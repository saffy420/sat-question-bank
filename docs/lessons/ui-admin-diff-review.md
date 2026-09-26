# Admin diff review — old `public/admin.js` → React rebuild

Base: `a4662276` (old vanilla module, 327 lines, `git show a4662276:public/admin.js`).
New: worktree `admin-ui/*.tsx` + `admin-ui/admin.css`, built to gitignored
`public/admin.js` via `vite.admin.config.ts`. Server: committed `586aa5ea`.
Verified: `npm test` 75/75, `npm run typecheck` pass, `npx playwright test
--workers=2` 19/19, screenshots both viewports under
`.opencode/pipeline/ui-admin-dashboard/e2e/{1366x768,1920x1080}/`.

## (a) Behavior map

Preserved = same API calls, handlers, and user-visible outcomes.
Changed = same intent, new rendering/interaction (justification inline).
Removed = gone (justification inline, or filed as bug — none open).

### Shell / transport

| Old behavior | New location | Verdict |
|---|---|---|
| Sidebar `#collapse` toggle + `aria-expanded` | `index.tsx` `#collapse` | Preserved (icons replace text) |
| `[data-section]` nav + `aria-current` + `#title` | `index.tsx` nav | Preserved; `document.title` also set |
| `api()` 401→`/login`, 403→`/app`, server error text | `helpers.ts` `api()` | Preserved verbatim |
| Loading / error + `#retry` (`busy`/`fail`) | `ui.tsx` `Pending` | Preserved |
| KaTeX `mathify` with `\( \)` / `\[ \]`, never blank on malformed math | `helpers.ts` `mathify` | Preserved |
| `fmt`/`pct`/`time`, honest `Unavailable` nulls | `helpers.ts` | Preserved (`date` inlined as `\|\| "Unavailable"`, `esc` via `lesson-ui/escape.ts`) |
| Student-app link | `index.tsx` `.student-app` | Changed: now runs the unsaved-changes guard first. Old link silently abandoned dirty builder state; guarding is strictly safer. |
| `Question Bank` section showed "unavailable until later task" | `index.tsx` + `Builder.tsx` `QuestionBrowser` (read-only, no `add`) | Changed: new read-only surface per `ui-admin-inventory.md` (shared filter/result/preview components, existing `/api/admin/questions`). Nothing old to preserve. |

### Students (`/admin`)

| Old behavior | New location | Verdict |
|---|---|---|
| `GET /api/admin/students?page&search&sort&order`; 7 columns, all sorts both directions, pagination, 400 ms debounced search | `Students.tsx` | Preserved (adds `aria-sort`, arrow icons instead of ↑↓ text) |
| `No students found.` empty row | `Empty` | Preserved text |
| Row `data-id` opens detail; `#back` returns to list | `Students.tsx`/`StudentDetail` | Preserved (React state replaces `detail` var) |
| Header `email · N questions done · accuracy · Last active` | `StudentDetail #message` | Preserved |
| Overview / By skill metrics, `cbSort`, `DOM_ORDER` split, SVG trend polyline | `Tab` + `Metric` | Preserved (stroke uses `var(--accent)`) |
| Mistakes `md-domain`/`md-skill`/`md-diff` filters, `No mistakes for these filters.`, `data-question` list, `#preview` with picked + correct answer, `#close-preview` | `Mistakes` | Preserved, plus marker `Badge` (Red/Orange). `close-preview.focus()` dropped — trivial, no spec relied on it. |
| Traps / Pacing / Second-guessing values and disclosures | `Tab` | Preserved |
| History newest-first, `h-prev`/`h-next`, `Page N of M (T attempts)`, row retry | `History` + shared `Pagination` | Preserved (adds Correct/Incorrect badges) |
| Lessons tab "Unavailable until task09" | `Tab` fallback | Preserved |
| Zero-attempt empty state per tab | `StudentDetail` gate | Changed: gate is `!t.att && !totalHistory` (uses `totalHistory` from detail payload) so a student with only legacy history rows does not show a false empty tab. Old gate ignored history rows. E2E `empty-*` screenshots assert the new text. |

### Live (`/admin/live`, `/admin/live/:id`)

