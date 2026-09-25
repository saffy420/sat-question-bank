// Fixed local-only seed: schemas are snapshots; repeat INSERT OR IGNORE on owned IDs.
const { spawnSync } = require('node:child_process');
const { connect } = require('node:net');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
if (process.argv.length !== 2) throw new Error('No seed overrides allowed');
const ports = [8787, 8788, 8789];
async function free(port) {
  return new Promise((ok, fail) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); fail(new Error(`Port ${port} active. Stop all E2E dev servers before seeding.`)); });
    socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? ok() : fail(error); });
  });
}
(async () => {
  for (const port of ports) await free(port);
  // Existing isolated state predates 0007; fresh state uses schema snapshot directly.
  const base = [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB', '--local', '--config', 'wrangler.e2e.toml', '--persist-to', '.wrangler/state-e2e'];
  const inspect = spawnSync(process.execPath, [...base, '--command', "SELECT name FROM sqlite_master WHERE type='table' AND name='users'", '--json'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
  if (inspect.status !== 0) throw new Error('Cannot inspect local E2E core schema: ' + inspect.stderr);
  const hasUsers = JSON.parse(inspect.stdout)[0]?.results?.length > 0;
  if (hasUsers) {
    const columns = spawnSync(process.execPath, [...base, '--command', 'PRAGMA table_info(users)', '--json'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
    if (columns.status !== 0) throw new Error('Cannot inspect users columns: ' + columns.stderr);
    const role = JSON.parse(columns.stdout)[0]?.results?.some(c => c.name === 'role');
    const history = spawnSync(process.execPath, [...base, '--command', 'PRAGMA table_info(attempts)', '--json'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
    if (history.status !== 0) throw new Error('Cannot inspect attempts columns: ' + history.stderr);
    const hasHistory = JSON.parse(history.stdout)[0]?.results?.some(c => c.name === 'answer_history_json');
    if (role !== hasHistory) throw new Error('Partial 0007 schema; inspect owned local state before reseeding');
    if (!role) {
      const upgrade = spawnSync(process.execPath, [...base, '--file', 'migrations/0007_admin_history.sql'],
        { cwd: root, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
      if (upgrade.status !== 0) throw new Error('0007 isolated E2E upgrade failed');
    }
    const lessons = spawnSync(process.execPath, [...base, '--command', "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('lessons','lesson_questions','lesson_sessions','question_lesson_usage')", '--json'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
    if (lessons.status !== 0) throw new Error('Cannot inspect lesson tables: ' + lessons.stderr);
    const count = JSON.parse(lessons.stdout)[0]?.results?.length || 0;
    if (count !== 0 && count !== 4) throw new Error('Partial 0008 schema; inspect isolated E2E state before reseeding');
    if (!count) {
      const upgrade = spawnSync(process.execPath, [...base, '--file', 'migrations/0008_lessons.sql'],
        { cwd: root, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
      if (upgrade.status !== 0) throw new Error('0008 isolated E2E upgrade failed');
    }
  }
  for (const [binding, file] of [['DB', 'schema.sql'], ['AI_DB', 'schema_ai.sql'], ['DB', 'tools/e2e_core.sql'], ['AI_DB', 'tools/e2e_ai.sql']]) {
    if (hasUsers && file === 'schema.sql') continue; // Snapshot has non-idempotent lesson DDL; upgrades ran above.
    const args = [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', binding, '--local', '--config', 'wrangler.e2e.toml', '--persist-to', '.wrangler/state-e2e', '--file', file];
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Local ${binding} seed failed (${file}); check isolated state and stop dev processes.`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
