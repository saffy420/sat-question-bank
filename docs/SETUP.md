# Own-account setup

Tracked configuration uses placeholders. Guest local use needs initialized D1 banks but no working Supabase account. Authentication does not work until all settings below use your own project. `.env.example` is a checklist, **not automatic configuration**: neither the static browser nor this Worker reads it to replace hardcoded values.

1. Install dependencies with `npm ci` and initialize local data using [BOOTSTRAP](BOOTSTRAP.md). Use Windows Node/npm together on Windows; the importer requires a working native `better-sqlite3` binary.
2. In your Cloudflare account create two D1 databases named as you prefer. Set each returned UUID and name in its `wrangler.toml` binding: `DB` holds core questions and user state; `AI_DB` holds AI questions. The tracked `00000000-0000-0000-0000-000000000001` and `00000000-0000-0000-0000-000000000002` are syntactically valid local placeholders, not provisioned resources. Keep bindings distinct. AI migrations use `migrations_dir = "migrations_ai"`.
3. Create your own Supabase project. Enable the intended email/password and Google providers; configure Google credentials in Supabase, never in Git. Set Site URL to your canonical HTTPS origin and allow its `/auth/callback` URL plus the exact local dev origin/callback you use. Use only the publishable key, never a service-role or secret key.
4. Update all five coupled locations together:

   | Location | Replace |
   |---|---|
   | `public/index.html` | `SUPABASE_URL` and `SUPABASE_KEY` |
   | `wrangler.toml` `[vars]` | `SUPABASE_URL` and `SUPABASE_ANON_KEY` with the same public pair |
   | `src/index.js` CSP | Supabase origin in `connect-src` |
   | `public/_headers` CSP | Same Supabase origin in `connect-src` |
   | `src/index.js` canonical redirect | `www.your-domain.example` and `your-domain.example`, using lowercase real hostnames |

   Keep both CSP policies identical, including `frame-src https://www.desmos.com`, and preserve `run_worker_first = ["/"]`. Existing non-root static assets can still bypass the Worker redirect.
5. Replace both matching custom-domain routes in `wrangler.toml`. Your domain must be an active Cloudflare zone on the same account. Alternatively remove both custom-domain routes and configure your chosen workers.dev origin and Supabase callback consistently; do not deploy placeholder routes. See [original public values](history/original-config.md) only for historical reference.
6. Run `npm run dev -- --local`. For a fresh placeholder configuration, expect AI-only data after bootstrap; fixed core exams and absent figure crops are not restored by setup. Run `npm test`; guest answers stay in memory and are not merged into an account. Test your own sign-in separately before launch.

## Reports and feature suggestions (optional)

Students can report a problem on any question and suggest features; the admin app has Reports and Suggestions tabs. Before deploying code that contains them, apply the migration to the remote core database once: `npx wrangler d1 execute DB --remote --file migrations/0011_reports.sql`. To let Claude triage reports, set the Worker secret `npx wrangler secret put ANTHROPIC_API_KEY`; without it reports are stored and shown as escalations. The model, the monthly call cap and the per-user limits are constants at the top of `src/reports.js`. Fixes are never applied automatically.

## Existing recovered working copy

Changing D1 IDs does not erase old SQLite files, but creates a different local binding identity. Stop every dev server before imports or direct SQLite writes. Back up existing state before changing IDs, and never delete files merely to make the importer accept duplicate candidates. The cleanup probes use an ignored `backup/cleanup-local.toml` containing the original **local** IDs with placeholder authentication and explicit `--persist-to .wrangler/state`. Run from repository root:

```sh
npm run dev -- --local --config backup/cleanup-local.toml --persist-to .wrangler/state
```

That ignored override is specific to this recovered working copy, not shipped in Git and not needed for fresh clones. Do not deploy it or use it for remote operations.

## Deployment is separate

This cleanup performs no deployment or remote database writes. Remote resources must be provisioned and populated deliberately using your own IDs and reviewed SQL. `npm run deploy` uploads code/assets, not schema or data. Its predeploy guard requires a real populated crop directory and rejects symlinks/junctions and fewer than 4,000 entries; AI-only setup therefore is not a complete deploy-ready replica. Preserve the College Board personal-study restriction. Legal pages still contain draft boilerplate and `LEGAL_CONTACT`; review before public launch.
