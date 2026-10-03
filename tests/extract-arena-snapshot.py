"""Offline design-data extraction from a captured public Arena page; never executes HTML.
Not an application crawler: no network, dependencies, credentials or automatic update.
"""
from pathlib import Path
from html.parser import HTMLParser
import hashlib
import json
import math
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'research/references/arena/arena-text-source-2026-10-02.txt'
EXPECTED = ROOT / 'research/references/arena/overall-top30.json'
OUTPUT = ROOT / 'design/model-data.js'
# This extractor is tied to one GET, not the source file's copy/rename timestamp.
SOURCE_SHA256 = '40ea395a1b1ab4c0c2b187b3b2680d5b7e4bb0d1e9cd3e65033a4da90e76f8b3'
CAPTURED_AT = '2026-10-02T09:03:51.154783+00:00'


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_script = False
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.in_script = True

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_script = False

    def handle_data(self, data):
        if self.in_script:
            self.scripts.append(data)


def extract(source):
    parser = Scripts()
    parser.feed(source)
    parts = []
    for script in parser.scripts:
        match = re.fullmatch(r'self\.__next_f\.push\((.*)\);?', script, re.S)
        if not match:
            continue
        value = json.loads(match[1])
        if isinstance(value, list) and len(value) > 1 and isinstance(value[1], str):
            parts.append(value[1])
    stream = ''.join(parts)
    marker = '"leaderboard":{"arenaSlug":"text","leaderboardSlug":"overall"'
    start = stream.find(marker)
    if start < 0:
        raise ValueError('Text Overall leaderboard not found; do not replace the old snapshot')
    board, _ = json.JSONDecoder().raw_decode(stream[start + len('"leaderboard":'):])
    if board['params'] != {'category': 'overall', 'styleControl': True}:
        raise ValueError('Unexpected Arena settings; check the source before changing the snapshot')
    rows = board['entries'][:30]
    if len(rows) != 30 or [r['rank'] for r in rows] != list(range(1, 31)):
        raise ValueError('Incomplete or unexpected top30; never pad or invent rows')
    keys = ('rank', 'rankUpper', 'rankLower', 'modelDisplayName', 'modelOrganization',
            'rating', 'ratingUpper', 'ratingLower', 'votes', 'inputPricePerMillion',
            'outputPricePerMillion', 'releaseType')
    for row in rows:
        if not row['modelDisplayName'] or not math.isfinite(row['rating']) or row['votes'] < 0:
            raise ValueError('Invalid model or rating')
        for key in ('inputPricePerMillion', 'outputPricePerMillion'):
            if row[key] is not None and (not math.isfinite(row[key]) or row[key] < 0):
                raise ValueError('Invalid price')
    return board, [{key: row[key] for key in keys} for row in rows]


if __name__ == '__main__':
    raw = SOURCE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError('Source changed; capture new evidence before replacing this snapshot')
    board, rows = extract(raw.decode('utf-8'))
    snapshot = {
        'sourceUrl': 'https://arena.ai/leaderboard/text',
        'sourceSha256': hashlib.sha256(raw).hexdigest(),
        'capturedAt': CAPTURED_AT,
        'voteCutoff': board['voteCutoffISOString'],
        'arena': 'Text Arena',
        'category': 'Overall',
        'styleControl': True,
        'totalModels': board['totalModels'],
        'totalVotes': board['totalVotes'],
        'rows': rows,
    }
    text = json.dumps(snapshot, ensure_ascii=False, indent=2)
    EXPECTED.write_text(text + '\n', encoding='utf-8')
    OUTPUT.write_text('/* Public Arena Text Overall snapshot. No live network or model calls. */\n'
                      'window.AZ_MODELS = ' + text + ';\n', encoding='utf-8')
    print(json.dumps({'rows': len(rows), 'voteCutoff': snapshot['voteCutoff'],
                      'sourceSha256': snapshot['sourceSha256']}, ensure_ascii=False))
