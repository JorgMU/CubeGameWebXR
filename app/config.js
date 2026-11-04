// Configuration constants for Cube Game WebXR

// Board and grid
export const GRID = 11;
export const BOARD_SIZE = 2.0; // m, board footprint
export const CELL = BOARD_SIZE / GRID;
export const CUBE = CELL;
export const COLORED_FRACTION = 0.5;

// Cube rolling
export const ROLL_SECONDS = 0.1;

// Starting position
export const START_COL = Math.floor(GRID / 2);
export const START_ROW = Math.floor(GRID / 2);

// Colors and shapes
export const COLORS = [
  { name: 'Red', hex: 0xc10303, css: '#c10303', shape: 'circle' },
  { name: 'Green', hex: 0x049f27, css: '#049f27', shape: 'triangle' },
  { name: 'Blue', hex: 0x354cff, css: '#354cff', shape: 'square' },
  { name: 'Yellow', hex: 0xf1c40f, css: '#f1c40f', shape: 'star' },
  { name: 'Purple', hex: 0x9b59b6, css: '#9b59b6', shape: 'diamond' },
  { name: 'Orange', hex: 0xe67e22, css: '#e67e22', shape: 'hexagon' },
];

export const INITIAL_ORIENTATION = { up: 2, down: 5, north: 1, south: 3, east: 0, west: 4 };

// Board appearance
export const BOARD_COLOR = '#0d8407';
export const BOARD_OPACITY = 0.34;
export const GRID_COLOR = 0xfff005;
export const CUBE_FACE_BLUE = '#0b1d65';
export const CUBE_OPACITY = 0.6;
export const CUBE_EDGE_COLOR = '#767f0f';
export const SHAPE_BORDER_COLOR = '#f9ff2c';
export const SHAPE_BORDER_WIDTH = 4; // px on the 256 px icon texture

// World positioning
export const HOMES = {
  desktop: { position: { x: 0, y: 0.5, z: -2.0 }, tilt: 0, scale: 1 },
  mr: { position: { x: 0, y: -0.1, z: -1.75 }, tilt: 30, scale: 0.75 },
};

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
export const APPEARANCE_REBUILD_MS = 250;
