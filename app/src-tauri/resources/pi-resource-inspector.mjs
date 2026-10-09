// Application-owned inspector and native settings writer. Imports the installed
// upstream SDK; never creates an agent, executes a factory, or calls a model.
import { createInterface } from 'node:readline';
import { readFileSync, existsSync, realpathSync, lstatSync, statSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const MAX_FILE = 128 * 1024;
function samePath(a, b) { return typeof a === 'string' && typeof b === 'string' && (b.startsWith('builtin:') ? a === b : relative(a.replace(/^\\\\\?\\/, ''), b.replace(/^\\\\\?\\/, '')) === ''); }
function inside(path, root) { const rel = relative(root, path); return !rel.startsWith('..') && !isAbsolute(rel); }
function owned(path, roots) {
  if (!isAbsolute(path) || !roots.some(root => inside(path, root))) return false;
  let cursor = path;
  while (true) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) return false;
    const next = dirname(cursor); if (next === cursor) break; cursor = next;
  }
  return !existsSync(path) || roots.some(root => inside(realpathSync(path), root));
}
function document(path, roots) {
  if (!['.md', '.ts', '.js', '.mjs', '.cjs'].includes(extname(path).toLowerCase())) return { content: '', hash: null, editable: false, error: '只预览规则、Skill 和扩展文本，不读取认证或模型配置。' };
  if (!owned(path, roots)) return { content: '', hash: null, editable: false, error: '此资源不在本应用独立目录内，未读取内容。' };
  if (!existsSync(path)) return { content: '', hash: null, editable: true, error: null };
  try {
    if (!statSync(path).isFile() || statSync(path).size > MAX_FILE) throw new Error('large');
    const bytes = readFileSync(path);
    if (bytes.length > MAX_FILE) throw new Error('large');
    return { content: bytes.toString('utf8'), hash: createHash('sha256').update(bytes).digest('hex'), editable: true, error: null };
  } catch { return { content: '', hash: null, editable: false, error: '文件不可读取，或超过 128 KB 预览上限。' }; }
}

