# Refactor01-fixed — what changed and why

Base: `For_Thule_1_k3bb.zip` (the "after" version, with the finished
`state.js` refactoring). This is **not** a revert to the "before" version —
the finished refactoring is kept, and the bugs it introduced are fixed.
`cube.js`, `materials.js`, `textures.js`, `scene.js`, and the board/cube
colours and desktop scale are unchanged from that base, so the look of the
game should be the same as the working "before" version except for the
fixes below.

## The cube-vanish bug (the main fix)

**Symptom:** the cube disappeared, but the rest of the game kept running.

**Root cause, found by diffing the working "before" version against the
"after" version:** only `app/main.js` and `app/state.js` differ between
those two zips, and in `main.js` `finishRoll()` the "after" code did:

```js
const pos = { col: roll.destCol, row: roll.destRow };
setCubePosition(pos);
```

but `state.js` defines:

```js
export function setCubePosition(col, row) { ... }
```

So `cubeCol` became the whole `{col, row}` object and `cubeRow` became
`undefined`. On the next roll, `destCol` became `"[object Object]1"` and
`destRow` became `NaN`, `cellToLocal()` returned `NaN`, and the cube's
position became `NaN` during the roll animation — a mesh at a NaN position
is not drawn, so the cube vanished. Everything else (HUD, messages,
orientation) kept working because it does not use the corrupted position.

**Fix (two layers, so it cannot silently recur):**

- `app/main.js`, `finishRoll()`: `setCubePosition(pos.col, pos.row);`
- `app/state.js`, `setCubePosition()`: now also accepts a single
  `{col, row}` object and unpacks it, instead of storing it as `cubeCol`.

A check of every other `state.js` call in `main.js` found no other
argument-shape mismatch of this kind.

**How to confirm the fix:** start a level, roll the cube at least twice
in different directions, and confirm the cube stays visible and lands on
the correct squares. Before this fix it vanished on the second roll.

## Other fixes in this zip (from the refactor01 punch list)

- `app/main.js`, `loadSky()`: the texture callback compared against a
  bare `skyRequest` variable that does not exist in `main.js`; it now
  compares against `getSkyRequest()` from `state.js`.
- `app/main.js`, MR `sessionend` handler: bare `drag`, `skyMode`,
  `exitTimer`, `exitPending` variables that do not exist in `main.js`
  are replaced with `setDrag()`, `getSkyMode()`/`setSkyMode()`,
  `getExitTimer()`/`setExitTimer()`, `setExitPending()`, so the handler
  no longer throws before closing the menu and restarting the level.
- `app/main.js`, tilt: `resetWorldForMR()` set a local `tiltDeg` while
  `stepTilt()` and the debug panel read `getTiltDeg()` from state, so
  they disagreed by the 30° MR home tilt. It now calls
  `setTiltDeg(home.tilt)`, and the local `tiltDeg` is gone.
- `app/main.js`, grip/menu/exit: `gripHeld` now *is* the `state.js`
  array (via `getGripHeld()`), and the unused local `menuOpen`,
  `menuPrev`, `exitPending`, `exitTimer` variables are removed, so there
  is one source of truth for each.
- `app/utils.js` + `app/main.js`, haptics: `triggerHaptic()` checked
  `window.leftGamepad`/`window.rightGamepad`, which nothing ever set.
  Gamepads are now registered from the XR session's input sources in
  `readXRInput()` (`setHapticGamepad()`), and `triggerHaptic()` uses
  those, with errors caught so haptics can never break the game.
- `app/index.html` + `app/config.js`: the inline loader that fetched
  five files' `Last-Modified` headers, stored a timestamp in
  `sessionStorage`, and reloaded on change (with a reload-loop risk when
  no header is present) is replaced by a static
  `<script type="module" src="./main.js">`. `app/buildTime.js` is deleted;
  `BUILD_TIMESTAMP` is now a constant in `config.js`
  (`'2026-11-04 refactor01-fixed'`) shown in the HUD.
- `app/config.js` + `app/main.js`, grid colour: the grid is now drawn
  with `GRID_COLOR` from config, and `GRID_COLOR` is set to the yellow
  (`0xfff005`) that was actually being rendered — no visual change,
  but changing the config value now works.
- `app/main.js`: unused imports removed (including the dead material
  creators, `ARButton`/`onWindowResize`/`setAnimationLoop` which `main.js`
  does not use, and unused state accessors). No behaviour change.

## Not changed (deliberately)

- Grid 11×11, board size, cube size, scoring, sky modes, menu, and
  appearance defaults are unchanged.
- The 17 MB of starmap textures is unchanged — the asset-set decision
  from the punch list is still open.
- No appearance reset control was added in this zip; that is still an
  open punch-list item.

## If the cube is still invisible on first load (before any roll)

That would be a different symptom from the bug above. Check the debug
colour table for the cube opacity: a saved appearance with cube opacity
0 (stored under `cubeGameAppearance` in `localStorage`) would hide the
cube on every load. Clearing site data for the page, or that key, would
confirm it. The fixed zip does not change a saved 0% opacity, because
that would be overriding a saved setting rather than fixing code.

## Run it

Same as before, from the repo root:

```
.\StartCubeGameWebXR.ps1
.\StopCubeGameWebXR.ps1
```

Only `app/` is served, on port 8001, with the trycloudflare URL copied
to the clipboard, as in `StartCubeGameWebXR.ps1`.

## Fixed2 update — the HUD build timestamp (2026-11-04, after fixed1)

Fixed1 made a mistake for this workflow: it replaced the dynamic
timestamp with a constant string in `config.js`, so the HUD would have
shown the same build label forever, even after files changed. That is
exactly the signal the user uses to tell whether the latest files
loaded, so fixed2 restores automatic updating:

- `app/index.html` loader is back, but with two fixes over the original:
  it checks all 9 served files (not just 5 — a `state.js` or `utils.js`
  change now moves the timestamp too), and if no file supplies a
  `Last-Modified` header it loads `main.js` plainly and does **not**
  reload. The original fell back to the current time, which always
  differs and could reload in a loop.
- `app/buildTime.js` is back, with the same full file list, and its
  fallback is the `BUILD_LABEL` in `config.js`, not the current time —
  so a missing-header case shows a stable label instead of a timestamp
  that changes on every load even though nothing changed.
- `app/main.js` again imports `BUILD_TIMESTAMP` from `buildTime.js`
  (HUD line and debug panel), not from `config.js`.

With the normal `py -m http.server` setup, that server does send
`Last-Modified` for every file, so the HUD date will move whenever any
of the 9 files changes. If you ever see the HUD show the fixed2 label
instead of a date, that means no `Last-Modified` headers reached the
browser — check the server/tunnel, not the game code.
