import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// ---------------------------------------------------------------------------
// Cube Game WebXR — v5, 10x10 board
// A horizontal 10x10 board floating in front of the player. Roll a cube with a
// different colour on each face. A square clears only when the cube's
// FACE-DOWN face matches that square's flat icon. Clear all coloured
// squares to finish the level. No timer or lose condition.
// Controls: Quest thumbstick rolls; hold BOTH grips to drag the world
// (translate / yaw-rotate / scale). Desktop: arrows/WASD roll, Q/E rotate,
// +/- scale, N next level, R restart level, 0 reset world transform,
// Ctrl+Arrow moves the world (one cell step, hold to repeat),
// mouse wheel scales the world like +/-.
// ---------------------------------------------------------------------------

const GRID = 10;
// Board size is the anchor: CELL is derived from it, so increasing GRID
// shrinks the cells (and the cube and icons, which are sized from CELL)
// instead of growing the board. Change BOARD_SIZE, not CELL, if you want
// a physically larger or smaller board.
const BOARD_SIZE = 2.0; // m, board footprint — unchanged from the 5x5 version
const CELL = BOARD_SIZE / GRID; // 0.2 m for a 10x10 board
const CUBE = CELL; // cube fills a cell, so rolling over its edge lands centred
const COLORED_FRACTION = 0.5;
const ROLL_SECONDS = 0.28;
// For an even grid there is no single centre cell, so start on the
// south-east of the central four (col/row 5, one half-cell off true centre).
const START_COL = Math.floor(GRID / 2);
const START_ROW = Math.floor(GRID / 2);

// Colour order is also the cube-face index order.
const COLORS = [
  { name: 'Red',    hex: 0xe74c3c, css: '#e74c3c', shape: 'circle' },
  { name: 'Green',  hex: 0x2ecc71, css: '#2ecc71', shape: 'triangle' },
  { name: 'Blue',   hex: 0x3498db, css: '#3498db', shape: 'square' },
  { name: 'Yellow', hex: 0xf1c40f, css: '#f1c40f', shape: 'star' },
  { name: 'Purple', hex: 0x9b59b6, css: '#9b59b6', shape: 'diamond' },
  { name: 'Orange', hex: 0xe67e22, css: '#e67e22', shape: 'hexagon' },
];

const INITIAL_ORIENTATION = { up: 2, down: 5, north: 1, south: 3, east: 0, west: 4 };
// Orientation fields: up/down/north/south/east/west, each a COLORS index.
// North = -z (away from player), south = +z (toward player).

function cellToLocal(col, row) {
  // Centre the logical grid on the board centre for ANY grid size.
  // The old code hard-coded (col - 2), which was only correct for 5x5:
  // with GRID = 10 it shifted every icon and the cube +1.0 m east/south
  // and let col/row 9 spill past the board edge.
  const centre = (GRID - 1) / 2; // 4.5 for a 10x10 board
  return new THREE.Vector3((col - centre) * CELL, 0, (row - centre) * CELL);
}

// --- Renderer / scene / camera (desktop fallback view) ---------------------
const canvas = document.getElementById('renderCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 4.2, 1.8);
camera.lookAt(0, 1.0, -2.0);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(3, 6, 2);
scene.add(sun);

// --- World group ------------------------------------------------------------
// Everything the player drags lives in here: board, icons, cube, panel.
// Its origin is the board centre, so yaw rotation turns the board in place
// instead of orbiting it around the player. Dragging this group is, to the
// player, the same as moving the player the opposite way.
const worldGroup = new THREE.Group();
const WORLD_HOME = new THREE.Vector3(0, 0.5, -2.0);
const VR_HOME_SCALE = 0.75; // board scale when an immersive session starts
// Rotation/scale gain for the two-grip drag (1 = hands map 1:1).
const ROTATE_GAIN = 0.4, SCALE_GAIN = 0.4;
// Board tilt about its own left-right axis: 0 = flat face up, 90 = facing the
// player, 180 = upside down. Changed in steps while a grip is held.
const TILT_STEP = 5, TILT_MAX = 180, TILT_REPEAT_SECONDS = 0.2;
let tiltDeg = 0;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TILT_AXIS = new THREE.Vector3(1, 0, 0);
let tiltReady = true, tiltTimer = 0;

// Tilt about the board's own left-right axis; positive raises the far edge.
function stepTilt(dir) {
  const next = THREE.MathUtils.clamp(tiltDeg + dir * TILT_STEP, 0, TILT_MAX);
  if (next === tiltDeg) return;
  const q = new THREE.Quaternion().setFromAxisAngle(TILT_AXIS, (next - tiltDeg) * Math.PI / 180);
  worldGroup.quaternion.multiply(q);
  if (drag) drag.worldQuat.multiply(q);
  tiltDeg = next;
  updateDebug();
}
worldGroup.position.copy(WORLD_HOME);
scene.add(worldGroup);

// Transparent board: faint plane + grid lines.
const boardPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(BOARD_SIZE, BOARD_SIZE),
  new THREE.MeshBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.06, side: THREE.DoubleSide })
);
boardPlane.rotation.x = -Math.PI / 2;
boardPlane.position.y = 0.001;
worldGroup.add(boardPlane);

