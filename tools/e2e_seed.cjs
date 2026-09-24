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
  for (const [binding, file] of [['DB', 'schema.sql'], ['AI_DB', 'schema_ai.sql'], ['DB', 'tools/e2e_core.sql'], ['AI_DB', 'tools/e2e_ai.sql']]) {
    const args = [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', binding, '--local', '--config', 'wrangler.e2e.toml', '--persist-to', '.wrangler/state-e2e', '--file', file];
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Local ${binding} seed failed (${file}); check isolated state and stop dev processes.`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
