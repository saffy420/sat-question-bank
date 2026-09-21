# Original public resource configuration

Historical reference only, not deployment instructions or permission to use the original author's resources. No service-role key, private token, or other secret is archived here. Supabase URL/publishable key were already public browser configuration. Database UUIDs identify resources but grant no access.

| Setting | Original public value |
|---|---|
| Worker name | `sat-question-bank` |
| Main D1 name / binding | `sat_question_bank` / `DB` |
| Main D1 ID | `bb6bfa7f-2687-4e52-94e7-eedccd1fa05b` |
| AI D1 name / binding | `sat_ai_bank` / `AI_DB` |
| AI D1 ID | `ce533bdc-0621-477e-8ea8-a375bf943623` |
| Browser and Worker Supabase URL | `https://lbwxzcdmhyhgtscthnaq.supabase.co` |
| Browser publishable key / Worker SUPABASE_ANON_KEY | `sb_publishable_jG8GJoT0puI7Roflw6yiFQ_IL7lSifr` |
| Both CSP connect-src project origins | `https://lbwxzcdmhyhgtscthnaq.supabase.co` |
| Canonical redirect | `www.helpmeaceit.page` to `helpmeaceit.page` |
| Wrangler custom-domain routes | `helpmeaceit.page`, `www.helpmeaceit.page` |

Changing D1 UUIDs changes local Miniflare filenames. The recovered working-copy data remains under its original IDs. For local probes only, use an ignored configuration under `backup/` with these original local IDs, absolute asset/Worker paths, and `--persist-to .wrangler/state`; keep placeholder auth settings and never pass `--remote` or deploy that local override. No database file needs deletion or renaming.