const grid = new THREE.GridHelper(BOARD_SIZE, GRID, 0x88aaff, 0x445577);
grid.position.y = 0.005;
worldGroup.add(grid);

// --- Flat icons (lie flat in the plane of the board) ------------------------
function makeIconTexture(color, shape) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = color.css;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.beginPath();
  const cx = 128, cy = 128, r = 84;
  if (shape === 'circle') {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else if (shape === 'triangle') {
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r * 0.8); ctx.lineTo(cx - r, cy + r * 0.8); ctx.closePath();
  } else if (shape === 'square') {
    ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
  } else if (shape === 'diamond') {
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.PI / 5) * i;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fill(); ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const iconTextures = COLORS.map((col) => makeIconTexture(col, col.shape));

// --- Cube -------------------------------------------------------------------
const cubeMaterials = [
  new THREE.MeshStandardMaterial({ color: COLORS[INITIAL_ORIENTATION.east].hex }),  // +x east
  new THREE.MeshStandardMaterial({ color: COLORS[INITIAL_ORIENTATION.west].hex }),  // -x west
  new THREE.MeshStandardMaterial({ color: COLORS[INITIAL_ORIENTATION.up].hex }),    // +y up
  new THREE.MeshStandardMaterial({ color: COLORS[INITIAL_ORIENTATION.down].hex }),  // -y down
  new THREE.MeshStandardMaterial({ color: COLORS[INITIAL_ORIENTATION.south].hex }), // +z south
  new THREE.MeshStandardMaterial({ color: COLORS[INITIAL_ORIENTATION.north].hex }), // -z north
];
const cube = new THREE.Mesh(new THREE.BoxGeometry(CUBE, CUBE, CUBE), cubeMaterials);
cube.add(new THREE.LineSegments(
  new THREE.EdgesGeometry(cube.geometry),
  new THREE.LineBasicMaterial({ color: 0x000000 })
));
worldGroup.add(cube);

// --- In-world status text (flat in the board plane, off the near edge) ---
// Same plane as the board and icons (rotation.x = -PI/2), sitting just
// past the south edge, toward the player. No background, no border —
// just text, so it reads as text on the board plane rather than a sign.
// With rotation.x = -PI/2 the top of the canvas points north (-z), so the
// text reads upright when viewed from the player (south) side.
const panelCanvas = document.createElement('canvas');
panelCanvas.width = 1024; panelCanvas.height = 288;
const panelCtx = panelCanvas.getContext('2d');
const panelTexture = new THREE.CanvasTexture(panelCanvas);
panelTexture.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(
  new THREE.PlaneGeometry(1.8, 0.5),
  new THREE.MeshBasicMaterial({ map: panelTexture, transparent: true, side: THREE.DoubleSide })
);
panel.rotation.x = -Math.PI / 2;
panel.position.set(0, 0.012, BOARD_SIZE / 2 + 0.35);
worldGroup.add(panel);

