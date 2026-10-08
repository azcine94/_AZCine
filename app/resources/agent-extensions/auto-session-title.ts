import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

/** Generic Pi extension: name a new, unnamed session after its first completed turn. */
const TITLE_PROMPT = `Give this coding assistant session a specific, short title in the user's language.
Reply with exactly one plain-text line, preferably under 32 characters. No quotes, Markdown, or explanation.
Never include API keys, passwords, tokens, private identifiers, or other secrets.`;
const SECRET = /(-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{16,})\b|\b(?:api[_ -]?key|token|secret|password|cookie|authorization)\b\s*[:=]\s*\S+|[?&](?:api[_-]?key|token|secret|password)=\S+)/gi;
const TIMEOUT_MS = 20_000;

function safeText(text: string, max: number): string {
  return Array.from(text.replace(SECRET, '[REDACTED]').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

function firstUserText(ctx: ExtensionContext): string | undefined {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== 'message' || entry.message.role !== 'user') continue;
    const content = entry.message.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((item) => item.type === 'text').map((item) => item.text).join(' ')
        : '';
    // AZCine appends transport metadata; titles must use only the user's request.
    const request = text.replace(/\x60\x60\x60azcine-(?:context|draft)\r?\n[\s\S]*?\x60\x60\x60/g, '').trim();
    if (request && !/^\s*\/[\w:-]+(?:\s|$)/.test(request)) return safeText(request, 900);
  }
  return undefined;
}

function cleanTitle(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const line = content.filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text).join(' ').split(/\r?\n/)[0]?.trim();
  if (!line) return undefined;
  const title = line.replace(/^(?:title|标题|会话标题)\s*[:：]\s*/i, '')
    .replace(/^[#*`"'“”「」\s]+|[#*`"'“”「」\s]+$/g, '')
    .replace(/\s+/g, ' ').trim();
  SECRET.lastIndex = 0;
  if (title.length < 2 || Array.from(title).length > 64 || SECRET.test(title)) {
    SECRET.lastIndex = 0;
    return undefined;
  }
  SECRET.lastIndex = 0;
  return title;
}

export default function autoSessionTitle(pi: ExtensionAPI) {
  let generation = 0;
  let eligible = false;
  let attempted = false;
  let manualNameChanged = false;
  let applyingOwnName = false;
  let pending: AbortController | undefined;

  pi.on('session_start', (event, ctx) => {
    pending?.abort();
    pending = undefined;
    generation++;
    manualNameChanged = false;
    attempted = false;
    // A startup may restore a session: inspect history, not only the start reason.
    const branch = ctx.sessionManager.getBranch();
    eligible = (event.reason === 'new' || event.reason === 'startup')
      && !pi.getSessionName()
      && !branch.some((entry) => entry.type === 'message' && (entry.message.role === 'user' || entry.message.role === 'assistant'));
  });

  pi.on('session_info_changed', () => {
    if (applyingOwnName) return;
    manualNameChanged = true;
    pending?.abort();
  });

  pi.on('session_shutdown', () => {
    generation++;
    eligible = false;
    pending?.abort();
    pending = undefined;
  });

  pi.on('agent_settled', (_event, ctx) => {
    if (!eligible || attempted || manualNameChanged || pi.getSessionName() || !ctx.model) return;
    const userText = firstUserText(ctx);
    if (!userText) return;
    attempted = true;
    const epoch = generation;
    const id = ctx.sessionManager.getSessionId();
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    timeout.unref?.();
    const model = ctx.model;
    const current = () => !controller.signal.aborted && generation === epoch
      && ctx.sessionManager.getSessionId() === id && !manualNameChanged && !pi.getSessionName();
    // Deliberately do not await: this optional request must not hold up the main agent.
    void ctx.modelRegistry.complete(model, {
      systemPrompt: TITLE_PROMPT,
      messages: [{ role: 'user', content: `First user request:\n${userText}`, timestamp: Date.now() }],
    }, { signal: controller.signal, maxTokens: 512, maxRetries: 0, timeoutMs: TIMEOUT_MS, cacheRetention: 'none' })
      .then((response) => {
        if (!current() || response.stopReason !== 'stop') return;
        const title = cleanTitle(response.content);
        if (!title || !current()) return;
        applyingOwnName = true;
        try {
          pi.setSessionName(title);
          eligible = false;
        } finally { applyingOwnName = false; }
      })
      .catch(() => { /* Optional title failure must not disrupt the conversation. */ })
      .finally(() => {
        clearTimeout(timeout);
        if (pending === controller) pending = undefined;
      });
  });
}
