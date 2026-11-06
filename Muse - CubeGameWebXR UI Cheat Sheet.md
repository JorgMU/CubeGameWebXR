# CubeGameWebXR — UI Cheat Sheet

Major UI elements and their proper names. Current build: v39.

## 2D screen

### Main panel (HUD, top-left)

- Status lines: Level, Remaining, Time, Score, Face Down, Board, Message
- Build timestamp
- Top 10 Scores — collapsible table
- Debug readout — shown when Show Debug is on
- Colour table

### Top-right button column (top to bottom)

1. Hide/Show Panel — TAB
2. Show Help — ? (reads Hide Help while the help panel is open)
3. Show Debug — * (reads Hide Debug while the debug readout is on)
4. Next Level — N
5. Restart Level — R
6. Clear Scores — X
7. Copy Settings — C
8. Reset Colors — O
9. Reset Home — H
10. Tilt Up — [
11. Tilt Down — ]
12. Zoom In — +
13. Zoom Out — −
14. Rotate Left — < (also Q)
15. Rotate Right — > (also E)
16. Force Refresh — F

### MR button

- START MR — starts a session (reads MR NOT SUPPORTED when WebXR is unavailable)

### Help panel (bottom-left, off by default)

- Help text

### Confirm dialog (overlay)

- Asks before Clear Scores and Reset Colors

### Copy overlay (overlay)

- Shows the settings text when clipboard copy fails

## In the world (3D)

- Board — 11×11 grid, 2.0 m square, transparent with grid lines
- Cube — six faces, one colour and shape per face
- Status panel (north panel) — past the north edge, tilted up; Level / Remaining, Time / Score, Face Down / Board, message; 2.0 m wide with a grid-line border
- Scores panel — west of the board, MR only; Top 10 Scores
- Debug panel — east of the board, MR only; debug readout
- Exit MR button — south edge, centred, MR only; flat button on the board
- Exit laser — MR only; green line from the right controller to the Exit MR button
- Exit message — MR only; "Exiting MR in 3 seconds…" floating text
- Y menu — left controller, MR only; Debug, Sky, Reset Home, Next Level, Restart Level, Clear Scores, Reset Colors, Exit MR; plus the hint row "Exit MR for Other Options"
- Appearance panel (colour picker) — B button, right controller, MR only; colours and opacities for board, cube, grid lines, edges and shapes
- Sky — starfield (Adjusted / Raw / Off) or passthrough in MR

## Debug readout lines

- Build — build timestamp
- Sky — sky mode
- Player — camera position and facing
- Board — board position and scale
- Board yaw / tilt — board rotation
- Left buttons down — pressed buttons, left controller
- Right buttons down — pressed buttons, right controller
