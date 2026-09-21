# One-time data repairs

These SQL files UPDATE rows that must already exist. They are not fresh-setup seeds and cannot reconstruct the core bank. Do not run them as schema migrations or blindly replay them against newly recovered content.

- `core/`: repairs against the main `DB.questions`, retained in historical filename order. Math answerability repairs were generated after re-extraction chunks; inspect prerequisites and current rows before applying.
- `ai/`: taxonomy repair against `AI_DB.questions`, not the main database.

Back up the intended database, review every predicate and target binding, and verify affected rows before any manual application. Historical SQL bytes are unchanged. See [migration mapping](../docs/history/migration-map.md). Fresh initialization uses schema snapshots; no repairs are required to create tables.
