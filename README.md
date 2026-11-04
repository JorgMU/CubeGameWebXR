# Cube Game WebXR — v5

A 90s-inspired cube-rolling puzzle for Meta Quest, in the browser.

## The game

- A horizontal 11×11 board floats in front of you. It is a 34% opaque green
  surface (`BOARD_COLOR`, `BOARD_OPACITY`) with yellow grid lines, so it tints the background behind it. The board footprint is still 2 m, so each cell is
  about 0.182 m — to change the board size, change `BOARD_SIZE` in `main.js`,
  not `CELL`, and the cells, cube, and icons will scale with it.
- A cube has deep-blue faces at 63% opacity (`CUBE_OPACITY`), each carrying a different coloured symbol (the same
  shape and colour as the board icons). Default colours were captured from the appearance panel's colour table.
  Red, Green, Blue, Yellow, Purple, Orange.
- Each coloured square shows a **flat icon lying in the plane of the board**
  (not floating above it). The icon's shape is also distinct per colour,
  so a square is not identified by colour alone.
- Roll the cube one square at a time. A square clears **only when the
  cube's face-down face matches that square's icon colour**.
- The level ends when every coloured square is cleared.
- A new level is a new random pattern: about 50% of squares coloured,
  the rest blank (the start square is always blank). Generation
  guarantees at least 6 coloured squares. There is no timer and no lose
  condition in the current version. Rolling off the edge is blocked.

The cube starts at the center cell (column 5, row 5), on the center row.
Its initial face orientation is: Blue up,
Orange down, Green north (away from the player), Yellow south, Red east,
and Purple west.

## Controls

### Meta Quest (Quest Browser, WebXR)
- **Thumbstick** (either controller): push to roll one square that way; hold it to keep rolling one square every half second.
  Push forward = north (away from you), back = south, left/right as shown.
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
  (Quest, in the headset only) the real-world passthrough view, **Reset view**
  returns the board to the MR start
  view, and **Exit MR** ends the immersive session. The menu closes after any
  selection. Choosing **Exit MR** shows a 3-second reminder on a panel facing
  you above the table center, 0.4 m above eye height so it clears the board. Look forward; the Quest resets its
  front direction to where you are looking when the immersive session ends.
  While the menu is open the thumbstick and trigger do not roll the cube or
  start a level.
  (On the Quest browser the left menu button is reported as button index 12
  and Y as 5; the debug readout's "Left buttons down" line shows the indices.)
- **Right B button**: opens/closes the appearance panel on the right controller. Point the left controller at
  it and hold the left trigger to drag. The `<` / `>` buttons, or the **right thumbstick left/right**, step
  through the items in order (Board, Cube faces, Grid lines, Cube edges, Shape borders, then each shape's
  Fill: Circle, Triangle, Square, Star, Diamond, Hexagon); the stick wraps around and also walks between an
  item's parts when it has more than one. "Shape borders" is a single colour and width shared by every
  shape. The colour picker (hue across, saturation down) and Brightness slider update live; Opacity
  appears for the board and cube faces; Shape borders gets a Border width slider (0-30 px on the icon
  texture). Grid lines stay 1 px (WebGL limit). Values are saved in `localStorage`.
  The stick and trigger are captured while it is open. The 2D HUD shows a selectable table of every current
  colour (hex) and the board/cube opacity, hidden with the debug readout, so you can copy values as defaults.

### Desktop (for testing logic without a headset)
- Arrow keys / WASD: roll.
- Ctrl+Arrow keys: move the world (one cell, 0.2 m, per press; hold to slide). Ctrl+Up moves the board away from you, Ctrl+Down toward you, Ctrl+Left/Right sideways.
- Q / E: rotate the world.
- + / - or mouse wheel: scale the world (scroll up / + enlarges ×1.1, scroll down / - shrinks ×0.9).
- 0: reset world position, rotation, and scale.
  Home poses for 2D and MR are listed together in the `HOMES` table near the top
  of `app/main.js`; the MR one is used by the Quest "Reset view" menu item and
  when a session starts.
- P: show/hide the debug readout (small grey text; see "Debug readout" below).
- K: cycle the sky: adjusted, raw, off (black).
- N: next level. R: restart the current level (same pattern, icons restored).
- The HTML buttons in the top-left do Next level / Restart level.

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
    Assets/
      starmap_2020_8k.jpg       served (adjusted sky, used when the GPU supports 8192 px textures)
      starmap_2020_4k.jpg       served (adjusted sky fallback for smaller GPUs)
      starmap_2020_8k_raw.jpg   served (unadjusted sky, 8k)
      starmap_2020_4k_raw.jpg   served (unadjusted sky fallback)
```

`app/index.html`, `app/main.js`, and the sky images in `app/Assets/` need
to be served. Icons are drawn on canvas in `main.js`, and
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

## Debug readout

Small grey text, shown in the HTML HUD (top-left, desktop) and in the world
just beyond the status text. Refreshed about 5 times a second. P toggles it.
The build timestamp is also shown in the HUD and debug readout, using
`yyyy-MM-dd@HH:mm:ss`. Since this project has no build step, update the
`BUILD_TIMESTAMP` constant in `app/main.js` whenever the app is changed.

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
- `app/main.js` — the whole game: board, cube orientation and rolling
  animation, flat icons, level generation, thumbstick/grip input, and
  the in-world status text (flat in the board plane, just past the near
  edge toward the player, no background or border), and the sky background.
- `app/Assets/starmap_2020_{8k,4k}[_raw].jpg` — the sky star maps (adjusted and raw; 8k preferred, 4k fallback).
- `StartCubeGameWebXR.ps1` / `StopCubeGameWebXR.ps1` — local server +
  Cloudflare tunnel for Quest testing (repo root, not served).

## Known limits

- Level patterns are random and are not checked for solvability. Blank
  squares give room to manoeuvre and reorient the cube, and R restarts
  the current level if a pattern feels stuck.
- World rotation is yaw only, to keep the board horizontal.
- Desktop world-drag by mouse is not implemented; use Q/E, +/-, and 0.
- No sound, no timer, no score, and no hand-tracking controls yet.
- Desktop behavior has been tested; Quest two-grip world dragging works,
  but thumbstick direction and the trigger have not been explicitly verified.