// --- Debug readout (small grey text) -------------------------------------------
// Shows where the viewer is and how the board is posed. Both are in the same
// scene (tracking-space) coordinates, so the numbers can be compared directly.
// Toggle with the P key; refreshed a few times a second, not every frame.
const DEBUG_SECONDS = 0.2;
let debugVisible = true;
let debugTimer = 0;
const debugCanvas = document.createElement('canvas');
debugCanvas.width = 1024; debugCanvas.height = 240;
const debugCtx = debugCanvas.getContext('2d');
const debugTexture = new THREE.CanvasTexture(debugCanvas);
debugTexture.colorSpace = THREE.SRGBColorSpace;
const debugPanelHeight = 1.8 * debugCanvas.height / debugCanvas.width;
const debugPanel = new THREE.Mesh(
  new THREE.PlaneGeometry(1.8, debugPanelHeight),
  new THREE.MeshBasicMaterial({ map: debugTexture, transparent: true, side: THREE.DoubleSide })
);
debugPanel.rotation.x = -Math.PI / 2;
// Directly beyond the status panel, which spans z = BOARD_SIZE/2 + 0.10 .. + 0.60.
debugPanel.position.set(0, 0.012, BOARD_SIZE / 2 + 0.6 + debugPanelHeight / 2);
worldGroup.add(debugPanel);
const hudDebug = document.getElementById('hudDebug');

const dbgPos = new THREE.Vector3();
const dbgQuat = new THREE.Quaternion();
const dbgEuler = new THREE.Euler();
const dbgAxis = new THREE.Vector3();
const RAD2DEG = 180 / Math.PI;

// Euler order YXZ reads as yaw (turn about the vertical axis), then tilt
// forward/back (pitch, about x), then tilt side to side (roll, about z).
// Positive yaw turns counterclockwise when seen from above.
function debugLines() {
  const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  viewer.getWorldPosition(dbgPos);
  viewer.getWorldQuaternion(dbgQuat);
  dbgEuler.setFromQuaternion(dbgQuat, 'YXZ');
  const player = `Player  x ${dbgPos.x.toFixed(2)}  y ${dbgPos.y.toFixed(2)}  z ${dbgPos.z.toFixed(2)}  facing ${(dbgEuler.y * RAD2DEG).toFixed(0)}°`;

  const wp = worldGroup.position;
  dbgEuler.setFromQuaternion(worldGroup.quaternion, 'YXZ');
  const board = `Board   x ${wp.x.toFixed(2)}  y ${wp.y.toFixed(2)}  z ${wp.z.toFixed(2)}  scale ${worldGroup.scale.x.toFixed(2)}`;
  const boardX = dbgAxis.set(1, 0, 0).applyQuaternion(worldGroup.quaternion);
  const yawDeg = Math.atan2(-boardX.z, boardX.x) * RAD2DEG;
  const pose = `Board   yaw ${yawDeg.toFixed(0)}°  tilt ${tiltDeg}° (0 flat, 90 facing you)`;
  const buttons = `Left buttons down: ${leftButtonsDown || '-'}`;
  return [player, board, pose, buttons];
}

function updateDebug() {
  const lines = debugLines();
  hudDebug.style.display = debugVisible ? 'block' : 'none';
  debugPanel.visible = debugVisible;
  if (!debugVisible) return;
  hudDebug.textContent = lines.join('\n');
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  debugCtx.fillStyle = '#9a9a9a';
  debugCtx.font = '34px Consolas, monospace';
  debugCtx.textAlign = 'left';
  lines.forEach((line, i) => debugCtx.fillText(line, 20, 52 + i * 50));
  debugTexture.needsUpdate = true;
}

// --- Game state ---------------------------------------------------------------
let level = 1;
let cubeCol = START_COL;
let cubeRow = START_ROW;
let orientation = { ...INITIAL_ORIENTATION };
let currentPattern = []; // [{col,row,colorIndex}]
let icons = new Map();   // "col,row" -> {colorIndex, mesh}
let remaining = 0;
let win = false;
let message = 'Roll the cube onto a matching flat icon.';

function keyOf(col, row) { return `${col},${row}`; }

function clearIcons() {
  for (const entry of icons.values()) worldGroup.remove(entry.mesh);
  icons.clear();
}

