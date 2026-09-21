# Fresh local D1 bootstrap

This creates **0 core questions, 400 AI questions, and 400 main-database AI registry IDs**. The core bank and figure crops are not in Git. See SETUP for own-account configuration before deployment. Never use `--remote` for this local recipe.

## Ordered recipe

1. Use a fresh clone or detached worktree with no `.wrangler/` state. Install package dependencies with `npm ci` using a supported Node installation. `better-sqlite3` must load successfully; do not use `--ignore-scripts` as a substitute for its native binary. On Windows, use Windows Node/npm consistently rather than mixing Linux-built modules with Windows Node. Stop local dev servers before importing.
2. Set both local D1 IDs once before initialization. Changing IDs later re-keys storage. Keep the main and AI IDs distinct. Use the root `wrangler.toml` and default `.wrangler/state` location: the importer discovers databases relative to its own source directory, not the current shell directory. An absolute importer path from another checkout would write to that checkout instead.
3. From this fresh project root, initialize the main snapshot, then the AI snapshot:

   ```sh
   npx wrangler d1 execute DB --local --file=schema.sql
   npx wrangler d1 execute AI_DB --local --file=schema_ai.sql
   ```

4. Apply **no subsequent historical migrations**. `schema.sql` already contains `migrations/0001_attempts.sql` through `0005_sessions.sql`; replaying `0004_ai_bank.sql` would add duplicate `picked`/`changes` columns. `schema_ai.sql` already contains `migrations_ai/0001_init.sql`. Skip all seven `data-fixes/` SQL files: they repair existing rows rather than seed a fresh bank. See [complete mapping](history/migration-map.md).
5. Import all 17 tracked batches explicitly; this works without shell wildcard expansion on Windows:

   ```sh
   node tools/apply_ai.cjs tools/aiq/math_01.jsonl tools/aiq/math_02.jsonl tools/aiq/math_03.jsonl tools/aiq/math_04.jsonl tools/aiq/rw_01.jsonl tools/aiq/rw_02.jsonl tools/aiq/rw_03.jsonl tools/aiq/rw_04.jsonl tools/aiq/rw_05.jsonl tools/aiq/rw_06.jsonl tools/aiq/rw_07.jsonl tools/aiq/rw_08.jsonl tools/aiq/rw_09.jsonl tools/aiq/rw_10.jsonl tools/aiq/rw_11.jsonl tools/aiq/rw_12.jsonl tools/aiq/rw_13.jsonl
   ```

   The existing importer validates all 400 rows, writes `AI_DB.questions`, registers IDs in `DB.ai_ids`, and generates ignored `d1_ai/questions.sql` and `d1_ai/ids.sql`. `--check` validates only and is not an import. Do not execute generated SQL against any remote database as part of this recipe.
6. Verify through Wrangler, not a substitute SQLite database:

   ```sh
   npx wrangler d1 execute DB --local --command="SELECT count(*) AS core_questions FROM questions; SELECT count(*) AS ai_ids FROM ai_ids;"
   npx wrangler d1 execute AI_DB --local --command="SELECT count(*) AS ai_questions FROM questions; SELECT section, count(*) AS count FROM questions GROUP BY section;"
   npm run dev -- --local
   ```

Expected counts: core `0`; registry `400`; AI `400`, split Math `100` and Reading & Writing `300`. Core-based fixed exams cannot resolve their questions in this tracked-AI-only bootstrap. Missing crops are not restored by SQL import. Guest practice can use the shipped AI content; real sign-in requires your own Supabase configuration.

## Verification evidence

Verified on Windows with Wrangler 4.125.0 in a separate detached temporary worktree under `C:\Users\Leon\AppData\Local\Temp\opencode\sat-bootstrap`. Its own default `.wrangler/state` started empty. Both snapshots were executed by actual Wrangler local D1; the unchanged `tools/apply_ai.cjs` completed its native `better-sqlite3` import and emitted both SQL files. Subsequent Wrangler queries returned the exact counts above. Dependencies were resolved from the existing checkout using `NODE_PATH`; no repository dependency changes, fake D1 adapter, populated-bank copies, or remote writes were used. The main checkout's recovered databases were not used for this verification.

## Optional external core recovery

`https://helpmeaceit.page/api/questions` was independently verified accessible during cleanup and supplied a JSON array with 3,770 CollegeBoard rows and 400 AI rows. This is an external source, not reconstruction from Git; availability and future counts are not guaranteed. Save and inspect the response before importing only the intended source rows into initialized local databases. Display fields do not restore legacy OCR `stem_text` or a PDF metadata baseline. Fetch referenced `/qimg/` assets separately from that origin into ignored `public/qimg/`; the JSON does not contain crop bytes. Recovery in this working copy is documented in `history/cleanup-plan.md`; no tracked core-recovery importer is supplied. Do not replay historical repair SQL blindly over current recovered content.
