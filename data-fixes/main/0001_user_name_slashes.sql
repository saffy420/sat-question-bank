-- Drop forward slashes from stored account names ("/Leon Chakraborty" -> "Leon Chakraborty").
-- Target: the main database (binding DB, database_name sat_question_bank), table `users`. Account names are stored
-- nowhere else in D1; lesson rosters and the admin pages read them from `users.name`.
-- The Worker cleans names the same way from now on (src/name.js), so this only fixes rows written before that.
--
-- 1. Back up first:
--      npx wrangler d1 export sat_question_bank --remote --table users --output users-backup.sql
-- 2. See what would change:
--      npx wrangler d1 execute sat_question_bank --remote --command "SELECT id, name FROM users WHERE name LIKE '%/%'"
-- 3. Apply:
--      npx wrangler d1 execute sat_question_bank --remote --file data-fixes/main/0001_user_name_slashes.sql
-- 4. Verify by the changed predicate (expect 0):
--      npx wrangler d1 execute sat_question_bank --remote --command "SELECT COUNT(*) FROM users WHERE name LIKE '%/%'"
--
-- A slash between words leaves a double space, collapsed below (twice covers runs of up to four spaces). A name that
-- was only slashes becomes NULL, so the app falls back to the account's email as it does for a missing name.
-- Safe to run again: the WHERE matches nothing once the slashes are gone.
UPDATE users
SET name = NULLIF(TRIM(REPLACE(REPLACE(REPLACE(name, '/', ''), '  ', ' '), '  ', ' ')), '')
WHERE name LIKE '%/%';
