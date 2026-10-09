// Refresh the standalone demo's public project snapshot and embedded author images.
// Run explicitly: node design/github-demo-snapshot.mjs
import {getProjects, getAvatar} from './github-project-source.mjs';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
const destination = new URL('./github-projects-snapshot.js', import.meta.url);
const items = new Map();let last;
for (let page = 1; page <= 10; page++) {
  last = await getProjects(page);
  const previous = items.size;
  for (const item of last.items) items.set(item.link, item);
  console.log(`来源第 ${page} 页：${last.items.length} 条`);
  if (!last.hasMore || !last.items.length || previous === items.size) break;
}
const rows = [...items.values()], owners = [...new Set(rows.map(item => item.fullName.split('/')[0]))];
const avatars = new Map(), failed = [];let cursor = 0;
await Promise.all(Array.from({length:4}, async () => {
  while (cursor < owners.length) {
    const owner = owners[cursor++];
    try {const image = await getAvatar(owner);avatars.set(owner, `data:${image.type};base64,${image.body.toString('base64')}`);}
    catch {failed.push(owner);}
  }
}));
for (const item of rows) item.avatar = avatars.get(item.fullName.split('/')[0]) || item.avatar;
const snapshot = {...last, items:rows, fetchedAt:new Date().toISOString(), embeddedAvatars:avatars.size};
const backup = new URL(`../artifacts/validation/github-snapshot-${Date.now()}/`, import.meta.url);
await mkdir(backup, {recursive:true});
try {await writeFile(new URL('github-projects-snapshot-before.js', backup), await readFile(destination), {flag:'wx'});}
catch (error) {if (error.code !== 'ENOENT') throw error;}
await writeFile(destination, '// Public HelloGitHub project history with embedded GitHub author avatars.\nwindow.AZCINE_GITHUB_PROJECTS = ' + JSON.stringify(snapshot) + ';\n');
console.log(JSON.stringify({projects:rows.length, owners:owners.length, embeddedAvatars:avatars.size, failed, oldest:rows.at(-1)?.published, hasMore:last.hasMore}));