function buildIconsFromPattern() {
  clearIcons();
  for (const cell of currentPattern) {
    const geo = new THREE.PlaneGeometry(CELL * 0.85, CELL * 0.85);
    const mat = new THREE.MeshBasicMaterial({ map: iconTextures[cell.colorIndex], transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    const p = cellToLocal(cell.col, cell.row);
    mesh.position.set(p.x, 0.012, p.z);
    worldGroup.add(mesh);
    icons.set(keyOf(cell.col, cell.row), { colorIndex: cell.colorIndex, mesh });
  }
  remaining = currentPattern.length;
}

function generateLevel() {
  currentPattern = [];
  for (let col = 0; col < GRID; col++) {
    for (let row = 0; row < GRID; row++) {
      if (col === START_COL && row === START_ROW) continue; // start square stays blank
      if (Math.random() < COLORED_FRACTION) {
        currentPattern.push({ col, row, colorIndex: Math.floor(Math.random() * COLORS.length) });
      }
    }
  }
  // Guarantee a meaningful level even on an unlucky roll.
  while (currentPattern.length < 6) {
    const col = Math.floor(Math.random() * GRID);
    const row = Math.floor(Math.random() * GRID);
    if (col === START_COL && row === START_ROW) continue;
    if (currentPattern.some((c) => c.col === col && c.row === row)) continue;
    currentPattern.push({ col, row, colorIndex: Math.floor(Math.random() * COLORS.length) });
  }
  resetCubeAndWin(false);
  buildIconsFromPattern();
  message = `Level ${level}: clear ${remaining} coloured squares.`;
  updateHUD();
}

function resetCubeAndWin(isRestart) {
  cubeCol = START_COL; cubeRow = START_ROW;
  orientation = { ...INITIAL_ORIENTATION };
  const p = cellToLocal(cubeCol, cubeRow);
  cube.position.set(p.x, CUBE / 2, p.z);
  cube.quaternion.identity();
  win = false;
  if (isRestart) message = `Level ${level} restarted.`;
}

function restartLevel() {
  resetCubeAndWin(true);
  buildIconsFromPattern();
  updateHUD();
}

function nextLevel() {
  level += 1;
  generateLevel();
}

// --- HUD ----------------------------------------------------------------------
const hudLevel = document.getElementById('hudLevel');
const hudRemaining = document.getElementById('hudRemaining');
const hudDown = document.getElementById('hudDown');
const hudMessage = document.getElementById('hudMessage');

function updateHUD() {
  hudLevel.textContent = String(level);
  hudRemaining.textContent = String(remaining);
  const down = COLORS[orientation.down];
  hudDown.textContent = down.name;
  hudDown.style.color = down.css;
  hudMessage.textContent = message;
  drawStatusPanel(down);
}

// In-world panel: text only, no background fill and no border.
function drawStatusPanel(down) {
  panelCtx.clearRect(0, 0, 1024, 288);
  panelCtx.fillStyle = '#ffffff';
  panelCtx.font = 'bold 52px system-ui, sans-serif';
  panelCtx.textAlign = 'center';
  panelCtx.fillText(`Level ${level}   Remaining: ${remaining}`, 512, 80);
  panelCtx.fillStyle = down.css;
  panelCtx.font = 'bold 52px system-ui, sans-serif';
  panelCtx.fillText(`Face down: ${down.name}`, 512, 160);
  panelCtx.fillStyle = '#ffffff';
  panelCtx.font = '36px system-ui, sans-serif';
  panelCtx.fillText(message.length > 52 ? message.slice(0, 52) + '…' : message, 512, 232);
  panelTexture.needsUpdate = true;
}

// --- Rolling ------------------------------------------------------------------
let roll = null; // {t, axis, totalAngle, edge, startOffset, startQuat, endPos, dir, destCol, destRow}

function tryRoll(dir) {
  if (roll || win) return;
  let dCol = 0, dRow = 0, axis = null, totalAngle = 0;
  if (dir === 'east')  { dCol = 1;  axis = new THREE.Vector3(0, 0, 1); totalAngle = -Math.PI / 2; }
  if (dir === 'west')  { dCol = -1; axis = new THREE.Vector3(0, 0, 1); totalAngle = Math.PI / 2; }
  if (dir === 'north') { dRow = -1; axis = new THREE.Vector3(1, 0, 0); totalAngle = -Math.PI / 2; }
  if (dir === 'south') { dRow = 1;  axis = new THREE.Vector3(1, 0, 0); totalAngle = Math.PI / 2; }
  const destCol = cubeCol + dCol;
  const destRow = cubeRow + dRow;
  if (destCol < 0 || destCol >= GRID || destRow < 0 || destRow >= GRID) {
    message = 'Edge — can\'t roll that way.';
    updateHUD();
    return;
  }
  const startPos = cube.position.clone();
  const endLocal = cellToLocal(destCol, destRow);
  const endPos = new THREE.Vector3(endLocal.x, CUBE / 2, endLocal.z);
  const edge = new THREE.Vector3((startPos.x + endPos.x) / 2, 0, (startPos.z + endPos.z) / 2);
  roll = {
    t: 0, axis, totalAngle, edge,
    startOffset: startPos.clone().sub(edge),
    startQuat: cube.quaternion.clone(),
    endPos, dir, destCol, destRow,
  };
}

function applyOrientationAfterRoll(dir) {
  const o = orientation;
  if (dir === 'east')  orientation = { ...o, down: o.east, east: o.up, up: o.west, west: o.down };
  if (dir === 'west')  orientation = { ...o, down: o.west, west: o.up, up: o.east, east: o.down };
  if (dir === 'north') orientation = { ...o, down: o.north, north: o.up, up: o.south, south: o.down };
  if (dir === 'south') orientation = { ...o, down: o.south, south: o.up, up: o.north, north: o.down };
}

function finishRoll() {
  cubeCol = roll.destCol; cubeRow = roll.destRow;
  cube.position.copy(roll.endPos);
  // Snap quaternion to the exact end rotation.
  const endQuat = new THREE.Quaternion().setFromAxisAngle(roll.axis, roll.totalAngle).multiply(roll.startQuat);
  cube.quaternion.copy(endQuat);
  const dir = roll.dir;
  roll = null;
  applyOrientationAfterRoll(dir);
  const entry = icons.get(keyOf(cubeCol, cubeRow));
  if (entry && entry.colorIndex === orientation.down) {
    worldGroup.remove(entry.mesh);
    icons.delete(keyOf(cubeCol, cubeRow));
    remaining -= 1;
    if (remaining <= 0) {
      win = true;
      message = 'Level complete! Press N, or a trigger in VR, for the next level.';
    } else {
      message = `Matched ${COLORS[orientation.down].name}! ${remaining} left.`;
    }
  } else if (entry) {
    message = `Down is ${COLORS[orientation.down].name}, square needs ${COLORS[entry.colorIndex].name}.`;
  } else {
    message = 'Blank square.';
  }
  updateHUD();
}

// --- Desktop keys ---------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  // Ctrl+Arrow moves the world instead of rolling the cube (desktop
  // testing). Scene axes, so Ctrl+Up always moves the board away from
  // the player on screen, regardless of any world yaw rotation. One
  // CELL per press; holding the keys repeats, so it slides smoothly.
  if (e.ctrlKey && k.startsWith('arrow')) {
    e.preventDefault();
    const step = CELL;
    if (k === 'arrowup') worldGroup.position.z -= step;
    else if (k === 'arrowdown') worldGroup.position.z += step;
    else if (k === 'arrowleft') worldGroup.position.x -= step;
    else if (k === 'arrowright') worldGroup.position.x += step;
    return;
  }
  if (k === 'arrowup' || k === 'w') tryRoll('north');
  else if (k === 'arrowdown' || k === 's') tryRoll('south');
  else if (k === 'arrowleft' || k === 'a') tryRoll('west');
  else if (k === 'arrowright' || k === 'd') tryRoll('east');
  else if (k === 'n') nextLevel();
  else if (k === 'r') restartLevel();
  else if (k === 'q') worldGroup.rotateOnWorldAxis(WORLD_UP, Math.PI / 12);
  else if (k === 'e') worldGroup.rotateOnWorldAxis(WORLD_UP, -Math.PI / 12);
  else if (k === '=' || k === '+') worldGroup.scale.multiplyScalar(1.1);
  else if (k === '-' || k === '_') worldGroup.scale.multiplyScalar(0.9);
  else if (k === 'p') { debugVisible = !debugVisible; updateDebug(); }
  else if (k === '0') {
    if (renderer.xr.isPresenting) { resetWorldForVR(); return; }
    worldGroup.position.copy(WORLD_HOME);
    worldGroup.quaternion.identity();
    tiltDeg = 0;
    worldGroup.scale.setScalar(1);
  }
});
// Mouse wheel scales the world, exactly like +/- on the keyboard:
// scroll up enlarges (x1.1), scroll down shrinks (x0.9). passive: false
// so preventDefault() can stop the page itself from scrolling/zooming.
window.addEventListener('wheel', (e) => {
  e.preventDefault();
  worldGroup.scale.multiplyScalar(e.deltaY < 0 ? 1.1 : 0.9);
}, { passive: false });
document.getElementById('btnNext').addEventListener('click', nextLevel);
document.getElementById('btnRestart').addEventListener('click', restartLevel);

