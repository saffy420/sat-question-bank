# UI source map

Navigation only; `public/index.html` remains one 4,057-line file. Ranges are inclusive and match the cleanup revision. No code was split or runtime behavior changed. Names of test-extraction block markers are preserved.

## Structure and styles

| Source range | Responsibility |
|---|---|
| `public/index.html:1–23` | Document head; pinned Supabase, font and KaTeX resources |
| `public/index.html:24–109` | Base/theme/global styles |
| `public/index.html:110–349` | Home layout, filters, settings, topic picker, charts and mistakes styles |
| `public/index.html:350–588` | Player, panes, figures, choices, highlighter, map, docking, calculators and results styles |
| `public/index.html:589–758` | Responsive/phone and compact-table overrides |
| `public/index.html:759–763` | Style/head closure and body opening |
| `public/index.html:764–927` | Home markup: navigation, dashboard, practice, browse, mistakes, exams, history and settings |
| `public/index.html:928–975` | Player markup |
| `public/index.html:976–999` | Practice results markup |
| `public/index.html:1000–1020` | Exam results and shared modal/overlay roots |

## Inline application script

| Source range | Responsibility / entry points |
|---|---|
| `public/index.html:1021–1040` | IIFE, DOM/escaping helpers, public auth placeholders, storage wrapper and shared state |
| `public/index.html:1041–1102` | Settings, theme, preference saving and legacy filter migration |
| `public/index.html:1103–1176` | Text normalization and `tidyExpl` extraction block |
| `public/index.html:1177–1251` | Account data loading and `backfillProgress` extraction block |
| `public/index.html:1252–1285` | Settings load and shared `refresh()` |
| `public/index.html:1286–1397` | Sync queues, `flush()`, session save/delete; known queue defects remain deferred |
| `public/index.html:1398–1447` | `load()`: questions/exams fetch, parsing, derived grid-in/levels and initial rendering |
| `public/index.html:1448–1554` | Home/filter dropdown logic |
| `public/index.html:1555–1757` | Legal/settings/filter-related home logic |
| `public/index.html:1758–1847` | `focus` extraction block: selection/ladder helpers |
| `public/index.html:1848–1914` | Shared selection/metrics helpers and `metrics` extraction block |
| `public/index.html:1915–2045` | Shared activity/chart helpers |
| `public/index.html:2046–2304` | Dashboard rendering and interaction |
| `public/index.html:2305–2405` | Mistakes filtering/review |
| `public/index.html:2406–2445` | `notesMd` extraction block and related note preview helpers |
| `public/index.html:2446–2523` | Browse search/preview |
| `public/index.html:2524–2555` | Session section and pure `exam` extraction block |
| `public/index.html:2556–2649` | `start()`, session state and timers |
| `public/index.html:2650–2968` | Question rendering, lightbox, panes, choices and input handling |
| `public/index.html:2969–3050` | `grade` extraction block; preserve `isRight()` semantics |
| `public/index.html:3051–3120` | Text highlighting |
| `public/index.html:3121–3183` | Explanation and per-question note docking |
| `public/index.html:3184–3239` | Session notepad and note chip |
| `public/index.html:3240–3304` | Player navigation/question map |
| `public/index.html:3305–3317` | Directions |
| `public/index.html:3318–3417` | More menu |
| `public/index.html:3418–3482` | Desmos iframe docking |
| `public/index.html:3483–3556` | Practice finish/results and return home |
| `public/index.html:3557–3838` | Exams, scoring, history and review |
| `public/index.html:3839–3913` | Copy for AI: content export and clipboard fallback |
| `public/index.html:3914–4036` | Supabase initialization, bearer headers, account changes and auth modal |
| `public/index.html:4037–4057` | Startup: remove old guest answer storage, await auth, welcome and load |

## Boundaries to preserve

- Browser fetch contracts and nine deferred issues: `docs/AUDIT.md` and `docs/KNOWN-ISSUES.md`; this map does not authorize fixes.
- Worker API/auth lives in `src/index.js`, not the SPA. Browser/Worker auth and both CSP sources must change together; see `docs/SETUP.md`.
- Questions are trusted imported HTML. Figure crops are external ignored assets; AI graphs may be inline SVG.
- Re-query choice nodes after Check; grading replaces DOM. Next may open explanation before moving. Guest probes cannot establish signed-in isolation, durable sync or real-phone touch behavior.
