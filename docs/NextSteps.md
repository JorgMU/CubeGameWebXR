# Next Steps

## 1. Split `app/main.js` into ES modules

`main.js` is about 1,600 lines. Split it in small, verifiable steps and keep the current constraints:

- No build step.
- The Three.js r160 CDN import map in `index.html` stays unchanged.
- All files stay under `app/`, and URLs stay relative to `index.html`.

### Ground rules
- Native `<script type="module" src="main.js">` and relative imports with the explicit `.js` extension (`import { COLORS } from './constants.js'`).
- The import map already resolves `three`, so every module can `import * as THREE from 'three'`.
- Move one module at a time. After each move, run `node --check` on the touched files, load the page, roll the cube, and test one MR action.
- Keep `BUILD_TIMESTAMP` in `constants.js` and keep updating it on every change.
- Avoid circular imports. Dependencies flow downward: `constants` → `state` / `audio` → `scene` / `panels` → `xr` / `appearance` → `main`.

### Target layout
| File | Contents |
|---|---|
| `constants.js` | `BUILD_TIMESTAMP`, `COLORS`, `INITIAL_ORIENTATION`, board and cell sizes, `ROLL_SECONDS`, `MESSAGE_SECONDS`, colour and opacity defaults, `HOMES`, `AP_*` layout constants, `CONFETTI_*`. Pure data only. |
| `audio.js` | `unlockAudio`, `playClick`, `playSwoop`; owns `audioCtx`. Later home for `THREE.AudioListener` or a mute toggle. |
| `haptics.js` (or inside `xr.js`) | `triggerHaptic`, `lastHapticAt` throttle. |
| `scene.js` | Renderer, scene, camera, `worldGroup`, sky, board, grid, `cube`, `cellToLocal`. |
| `icons.js` | `drawIcon`, `makeIconTexture`, `redrawIconTexture`, `iconTextures`, `shapeStyles`, `removeIcon`, `icons`, `buildIconsFromPattern`. |
| `panels.js` | In-world status, debug and scores panels; `drawScoresPanel`, `updateDebug`, `updateColorTable`. |
| `game.js` | State (`level`, `orientation`, `win`, `levelScore`, timers, `sessionRecords`), `tryRoll`, `finishRoll`, `generateLevel`, `restartLevel`, `nextLevel`, scoring. Emits events instead of touching the DOM. |
| `hud.js` | DOM HUD (`updateHUD`, records table) and message auto-clear. |
| `celebration.js` | Confetti and panel pulse. |
| `xr.js` | `sessionstart` / `sessionend`, controllers, `readXRInput`, `updateWorldDrag`, thumbstick roll, `resetWorldForMR`, home pose. |
| `menu.js` | Controller menu: draw, hover, `activateMenuItem`. |
| `appearance.js` | Appearance model, localStorage, HSV helpers, panel drawing, drag handling, `flushAppearance`. |
| `input-desktop.js` | Keyboard handlers. |
| `main.js` | Imports, wiring, and the animation loop only. |

### Migration order
Start with the least-coupled code; each step is a separate, commit-sized change.
1. `constants.js` — move pure values.
2. `audio.js` — self-contained.
3. `haptics.js` — pass the renderer in (`initHaptics(renderer)`).
4. `icons.js`, then `celebration.js` — export `init…(worldGroup, panel)`.
5. `scene.js` — export `renderer`, `scene`, `camera`, `worldGroup`, `cube`, `boardPlane`, etc.
6. `panels.js` and `hud.js`.
7. `game.js` — split state from side effects; `hud` / `panels` / `celebration` subscribe to game events.
8. `xr.js`, `menu.js`, `appearance.js` — share state through an exported object, not bare `let` exports.
9. `input-desktop.js`; reduce `main.js` to wiring plus the loop.

### Pitfalls
- **Mutable shared `let`s.** Importers cannot reassign an imported `let`. Use an object (`state.win = true`) or setters. Candidates: `win`, `message`, `roll`, `orientation`, `levelScore`, `appearanceOpen`, `menuOpen`, `cubeColorDirty`.
- **Load order and side effects.** Module-level code currently runs top to bottom (for example `generateLevel()` before the loop, `cubeColorDirty = true` before the initial flush). Move these into explicit `init()` calls from `main.js`.
- **Audio unlock.** Keep the `keydown` / `pointerdown` listeners and the `sessionstart` call to `unlockAudio()`.
- **Per-frame order.** Keep the loop order: timer HUD, message clear, debug, roll, exit-pending return, then input and UI.
- **Caching.** Hard-refresh (or add `?v=`) after edits; on Quest clear the cache or bump the query string.
- **Request count.** Negligible locally; `modulepreload` links in `index.html` fix it later without a build step.

### Verification checklist (after each step)
- [ ] `node --check` passes on every changed file.
- [ ] Desktop: loads with no console errors, keyboard roll works, level completes, N advances.
- [ ] Desktop: scores panel and HUD table update.
- [ ] Quest: enter MR (game resets), roll, grips drag the world, menu and appearance panel work.
- [ ] Sounds, haptics and the celebration still fire.
- [ ] `BUILD_TIMESTAMP` shows the new value in the debug panel.

### Features this enables
- Custom level loader (`levels.js`).
- Saved player profiles (`profile.js` wrapping localStorage: scores, appearance, mute).
- Positional audio via `THREE.AudioListener`, contained in `audio.js`.

## 2. Test on Quest (not yet hardware-verified)
- Slider optimization (live cube opacity, in-place texture redraws, 250 ms throttled rebuilds).
- Haptics: match, no-match, menu, appearance panel.
- Click and swoop sounds (check the audio unlock in MR).
- Level-win celebration (confetti and panel pulse).
- Scores panel, status panel and debug panel placement.
- MR enter/exit resetting the game.

## 3. Smaller follow-ups
- Cap sky texture quality by device profile (4K vs 8K).
- `formatTime` has no hours handling.
- Session-record sort tie-breaking is not fully stable.
- Saved `localStorage` appearance overrides new coded defaults (e.g. cube opacity 60%); consider a version key.