// --- XR controllers: thumbstick roll + two-grip world drag ---------------------
const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);
scene.add(controller0, controller1);
// The browser doesn't draw controllers; load the standard Quest models.
const controllerModelFactory = new XRControllerModelFactory();
for (const i of [0, 1]) {
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerModelFactory.createControllerModel(grip));
  scene.add(grip);
}

let stickReady = true;
let triggerPrev = false;
let drag = null; // {mode: 0 | 1 | 'both', mid, angle, dist, worldPos, worldQuat, worldScale}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpMid = new THREE.Vector3();

// Grip state comes from each controller's own squeeze events, so it always
// matches the controller object whose position the world drag reads.
const gripHeld = [false, false];
[controller0, controller1].forEach((controller, i) => {
  controller.addEventListener('squeezestart', () => { gripHeld[i] = true; });
  controller.addEventListener('squeezeend', () => { gripHeld[i] = false; });
});
// Immersive start: centred on the board, tilted 30°, slightly smaller board.
const VR_HOME = new THREE.Vector3(0, 0.5, -2.5);
const VR_HOME_TILT = 30;
const IDENTITY_Q = new THREE.Quaternion();
function resetWorldForVR() {
  worldGroup.position.copy(VR_HOME);
  worldGroup.quaternion.setFromAxisAngle(TILT_AXIS, VR_HOME_TILT * Math.PI / 180);
  tiltDeg = VR_HOME_TILT;
  worldGroup.scale.setScalar(VR_HOME_SCALE);
}
renderer.xr.addEventListener('sessionstart', resetWorldForVR);
renderer.xr.addEventListener('sessionend', () => {
  gripHeld.fill(false); drag = null; setMenuOpen(false);
});

