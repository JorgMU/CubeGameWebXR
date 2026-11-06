// Session defaults for CubeGameWebXR (v30).
// This is the one source of truth for the settings the Copy settings
// button dumps: edit the values here, reload, and a fresh load starts
// from them. The shape matches what Copy settings produces, so a copied
// dump pastes straight in here.
// The saved appearance and records in the browser still override these
// at runtime until cleared — that is what the reset control is for, not
// this file.
export const SESSION_DEFAULTS = {
  // Board layout — geometry shared by 2D and MR.
  // v40: rectangular now — 17 squares across (east-west) by 11 deep
  // (north-south), about 3:2, so the board fits a wider-than-tall
  // view. Both are odd, so the start square stays dead centre.
  // boardSize is the width, sized so the 11-deep side stays the
  // 2.0 m it was when the board was square (2.0 x 17 / 11); the
  // depth follows from the cell size.
  boardLayout: {
    cols: 17, // squares across
    rows: 11, // squares deep
    boardSize: 2.0 * 17 / 11, // m, board width (east-west)
    coloredFraction: 0.5, // share of squares coloured each level
    rollSeconds: 0.1,
  },
  // Board home, 2D (desktop browser)
  boardHome_2D: {
    position: { x: 0, y: 0.5, z: -3.0 },
    tilt: 20, // degrees; 0 flat, 90 facing you
    scale: 3.22,
  },
  // Board home, MR (Quest passthrough)
  boardHome_MR: {
    position: { x: 0, y: -0.1, z: -1.75 },
    tilt: 30,
    scale: 0.75,
  },
  // Appearance — everything editable from the B-button panel.
  // Colours are hex; opacity 0–1. boardIcons / cubeIcons are
  // opacity-only: their shapes take their colour from the Fill items.
  appearance: {
    board: { color: '#000584', opacity: 0.34 },
    boardIcons: { opacity: 0.8 },
    // Cube faces: one background colour for ALL faces; the shape on
    // each face is drawn in that shape's own colour, as on the board.
    // The background must therefore not be any of the six shape
    // colours — the old green default (#036500) hid the green
    // triangle, and a per-face background put the colours on the
    // wrong layer. Dark neutral grey lets every shape colour read.
    cube: { color: '#222222', opacity: 0.4 },
    cubeIcons: { opacity: 0.9 },
    grid: { color: '#0c3700' },
    edges: { color: '#055200' },
    shapeBorder: { color: '#000000', width: 5 }, // width in px on the 256 px icon texture
    circle: { fill: '#c10303' },
    triangle: { fill: '#049f27' },
    square: { fill: '#354cff' },
    star: { fill: '#f1c40f' },
    diamond: { fill: '#9b59b6' },
    hexagon: { fill: '#e67e22' },
  },
  // Skybox — mode is one of Adjusted | Raw | Off | Passthrough.
  // Passthrough only exists inside an MR session; leaving a session
  // resets it to Adjusted.
  skybox: {
    mode: 'Adjusted',
  },
};
