// Imports data/questions.snapshot.json into the local D1 files and emits chunked
// SQL for the remote. Stop every `wrangler dev` first: it holds the sqlite files.
//   node tools/import_snapshot.cjs          import locally + emit d1_chunks/
//   node tools/import_snapshot.cjs --test   self-check, touches nothing
//
// Split: source !== 'AI' -> DB.questions (stem_text forced to ''), source === 'AI'
// -> AI_DB.questions (level kept), and every AI id -> DB.ai_ids. The ai_ids step
// is mandatory: the progress/attempts/notes guards drop answers for unknown ids.
// Local writes are parameterized; the emitted files escape literals instead.
// Everything is an upsert, so reruns are safe.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SNAP = path.join(ROOT, 'data', 'questions.snapshot.json');
const D1DIR = path.join(ROOT, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
const OUT = path.join(ROOT, 'd1_chunks');
// One file stays far below wrangler's per-request size limit (d1_dump.cjs used 900K).
const CHUNK_BYTES = 700000;
const MARKER = '_snap_marker';

const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
const lit = (v) => v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v)
  : "'" + String(v).replace(CTRL, '').replace(/'/g, "''") + "'";
const str = (v) => v === null || v === undefined ? null : String(v);
const jstr = (v) => typeof v === 'string' ? v : JSON.stringify(v);

const MAIN_COLS = ['id', 'external_id', 'section', 'domain', 'difficulty', 'skill',
  'stem_html', 'choices_json', 'correct_answer', 'explanation_html', 'source',
  'source_page', 'has_figure', 'stem_text'];
const AI_COLS = [...MAIN_COLS.slice(0, 13), 'level'];
const mainVals = (r) => [r.id, str(r.external_id), str(r.section), str(r.domain),
  str(r.difficulty), str(r.skill), str(r.stem_html), jstr(r.choices_json),
  str(r.correct_answer), str(r.explanation_html), str(r.source),
  r.source_page === undefined ? null : r.source_page, r.has_figure | 0, ''];
const aiVals = (r) => [...mainVals(r).slice(0, 13), r.level | 0];
const upsert = (table, cols) =>
  `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})` +
  ` ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(', ')}`;
const upsertSql = (table, cols, vals) =>
  `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.map(lit).join(', ')})` +
  ` ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(', ')};`;

// The state dir holds one hashed .sqlite per database_id ever used, so stale files
// from previous ids sit next to the live ones (apply_ai.cjs documents the same
// hazard). Mark the live file through the binding itself: one wrangler call writes
// a marker table to exactly the file the current wrangler.toml points at.
function liveFile(binding, expectLevel) {
  // --command splits on spaces through cmd quoting, so the marker goes via --file.
  const os = require('os');
  const markerSql = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'snapmark-')), 'marker.sql');
  fs.writeFileSync(markerSql, `CREATE TABLE IF NOT EXISTS ${MARKER} (x TEXT);`);
  const run = spawnSync('npx', ['wrangler', 'd1', 'execute', binding, '--local', `--file=${markerSql}`],
    { cwd: ROOT, shell: true, encoding: 'utf8' });
  fs.rmSync(path.dirname(markerSql), { recursive: true, force: true });
  if (run.status !== 0) throw new Error(`wrangler mark ${binding} failed: ${(run.stderr || run.stdout || '').slice(0, 300)}`);
  const Database = require('better-sqlite3');
  const hits = fs.readdirSync(D1DIR).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
    .filter((f) => {
      const db = new Database(path.join(D1DIR, f), { readonly: true });
      const has = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(MARKER);
      db.close();
      return !!has;
    });
  if (hits.length !== 1) throw new Error(`${binding}: marker in ${hits.length} files (${hits.join(', ')})` +
    ' - drop stray _snap_marker tables from a crashed run and re-run');
  const file = path.join(D1DIR, hits[0]);
  const db = new Database(file);
  const cols = db.prepare('PRAGMA table_info(questions)').all().map((c) => c.name);
  if (!cols.length) { db.close(); throw new Error(`${binding}: ${hits[0]} has no questions table - apply the schema first`); }
  if (cols.includes('level') !== expectLevel) { db.close(); throw new Error(`${binding}: ${hits[0]} role mismatch (level=${cols.includes('level')})`); }
  db.prepare(`DROP TABLE ${MARKER}`).run();
  return db;
}