// --- Controller menu --------------------------------------------------------
// A small panel attached to the LEFT controller, opened with the left menu
// button (or Y) and operated by pointing the RIGHT controller at it and
// pressing its trigger.
// Button indices measured on the Quest browser, left Touch controller.
const MENU_TOGGLE_BUTTONS = [12, 5]; // 12 = menu button, 5 = Y
const MENU_ROWS = 3;
const MENU_W = 512, MENU_H = 20 + MENU_ROWS * 150;
let menuOpen = false;
let menuHover = -1; // -1 none, 0 Debug, 1 Reset view, 2 Exit VR
let menuPrev = false;
let leftButtonsDown = '';
let leftController = null, rightController = null;

controller0.addEventListener('connected', (e) => assignHand(controller0, e.data));
controller1.addEventListener('connected', (e) => assignHand(controller1, e.data));
function assignHand(controller, data) {
  if (data.handedness === 'left') leftController = controller;
  if (data.handedness === 'right') rightController = controller;
  attachMenu();
}

const menuCanvas = document.createElement('canvas');
menuCanvas.width = MENU_W; menuCanvas.height = MENU_H;
const menuCtx = menuCanvas.getContext('2d');
const menuTexture = new THREE.CanvasTexture(menuCanvas);
menuTexture.colorSpace = THREE.SRGBColorSpace;
const menuMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(0.2, 0.2 * MENU_H / MENU_W),
  new THREE.MeshBasicMaterial({ map: menuTexture, transparent: true, side: THREE.DoubleSide })
);
// Above the controller and tilted back so it faces the player's eyes.
menuMesh.position.set(0, 0.1, -0.05);
menuMesh.rotation.x = -Math.PI / 4;
menuMesh.visible = false;

const pointerLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -0.6)]),
  new THREE.LineBasicMaterial({ color: 0x9a9a9a })
);
pointerLine.visible = false;

function attachMenu() {
  if (leftController) leftController.add(menuMesh);
  if (rightController) rightController.add(pointerLine);
}