| Old behavior | New location | Verdict |
|---|---|---|
| Room list: per-lesson `GET sessions`, filter `ended`, `No open rooms.` | `LiveRooms` | Preserved, except queries `?includeArchived=1` so archiving a template never hides its active session (archive decision, §b). Link text is now "Open live room". |
| Room `GET /api/lessons/:id`, WS `/api/lessons/:id/ws`, ping/pong clock offset, `snapshot`/`annotate`/`laser`/`error` handling, 1.5 s reconnect, code-4001 tab-takeover message | `Live` effect | Preserved. Laser additionally checks `room.current.questionId` so late frames from a previous question cannot paint the new one. `error` also refetches the room snapshot. |
| `data-live` actions: `start`, `startQuestion`, `addTime{sec:15}`, `endNow`, `next`, `endSession`; `lockJoin` + `kick{userId}`; sort select; `classResults` toggle | `Live` footer/controls | Preserved. Buttons render conditionally instead of disabled (same enable rules); lock toggle exists in lobby AND inside in-live `.roster-details` (spec opens the disclosure first). |
| Roster `#live-roster`, remove buttons, `No students yet.` | `roster` | Preserved |
| Responses `○/◐/●` + answer + always-on `✓/✗` | `response-row[data-response]` named badges `nothing`/`selected`/`locked` + `aria-label Correct/Incorrect` | Changed (required): correctness is revealed-only now — pre-reveal icons shown in the old UI leaked answers. Per inventory contract; `paced.spec` asserts `[aria-label]` counts are 0 pre-reveal and 1/1 post-reveal. |
| Distribution `data-group` buttons + `#live-group` names/time | `.distribution` | Preserved shape; rendering changed from `█`-repeat text to CSS `.track` bars + counts + `Correct choice` icon, popover with close button, toggle on re-click, `Escape` closes. Old text assertions replaced by bar/`aria-label` assertions in `paced.spec`. |
| `#live-timer` countdown | `#live-timer` | Preserved (now `mm:ss` via `formatTime` + `urgent` class ≤10 s; old raw seconds). |
| Annotation tools pen/highlight/strike/erase/clear/laser, revealed-only `#live-tools`, `aria-pressed`, crosshair/text cursor | `InstructorStage` | Preserved mechanics; changed: 3 swatches (`#ffe066 #ff7676 #75dbaa`, pen defaults `#ff7676`), tool toggles off on re-click, `Escape` deselects, clear uses a `Dialog` (Cancel/Clear all) instead of blocking `confirm()`. All three swatch colors asserted in E2E (`Color #75dbaa`). |
| `mountStage($('live-stage'), {id:'live-card', marks, mathify})`, `data-ready` | Shared `Stage` (`id="live-card"`, `dataset.ready='true'`, `onReady`) | Preserved — no second renderer. |
| `✓ Correct:` answer line, Official explanation + My notes (`notesHTML`) | `stage-heading` badge + `.instructor-drawer` | Preserved (+ `Explanation unavailable.` fallback). |
| `#live-error[role=alert]` | `#live-error` | Preserved |
| `#live-link` Connected/Reconnecting | `#live-link` with Wifi icons | Preserved text |

### Builder (`/admin/lessons/new`, `/:id/edit`)

| Old behavior | New location | Verdict |
|---|---|---|
| Library cards: title/mode/count/total/runs/last-run; edit/start/duplicate/past; `No lessons yet.`; `New lesson` | `Library.tsx` | Preserved, plus `Delete` (archive, §b). |
| Past sessions inline `#past-{id}`, `Session {paddedId} · {status} · {date} · {code} (results unavailable until later task)` | `PastSessions` | Preserved (+ `Open live room` link for non-ended sessions — additive, no contract broken). |
| Filters section/domain/skill/difficulty/usage/search, result pages, usage badges, `data-add`/`data-preview`, `Add all on page`, `No results.` | `QuestionBrowser` | Preserved query semantics; changed: Domain/Skill/Difficulty are collapsible `<details class="multi">` with count badges + removable chips (why `builder.spec` opens them first). Duplicate add now also disables the button (`aria-label "Added …"`, check icon); old relied on `#add-error` text only. `#add-error` node retained. |
| Question preview | `Dialog` slide-over `#question-preview` | Changed container (was inline); same `Preview` content. |
| Title (maxlength 200) / mode radios / total time / `lesson-items` with drag + up/down + remove + edit | `Builder` | Preserved. Reorder keeps the open editor glued to its `question_id` (old index could edit the wrong item after a move). |
| Time chips 30–180 s + custom `mm:ss` (5 s–3 h), `#time-error` | Editor | Preserved rule and message (`Use mm:ss (5 seconds to 180 minutes)`); chips show short labels with `aria-pressed`; `#time-error` is a persistent node. |
| Notes (maxlength 4000) markdown + KaTeX `#notes-preview`, question reference | Editor | Preserved (`notesHTML` byte-identical logic in `helpers.ts`); reference moved into a collapsed `<details>` — why `admin.spec` opens nothing extra (it reads `#notes-preview .katex` only). |
| Debounced (600 ms) serialized autosave; `Saved/Unsaved/Saving/Error…`; title-required; manual Save + Retry; `history.replaceState` to `/edit` | `save`/`update`/`saveLatest` with `revision`/`saved` refs + promise chain | Preserved. `Retry` (`#retry-save`) renders only while status is `Error…` (old always rendered) — cosmetic; manual-save and error paths asserted in E2E. Untitled drafts skip scheduling but stay explicitly saveable, so the exit dialog's Save correctly reports `Title required` while Discard still works (asserted). |
| Save & start → `#join-result .join-code` + paddedId + join URL + `Open live room` | `startSession` | Preserved |
| Leave-guard: section nav forced save-then-leave | `guard` ref + `Save changes before leaving?` Save/Discard/Cancel `Dialog` + `beforeunload` | Changed: explicit choice replaces forced save; also covers the student-app link. `unsaved-exit` / `unsaved-save-error` screenshots assert both paths. |
| `?start=1` auto-start | `Builder start` prop | Preserved |