function emit(prefix, stmts) {
  const files = [];
  let buf = [], size = 0, n = 0;
  const flush = () => {
    if (!buf.length) return;
    const f = path.join(OUT, `${prefix}_${String(n).padStart(3, '0')}.sql`);
    fs.writeFileSync(f, buf.join('\n') + '\n');
    files.push(f); n++; buf = []; size = 0;
  };
  for (const s of stmts) { buf.push(s); size += s.length + 1; if (size > CHUNK_BYTES) flush(); }
  flush();
  return files;
}

function selftest() {
  const assert = require('assert');
  assert.strictEqual(lit("o'clock"), "'o''clock'");
  assert.strictEqual(lit(null), 'NULL');
  assert.strictEqual(lit(undefined), 'NULL');
  assert.strictEqual(lit(4), '4');
  assert.strictEqual(lit('a\x00b\x1fc'), "'abc'");
  assert.strictEqual(jstr('["a"]'), '["a"]');
  assert.strictEqual(jstr(['a']), '["a"]');
  assert.ok(upsertSql('ai_ids', ['id'], ['x']).startsWith('INSERT INTO ai_ids (id) VALUES'));
  console.log('import_snapshot selftest: all cases hold');
}

function main() {
  if (process.argv.includes('--test')) return selftest();
  const rows = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  if (!Array.isArray(rows) || !rows.length) throw new Error('snapshot is not a non-empty array');
  const core = rows.filter((r) => r.source !== 'AI');
  const ai = rows.filter((r) => r.source === 'AI');
  if (core.length + ai.length !== rows.length) throw new Error('unclassifiable rows');

  const mainDb = liveFile('DB', false);
  const aiDb = liveFile('AI_DB', true);
  const putMain = mainDb.prepare(upsert('questions', MAIN_COLS));
  const putAi = aiDb.prepare(upsert('questions', AI_COLS));
  const putId = mainDb.prepare('INSERT OR IGNORE INTO ai_ids (id) VALUES (?)');
  mainDb.transaction(() => { for (const r of core) putMain.run(...mainVals(r)); })();
  aiDb.transaction(() => { for (const r of ai) putAi.run(...aiVals(r)); })();
  mainDb.transaction(() => { for (const r of ai) putId.run(r.id); })();
  const counts = {
    main: mainDb.prepare('SELECT COUNT(*) AS n FROM questions').get().n,
    ai: aiDb.prepare('SELECT COUNT(*) AS n FROM questions').get().n,
    ids: mainDb.prepare('SELECT COUNT(*) AS n FROM ai_ids').get().n,
  };
  mainDb.close(); aiDb.close();
  console.log(`local: DB.questions=${counts.main} AI_DB.questions=${counts.ai} DB.ai_ids=${counts.ids}`);

  fs.mkdirSync(OUT, { recursive: true });
  const fMain = emit('snapshot_main', core.map((r) => upsertSql('questions', MAIN_COLS, mainVals(r))));
  const fAi = emit('snapshot_ai', ai.map((r) => upsertSql('questions', AI_COLS, aiVals(r))));
  const fIds = emit('snapshot_ai_ids', ai.map((r) => `INSERT OR IGNORE INTO ai_ids (id) VALUES (${lit(r.id)});`));
  console.log('remote chunks:');
  for (const f of [...fMain, ...fAi, ...fIds]) console.log('  ' + path.relative(ROOT, f));
  console.log('remote order: snapshot_main_* -> DB, snapshot_ai_* -> AI_DB, snapshot_ai_ids_* -> DB');
}

main();
