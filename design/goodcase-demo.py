"""Read-only GoodCase adapter for the standalone HTML demo; Python stdlib only."""
from __future__ import annotations

import base64
import concurrent.futures
import datetime
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts/validation/goodcase-demo-20261009'
PAGE = ROOT / 'design/ai-video-demo.html'
DATA = OUT / 'rankings-data.json'
ORIGIN = 'https://goodcase.ai'
LOCK = threading.Lock()
DETAILS = {}
RANK_PAGES = {}
CATEGORIES = ('video', 'image', 'web', 'hardware')
SORTS = ('heat', 'stability', 'latest')


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def text(self):
        return ''.join(x.text() if isinstance(x, Node) else x for x in self.children).strip()

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.walk()

    def find(self, tag):
        return next((x for x in self.walk() if x.tag == tag), Node())


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.root = Node()
        self.stack = [self.root]
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in {'img', 'meta', 'link', 'input', 'br', 'hr', 'source', 'wbr', 'area', 'base', 'embed'}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'AZCine-GoodCase-Demo/2.0'})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read()


def document(route, cached=False):
    name = (route.strip('/') or 'home').replace('/', '-').replace('?', '-').replace('&', '-')
    path = OUT / (name + '.txt')
    if cached and path.exists():
        return path.read_text(encoding='utf-8')
    text = download(ORIGIN + route).decode('utf-8')
    path.write_text(text, encoding='utf-8')
    return text


