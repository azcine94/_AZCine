// Public HelloGitHub homepage data, also used by RSSHub's hellogithub/home route.
// This feed is per repository; https://hellogithub.com/rss is per magazine issue.
export async function getProjects(page = 1) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('invalid_page');
  const response = await fetch(`https://api.hellogithub.com/v1/?sort_by=featured&page=${page}`, {
    signal: AbortSignal.timeout(20000), redirect: 'error',
    headers: { 'User-Agent': 'AZCine-GitHub-Demo/2.0', Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error('来源数据过大');
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (payload.success !== true || !Array.isArray(payload.data)) throw new Error('来源格式变化');
  const items = payload.data.flatMap(item => {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.full_name || '')) return [];
    return [{
      id: item.item_id, name: item.name, fullName: item.full_name,
      link: `https://github.com/${item.full_name}`, title: item.title || '', summary: item.summary || '',
      author: item.author || item.full_name.split('/')[0], avatar: `https://avatars.githubusercontent.com/${encodeURIComponent(item.full_name.split('/')[0])}?s=96`,
      language: item.primary_lang || '', published: item.updated_at ? `${item.updated_at}${/Z$|[+-]\d\d:\d\d$/.test(item.updated_at) ? '' : '+08:00'}` : '',
      views: Number.isFinite(item.clicks_total) ? item.clicks_total : null,
      comments: Number.isFinite(item.comment_total) ? item.comment_total : null,
    }];
  });
  if (payload.data.length && !items.length) throw new Error('没有有效的 GitHub 仓库');
  return { source: 'https://hellogithub.com/?sort_by=featured', fetchedAt: new Date().toISOString(), page, hasMore: payload.has_more === true, items };
}

const avatarCache = new Map();
export async function getAvatar(owner) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)) throw new Error('invalid_owner');
  if (avatarCache.has(owner)) return avatarCache.get(owner);
  const job = (async () => {
    const response = await fetch(`https://avatars.githubusercontent.com/${encodeURIComponent(owner)}?s=96`, {
      signal: AbortSignal.timeout(15000), headers: {'User-Agent':'AZCine-GitHub-Demo/3.0'},
    });
    if (!response.ok) throw new Error('avatar_unavailable');
    const type = response.headers.get('content-type')?.split(';')[0];
    if (!['image/png','image/jpeg','image/webp','image/gif'].includes(type)) throw new Error('invalid_image');
    const chunks = [];let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;if (size > 2 * 1024 * 1024) throw new Error('image_too_large');chunks.push(chunk);
    }
    return {type, body:Buffer.concat(chunks)};
  })();
  avatarCache.set(owner, job);
  try {return await job;} catch (error) {avatarCache.delete(owner);throw error;}
}
