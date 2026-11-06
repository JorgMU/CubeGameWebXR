# Cube Game WebXR — v5

A 90s-inspired cube-rolling puzzle for Meta Quest, in the browser.

## The game

- A horizontal 17×11 board floats in front of you — 17 squares across,
  11 deep, about 3:2, so it fits a wider-than-tall view. It is a 34% opaque dark-blue
  surface (`BOARD_COLOR` `#000584`, `BOARD_OPACITY`) with black grid lines
  (`GRID_COLOR` `0x000000`), so it tints the background behind it. The board is
  about 3.09 m wide and 2.0 m deep, so each cell is about 0.182 m — to change
  the board, change `cols` / `rows` / `boardSize` in `app/sessionConfig.js`,
  not `CELL`, and the cells, cube, and icons will scale with it.
- A cube has dark-grey faces (`CUBE_FACE_COLOR` `#222222`) at 40% opacity
  (`CUBE_OPACITY`), each carrying a different coloured symbol (the same
  shape and colour as the board icons). Current colours, from the appearance
  panel's colour table: board `#000584`, cube `#222222`, grid `#000000` at 25%
  opacity, edges `#055200`, circle `#c10303`, triangle `#049f27`, square `#354cff`,
  star `#f1c40f`, diamond `#9b59b6`, hexagon `#e67e22`, shape border
  `#000000` 5 px. Red, Green, Blue, Yellow, Purple, Orange.
- The cube is transparent, and its six faces are separate planes, so the
  shapes on the far faces show through the near faces, in the right order,
  at partial opacity. At opacity 1.0 it is solid, and only three faces show.
- Each coloured square shows a **flat icon lying in the plane of the board**
  (not floating above it). The icon's shape is also distinct per colour,
  so a square is not identified by colour alone.
- Roll the cube one square at a time. A square clears **only when the
  cube's face-down face matches that square's icon colour**.
- The level ends when every coloured square is cleared.
- A new level is a new random pattern: about 50% of squares coloured,
  the rest blank (the start square is always blank). Generation
  guarantees at least 6 coloured squares. There is no lose
  condition in the current version. Rolling off the edge is blocked,
  with a buzz-buzz error sound and a matching double haptic pulse
  on both controllers (throttled to one buzz per half second while
  the stick is held against the edge).

## Scores

- The clock starts on your first move of a level. Each match is worth
  180 points minus one point per elapsed second (minimum 0).
- Completing a level adds a record (level, score, time, date) to the
  top 10, shown in the HUD table ("Top 10 Scores") and, in MR, on the scores
  panel beside the board in the world.
- The top 10 **persist across sessions**: they are saved in
  `localStorage` under `cubeGameRecords` (like the appearance colours
  under `cubeGameAppearance`), sorted by score, then by time, and
  trimmed to 10. Bad or unavailable storage falls back to an empty list.
- **Clear scores** (2D only): the **Clear Scores** button in the
  top-right button bar, or the **X** key, wipes the saved top 10 immediately
  (asks for confirmation first; no undo) and restores the empty table. There is no clear control in
  MR; clear from the 2D panel before or after a session.

The cube starts at the center cell (column 5, row 5), on the center row.
Its initial face orientation is: Blue up,
Orange down, Green north (away from the player), Yellow south, Red east,
and Purple west.

## Controls

### Meta Quest (Quest Browser, WebXR)
- **Thumbstick** (either controller): push to roll one square that way; hold it to keep rolling one square every half second.
  Push forward = north (away from you), back = south, left/right as shown. The stick acts like a D-pad:
  each direction owns a 60° wedge around it, and the 30° gaps centred on the diagonals roll nothing,
  so a push near a diagonal does not flip direction.
- **Grips**: world drag.
  - **One grip** (either hand): the world follows that hand, translate only.
  - **Both grips**: the world also rotates and scales:
    - move your hands to translate the world,
    - twist your hands to rotate the world (yaw only, so the board stays horizontal),
    - move your hands apart to enlarge the world, together to shrink it.
  - Adding or releasing a grip re-anchors the drag, so the world never jumps;
    release all grips to end it.
  - **Tilt**: while either grip is held, pull a thumbstick back to tilt the board
    up toward you, push forward to lay it down, in 5° steps (repeating while
    held) from 0° (flat, face up) to 180°; 90° faces you. Reset view returns to 0°.
  - To the player this feels like the world moving around them; it is
    implemented as moving the board/cube/icon group, which is the same
    relative motion as moving the player the opposite way.
