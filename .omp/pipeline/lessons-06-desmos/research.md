# lessons-06 research

## B — Desmos API v1.11 (researcher, Sonnet; general-purpose agent with the lessons-researcher prompt because the custom agent type is not loaded until a new session)

Source: https://www.desmos.com/api/v1.11/docs/index.html (curl). calculator.js 302 → v1.11.4 (4,029,561 bytes) with apiKey=dcb31709b452b1cf9dc26972add0fda6.

1. Script: `https://www.desmos.com/api/v1.11/calculator.js?apiKey=KEY`. Docs print no demo key; `dcb31709b452b1cf9dc26972add0fda6` works live (`desmosApiKeyType='demo'` in the response). Production keys: desmos.com/my-api; licensing terms page is client-rendered — production use of the demo key unverified.
2. Options (docs): `graphpaper`, `expressions`, `settingsMenu`, `zoomButtons`, `keypad`, `expressionsTopbar`, `pointsOfInterest`, `trace`, `border`, `lockViewport` ("Disable user panning and zooming"), `expressionsCollapsed`, `capExpressionSize`, `authorFeatures`. Per-expression `readonly` needs `authorFeatures:true`. `updateSettings(obj)` changes options after construction.
3. `observeEvent('change', cb)` fires on any state-persisting change (user or API). `graphpaperBounds` is observed with `calculator.observe('graphpaperBounds', cb)`. `getState()` opaque JSON; `setState(state, {allowUndo, remapColors})`. `destroy()`.
4. Runtime: `eval(__dcg_shared_module_source__)` → script-src needs `'unsafe-eval'`; worker via `URL.createObjectURL(new Blob(...))` → worker-src needs `blob:`; images `data:`. No external font/CDN hosts (fonts bundled). Other hosts only for help links.

Open risks: `'unsafe-eval'` conflicts with CLAUDE.md guidance (which is about test harnesses) — verify empirically and scope it. Demo key licensing for production unverified.

## A — current code (main session, no subagent)
- DO: `src/lesson-room.js`; protocol: `public/shared/lesson.js` (MAX_FRAME 2048 bytes — too small for Desmos state).
- Instructor: `admin-ui/Live.tsx` (`InstructorStage`, toolbar in REVEALED). Student: `lesson-ui/index.tsx` (`Player`), bridge in `public/index.html` ~3690.
- Worker → DO context body `src/index.js:42`; static allowlist `src/index.js:412`; CSP `src/index.js:57` + `public/_headers`.
- `session_question_review.desmos_state_json` already exists (migration 0008).
