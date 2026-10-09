// Read-only local project adapter for github-demo.html. No dependencies or data writes.
// Run from any directory: node <worktree>/design/github-demo.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { getProjects, getAvatar } from './github-project-source.mjs';

const root = new URL('../', import.meta.url);
const files = new Map([
  ['/', ['design/github-demo.html', 'text/html; charset=utf-8']],
  ['/design/github-demo.html', ['design/github-demo.html', 'text/html; charset=utf-8']],
  ['/design/github-projects-snapshot.js', ['design/github-projects-snapshot.js', 'text/javascript; charset=utf-8']],
  ['/github-projects-snapshot.js', ['design/github-projects-snapshot.js', 'text/javascript; charset=utf-8']],
  ...['tokens', 'base', 'app'].map(name => [`/app/src/styles/${name}.css`, [`app/src/styles/${name}.css`, 'text/css; charset=utf-8']]),
  ['/app/src/components/ui/controls.css', ['app/src/components/ui/controls.css', 'text/css; charset=utf-8']],
  ['/assets/brand/logo-lockup.png', ['assets/brand/logo-lockup.png', 'image/png']],
]);
const cached = new Map(), pending = new Map();
async function projects(page) {
  const previous = cached.get(page);
  if (previous && Date.now() - previous.at < 60000) return previous.body;
  if (pending.has(page)) return pending.get(page);
  const job = getProjects(page).then(data => {
    const body = JSON.stringify(data);
    cached.set(page, {body, at: Date.now()});
    return body;
  });
  pending.set(page, job);
  try {return await job;} finally {pending.delete(page);}
}
const server = http.createServer(async (request, response) => {
  const send = (status, type, body) => {response.writeHead(status, {'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(body);};
  if (request.method !== 'GET') return send(405, 'text/plain', 'Method not allowed');
  const host = `127.0.0.1:${server.address().port}`;
  if (request.headers.host !== host) return send(403, 'text/plain', 'Invalid host');
  if (request.headers.origin && request.headers.origin !== `http://${host}`) return send(403, 'text/plain', 'Invalid origin');
  let pathname;
  try {pathname = new URL(request.url, `http://${host}`).pathname;} catch {return send(400, 'text/plain', 'Invalid URL');}
  if (pathname === '/api/github-projects') {
    const page = Number(new URL(request.url, `http://${host}`).searchParams.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1) return send(400, 'text/plain', 'Invalid page');
    try {send(200, 'application/json; charset=utf-8', await projects(page));}
    catch {send(502, 'text/plain; charset=utf-8', 'HelloGitHub 暂时无法读取，请稍后重试。');}
    return;
  }
  if (pathname === '/api/github-avatar') {
    const owner = new URL(request.url, `http://${host}`).searchParams.get('owner') || '';
    try {const avatar = await getAvatar(owner);send(200, avatar.type, avatar.body);}
    catch {send(404, 'text/plain', 'Avatar unavailable');}
    return;
  }
  const file = files.get(pathname);
  if (!file) return send(404, 'text/plain', 'Not found');
  try {send(200, file[1], await readFile(new URL(file[0], root)));}
  catch {send(404, 'text/plain', 'File not found');}
});
server.on('error', error => {console.error(`GitHub demo 无法启动：${error.message}`);process.exitCode = 1;});
server.listen(0, '127.0.0.1', () => {
  console.log(`GitHub demo：http://127.0.0.1:${server.address().port}/design/github-demo.html`);
  console.log('仅本机访问、只读抓取 HelloGitHub 具体项目。按 Ctrl+C 停止。');
});
