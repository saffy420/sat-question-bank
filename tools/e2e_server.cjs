// Local-only launcher: fixed configs, dedicated ports/state, no remote options.
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const mode = process.argv[2];
const targets = {
  enabled: ['wrangler.e2e.toml', '8787'],
  unset: ['wrangler.e2e.toml', '8788'],
  production: ['wrangler.e2e-production.toml', '8789']
};
if (!Object.hasOwn(targets, mode) || process.argv.length !== 3) throw new Error('Use enabled, unset or production; no overrides');
const [config, port] = targets[mode];
if (!existsSync(resolve(__dirname, '..', config))) throw new Error('Local harness config missing');
const args = [resolve(__dirname, '../node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--config', config, '--persist-to', '.wrangler/state-e2e', '--ip', '127.0.0.1', '--inspector-ip', '127.0.0.1', '--port', port, '--local-protocol', 'https', '--show-interactive-dev-session=false'];
if (mode !== 'unset') args.push('--var', 'E2E_TEST_MODE:1');
// report-and-suggest: the triage call goes to tools/e2e_anthropic_mock.cjs, never to the real API (src/reports.js apiTarget).
if (mode === 'enabled') args.push('--var', 'ANTHROPIC_API_KEY:e2e-not-a-real-key', '--var', 'ANTHROPIC_API_URL:http://127.0.0.1:8790/v1/messages');
// Explicit empty file suppresses .dev.vars and process .env on every target.
if (!existsSync(resolve(__dirname, 'e2e_unset.env'))) throw new Error('Empty environment file missing');
args.push('--env-file', 'tools/e2e_unset.env');
const childEnv = { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' };
delete childEnv.E2E_TEST_MODE;
const child = spawn(process.execPath, args, { cwd: resolve(__dirname, '..'), stdio: 'inherit', env: childEnv });
// Playwright kills process group on exit; forwarding manual shutdown prevents orphaned Wrangler.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => { process.exitCode = code || (signal ? 1 : 0); });
