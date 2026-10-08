// Application-owned MCP stdio server. Pi loads this through its native MCP client.
// Business access returns to the running Rust application; no Pi core/extension patch.
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const address = process.env.AZCINE_BUSINESS_ADDR;
const grant = process.env.AZCINE_MCP_GRANT;
const sockets = new Map();
const supported = ['2025-11-25', '2025-06-18', '2024-11-05'];
const write = value => {
  let text = JSON.stringify(value);
  if (Buffer.byteLength(text) >= 16 * 1024 * 1024) {
    text = JSON.stringify({ jsonrpc: '2.0', id: value.id ?? null, error: { code: -32603, message: '结果超过传输上限，请缩小查询；操作可能已完成，请先查询实际状态。' } });
  }
  process.stdout.write(`${text}\n`);
};
const business = (method, params, id) => new Promise((resolve, reject) => {
  if (!address || !grant) {
    if (method === 'tools/list') return resolve({ tools: [] });
    if (method === 'resources/list') return resolve({ resources: [] });
    if (method === 'resources/templates/list') return resolve({ resourceTemplates: [] });
    return reject(new Error('本进程没有工作台业务连接。'));
  }
  const [host, port] = address.split(':');
  if (host !== '127.0.0.1' || !/^\d+$/.test(port)) return reject(new Error('业务连接不可用。'));
  const socket = net.createConnection({ host, port: Number(port) });
  let text = '';
  const decoder = new StringDecoder('utf8');
  sockets.set(id, socket);
  socket.setTimeout(300_000, () => socket.destroy(new Error('业务请求超时；请查询实际状态，未自动重发。')));
  socket.on('connect', () => socket.write(`${JSON.stringify({ grant, method, params })}\n`));
  socket.on('data', chunk => {
    text += decoder.write(chunk);
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) return socket.destroy(new Error('结果超过读取上限，请缩小查询。'));
    if (!text.includes('\n')) return;
    socket.end();
    try {
      const reply = JSON.parse(text.slice(0, text.indexOf('\n')));
      if (reply.error) reject(new Error(reply.error)); else resolve(reply.result);
    } catch { reject(new Error('业务回执无效；未报告成功。')); }
  });
  socket.on('error', () => reject(new Error('业务连接中断；请查询实际状态，未自动重发。')));
  socket.on('close', () => { sockets.delete(id); reject(new Error('业务连接关闭；未收到确认回执。')); });
});

async function call(request) {
  const { id, method, params = {} } = request;
  if (id === undefined) {
    if (method === 'notifications/cancelled') sockets.get(params.requestId)?.destroy();
    return;
  }
  try {
    let result;
    if (method === 'initialize') {
      result = {
        protocolVersion: supported.includes(params.protocolVersion) ? params.protocolVersion : supported[0],
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'azcine', version: '1.0.0' },
        instructions: 'AZCine 工作台业务能力。先查询能力、上下文和对象，使用真实标识与版本提交变更草案。prepare_changes 只保存待本人核对的草案；正式保存状态以 get_draft 的应用回执为准。通过工具自行检索跨模块资料，不依赖聊天中的附加对象。',
      };
    } else if (method === 'ping') result = {};
    else if (['tools/list', 'tools/call', 'resources/list', 'resources/read', 'resources/templates/list'].includes(method)) {
      result = await business(method, params, id);
      // Only the Rust application may supply an owned attachment path. Validate
      // content against its stored digest immediately before returning the image.
      if (result?.attachmentImage) {
        const info = result.attachmentImage;
        const bytes = await readFile(info.path);
        if (bytes.length !== info.bytes || createHash('sha256').update(bytes).digest('hex') !== info.hash) throw new Error('附件已变化，请重新导入。');
        const raster = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
          : ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()) ? 'image/gif'
          : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : null;
        if (!raster) throw new Error('附件不是支持的图片。');
        delete result.attachmentImage;
        if (bytes.length <= 8 * 1024 * 1024) result.content.push({ type: 'image', data: bytes.toString('base64'), mimeType: raster });
        else {
          // Native Pi MCP has a 16MiB JSON-RPC message limit. Reuse upstream's
          // own image processor for the model view; keep the original intact.
          const packageDir = process.env.PI_PACKAGE_DIR;
          if (!packageDir) throw new Error('图片预览处理器不可用，原副本保留。');
          const { resizeImage, formatDimensionNote } = await import(pathToFileURL(join(packageDir, 'dist/utils/image-resize.js')).href);
          const preview = await resizeImage(bytes, raster, { maxWidth: 4096, maxHeight: 4096, maxBytes: 8 * 1024 * 1024 });
          if (!preview || preview.data.length > 12 * 1024 * 1024) throw new Error('图片预览无法生成，原副本保留，可用原生文件工具读取。');
          result.content.push({ type: 'text', text: formatDimensionNote(preview) || '用于模型查看的图片预览；原副本未修改。' });
          result.content.push({ type: 'image', data: preview.data, mimeType: preview.mimeType });
        }
      }
    } else { write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }); return; }
    write({ jsonrpc: '2.0', id, result });
  } catch (error) {
    // Business failures are MCP tool failures, retaining their actionable reason.
    const message = error instanceof Error ? error.message : '业务调用失败。';
    if (method === 'tools/call') write({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: message }] } });
    else write({ jsonrpc: '2.0', id, error: { code: -32603, message } });
  }
}
let pending = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk]);
  if (pending.length > 8 * 1024 * 1024) process.exit(1);
  for (let end; (end = pending.indexOf(10)) >= 0;) {
    const line = pending.subarray(0, end).toString('utf8'); pending = pending.subarray(end + 1);
    try {
      const request = JSON.parse(line);
      if (request.jsonrpc !== '2.0' || typeof request.method !== 'string' || Array.isArray(request)) throw new Error();
      void call(request);
    } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC request' } }); }
  }
});
process.stdin.on('end', () => { for (const socket of sockets.values()) socket.destroy(); process.exit(0); });
