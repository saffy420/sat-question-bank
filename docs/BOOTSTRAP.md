# Local D1 bootstrap (snapshot recipe)

This fork seeds its banks from `data/questions.snapshot.json` (ignored, College
Board content — never commit it), not from tracked migrations or data repairs.
Never use `--remote` for this local recipe.

## Ordered recipe

1. Stop every `wrangler dev` process. Direct sqlite writes race its in-memory state.
2. Apply the schema snapshots only, once per fresh database:
   ```sh
   npx wrangler d1 execute DB --local --file=schema.sql
   npx wrangler d1 execute AI_DB --local --file=schema_ai.sql
   ```
   `schema.sql` already contains every table (`questions`, `users`, `progress`,
   `attempts` with `picked`/`changes`, `settings`, `notes`, `ai_ids`, `sessions`);
   `schema_ai.sql` already contains the AI `questions` with `level`.
3. Run the importer:
   ```sh
   node tools/import_snapshot.cjs
   ```
   It resolves the live local files through the current bindings (a marker table,
   so stale files from previous `database_id` values are never picked up), writes
   core rows to `DB.questions` with `stem_text = ''`, AI rows to `AI_DB.questions`
   keeping `level`, registers every AI id in `DB.ai_ids`, and emits upsert chunks
   to ignored `d1_chunks/` for later remote use. Reruns are safe (upserts).
   Expected: `DB.questions=3770`, `AI_DB.questions=400`, `DB.ai_ids=400`.
4. Verify through Wrangler:
   ```sh
   npx wrangler d1 execute DB --local --command="SELECT count(*) AS core_q FROM questions; SELECT count(*) AS ai_ids FROM ai_ids;"
   npx wrangler d1 execute AI_DB --local --command="SELECT count(*) AS ai_q FROM questions;"
   npm run dev -- --local
   ```

## Never bulk-apply migrations to these databases

Do NOT run `wrangler d1 migrations apply` on a snapshot-built database.
`schema.sql` already defines the columns that `migrations/0004_ai_bank.sql` ALTERs
in, so a bulk apply fails on duplicate columns — and the data-repair files under
`data-fixes/` UPDATE rows for problems the snapshot no longer has. The snapshot
is already repaired content; see `history/migration-map.md` for the mapping.

Consequence: the `d1_migrations` ledger on these databases is empty by design.
Future schema changes must therefore be applied individually, never by bulk
apply: add the new file under `migrations/` (or `migrations_ai/`), fold its DDL
into `schema.sql` (or `schema_ai.sql`) so fresh bootstraps stay one step, and
run it explicitly — `npx wrangler d1 execute DB --local --file=migrations/NNNN_x.sql`
and later the same with `--remote`. Do not hand-write rows into `d1_migrations`
to fake a history the database never executed. Bulk `migrations apply` remains
valid only for databases that were themselves built by running those migrations
in order.

## Changing database IDs

Changing a `database_id` in `wrangler.toml` re-keys local Miniflare storage: the
next dev run uses a new, empty sqlite file and the populated one is left behind.
The importer finds the live file via its marker, so it keeps working — but do
not delete the stale files to "clean up"; back up first. The old populated bank
from the author's IDs is still under `.wrangler/state/` for reference, not for use.

## Remote (owner approval required)

Schemas then chunks, in this order, only after explicit approval:
`schema.sql` -> remote DB, `schema_ai.sql` -> remote AI_DB, then
`d1_chunks/snapshot_main_*` -> remote DB, `d1_chunks/snapshot_ai_*` -> remote
AI_DB, `d1_chunks/snapshot_ai_ids_*` -> remote DB. Each chunk was validated by
applying it to scratch sqlite databases built from the same schemas.