- **Trigger** after a win: starts the next level.
- **Left menu button or Y button**: opens/closes a small menu attached to the left controller.
  Point the right controller at an item and pull its trigger: **Debug: On/Off**
  toggles the debug readout, **Sky: <mode>** shows the mode a click will switch to (the debug readout shows the current one) and cycles the star map
  between the tuned version, the unadjusted NASA data, a plain black background, and
  (Quest, in the headset only) the real-world passthrough view, **Reset Home**
  returns the board to the MR start view, **Next Level** starts a new level,
  **Restart Level** restarts the current level, **Clear Scores** and
  **Reset Colors** each ask you to tap the same row again within 5 seconds to
  confirm (there is no popup inside a session), and **Exit MR** ends the
  immersive session. Below the rows, in small grey text, the menu says
  "Exit MR for Other Options" — an inactive hint, not a button. The menu closes after any selection. Choosing **Exit MR** shows a 3-second reminder on a panel facing
  you above the table center, 0.4 m above eye height so it clears the board. Look forward; the Quest resets its
  front direction to where you are looking when the immersive session ends.
  There is also an **Exit MR** button on the board itself, flat in the board
  plane, centred on the south edge — half the size it was, at the board's
  own level (y 0) and 0.04 m south of the south edge, so there is a clear
  gap between it and the board — point the right controller at it (it
  highlights bright green, and a green laser draws from the controller to the
  button; when you point away the laser stays for 2 s, still following where
  the controller points, fading out) and pull the trigger. When nobody is
  pointing at it its background is 95% transparent, so it sits quietly
  at the bottom edge as dark-green text and a border. It only shows
  while a session is running, and it runs the same 3-second exit as the
  menu row. Coming out of a session puts the board back at the 2D home pose
  and the camera back to the desktop viewpoint.
  While the menu is open the thumbstick and trigger do not roll the cube or
  start a level.
  (On the Quest browser the left menu button is reported as button index 12
  and Y as 5; the debug readout's "Left buttons down" line shows the indices.)
- **Right B button**: opens/closes the appearance panel on the right controller. Point the left controller at
  it and hold the left trigger to drag. The `<` / `>` buttons, or the **right thumbstick left/right**, step
  through the items in order (Board, Icons, Cube faces, Grid lines, Cube edges,
  Shape borders, then each shape's Fill: Circle, Triangle, Square, Star, Diamond, Hexagon); the stick
  wraps around and also walks between an item's parts when it has more than one. "Shape borders" is a
  single colour and width shared by every shape. The colour picker (hue across, saturation down) and
  Brightness slider update live; Opacity appears for the board, cube faces, icons,
  grid lines and cube edges — the two line opacities are separate values. The grid lines default to
  black at 25% opacity: bright line colours flicker with aliasing and foveated rendering.
  "Icons" has two Opacity sliders — one for the board icons, one for the cube icons — and no colour
  picker: the icon colours come from the shape fills.
  The cube faces and their shapes have separate opacities: each shape sits on its own plane just outside
  its face, so the face can stay translucent while the shapes stay solid, or the other way round. Try the
  board icons near 40% to match the cube faces at their default. Shape borders gets a Border
  width slider (0-30 px on the icon texture). Grid lines stay 1 px (WebGL limit). Values are saved in
  `localStorage`.
  The stick and trigger are captured while it is open. The help panel
  (bottom left) shows a selectable table of every current
  colour (hex) and the board, board-icon, cube, grid-line and cube-edge opacity, hidden with the debug readout, so you can copy
  values as defaults.

### Desktop (for testing logic without a headset)
- Arrow keys / WASD: roll.
- Ctrl+Arrow keys: move the world (one cell, 0.2 m, per press; hold to slide). Ctrl+Up moves the board away from you, Ctrl+Down toward you, Ctrl+Left/Right sideways.
- Q / E (or < / >): rotate the world. The **Rotate Left** /
  **Rotate Right** buttons do the same.
- + / - or mouse wheel: scale the world (scroll up / + enlarges ×1.1, scroll down / - shrinks ×0.9). The **Zoom In** / **Zoom Out** buttons do the same.
- 0 or H: reset the board to its home position, rotation, and scale — and,
  in 2D, the camera viewpoint too (coming out of MR leaves the camera at
  the headset's last pose, so Reset Home fixes the player as well as the
  board). The **Reset Home** button does the same. In a session the headset
  owns the camera, so there it resets the board only.
  Home poses for 2D and MR are the `boardHome_2D` / `boardHome_MR`
  sections of `app/sessionConfig.js`; the MR one is used by the Quest
  "Reset Home" menu item and when a session starts.
- *: show/hide the debug readout (small grey text; see "Debug readout" below).
  The **Show Debug** button in the top-right button bar does the same, and also
  refreshes the colour table at once, for use on the Quest where there
  is no * key.
- K: cycle the sky: adjusted, raw, off (black).
- T: tilt the board up 5°; Shift+T tilts it down 5° (0–180°, same as
  grip + thumbstick in MR). The **Tilt Up** / **Tilt Down** buttons, or
  the **[** / **]** keys, do the same.
- TAB: show/hide the whole top-left HUD panel and the other top-right
  buttons. The panel starts hidden on page load, so TAB (or the button)
  is how it first appears. TAB again hides them. The **Show Panel** button
  does the same with the mouse; only it and the MR button stay visible
  while everything is hidden.
- ?: show/hide the help panel (bottom left — help text). The **Show Help** button does the same. The
  help panel is off by default; the main panel keeps the live
  status (level, time, score, face down and board square, message, build date), the
  session scores, the debug readout below the scores when it is on, and
  the colour table. The Show Panel, Show Help and Show Debug buttons read
  Hide instead of Show while their panel or readout is open.
- X: clear the saved top-10 scores (asks for confirmation; no undo). The **Clear Scores**
  button in the top-right button bar does the same.
- Copy Settings (2D only): the **Copy Settings** button in the top-right
  bar, or the **C** key, copies the current settings to the clipboard as ECMAScript — an
  `export const SESSION_DEFAULTS = { ... }` block with five sections:
  `boardLayout` (the board geometry shared by both modes), `boardHome_2D`
  (desktop home pose), `boardHome_MR` (Quest home pose), `appearance`
  (everything the B-button panel edits, colours as hex), and `skybox`
  (current mode only). Paste it
  into `app/sessionConfig.js` to make the values the defaults. If the
  clipboard write fails, the text is shown in a box with its own Copy button
  instead.
- Reset Colors (2D only): the **Reset Colors** button in the top-right
  bar, or the **O** key, clears the saved appearance from `localStorage`
  and rebuilds it from the server defaults in `app/sessionConfig.js`;
  the sky returns to the session default too. Asks for confirmation;
  no undo. The top-10 scores are not touched.
- Reset Home: the **Reset Home** button, or the **H** key (or 0),
  returns the board to its home position, tilt and scale — and, in 2D,
  the camera to the desktop viewpoint too.
- F: force refresh (reload with a unique version string, bypassing
  the cache). The **Force Refresh** button does the same.
- N: next level. R: restart the current level (same pattern, icons restored).
- The buttons in the top-right bar, in order, are Show Panel,
  Show Help, Show Debug, Next Level, Restart Level, Clear Scores,
  Copy Settings, Reset Colors, Reset Home, Tilt Up,
  Tilt Down, Zoom In, Zoom Out, Rotate Left, Rotate Right and Force
  Refresh. Each button shows its hotkey as a bold key at the
  right edge of the button.

## Repo layout — what is served, and what is not

```
CubeGameWebXR/                  repo root
  README.md                     not served (repo docs)
  .gitignore                    not served
  StartCubeGameWebXR.ps1        not served (run from repo root)
  StopCubeGameWebXR.ps1         not served
  app/                          <-- web root: only this is served
    index.html                  served
    main.js                     served (loaded by index.html as ./main.js)
    config.js                   served (code constants, derived values, storage keys)
    sessionConfig.js            served (session defaults: board layout, homes, appearance, skybox)
    state.js                    served (game state, incl. persisted scores)
    cube.js                     served (cube: six separate face planes)
    materials.js                served (cube/board/icon materials)
    textures.js                 served (icon textures)
    scene.js                    served (scene, camera, lights)
    utils.js                    served (helpers, haptics)
    buildTime.js                served (build timestamp from Last-Modified)
    Assets/
      starmap_2020_8k.jpg       served (adjusted sky, used when the GPU supports 8192 px textures)
      starmap_2020_4k.jpg       served (adjusted sky fallback for smaller GPUs)
      starmap_2020_8k_raw.jpg   served (unadjusted sky, 8k)
      starmap_2020_4k_raw.jpg   served (unadjusted sky fallback)
```

## Session defaults — `app/sessionConfig.js`

The settings a fresh load starts from live in one file,
`app/sessionConfig.js`, as `SESSION_DEFAULTS`: `boardLayout`
(columns, rows, board width, coloured fraction, roll time), `boardHome_2D`
and `boardHome_MR` (position, tilt, scale), `appearance`
(everything the B-button panel edits, colours as hex) and
`skybox` (default mode). Edit the values there and reload; the
file is in the build-timestamp check, so the HUD build date moves
when it changes and you can tell the new file loaded. The Copy
settings button dumps the live values in exactly this shape, so a
copied dump pastes straight in. The saved appearance and scores in
the browser still override these defaults at runtime; the **Reset
Colors** button in the 2D top-right bar clears the saved
appearance and restores these values (scores are not touched).


`app/index.html`, `app/main.js` and its modules, and the sky images in `app/Assets/` need
to be served. Icons are drawn on canvas in `app/textures.js`, and
Three.js r160 is loaded from a CDN via an import map in `index.html`.
If you add assets later (textures, sounds, models), put them under
`app/` — for example `app/Assets/` — so their relative URLs keep working
from `index.html`.

## Sky background

The sky is a star map of the whole sky as seen from Earth, with the Milky
Way, in celestial coordinates (north celestial pole straight up when the
board is at its home orientation). It is painted on a large sphere (radius
30 m) inside the board's group, so it moves, turns, tilts, and scales with the
board: dragging the board drags the sky with it.

The images are NASA's 8192×4096 "Deep Star Maps 2020" (NASA/Goddard Space
Flight Center Scientific Visualization Studio, https://svs.gsfc.nasa.gov/4851/;
Gaia DR2: ESA/Gaia/DPAC), converted from linear OpenEXR to JPEG, each with a
4096×2048 copy for GPUs that cannot load 8192 px textures. In a headset
resolution is what matters, which is why 8k is used when the GPU allows it.

- **Adjusted** (default): subtracts the diffuse sky glow so the space between
  stars is nearly black, then softens and brightens the stars slightly so they
  do not shimmer as single pixels. Only the stars and a faint Milky Way remain.
- **Raw**: only the linear-to-sRGB conversion, with no glow removal, gain, or
  bloom. It is hazier and dimmer, with a bright Milky Way band.

Cycle with the **Sky** menu item in MR, or K on desktop (Adjusted, Raw, Off =
plain black, a solid black sphere with no texture in memory, because
immersive-ar sessions ignore the scene background colour; Passthrough is added to
the cycle only when the session's display blends with the real world). The app
has a single start button for one `immersive-ar` session (WebXR's name for what
this README calls MR; the button text is shown as "START MR"). There is no
separate VR mode; the runtime decides what happens on a device without
passthrough. Only one 8k texture
is held in GPU memory at a time. The sphere stays black until the first image
loads.

## Run it

No build step. `app/index.html` loads Three.js r160 from a CDN via an
import map, so you need internet access the first time it loads.

### Option A — the included PowerShell scripts (recommended for Quest)

This is the same pattern as the EarthAndMoon scripts: scripts at the
repo root, app folder beside them.

```powershell
cd CubeGameWebXR
.\StartCubeGameWebXR.ps1
.\StopCubeGameWebXR.ps1
```

Requirements: Python launcher `py` in PATH, and `cloudflared` in PATH
(`winget install Cloudflare.cloudflared`).

What Start does:
- Serves only `app/` with `py -m http.server` on port **8001**, bound to
  127.0.0.1 so it is not exposed on your LAN (the tunnel reaches it locally).
  (8001, not 8000, so it can run alongside EarthAndMoon on 8000).
- Starts `cloudflared tunnel --url http://127.0.0.1:8001` and prints the
  `https://*.trycloudflare.com` URL, which it also copies to the clipboard.
  Open that URL in the Quest Browser — WebXR needs a secure (HTTPS)
  context, and a plain `http://` address to your PC over LAN will not qualify.
- Saves the server and tunnel PIDs to
  `%LOCALAPPDATA%\cube-game-webxr\processes.json`.
- If services are already running, it calls the Stop script first.

Stop kills both PIDs from that state file and removes the state file.

### Option B — any static server

From the repo root:

```powershell
py -m http.server 8001 --directory app
```

Then open `http://localhost:8001` on desktop for logic testing. For the
Quest, you still need an HTTPS URL (see Option A).

## Forcing a refresh after changing a file

The HUD shows the build time as the newest Last-Modified among the
served files — that is how you tell the latest changes loaded. Three
things make a changed file actually show up:

- **The server sends `Cache-Control: no-store`.** `StartCubeGameWebXR.ps1`
  runs `CubeGameWebXRServer.py` (repo root, not served) instead of plain
  `py -m http.server`, which sends no Cache-Control and let browsers and
  the tunnel cache files by Last-Modified heuristics. With no-store,
  every load goes to disk, so a normal reload or a new tab works.
- **The loader re-reads every file from the server.** The inline loader
  in `app/index.html` fetches all 9 served files with `cache: 'reload'`
  (true Last-Modified, and the fresh copies are put in the cache, so
  `main.js`'s imports load fresh too), then loads
  `main.js?v=<newest Last-Modified>`. There is no `location.reload()` in
  the loader any more — the old one could read a cached timestamp, reload,
  read the cached timestamp again, and settle on the old files.
- **Force refresh, by hand.** The **Force refresh** button in the top-left
  HUD (2D only) reloads the page with `?fresh=<timestamp>`, which loads
  `main.js` with a unique, never-cached version string. You can also paste
  the tunnel URL with `?fresh=1` added yourself. The displayed build time
  is still the newest Last-Modified, not "now" — forcing a refresh only
  forces the files to load, it does not change what the time means.

## Debug readout

Small grey text, shown in the main panel below the scores on desktop,
and in the world east of the board in MR. Refreshed about 5 times a second. * toggles it.
The build timestamp is also shown in the HUD and debug readout, using
`yyyy-MM-dd@HH:mm:ss`. It is computed from the served files'
Last-Modified headers (see buildTime.js), so it moves whenever a file
changes.

- **Player** — where the view is from: x/y/z in metres, and `facing`, the
  head's turn about the vertical axis (positive = counterclockwise from above).
  In MR this is your headset; on desktop it is the fixed testing camera.
- **Board** — the game world's position (x/y/z) and scale.
- **Board yaw / tilt** — rotation of the board: yaw is the turn about the
  vertical axis; tilt is 0° flat (face up) to 180°, with 90° facing the player.
- **Left buttons down** — button indices currently pressed on the left
  controller (for finding out which buttons the Quest browser exposes).

Player and board are separate things in the same coordinate space. The player
is the camera (tracked by the headset; you move it by walking). The board is
`worldGroup` (moved by the two-grip drag or Ctrl+Arrow/Q/E/+/-). Moving the
board never changes the player numbers, and walking never changes the board
numbers; what you see is the difference between them.

## Files

- `app/index.html` — page, HUD, import map for Three.js, loads `main.js`.
- `app/main.js` — game flow: board, cube orientation and rolling
  animation, flat icons, level generation, thumbstick/grip input,
  appearance/menu panels, scores, and the in-world status text (tilted
  up past the far edge, as wide as the board at 3.09 m, its bottom edge level with the
  board, filled with the board face colour, with a grid-line border
  and a divider between the status lines and the message),
  and the sky background. Shared state lives in
  `app/state.js`; constants and colours in `app/config.js`; the cube
  (six separate face planes) in `app/cube.js`.
- `app/Assets/starmap_2020_{8k,4k}[_raw].jpg` — the sky star maps (adjusted and raw; 8k preferred, 4k fallback).
- `StartCubeGameWebXR.ps1` / `StopCubeGameWebXR.ps1` — local server +
  Cloudflare tunnel for Quest testing (repo root, not served).

## Known limits

- Level patterns are random and are not checked for solvability. Blank
  squares give room to manoeuvre and reorient the cube, and R restarts
  the current level if a pattern feels stuck.
- World rotation is yaw only, to keep the board horizontal.
- Desktop world-drag by mouse is not implemented; use Q/E, +/-, and 0.
- No hand-tracking controls yet. There is sound, a clock, and a score
  (see "Scores" above); scores persist, and are cleared only by C or
  the Clear scores button in 2D.
- Desktop behavior has been tested; Quest two-grip world dragging works,
  but thumbstick direction and the trigger have not been explicitly verified.
