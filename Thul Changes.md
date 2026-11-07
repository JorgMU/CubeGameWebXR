# Thul Changes — v40 (2026-11-06)

Based on v39. `app/main.js` and `README.md` change (plus this
note). `app/index.html`, `app/scene.js` and `sessionConfig.js` are
unchanged.

## Status panel: filled, with a divider — and the text stays put

Two changes to the north (status) panel, both about it reading as
part of the board instead of floating text:

- **Fill.** The panel is filled with the board face colour, at the
  board's opacity (board #000584 at 34% by default). drawStatusPanel
  paints the canvas with it before the text, so the fill follows a
  board colour or opacity change: Reset Colors redraws through
  updateHUD, and dragging the board colour or opacity in the
  appearance panel redraws live (applyAppearanceDrag calls updateHUD
  for the board key).
- **Divider.** A divider line splits the panel into a fixed top
  section — Level, Time, Face Down / Board — and a bottom section
  for the temporary message, as sketched. It is a 3D line sharing
  the border material, so it matches the border exactly and follows
  the grid colour. The three top lines sit at fixed baselines now
  (55/121/181), and the message is centred in the bottom section
  (baseline 258); when the message expires after 3 seconds the
  bottom section is just empty, and nothing jumps. The text stays
  horizontally centred throughout — the sketch's left-aligned lines
  were schematic only.

Verified with `node --check` on every file and a local serve
check (index.html, main.js, config.js, sessionConfig.js all 200).
Not tested in a headset by Muse.

## Panel button matches the other toggles, and the panel starts hidden

- "Hide/Show Panel" is now "Show Panel" / "Hide Panel", flipping
  with the state like Show Help and Show Debug do (label span plus
  updatePanelLabel, shared by the button and the TAB key). The toggle
  itself is now a setHudVisible(visible) helper, so the show and hide
  paths cannot drift apart.
- The main panel starts hidden on page load — the same state as after
  pressing Hide — so only the Show Panel button and the MR button
  show until TAB or the button brings the panel and the other buttons
  back. The panel still updates while hidden, so the first TAB shows
  the live status, not a stale one.

## Board is 17 wide by 11 deep now (about 3:2)

- The board was 11×11 square; it is now 17 columns across by 11
  rows deep (17:11, about 3:2), so it fits a wider-than-tall view.
  Both counts are odd, so the start square stays dead centre (8, 5).
  The width stays 2.0 m; the depth follows from the cell size, about
  1.29 m. Cells — and the cube, which is one cell wide — are smaller
  now, about 11.8 cm instead of 18.2 cm.
- `boardLayout.grid` is gone; sessionConfig.js has `cols` and `rows`
  instead, and Copy settings dumps them. config.js derives CELL from
  the width over the columns, BOARD_DEPTH from CELL times the rows,
  and START_COL / START_ROW from the two counts separately.
- GridHelper only makes square grids, so the grid lines are built by
  hand now as line segments (one per cell boundary) with a colour
  attribute like GridHelper's, so applyLineColors() rewrites them
  the same way. utils.js cellToLocal() also got separate column and
  row centres — one centre for both axes would have put every icon
  half a cell off in the short direction. The status panel, scores
  panel and Exit MR button all sit off the board depth now instead
  of the width; the side panels still sit off the width. The scores
  panel's height (1.3 m) is almost the new depth (1.29 m), so its
  old north-aligned position lands essentially centred.

## Board width grows so the 11 side stays 2.0 m

- The 17×11 board keeps its cells the size they were on the square
  board: boardSize is now 2.0 x 17 / 11 (about 3.09 m wide), so the
  11-deep side stays 2.0 m and the board grows to fit the 17. Cells
  — and the cube — are back to about 18.2 cm. Nothing else changes:
  the panel positions, confetti spread and side panels all follow
  boardSize and BOARD_DEPTH, so they move with the wider board.

## Thumbstick rolls like a D-pad now

- The stick used to roll by whichever axis was bigger, so the
  boundary between directions sat exactly on the 45° diagonals and
  a push near a diagonal flipped direction with the slightest
  wobble. It now measures the stick angle instead: each cardinal
  direction owns a 60° wedge (±30°), and the 30° gaps centred on
  the diagonals roll nothing. While the stick sits in a gap the
  repeat timer resets, so sliding into a wedge acts like a fresh
  press. The wedge width is one constant (STICK_WEDGE_HALF_DEGREES
  in main.js). The centre dead zone, the 0.6 engage threshold, the
  repeat rate and the keyboard arrows are all unchanged.

## Status line shows shapes now, not colours

- The third status line was "Face Down: <colour>, Board: <colour>".
  It now reads "<down shape> : Cube | Board: <board shape>" — for
  example "Hexagon : Cube | Board: Star". The shape words and the
  Cube / Board words are drawn in the colour of the face or square
  they belong to; the " : ", " | " and ": " separators stay white.
  A blank square reads "Board: Blank", both in white. Same line in
  the 2D HUD (coloured spans) and on the in-world status panel
  (centred multi-colour run), so the two always agree.

## Cube edges drawn once now, not twice

- The cube's outline was two identical LineSegments sets on top of
  each other: one inside cube.js initCube, one in main.js right
  after initCube — a leftover from the fixed10 rebuild, when the
  cube became six separate planes and initCube gained its own
  outline while main.js kept the one from the single-box days.
  Only main.js's set was ever updated (B-panel edge colour, Reset
  Colors); the cube.js set was frozen at the startup default and
  hidden underneath it. The cube.js set is gone, along with the
  now-unused createCubeEdgeMaterial in materials.js. At full
  opacity nothing visible changes; it matters once the edges go
  transparent, where a double-drawn line would blend twice and
  read darker than the slider says.