function drawMenu() {
  menuCtx.clearRect(0, 0, MENU_W, MENU_H);
  const rows = [`Debug: ${debugVisible ? 'On' : 'Off'}`, 'Reset view', 'Exit VR'];
  rows.forEach((label, i) => {
    const y = 20 + i * 150;
    menuCtx.fillStyle = i === menuHover ? '#3498db' : 'rgba(20,20,30,0.92)';
    menuCtx.fillRect(10, y, MENU_W - 20, 130);
    menuCtx.strokeStyle = '#9a9a9a';
    menuCtx.lineWidth = 4;
    menuCtx.strokeRect(10, y, MENU_W - 20, 130);
    menuCtx.fillStyle = '#ffffff';
    menuCtx.font = 'bold 56px system-ui, sans-serif';
    menuCtx.textAlign = 'center';
    menuCtx.textBaseline = 'middle';
    menuCtx.fillText(label, MENU_W / 2, y + 65);
  });
  menuTexture.needsUpdate = true;
}

function setMenuOpen(open) {
  menuOpen = open && !!leftController;
  menuMesh.visible = menuOpen;
  pointerLine.visible = menuOpen && !!rightController;
  menuHover = -1;
  if (menuOpen) drawMenu();
}

const menuRaycaster = new THREE.Raycaster();
const menuRayDir = new THREE.Vector3();
const menuRayQuat = new THREE.Quaternion();

function updateMenuHover() {
  let hover = -1;
  if (menuOpen && rightController) {
    scene.updateMatrixWorld();
    rightController.getWorldPosition(menuRaycaster.ray.origin);
    rightController.getWorldQuaternion(menuRayQuat);
    menuRaycaster.ray.direction.copy(menuRayDir.set(0, 0, -1).applyQuaternion(menuRayQuat));
    const hit = menuRaycaster.intersectObject(menuMesh)[0];
    if (hit && hit.uv) {
      const y = (1 - hit.uv.y) * MENU_H;
      const row = Math.floor((y - 20) / 150);
      if (row >= 0 && row < MENU_ROWS && (y - 20) % 150 <= 130) hover = row;
    }
  }
  if (hover !== menuHover) { menuHover = hover; drawMenu(); }
}

function activateMenuItem() {
  if (!menuOpen) return;
  if (menuHover === 0) {
    debugVisible = !debugVisible;
    updateDebug();
    drawMenu();
  } else if (menuHover === 1) {
    const atHome = worldGroup.position.distanceTo(VR_HOME) < 0.005
      && Math.abs(worldGroup.scale.x - VR_HOME_SCALE) < 0.005
      && worldGroup.quaternion.angleTo(IDENTITY_Q) < 0.005;
    if (atHome) message = 'View is already at the home position.';
    else { resetWorldForVR(); message = 'View reset.'; }
    updateHUD();
  } else if (menuHover === 2) {
    const session = renderer.xr.getSession();
    if (session) session.end();
  }
}
controller0.addEventListener('selectstart', () => { if (controller0 === rightController) activateMenuItem(); });
controller1.addEventListener('selectstart', () => { if (controller1 === rightController) activateMenuItem(); });

function readXRInput() {
  const session = renderer.xr.getSession();
  if (!session) return { grips: gripHeld, stick: null, trigger: false, menuButton: false };
  let stick = null;
  let trigger = false;
  let menuButton = false;
  const leftDown = [];
  const sources = session.inputSources || [];
  for (const source of sources) {
    const gp = source.gamepad;
    if (!gp) continue;
    if (gp.buttons[0] && gp.buttons[0].pressed) trigger = true;
    if (source.handedness === 'left') {
      gp.buttons.forEach((b, i) => { if (b.pressed) leftDown.push(i); });
      if (MENU_TOGGLE_BUTTONS.some((i) => gp.buttons[i] && gp.buttons[i].pressed)) menuButton = true;
    }
    if (gp.axes) {
      const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0];
      const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1];
      // Either thumbstick can roll the cube; use whichever is pushed further.
      if (typeof ax === 'number' && typeof ay === 'number'
          && (!stick || Math.hypot(ax, ay) > Math.hypot(stick.x, stick.y))) {
        stick = { x: ax, y: ay };
      }
    }
  }
  leftButtonsDown = leftDown.join(',');
  return { grips: gripHeld, stick, trigger, menuButton };
}

