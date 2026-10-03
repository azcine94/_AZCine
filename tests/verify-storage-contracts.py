"""Offline SQLite contract examples, not the AZCine schema or a production writer.
Only Python's standard library and fictional rows in a new validation directory.
No user data, credentials, Pi process, network, attachments or installed dependencies.
"""
from contextlib import closing
from datetime import date, datetime, timezone
from pathlib import Path
import hashlib
import json
import platform
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/validation' / ('storage-contracts-' + datetime.now(timezone.utc).isoformat().replace(':', '-').replace('.', '-'))
OUT.mkdir(parents=True, exist_ok=False)
checks = []
script_before = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def check(name, test):
    try:
        test()
        checks.append({'name': name, 'passed': True})
    except Exception as error:
        checks.append({'name': name, 'passed': False, 'error': str(error)})


def same(actual, expected):
    assert actual == expected, f'{actual!r} != {expected!r}'


def rejects(exception, operation):
    try:
        operation()
    except exception:
        return
    raise AssertionError(f'Expected {exception.__name__}')


def complete_date(value):
    # Example validation only: missing is allowed, incomplete/invalid is not guessed.
    if value is None:
        return None
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError('Full YYYY-MM-DD required')
    return value


SCHEMA = '''
PRAGMA foreign_keys = ON;
CREATE TABLE projects(id TEXT PRIMARY KEY);
CREATE TABLE stages(
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(project_id,id)
);
CREATE TABLE deliveries(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  item TEXT NOT NULL, stage_id TEXT, due TEXT, status TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(project_id,stage_id) REFERENCES stages(project_id,id)
);
CREATE TABLE revisions(row_id TEXT NOT NULL, old_due TEXT, new_due TEXT);
'''


def apply_example(db, changes, confirmed):
    # This local sample encodes the proposed contract. It is not app/Pi integration.
    if not confirmed:
        raise PermissionError('User confirmation required')
    with db:
        for row_id, old_due, old_revision, new_due in changes:
            complete_date(new_due)
            updated = db.execute('''UPDATE deliveries SET due=?,revision=revision+1
                WHERE id=? AND revision=? AND due IS ?''',
                (new_due, row_id, old_revision, old_due))
            if updated.rowcount != 1:
                raise ValueError('Baseline conflict; whole draft must be rechecked')
            db.execute('INSERT INTO revisions VALUES(?,?,?)', (row_id, old_due, new_due))


def delivery_rows(db):
    return db.execute('SELECT id,project_id,item,stage_id,due,status,revision FROM deliveries ORDER BY id').fetchall()