### Spec changes (same change, reason listed — no loosened assertions)

| Spec | Change | Reason |
|---|---|---|
| `builder.spec` | `openFilter` opens `.multi details` before checking; skill visibility uses `toHaveCount(1)` | Collapsible filter redesign |
| `realtime.spec` | Opens `.roster-details summary` before `#live-lock` | Lock toggle moved into disclosure in live view |
| `paced.spec` | `data-response` named-status text; `[aria-label Correct/Incorrect]` 0 pre-reveal → visible post-reveal; bar `style width` + `Correct choice` icon; SPR group text `0.53` | Redesign: delayed correctness, CSS bars, exact SPR grouping |
| `annotations.spec` | Clicks `Clear all` in dialog instead of accepting native dialog | `confirm()` replaced by `Dialog` |
| New `tests/e2e/ui-admin-dashboard/admin.spec.js` (94→93 lines) | Inventory sweep + both viewports, archive round-trip (sessions API still returns 1 row post-delete), 503 error states via route fulfill, zero pageerrors | Covers every inventory row incl. lobby/live-answering/revealed+popover/toolbar-active/builder/library/8 student tabs/bank |

## (b) Server + outside-UI changes

| Change (all committed in `586aa5ea` unless noted) | Reason |
|---|---|
| `migrations/0009_lesson_archive.sql` + `schema.sql`: `lessons.archived INTEGER NOT NULL DEFAULT 0 CHECK(0,1)` | Soft-delete; `lesson_sessions.lesson_id` FK + frozen session/response/review rows must survive template removal. |
| `src/index.js` DELETE `/api/admin/lessons/:id`: hard delete (409 when sessions exist) → `UPDATE lessons SET archived=1` | Deleting a taught lesson previously either failed (409) or destroyed history; archive keeps `GET sessions` intact (E2E asserts 1 row remains). 404 for unknown id preserved; admin gate untouched. |
| `src/index.js` lesson list: `WHERE archived=0 OR ?=1`, `?includeArchived=1` opt-in | Library hides archived; `LiveRooms` passes `includeArchived=1` so live rooms outlive archival. Default response shape unchanged. |
| `tests/test_lessons_builder.cjs` (+47): archive gate + history-preservation cases; `test_grade.cjs` (touches archive fixture); `tools/e2e_seed.cjs` (+8, committed) | Unit coverage for the delete→archive contract. |
| `public/admin.html`: full shell → `<div id="admin-root">` (KaTeX CDN + integrity + `/admin.js` URL unchanged) | Bundle owns the DOM; role-gated `/admin.js` URL and CSP-sensitive CDN pins preserved. |
| `public/admin.js` (old 327-line source): deleted; now a gitignored build artifact (`/public/admin.js` in `.gitignore`) | Single source of truth is `admin-ui/`; no forked copy to drift. |
| `vite.admin.config.ts` (new, committed; worktree only re-quotes): lib build `admin-ui/index.tsx` → `public/admin.js`, CSS inlined, `/shared/*` external | Keeps the role-gated URL with no new asset route; shared modules stay server-served singletons. |
| `lesson-ui/escape.ts` (new; worktree: prettier reformat only) + `Stage.tsx` import switch | `escapeHTML` shared by admin helpers without duplicating logic; zero behavior change. |
| `lesson-ui/lesson.css`: token `:where(...)` hoisted to cover `#admin-root` | One design system; Stage looks identical in admin and student contexts. |
| `tsconfig.lesson.json`: includes `admin-ui`, `vite/client` types, `allowImportingTsExtensions` | Typecheck the new sources (passes). |
| `package.json` worktree `+dev:admin` watch script; `playwright.config.js` worktree `workers: 2` | Dev speed / suite speed only; `test:e2e` green at workers 2 (19/19). Full-suite run above used it. |

## (c) Could not confirm / accepted limits

1. Touch behavior on real phones (pointer capture paths are shared `Stage` + pointer events; no device lab) — same standing limit as the student player.
2. Screen-reader pass beyond roles/labels already asserted (`tablist`, `aria-pressed`, `aria-sort`, `role=alert/status`, dialog focus restore) — no AT run.
3. Production CDN/KaTeX availability — E2E loads local bundle; pinned integrity attributes unchanged.
4. Roster above ~500 members and full-bank sweeps — unmeasured, same as before; no new claim.
5. `retry-save` hidden until error and editor reference collapsed are cosmetic visibility changes with no spec coverage of the old always-visible state; flagged here, not treated as bugs.
