# Admin redesign inventory

Baseline: `a4662276` on merged `main`; working branch `ui/admin-dashboard`.
Recorded before implementation. Existing admin HTML and all 370 lines of its module
are the behavior baseline; the Worker serves the shell for every `/admin/*` path.

| Surface | Existing views and states to cover |
|---|---|
| Shell | Expanded/collapsed sidebar; Students, Lessons, Live, Question Bank; student-app link; loading, error, retry; auth redirects remain server-owned |
| `/admin` | Seven-column Students table; name/email search, all seven sorts both directions, pagination, no results |
| Student detail | Overview, By skill, Mistakes, Traps, Pacing, Second-guessing, History, Lessons; zero-attempt state per tab; honest legacy/unavailable values |
| Mistakes | Domain/skill/difficulty filters, no matches, MC and SPR previews, student/correct answer, explanation/math, close preview |
| History | Newest-first rows, pagination, loading/error/retry, empty |
| Student Lessons | Existing attendance-unavailable state (backend not implemented) |
| `/admin/live` | Open-room links, no open rooms, loading/error/retry |
| `/admin/live/:id` | Lobby and live roster/remove/lock; READY, ANSWERING, REVEALED, ENDED; reconnect/error; countdown; Stage; explanation/notes |
| Live responses | Name/status sorts; nothing/selected/locked; choice; correctness after reveal; empty roster |
| Distribution | MC choices + blank; server SPR groups + other; correct emphasis; clicked group names/time; empty group |
| Annotation | Revealed-only pen/highlight/strike/erase/clear/laser; clear confirmation; active cursor, Esc, three allowed colors |
| Live controls | Start lesson, Start question, +15s, End now, Next, End session, class-results toggle, connection/count |
| `/admin/lessons/new`, `/:id/edit` | Section/domain/skill/difficulty/usage/search filters; result pages; no results/error/retry; preview; add/add-page/already-added |
| Lesson editor | Title/mode; live total; items/empty; drag and accessible up/down reorder; remove; time chips/custom validation; notes markdown/math preview; question preview; close editor |
| Builder persistence | Debounced serialized autosave; saved/unsaved/saving/error; manual save/retry; save/start join-code result; exit Save/Discard/Cancel; browser leave guard |
| `/admin/lessons` | Card grid; empty/loading/error; edit/start/duplicate; inline past sessions with IDs/status/date/code; no sessions/error; named delete confirmation |
| Past results | Preserve current results-unavailable disclosure; no fabricated result API |
| Question Bank | Existing placeholder; redesign as read-only bank using existing admin question endpoint and shared preview/filter components |

## Test-selector audit before edits

Read/grepped every admin reference in `tests/e2e/**`, including admin, practice,
builder, realtime, paced, annotations and student-player specs. Preserve shell
IDs, `[data-section]`, student sorting/detail/tab IDs, builder filter/result/editor
IDs, `#live-card`, `[data-live]`, `[data-tool]`, `[data-group]`, `#live-link`,
`#live-class`, `#live-roster`, `#live-timer`, and `#live-group`.

Required spec updates: dropdown filters now need opening before checking an option;
Unicode response/distribution assertions become named status + SVG/bar assertions;
pre-reveal correctness assertions move to reveal because the requested redesign
explicitly delays correctness. The completed diff review records exact changes.

## Constraints discovered

- `RTK.md` referenced in the supplied instructions is absent from the repository
  and its parent directories.
- `lesson_sessions.lesson_id` references `lessons.id`; archive instead of deleting
  templates. Never mutate sessions, participants, responses, reviews, usage or polls.
- Question Bank, student Lessons attendance, and past-session result details were
  not implemented in the old UI. Preserve honest availability for missing APIs.