function updateWorldDrag(input) {
  // One grip: translate only, following that hand. Both grips: translate by
  // the midpoint, plus yaw and scale from the hand-to-hand vector.
  const held = [input.grips[0], input.grips[1]];
  const mode = held[0] && held[1] ? 'both' : held[0] ? 0 : held[1] ? 1 : null;
  if (mode === null) { drag = null; return false; }

  controller0.getWorldPosition(tmpA);
  controller1.getWorldPosition(tmpB);
  const delta = new THREE.Vector3().subVectors(tmpB, tmpA);
  // Yaw angle of the hand-to-hand vector, measured so a positive yaw
  // (Three's rotationY) matches the hands turning toward -z from +x.
  const angle = Math.atan2(-delta.z, delta.x);
  const dist = delta.length();
  if (mode === 'both') tmpMid.addVectors(tmpA, tmpB).multiplyScalar(0.5);
  else tmpMid.copy(mode === 0 ? tmpA : tmpB);

  // Re-anchor whenever the set of held grips changes, so adding or releasing
  // a grip never makes the world jump.
  if (!drag || drag.mode !== mode) {
    drag = {
      mode, mid: tmpMid.clone(), angle, dist,
      worldPos: worldGroup.position.clone(),
      worldQuat: worldGroup.quaternion.clone(),
      worldScale: worldGroup.scale.x,
    };
    return true;
  }
  const midDelta = tmpMid.clone().sub(drag.mid);
  worldGroup.position.copy(drag.worldPos).add(midDelta);
  if (mode === 'both') {
    const yawDelta = angle - drag.angle;
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawDelta * ROTATE_GAIN);
    worldGroup.quaternion.copy(yawQuat).multiply(drag.worldQuat);
    const rawScale = dist / Math.max(drag.dist, 0.001);
    const scaleFactor = THREE.MathUtils.clamp(Math.pow(rawScale, SCALE_GAIN), 0.4, 2.5);
    worldGroup.scale.setScalar(drag.worldScale * scaleFactor);
  }
  return true;
}

// --- Main loop ------------------------------------------------------------------
const clock = new THREE.Clock();
generateLevel();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  debugTimer += dt;
  if (debugTimer >= DEBUG_SECONDS) { debugTimer = 0; updateDebug(); }
  if (roll) {
    roll.t += dt;
    const pRaw = Math.min(roll.t / ROLL_SECONDS, 1);
    const p = pRaw * pRaw * (3 - 2 * pRaw); // smoothstep
    const angle = roll.totalAngle * p;
    const q = new THREE.Quaternion().setFromAxisAngle(roll.axis, angle);
    cube.position.copy(roll.edge).add(roll.startOffset.clone().applyQuaternion(q));
    cube.quaternion.copy(q).multiply(roll.startQuat);
    if (pRaw >= 1) finishRoll();
  }

  const input = readXRInput();
  const dragging = updateWorldDrag(input);

  if (input.menuButton && !menuPrev) setMenuOpen(!menuOpen);
  menuPrev = input.menuButton;
  if (menuOpen) updateMenuHover();

  // Grip held: the stick's forward/back axis tilts the board instead of rolling.
  // Pull back raises the board toward you; push forward lays it flat.
  if (dragging && input.stick && !menuOpen) {
    const y = input.stick.y;
    if (Math.abs(y) < 0.3) { tiltReady = true; tiltTimer = 0; }
    else if (Math.abs(y) > 0.6) {
      tiltTimer -= dt;
      if (tiltReady || tiltTimer <= 0) {
        stepTilt(y > 0 ? 1 : -1);
        tiltReady = false;
        tiltTimer = TILT_REPEAT_SECONDS;
      }
    }
  } else { tiltReady = true; tiltTimer = 0; }

  // The menu captures the stick and trigger so they don't roll the cube.
  if (!dragging && !roll && !menuOpen) {
    if (input.stick) {
      const mag = Math.hypot(input.stick.x, input.stick.y);
      if (mag < 0.3) stickReady = true;
      else if (mag > 0.6 && stickReady) {
        stickReady = false;
        if (Math.abs(input.stick.x) > Math.abs(input.stick.y)) {
          tryRoll(input.stick.x > 0 ? 'east' : 'west');
        } else {
          tryRoll(input.stick.y > 0 ? 'south' : 'north');
        }
        // Quest thumbstick, standard profile: pushing forward gives
        // axes y = -1, so y > 0 is south (toward the player) and
        // y < 0 is north (away from the player).
      }
    }
    if (win && input.trigger && !triggerPrev) nextLevel();
  }
  triggerPrev = input.trigger;

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
