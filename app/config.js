// Configuration constants for Cube Game WebXR
// Fixed build: 2026-11-04 refactor01-fixed (see ../FIXES.md)
// v30: the session defaults (board layout, homes, appearance, skybox)
// moved to app/sessionConfig.js; this file keeps the code constants
// and derives the values that depend on the session defaults.
import { SESSION_DEFAULTS } from './sessionConfig.js';
export const BUILD_LABEL = '2026-11-04 refactor01-fixed2'; // fallback only: the HUD date comes from Last-Modified headers (see buildTime.js)
// Updated Nov 5, 2026 (v17): desktop home is further away, tilted and larger

// Board and grid — v30: GRID, BOARD_SIZE and COLORED_FRACTION moved
// to app/sessionConfig.js (SESSION_DEFAULTS.boardLayout). CELL and CUBE
// are still derived here from them.
export const CELL = SESSION_DEFAULTS.boardLayout.boardSize / SESSION_DEFAULTS.boardLayout.grid;
export const CUBE = CELL;

// Cube rolling — v30: moved to app/sessionConfig.js
// (SESSION_DEFAULTS.boardLayout.rollSeconds).

// Starting position — derived from the session board layout
// (SESSION_DEFAULTS.boardLayout.grid).
export const START_COL = Math.floor(SESSION_DEFAULTS.boardLayout.grid / 2);
export const START_ROW = Math.floor(SESSION_DEFAULTS.boardLayout.grid / 2);

// Colors and shapes — the six tile identities (name and shape stay
// fixed here). The fill colours are the session defaults
// (SESSION_DEFAULTS.appearance), so editing a fill in
// sessionConfig.js changes the colour everywhere, including the HUD's
// "face down" chip. v30: the hex/css literals moved there.
const _ap = SESSION_DEFAULTS.appearance;
export const COLORS = [
  { name: 'Red', hex: parseInt(_ap.circle.fill.slice(1), 16), css: _ap.circle.fill, shape: 'circle' },
  { name: 'Green', hex: parseInt(_ap.triangle.fill.slice(1), 16), css: _ap.triangle.fill, shape: 'triangle' },
  { name: 'Blue', hex: parseInt(_ap.square.fill.slice(1), 16), css: _ap.square.fill, shape: 'square' },
  { name: 'Yellow', hex: parseInt(_ap.star.fill.slice(1), 16), css: _ap.star.fill, shape: 'star' },
  { name: 'Purple', hex: parseInt(_ap.diamond.fill.slice(1), 16), css: _ap.diamond.fill, shape: 'diamond' },
  { name: 'Orange', hex: parseInt(_ap.hexagon.fill.slice(1), 16), css: _ap.hexagon.fill, shape: 'hexagon' },
];

export const INITIAL_ORIENTATION = { up: 2, down: 5, north: 1, south: 3, east: 0, west: 4 };

// Board appearance — v30: moved to app/sessionConfig.js
// (SESSION_DEFAULTS.appearance: board, boardIcons, cube, cubeIcons,
// grid, edges, shapeBorder).

// World positioning — v30: moved to app/sessionConfig.js
// (SESSION_DEFAULTS.boardHome_2D / .boardHome_MR). scene.js and
// main.js read them from there now.

export const EXIT_MESSAGE_RISE = 0.4; // metres above eye height
export const ROTATE_GAIN = 0.4;
export const SCALE_GAIN = 0.4;

// Board tilt
export const TILT_STEP = 5;
export const TILT_MAX = 180;
export const TILT_REPEAT_SECONDS = 0.2;

// Sky
export const SKY_RADIUS = 30;
export const SKY_MODES = ['Adjusted', 'Raw', 'Off', 'Passthrough'];
export const SKY_MESSAGES = ['adjusted', 'raw (unadjusted NASA data)', 'off (black)', 'passthrough'];

// Messages
export const MESSAGE_SECONDS = 3;

// Debug
export const DEBUG_SECONDS = 0.2;

// Appearance panel dimensions
export const AP_W = 512;
export const AP_H = 610;
export const AP_SELECT = { y: 10, h: 80 };
export const AP_PARTS = { y: 100, h: 70 };
export const AP_PICKER = { x: 10, y: 190, w: 492, h: 200 };
export const AP_BRIGHT = { x: 20, y: 440, w: 472, h: 44 };
export const AP_OPACITY = { x: 20, y: 540, w: 472, h: 44 };
export const AP_STORAGE_KEY = 'cubeGameAppearance';
export const AP_PANEL_WIDTH = 0.225;
export const BORDER_WIDTH_MAX = 30; // px on the 256 px icon texture

// Session storage
export const SESSION_RECORDS_MAX = 10;
export const RECORDS_STORAGE_KEY = 'cubeGameRecords'; // top-10 scores, persisted like the appearance colours
export const APPEARANCE_REBUILD_MS = 250;
