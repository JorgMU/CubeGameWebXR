# Cube Game WebXR — v1

A 90s-inspired cube-rolling puzzle for Meta Quest, in the browser.

## The game

- A horizontal 10×10 board floats in front of you. It is transparent except
  for its grid lines. The board footprint is still 2 m, so each cell is
  0.2 m — to change the board size, change `BOARD_SIZE` in `main.js`,
  not `CELL`, and the cells, cube, and icons will scale with it.
- A cube has a different colour on each of its 6 faces:
  Red, Green, Blue, Yellow, Purple, Orange.
- Each coloured square shows a **flat icon lying in the plane of the board**
  (not floating above it). The icon's shape is also distinct per colour,
  so a square is not identified by colour alone.
- Roll the cube one square at a time. A square clears **only when the
  cube's face-down face matches that square's icon colour**.
- The level ends when every coloured square is cleared.
- A new level is a new random pattern: about 50% of squares coloured,
  the rest blank (the start square is always blank). There is no
  timer and no lose condition in v1. Rolling off the edge is blocked.

## Controls

### Meta Quest (Quest Browser, WebXR)
- **Thumbstick** (either controller): push to roll one square that way.
  Push forward = north (away from you), back = south, left/right as shown.
- **Both grips together**: world drag. While both grips are held:
  - move your hands to translate the world,
  - twist your hands to rotate the world (yaw only, so the board stays horizontal),
  - move your hands apart to enlarge the world, together to shrink it.
  - Release either grip to end the drag.
  - To the player this feels like the world moving around them; it is
    implemented as moving the board/cube/icon group, which is the same
    relative motion as moving the player the opposite way.
- **Trigger** after a win: starts the next level.

### Desktop (for testing logic without a headset)
- Arrow keys / WASD: roll.
- N: next level. R: restart the current level (same pattern, icons restored).
- Q / E: rotate the world. + / -: scale the world. 0: reset world position,
  rotation, and scale.
- The HTML buttons in the top-left do Next level / Restart level.

## Repo layout — what is served, and what is not

```
CubeGameWebXR/                  repo root — init git here
  README.md                     not served (repo docs)
  .gitignore                    not served
  StartCubeGameWebXR.ps1        not served (run from repo root)
  StopCubeGameWebXR.ps1         not served
  app/                          <-- web root: only this is served
    index.html                  served
    main.js                     served (loaded by index.html as ./main.js)
```

Only `app/index.html` and `app/main.js` need to be served. Nothing else
in v1 is a web asset: icons are drawn on canvas in `main.js`, and
Three.js r160 is loaded from a CDN via an import map in `index.html`.
If you add assets later (textures, sounds, models), put them under
`app/` — for example `app/Assets/` — so their relative URLs keep working
from `index.html`.

`index.html` and `main.js` needed no code change for this move, because
`index.html` already loads `./main.js` relatively, and both files moved
together into `app/`.

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
- Serves only `app/` with `py -m http.server` on port **8001**
  (8001, not 8000, so it can run alongside EarthAndMoon on 8000).
- Starts `cloudflared tunnel --url http://localhost:8001` and prints the
  `https://*.trycloudflare.com` URL, which it also copies to the clipboard.
  Open that URL in the Quest Browser — WebXR needs a secure (HTTPS)
  context, and a plain `http://` address to your PC over LAN will not qualify.
- Saves the server and tunnel PIDs to
  `%LOCALAPPDATA%\cube-game-webxr\processes.json`.
- If services are already running, it calls the Stop script first.

Stop kills both PIDs from that state file and removes the state file.

To init the repo with this version:

```powershell
cd CubeGameWebXR
git init
git add .
git commit -m "Initial v1"
```

### Option B — any static server

From the repo root:

```powershell
py -m http.server 8001 --directory app
```

Then open `http://localhost:8001` on desktop for logic testing. For the
Quest, you still need an HTTPS URL (see Option A).

## Files

- `app/index.html` — page, HUD, import map for Three.js, loads `main.js`.
- `app/main.js` — the whole game: board, cube orientation and rolling
  animation, flat icons, level generation, thumbstick/grip input, and
  the in-world status panel.
- `StartCubeGameWebXR.ps1` / `StopCubeGameWebXR.ps1` — local server +
  Cloudflare tunnel for Quest testing (repo root, not served).

## Known v1 limits

- Level patterns are random and are not checked for solvability. Blank
  squares give room to manoeuvre and reorient the cube, and R restarts
  the current level if a pattern feels stuck.
- World rotation is yaw only, to keep the board horizontal.
- Desktop world-drag by mouse is not implemented; use Q/E, +/-, and 0.
- No sound, no timer, no score, and no hand-tracking controls yet.