def run():
    with closing(sqlite3.connect(OUT / 'fictional.sqlite3')) as db:
        same(db.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
        db.executescript(SCHEMA)
        with db:
            db.executemany('INSERT INTO projects VALUES(?)', [('fictional-a',), ('fictional-b',)])
            db.executemany('INSERT INTO stages VALUES(?,?,?)', [
                ('fictional-a', 'stage-copy', 'ACOPY'), ('fictional-a', 'stage-final', 'FINAL'),
                ('fictional-b', 'stage-copy', 'ACOPY'), ('fictional-b', 'b-only', 'OTHER')])
            db.executemany('INSERT INTO deliveries VALUES(?,?,?,?,?,?,?)', [
                ('row-1', 'fictional-a', 'SHOT-DEMO-01', 'stage-copy', '2030-01-14', 'pending', 0),
                ('row-2', 'fictional-a', 'SHOT-DEMO-01', 'stage-final', '2030-01-20', 'pending', 0),
                ('row-3', 'fictional-a', 'SHOT-DEMO-02', None, None, None, 0),
                ('row-4', 'fictional-a', 'SHOT-DEMO-03', 'stage-copy', '2030-01-10', 'submitted', 0)])

        def independent_rows():
            same(db.execute('SELECT id,due FROM deliveries WHERE item=? ORDER BY id', ('SHOT-DEMO-01',)).fetchall(),
                 [('row-1', '2030-01-14'), ('row-2', '2030-01-20')])
        check('Same shot retains separate delivery IDs/dates', independent_rows)
        original = delivery_rows(db)
        check('Draft reads do not mutate formal records', lambda: same(delivery_rows(db), original))

        def confirmation_required():
            rejects(PermissionError, lambda: apply_example(db, [('row-1', '2030-01-14', 0, '2030-01-15')], False))
            same(delivery_rows(db), original)
        check('Unconfirmed sample change is rejected without mutation', confirmation_required)

        def one_delivery_change():
            apply_example(db, [('row-1', '2030-01-14', 0, '2030-01-15')], True)
            same(db.execute('SELECT id,due,revision FROM deliveries WHERE item=? ORDER BY id', ('SHOT-DEMO-01',)).fetchall(),
                 [('row-1', '2030-01-15', 1), ('row-2', '2030-01-20', 0)])
            same(db.execute('SELECT * FROM revisions').fetchall(), [('row-1', '2030-01-14', '2030-01-15')])
        check('Confirmed edit changes only targeted delivery and records old/new values', one_delivery_change)

        def rollback_all():
            before = delivery_rows(db)
            audit = db.execute('SELECT * FROM revisions').fetchall()
            rejects(ValueError, lambda: apply_example(db, [
                ('row-1', '2030-01-15', 1, '2030-01-16'),
                ('row-2', '2030-01-19', 0, '2030-01-21')], True))
            same(delivery_rows(db), before)
            same(db.execute('SELECT * FROM revisions').fetchall(), audit)
        check('Later-row baseline conflict rolls back earlier changes AND audit', rollback_all)

        def revision_conflict():
            before = delivery_rows(db)
            rejects(ValueError, lambda: apply_example(db, [('row-1', '2030-01-15', 0, '2030-01-16')], True))
            same(delivery_rows(db), before)
        check('Stale revision rejected even when old date matches', revision_conflict)

        def project_labels():
            with db:
                db.execute('UPDATE stages SET name=? WHERE project_id=? AND id=?', ('BCOPY', 'fictional-a', 'stage-copy'))
            same(db.execute('SELECT project_id,name FROM stages WHERE id=? ORDER BY project_id', ('stage-copy',)).fetchall(),
                 [('fictional-a', 'BCOPY'), ('fictional-b', 'ACOPY')])
            same(db.execute('SELECT stage_id FROM deliveries WHERE id=?', ('row-1',)).fetchone(), ('stage-copy',))
        check('Project label rename preserves ID and does not rename another project', project_labels)

        def scope_constraint():
            before = delivery_rows(db)
            def invalid_insert():
                with db:
                    db.execute('INSERT INTO deliveries VALUES(?,?,?,?,?,?,?)',
                               ('bad-row', 'fictional-a', 'DEMO', 'b-only', None, None, 0))
            rejects(sqlite3.IntegrityError, invalid_insert)
            same(delivery_rows(db), before)
        check('Composite foreign key rejects another project stage', scope_constraint)
        check('Referenced label cannot be deleted silently', lambda: rejects(sqlite3.IntegrityError,
            lambda: db.execute('DELETE FROM stages WHERE project_id=? AND id=?', ('fictional-a', 'stage-copy'))))
        db.rollback()

        check('Missing date/stage/status remain missing, not inferred', lambda: same(
            db.execute('SELECT due,stage_id,status FROM deliveries WHERE id=?', ('row-3',)).fetchone(), (None, None, None)))
        check('Yearless date rejected', lambda: rejects(ValueError, lambda: complete_date('01-14')))
        check('Invalid calendar date rejected', lambda: rejects(ValueError, lambda: complete_date('2030-02-30')))
        check('Complete cross-year date round trips', lambda: same(complete_date('2031-01-05'), '2031-01-05'))
        check('Pending summary excludes missing fields and submitted delivery', lambda: same(
            db.execute('''SELECT id FROM deliveries WHERE status='pending' AND due IS NOT NULL
                AND stage_id IS NOT NULL ORDER BY due,id''').fetchall(), [('row-1',), ('row-2',)]))

        def backup_and_restore():
            expected = delivery_rows(db)
            with closing(sqlite3.connect(OUT / 'fictional.sqlite3')) as uncommitted:
                uncommitted.execute('UPDATE deliveries SET item=? WHERE id=?', ('UNCOMMITTED-DEMO', 'row-1'))
                with closing(sqlite3.connect(OUT / 'backup.sqlite3')) as backup:
                    db.backup(backup)
                    same(backup.execute('PRAGMA integrity_check').fetchall(), [('ok',)])
                    same(backup.execute('PRAGMA foreign_key_check').fetchall(), [])
                    same(delivery_rows(backup), expected)
                uncommitted.rollback()
            # Restore to a separate staging database, never overwrite the live sample.
            with closing(sqlite3.connect(OUT / 'backup.sqlite3')) as backup, \
                    closing(sqlite3.connect(OUT / 'restored.sqlite3')) as restored:
                backup.backup(restored)
                same(restored.execute('PRAGMA integrity_check').fetchall(), [('ok',)])
                same(restored.execute('PRAGMA foreign_key_check').fetchall(), [])
                same(delivery_rows(restored), expected)
            same(delivery_rows(db), expected)
        check('Online backup excludes uncommitted WAL write; staged DB restore matches', backup_and_restore)


try:
    run()
except Exception as error:
    checks.append({'name': 'Probe setup/run', 'passed': False, 'error': str(error)})
check('Probe script unchanged during execution', lambda: same(
    hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), script_before))
summary = {'passed': sum(c['passed'] for c in checks), 'failed': sum(not c['passed'] for c in checks)}
files = [{'path': p.relative_to(ROOT).as_posix(), 'bytes': p.stat().st_size,
          'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.glob('*.sqlite3'))]
report = {
    'scope': 'Fictional standard-library SQLite examples, not production schema/app/Pi integration',
    'createdAt': datetime.now(timezone.utc).isoformat(),
    'runtime': {'python': platform.python_version(), 'sqlite': sqlite3.sqlite_version, 'platform': sys.platform},
    'scriptSha256': script_before, 'sampleFiles': files, 'summary': summary, 'checks': checks,
    'notTested': ['Rust SQLite library', 'real UI or file parsing', 'Pi tools/extension permissions',
                  'attachment/session bundle consistency', 'disk-full/power-loss recovery',
                  'backup retention', 'destructive restore/atomic directory swap', 'production schema migrations'],
}
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'report': (OUT / 'report.json').relative_to(ROOT).as_posix(), 'summary': summary}))
raise SystemExit(bool(summary['failed']))