## Grid lines and cube edges get their own opacity

- Grid lines and cube edges each have an opacity slider in the
  appearance panel now (two separate values), alongside the four
  that were already there. The status border and divider follow
  the grid opacity, since they are grid-colour lines. Copy
  settings dumps both opacities, and the colour table shows them.
- The grid default is black at 25% opacity now (was dark green
  #0c3700 at full opacity): bright line colours flicker with
  aliasing and foveated rendering. Cube edges stay dark green
  #055200 at full opacity. A saved appearance that still holds
  the old grid default moves to the new one on load; a grid
  colour you customised is left alone.

## Status panel is as wide as the board now

- The north panel was 2.0 m wide on a 3.09 m board, so it sat
  centred over the middle of it. It is 3.09 m wide now, matching
  the board: the canvas is 1780 px (576 px per metre, the same
  density as before), the border and divider span the full width,
  and the text stays centred. The temporary-message cap rises
  from 58 to 89 characters to match the wider panel.

## Buzz-buzz when you try to roll off the edge

- Rolling off the edge used to fail silently apart from the status
  message. It now plays a buzz-buzz error sound (two short 140 Hz
  square-wave buzzes, synthesized like the existing click and
  swoop) and a matching double haptic pulse on both controllers.
  The sound also plays on the 2D keyboard path; the haptic is a
  silent no-op with no gamepad connected. Throttled to one buzz
  per half second — a held stick retries every 0.125 s, and
  buzzing on every retry would machine-gun.

## Board icons and Cube icons are one page now

- The appearance panel had a page each for Board icons and Cube
  icons. Neither has a colour, so they are one "Icons" page now,
  with two opacity sliders on it: board icons at the brightness
  position, cube icons at the opacity position. Dragging either
  slider edits its own value (the drag carries the key, so the
  two cannot be mixed up), and the panel steps through one fewer
  item. The saved values, the colour table and Copy settings are
  unchanged — boardIcons and cubeIcons are still separate values
  under the hood, they just share a page.

## Credit line, bottom right

- "2026 JorgTheElder@outlook.com" sits at the bottom right of the
  screen, in the MR button's rest text colour and size (#007a33,
  13px) but as plain text — no border, no background. It is a page
  element, so it shows on desktop only, and it stays put when the
  HUD panel hides.

## v41: app/ is docs/ now, for GitHub Pages

- The served folder is renamed `app/` -> `docs/`, so the repo can
  be published with GitHub Pages straight from the branch's /docs
  folder. No game code changed — every import inside the folder is
  relative, so the move is mechanical.
- `StartCubeGameWebXR.ps1` serves `docs/` now (`$docsDir`, and the
  state file records `DocsDir`); `CubeGameWebXRServer.py` defaults
  to `./docs`. Local dev works exactly as before, on port 8001.
- `README.md` paths, the in-game help text ("paste into
  docs/sessionConfig.js") and the v30 move comments in config.js /
  main.js all say `docs/` now.
- Empty `docs/.nojekyll` added, so GitHub's default Jekyll
  processing stays out of the way.
- Still to do on the GitHub side: Settings -> Pages -> "Deploy
  from a branch", branch main, folder /docs. The site will then be
  https://jorgmu.github.io/CubeGameWebXR/ — and
  .github/copilot-instructions.md needs its "Keep browser-served
  assets under `app/`" line changed to `docs/`.

## Grid default is black at full opacity now

- The grid default moved from black at 25% (v40) to black at full
  opacity, matching the repo change Jorg checked in Nov 6, 2026.
  sessionConfig.js and the README say so; the old-grid migration
  already reads the default, so nothing else needed changing.

## v42: no more Range requests — GitHub Pages cached 1-byte files

- The loader (index.html) and buildTime.js read Last-Modified by
  fetching each file with `Range: bytes=0-0` + `cache: 'reload'`.
  That worked locally only because the dev server sends
  `Cache-Control: no-store`, so nothing is ever cached. On GitHub
  Pages the responses are cacheable, and the browser cached the
  1-byte partial response AS the whole file: config.js came back
  as "/" in Edge DevTools (it starts with `//`), the module graph
  died on a syntax error, and only the HUD panel and buttons
  showed — no board, no cube.
- Fix: plain GET with `cache: 'reload'`, no Range header, in both
  places. It downloads the ten small files in full, which is also
  what primes the cache with the real files — the thing the check
  was for in the first place.
- After pushing, do one hard refresh (Ctrl+F5) so the fixed
  index.html loads; after that the page heals its own cache. The
  poisoned entries would also expire on their own within about
  10 minutes (Pages' max-age=600).

## v43: the | stays put, and a match gets its own mini burst

- The Face Down / Board line no longer jumps: the `|` separator is
  pinned to the centre, with "<shape> : Cube" right-justified against
  its left side and "Board: <shape>" left-justified on its right.
  Before, the whole line was centred as one run, so the `|` drifted
  whenever a shape name changed length. Same fix in both places that
  show the line: the in-world status panel (measured canvas runs)
  and the 2D HUD (flexbox halves). Colours and wording unchanged.
- A match now fires a mini version of the level-win celebration: a
  single burst of 40 confetti pieces in the six shape colours, out
  of the top of the cube, fading over 1.2 seconds. No panel bounce
  — that stays with the win. A fast re-match just re-seeds the
  burst; the win celebration takes over on the final match. This
  was queued Nov 6 (end of night) as "a single-burst animation like
  the clear-board animation out of the top of the cube".