async function inspect(input) {
  for (const key of ['package', 'agent', 'cwd']) input[key] = input[key].replace(/^\\\\\?\\/, '');
  const dist = join(input.package, 'dist');
  const module = name => import(pathToFileURL(join(dist, name)).href);
  const [{ SettingsManager }, { DefaultPackageManager }, { loadSkills }, { buildSystemPrompt }, { createCodingTools }, { builtInExtensions }] = await Promise.all([
    module('core/settings-manager.js'), module('core/package-manager.js'), module('core/skills.js'),
    module('core/system-prompt.js'), module('core/tools/index.js'), module('extensions/index.js'),
  ]);
  const roots = [input.agent, join(dirname(input.agent), 'workspaces')];
  const settingsPath = join(input.agent, 'settings.json');
  // Native parser, read-only storage. Project settings outside owned workspaces
  // and host config/credentials are never supplied to this inspector.
  const settings = SettingsManager.fromStorage({ withLock(scope, fn) {
    const path = scope === 'global' ? settingsPath : join(input.cwd, '.pi', 'settings.json');
    if (owned(path, roots) && existsSync(path)) {
      if (statSync(path).size > MAX_FILE) throw new Error('settings-size');
      fn(readFileSync(path, 'utf8'));
    } else fn(undefined);
  } }, { projectTrusted: false });
  // Match the RPC process's native --no-approve policy BEFORE resolution.
  // Filtering the resulting list is too late: resolution walks ancestor
  // .agents/skills directories and follows their entries. User-scoped resources
  // explicitly installed/configured in this application's agentDir still work.
  if (settings.drainErrors().length) throw new Error('settings');
  const missing = [];
  const manager = new DefaultPackageManager({ cwd: input.cwd, agentDir: input.agent, settingsManager: settings, builtinExtensions: builtInExtensions.map(item => item.name) });
  const paths = await manager.resolve(async source => { missing.push(source); return 'skip'; });
  const tools = createCodingTools(input.cwd);
  const entries = [{ id: 'official:system', kind: 'official', name: 'Pi 官方默认提示词', path: join(dist, 'core/system-prompt.js'),
    description: '由当前安装的 Agent 构造，供只读查看；不代表扩展或用户配置修改后的会话最终提示词。',
    content: buildSystemPrompt({ cwd: input.cwd, selectedTools: tools.map(t => t.name), toolSnippets: Object.fromEntries(tools.map(t => [t.name, t.promptSnippet ?? ''])), toolGuidelines: Object.fromEntries(tools.map(t => [t.name, t.promptGuidelines ?? []])) }),
    hash: null, editable: false, enabled: true, loaded: false, toggleable: false, error: null, commands: [] }];
  for (const path of [join(input.agent, 'AGENTS.md'), join(input.cwd, 'AGENTS.md'), join(input.agent, 'SYSTEM.md'), join(input.agent, 'APPEND_SYSTEM.md')]) {
    if (!owned(path, roots) || (!existsSync(path) && path !== join(input.agent, 'AGENTS.md'))) continue;
    const name = basename(path), doc = document(path, roots);
    entries.push({ id: `rule:${path}`, kind: 'rule', name, path, description: name === 'AGENTS.md' ? (samePath(path, join(input.agent, 'AGENTS.md')) ? '工作台自有 AGENTS.md 会在连接或新建对话时明确加载；当前对话需重新连接。' : '工作目录的规则仅供查看；通用规则使用工作台自有 AGENTS.md。') : '原生系统提示词配置，重新连接后由 Pi 读取。', ...doc,
      enabled: name !== 'AGENTS.md' || samePath(path, join(input.agent, 'AGENTS.md')), loaded: false, toggleable: false, commands: [] });
  }
  const skills = loadSkills({ cwd: input.cwd, agentDir: input.agent, skillPaths: paths.skills.filter(item => item.enabled).map(item => item.path), includeDefaults: false });
  const disabledSkills = paths.skills.filter(item => !item.enabled).map(item => loadSkills({ cwd: input.cwd, agentDir: input.agent, skillPaths: [item.path], includeDefaults: false }));
  const allSkills = [...new Map([...skills.skills, ...disabledSkills.flatMap(result => result.skills)].map(skill => [skill.filePath, skill])).values()];
  for (const skill of allSkills) {
    const resource = paths.skills.find(item => item.path === skill.filePath || inside(skill.filePath, item.path));
    const commands = input.commands.filter(cmd => cmd.source === 'skill' && cmd.name === `skill:${skill.name}` && samePath(cmd.sourceInfo?.path, skill.filePath)).map(cmd => cmd.name);
    entries.push({ id: `skill:${skill.filePath}`, kind: 'skill', name: skill.name, path: skill.filePath, description: skill.description, ...document(skill.filePath, roots), enabled: resource?.enabled ?? true, loaded: commands.length > 0, toggleable: false, commands });
  }
  for (const cmd of input.commands.filter(cmd => cmd.source === 'skill')) {
    const path = cmd.sourceInfo?.path;
    if (path && !entries.some(item => item.kind === 'skill' && samePath(item.path, path))) entries.push({ id: `skill:${path}`, kind: 'skill', name: cmd.name.replace(/^skill:/, ''), path, description: cmd.description ?? '', ...document(path, roots), enabled: true, loaded: true, toggleable: false, commands: [cmd.name] });
  }
  for (const resource of paths.extensions) {
    const builtin = builtInExtensions.find(item => resource.path === `builtin:${item.name}`);
    const commands = input.commands.filter(cmd => cmd.source === 'extension' && samePath(cmd.sourceInfo?.path, resource.path)).map(cmd => cmd.name);
    const doc = builtin ? { content: builtin.factory.toString(), hash: null, editable: false, error: null } : document(resource.path, roots);
    entries.push({ id: `extension:${resource.path}`, kind: 'extension', name: builtin?.name ?? basename(resource.path), path: resource.path,
      description: builtin ? 'Agent 内置扩展，预览为 Agent 工厂函数。' : '原生扩展源码预览；读取不会执行扩展。', ...doc, editable: false,
      enabled: resource.enabled, loaded: commands.length > 0, toggleable: resource.metadata.scope === 'user' && (Boolean(builtin) || owned(resource.path, roots)), commands });
  }
  // Include registrations from extensions without a locally resolved file entry.
  for (const cmd of input.commands.filter(cmd => cmd.source === 'extension')) {
    const path = cmd.sourceInfo?.path;
    if (path && !entries.some(item => item.kind === 'extension' && samePath(item.path, path))) entries.push({ id: `extension:${path}`, kind: 'extension', name: path, path, description: cmd.description ?? '', content: '', hash: null, editable: false, enabled: true, loaded: true, toggleable: false, error: null, commands: input.commands.filter(item => samePath(item.sourceInfo?.path, path)).map(item => item.name) });
  }
  if (entries.length > 200 || JSON.stringify(entries).length > 1024 * 1024) throw new Error('limit');
  return { entries, diagnostics: [...skills.diagnostics, ...disabledSkills.flatMap(result => result.diagnostics)].map(item => `${item.path ?? ''}: ${item.message}`).concat(missing.map(source => `包未安装，已跳过：${source}`)), agentDir: input.agent, cwd: input.cwd, settingsHash: existsSync(settingsPath) ? createHash('sha256').update(readFileSync(settingsPath)).digest('hex') : null, settingsDocument: settings.getGlobalSettings() };
}

