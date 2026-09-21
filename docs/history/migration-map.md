# Migration classification and path mapping

All 13 SQL files were classified by their SQL statements, not size. SQLite parsed and executed every file against disposable in-memory schema copies; the historical attempts shape was used for the two ALTER statements. No persistent database was modified. Six files contain schema DDL; seven contain only UPDATE repairs against existing questions. Nothing was deleted. Moves preserve exact working-tree SQL bytes; historical documents retain their original paths.

| Original path | Current path | SQL purpose |
|---|---|---|
| migrations/0001_attempts.sql | migrations/0001_attempts.sql | CREATE attempts and index |
| migrations/0002_math_text_fix.sql | data-fixes/core/0002_math_text_fix.sql | UPDATE question text |
| migrations/0003_pt10_math_m2_q16_stem.sql | data-fixes/core/0003_pt10_math_m2_q16_stem.sql | UPDATE one existing stem |
| migrations/0004_skill_names.sql | data-fixes/core/0004_skill_names.sql | UPDATE existing skill labels |
| migrations/0005_math_render_fixes.sql | data-fixes/core/0005_math_render_fixes.sql | UPDATE stems, choices and explanations |
| migrations/0005_settings.sql | migrations/0002_settings.sql | CREATE settings |
| migrations/0006_math_answerable.sql | data-fixes/core/0006_math_answerable.sql | UPDATE answerability content after extraction |
| migrations/0008_notes.sql | migrations/0003_notes.sql | CREATE notes |
| migrations/0009_ai_bank.sql | migrations/0004_ai_bank.sql | ALTER attempts picked/changes; CREATE ai_ids |
| migrations/0009_rw_underline.sql | data-fixes/core/0009_rw_underline.sql | UPDATE existing RW underlines |
| migrations/0010_sessions.sql | migrations/0005_sessions.sql | CREATE sessions |
| migrations_ai/0001_init.sql | migrations_ai/0001_init.sql | CREATE AI questions with level |
| migrations_ai/0002_cross_text_domain.sql | data-fixes/ai/0002_cross_text_domain.sql | UPDATE AI taxonomy |

Core schema numbering is now 0001–0005; AI schema numbering starts independently at 0001. Repair filenames preserve historical order, including gaps. Four executable emitters now target `data-fixes/core/`: `fix_math_text.cjs`, `apply_choice_tables.cjs`, `apply_answerable.cjs`, `underline.py`. Their database selection and repair behavior are unchanged.

## Do not replay history over snapshots

`schema.sql` already includes all five core migrations, including `attempts.picked` and `attempts.changes`. `schema_ai.sql` already includes the AI initialization. Fresh setup applies only the two snapshots, with no subsequent historical migration or data repair. Applying `0004_ai_bank.sql` after the snapshot fails with duplicate columns. Existing installations need their own migration-ledger reconciliation before using renamed filenames; renaming does not establish that an old database has applied a migration.