def flight(text):
    return ''.join(json.loads(s) for s in re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', text))


def values(text, key):
    decoder = json.JSONDecoder()
    result = []
    for match in re.finditer('"' + re.escape(key) + '":', text):
        try:
            value, _ = decoder.raw_decode(text[match.end():])
            result.append(value)
        except (ValueError, TypeError):
            continue
    return result


def absolute(url):
    if not isinstance(url, str) or not url or url.startswith('$'):
        return ''
    return urllib.parse.urljoin(ORIGIN, url)


def unique(items, key='slug'):
    seen, result = set(), []
    for item in items:
        value = item.get(key)
        if value and value not in seen:
            seen.add(value)
            result.append(item)
    return result


def image(node):
    picture = node.find('img').attrs
    src = absolute(picture.get('src', ''))
    parsed = urllib.parse.urlparse(src)
    if parsed.path == '/_next/image':
        src = absolute(urllib.parse.parse_qs(parsed.query).get('url', [''])[0])
    return src


def case_items(text):
    return unique([x for x in values(flight(text), 'item') if isinstance(x, dict) and x.get('slug') and x.get('title')])


def category_of(node):
    labels = {'AI 视频': 'video', 'AI 图像': 'image', 'AI 编程(UI)': 'web', 'AI 硬件': 'hardware'}
    return next((labels[n.text()] for n in node.walk() if n.text() in labels), '')


def ranking_route(category, sort, page):
    if category not in CATEGORIES or sort not in SORTS or not isinstance(page, int) or page < 1:
        raise ValueError('Invalid ranking selection')
    return '/cases?filter=' + category + ('&sort=' + sort if sort != 'heat' else '') + '&page=' + str(page)


def parse_ranking(raw, category, sort, page):
    root = Document(raw).root
    items = [x for x in case_items(raw) if x.get('category') == category]
    counts = [re.search(r'第\s*[\d,]+\s*[–—-]\s*[\d,]+\s*条[，,]\s*共\s*([\d,]+)\s*条', n.text())
              for n in root.walk() if n.tag == 'p']
    total = next((int(m.group(1).replace(',', '')) for m in counts if m), None)
    if total is None:
        count = re.search(r'当前结果\s*([\d,]+)\s*案例', root.text())
        total = int(count.group(1).replace(',', '')) if count else None
    if total is None or (total > 0 and not items):
        raise ValueError('GoodCase ranking structure changed; existing content preserved')
    has_more = False
    for node in root.walk():
        if node.tag != 'a':
            continue
        link = urllib.parse.urlparse(node.attrs.get('href', ''))
        query = urllib.parse.parse_qs(link.query)
        if (link.path == '/cases' and query.get('filter') == [category]
                and query.get('sort', ['heat']) == [sort] and query.get('page') == [str(page + 1)]):
            has_more = True
    return {'category': category, 'sort': sort, 'page': page, 'items': items,
            'total': total, 'hasMore': has_more, 'url': ORIGIN + ranking_route(category, sort, page)}


def ranking_page(category, sort, page):
    route = ranking_route(category, sort, page)
    prior = RANK_PAGES.get(route)
    if prior and time.time() - prior[0] < 60:
        return prior[1]
    result = parse_ranking(document(route), category, sort, page)
    RANK_PAGES[route] = (time.time(), result)
    return result


def collect(cached=False):
    OUT.mkdir(parents=True, exist_ok=True)
    routes = ['/', '/models', '/skills', '/daily', '/creators']
    routes += [ranking_route(category, sort, 1) for category in CATEGORIES for sort in SORTS]
    routes += ['/creators?page=2', '/creators?page=3']
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        pages = dict(zip(routes, pool.map(lambda route: document(route, cached), routes)))
    home = Document(pages['/']).root
    groups = [x for x in values(flight(pages['/']), 'tabs') if isinstance(x, list) and x and isinstance(x[0], dict) and 'rows' in x[0]]
    if len(groups) < 2:
        raise ValueError('GoodCase ranking structure changed; previous snapshot preserved')
    result = {'capturedAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
              'heat': groups[0], 'stability': groups[1], 'weekly': [], 'models': [],
              'skills': [], 'daily': [], 'creators': [], 'cases': [], 'rankings': {}}
    for group in groups[:2]:
        for tab in group:
            for row in tab['rows']:
                result['cases'].append({**row['media'], 'url': absolute(row['href'])})
    for anchor in (n for n in home.walk() if n.tag == 'a'):
        href, text = anchor.attrs.get('href', ''), anchor.text()
        if href.startswith('/cases/') and re.search(r'本周\s*\d+\s*人看过', text):
            result['weekly'].append({'slug': href.split('/')[-1], 'url': absolute(href), 'title': anchor.find('h3').text() or re.split(r'本周\s*\d+', text)[0],
                                     'text': text, 'posterUrl': image(anchor)})
    for category in CATEGORIES:
        result['rankings'][category] = {}
        for sort in SORTS:
            route = ranking_route(category, sort, 1)
            listing = parse_ranking(pages[route], category, sort, 1)
            result['rankings'][category][sort] = listing
            result['cases'].extend(listing['items'])
    for node in Document(pages['/models']).root.walk():
        if node.tag == 'a' and node.attrs.get('href', '').startswith('/models/') and node.find('h2').text():
            category = next((value for label, value in [('视频', 'video'), ('图像', 'image'), ('网页', 'web'), ('硬件', 'hardware')] if node.text().startswith(label)), '')
            result['models'].append({'title': node.find('h2').text(), 'text': node.text(), 'url': absolute(node.attrs['href']), 'category': category})
    for node in Document(pages['/skills']).root.walk():
        if node.tag != 'article':
            continue
        title = node.find('h3')
        anchor = title.find('a')
        if anchor.attrs.get('href'):
            paragraphs = [x.text() for x in node.walk() if x.tag == 'p']
            result['skills'].append({'title': title.text(), 'url': absolute(anchor.attrs['href']),
                                    'summary': paragraphs[0] if paragraphs else '', 'text': node.text(),
                                    'posterUrl': image(node), 'category': category_of(node)})
    for route in ['/creators', '/creators?page=2', '/creators?page=3']:
        for node in Document(pages[route]).root.walk():
            if node.tag != 'article':
                continue
            anchor = next((x for x in node.walk() if x.tag == 'a' and x.attrs.get('href', '').startswith('/creators/')), None)
            if anchor:
                headings = [x.text() for x in node.walk() if x.tag in {'h2', 'h3'}]
                paragraphs = [x.text() for x in node.walk() if x.tag == 'p']
                result['creators'].append({'title': headings[0] if headings else anchor.text(),
                                          'url': absolute(anchor.attrs['href']), 'summary': paragraphs[0] if paragraphs else node.text(),
                                          'text': node.text(), 'posterUrl': image(node), 'category': category_of(node)})
    daily = Document(pages['/daily']).root
    result['dailyTitle'] = daily.find('h1').text()
    for node in daily.walk():
        if node.tag == 'a' and re.match(r'/daily/\d{4}-\d{2}-\d{2}$', node.attrs.get('href', '')):
            spans = [n.text() for n in node.walk() if n.tag == 'span']
            if len(spans) >= 2:
                result['daily'].append({'url': absolute(node.attrs['href']), 'date': spans[0], 'title': spans[1], 'count': spans[2] if len(spans) > 2 else ''})
    result['dailyCases'] = case_items(pages['/daily'])
    result['cases'].extend(result['dailyCases'])
    result['cases'].extend(result['weekly'])
    merged = {}
    for item in result['cases']:
        merged[item['slug']] = {**merged.get(item['slug'], {}), **{k: v for k, v in item.items() if v is not None and v != ''}}
    result['cases'] = list(merged.values())
    result['weekly'] = unique(result['weekly'])
    for key in ['models', 'skills', 'daily', 'creators']:
        result[key] = unique(result[key], 'url')
    # Preserve official complete prompts from the already downloaded bulk snapshot.
    bulk = OUT / 'llms-full.txt.txt'
    prompt_index = {}
    if bulk.exists():
        for match in re.finditer(r'^## ([^\n]+)\nURL: (https://goodcase\.ai/cases/[^\n]+)\n(.*?)(?=^## |\Z)', bulk.read_text(encoding='utf-8'), re.M | re.S):
            title, url, text = match.groups()
            slug = urllib.parse.urlparse(url).path.split('/')[-1]
            original = text.partition('Prompt:\n')[2].rstrip()
            # The source separates entries with a markdown horizontal rule.
            original = re.sub(r'\n---\s*$', '', original).rstrip()
            creator = re.search(r'^Creator: (.*)$', text, re.M)
            source = re.search(r'^Source: (.*)$', text, re.M)
            category = re.search(r'^Category: (.*)$', text, re.M)
            prompt_index[slug] = {'title': title, 'promptFull': original, 'creator': creator.group(1) if creator else '',
                                  'sourceUrl': source.group(1) if source else '', 'url': url,
                                  'category': category.group(1).strip() if category else ''}
    result['bulkCount'] = len(prompt_index)
    result['cases'] = [{**prompt_index.get(x['slug'], {}), **x} for x in result['cases']]
    case_index = {x['slug']: x for x in result['cases']}
    result['weekly'] = [{**case_index[x['slug']], **x} for x in result['weekly'] if x['slug'] in case_index]
    result['daily'] = []
    result.pop('dailyTitle', None)
    result['sources'] = [ORIGIN + route for route in routes]
    return result


def persist(data):
    DATA.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    html = PAGE.read_text(encoding='utf-8')
    payload = json.dumps(data, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    html = re.sub(r'(<script id="snapshot" type="application/json">).*?(</script>)',
                  lambda m: m.group(1) + payload + m.group(2), html, count=1, flags=re.S)
    PAGE.write_text(html, encoding='utf-8')


def case_detail(slug):
    if slug in DETAILS and time.time() - DETAILS[slug][0] < 300:
        return DETAILS[slug][1]
    data = json.loads(download(ORIGIN + '/api/public/cases/' + urllib.parse.quote(slug) + '?locale=zh-CN'))
    if not isinstance(data, dict) or not isinstance(data.get('promptFull'), str):
        raise ValueError('Unexpected case response')
    DETAILS[slug] = (time.time(), data)
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, data, content_type='application/json; charset=utf-8', status=200):
        payload = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path in {'/', '/ai-video-demo.html'}:
                return self.send(PAGE.read_bytes(), 'text/html; charset=utf-8')
            if parsed.path == '/api/snapshot':
                return self.send(DATA.read_bytes())
            if parsed.path == '/api/rankings':
                query = urllib.parse.parse_qs(parsed.query)
                category = query.get('category', ['video'])[0]
                sort = query.get('sort', ['heat'])[0]
                page_text = query.get('page', ['1'])[0]
                if category not in CATEGORIES or sort not in SORTS or not re.fullmatch(r'[1-9][0-9]{0,5}', page_text):
                    return self.send({'error': 'Invalid ranking selection'}, status=400)
                return self.send(ranking_page(category, sort, int(page_text)))
            if parsed.path.startswith('/api/case/'):
                slug = urllib.parse.unquote(parsed.path[len('/api/case/'):])
                if not re.fullmatch(r'[a-zA-Z0-9_-]{1,300}', slug):
                    return self.send({'error': 'Invalid case ID'}, status=400)
                return self.send(case_detail(slug))
            if parsed.path.startswith('/api/retests/'):
                slug = parsed.path[len('/api/retests/'):]
                if not re.fullmatch(r'[a-zA-Z0-9_-]{1,300}', slug):
                    return self.send({'error': 'Invalid case ID'}, status=400)
                return self.send(download(ORIGIN + '/api/public/cases/' + slug + '/retests?locale=zh-CN'))
            return self.send({'error': 'Not found'}, status=404)
        except urllib.error.HTTPError as exc:
            self.send({'error': 'GoodCase HTTP ' + str(exc.code)}, status=502)
        except Exception as exc:
            self.send({'error': str(exc)}, status=502)

    def do_POST(self):
        if self.path != '/api/refresh':
            return self.send({'error': 'Not found'}, status=404)
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.headers.get('Host', ''):
            return self.send({'error': 'Origin mismatch'}, status=403)
        if not LOCK.acquire(blocking=False):
            return self.send({'error': 'Refresh already running'}, status=409)
        try:
            data = collect()
            persist(data)
            RANK_PAGES.clear()
            self.send(data)
        except Exception as exc:
            self.send({'error': str(exc)}, status=502)
        finally:
            LOCK.release()


if __name__ == '__main__':
    import argparse
    import os
    parser = argparse.ArgumentParser()
    parser.add_argument('--collect', action='store_true')
    parser.add_argument('--cached', action='store_true')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    if args.collect:
        data = collect(args.cached)
        persist(data)
        print(json.dumps({key: len(data[key]) for key in ['heat', 'stability', 'weekly', 'models', 'skills', 'dailyCases', 'creators', 'cases']}))
    else:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
        server.daemon_threads = True
        state = {'pid': os.getpid(), 'url': 'http://127.0.0.1:' + str(server.server_port), 'startedAt': datetime.datetime.now().isoformat()}
        (OUT / 'server-state.json').write_text(json.dumps(state), encoding='utf-8')
        print(json.dumps(state), flush=True)
        server.serve_forever()