const lines = createInterface({ input: process.stdin, terminal: false });
for await (const line of lines) {
  const request = JSON.parse(line);
  try {
    let data;
    if (request.type === 'models') {
      const { ModelRuntime } = await import(pathToFileURL(join(request.input.package, 'dist/core/model-runtime.js')).href);
      const { ReadOnlyAuthStorage } = await import(pathToFileURL(join(request.input.package, 'dist/core/auth-storage.js')).href);
      // Rust already holds the native config/cache locks. FileAuthStorage would
      // reacquire auth.json and deadlock against our caller. Use upstream's
      // read-only credential API and a read-only cache snapshot; no nested locks,
      // credential refresh, cache writes or network are needed to list models.
      const cachePath = join(request.input.agent, 'models-store.json');
      const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8').replace(/^\uFEFF/, '')) : {};
      const modelsStore = {
        async read(providerId, options) { options?.signal?.throwIfAborted(); return structuredClone(cache[providerId]); },
        async write() { throw new Error('read-only model catalog'); },
        async delete() { throw new Error('read-only model catalog'); },
      };
      const runtime = await ModelRuntime.create({ modelsPath: join(request.input.agent, 'models.json'),
        credentials: new ReadOnlyAuthStorage(join(request.input.agent, 'auth.json')), modelsStore, allowModelNetwork: false });
      if (runtime.getError()) throw new Error('models');
      data = runtime.getAvailableSnapshot().map(model => ({ id: model.id, name: model.name, provider: model.provider, api: model.api, input: model.input, reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens, ...(model.thinkingLevelMap ? {thinkingLevelMap:model.thinkingLevelMap} : {}) }));
    }
    else if (request.type === 'resources') data = await inspect(request.input);
    else if (request.type === 'save_extensions') {
      const input = request.input;
      const agent = input.agent.replace(/^\\\\\?\\/, '');
      const path = join(agent, 'settings.json');
      if (!owned(path, [agent]) || typeof input.document !== 'string' || Buffer.byteLength(input.document) > MAX_FILE) throw new Error('settings');
      const { FileSettingsStorage } = await import(pathToFileURL(join(input.package, 'dist/core/settings-manager.js')).href);
      new FileSettingsStorage(input.cwd, agent).withLock('global', current => {
        const hash = current === undefined ? null : createHash('sha256').update(current).digest('hex');
        if (hash !== input.hash) throw new Error('conflict');
        return input.document;
      });
      data = { saved: true };
    } else throw new Error('command');
    process.stdout.write(JSON.stringify({ type: 'response', id: request.id, command: request.type, success: true, data }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ type: 'response', id: request.id, command: request.type, success: false, errorCode: error.message === 'conflict' ? 'conflict' : 'resources' }) + '\n');
  }
}
