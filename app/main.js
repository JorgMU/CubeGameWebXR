import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
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

const BUILD_TIMESTAMP = '2026-11-03@21:32:05';
const GRID = 11;
// Board size is the anchor: CELL is derived from it, so increasing GRID
// shrinks the cells (and the cube and icons, which are sized from CELL)
// instead of growing the board. Change BOARD_SIZE, not CELL, if you want
// a physically larger or smaller board.
const BOARD_SIZE = 2.0; // m, board footprint — unchanged from the 5x5 version
const CELL = BOARD_SIZE / GRID; // 0.2 m for a 10x10 board
const CUBE = CELL; // cube fills a cell, so rolling over its edge lands centred
const COLORED_FRACTION = 0.5;
const ROLL_SECONDS = 0.1;
// For an even grid there is no single centre cell, so start on the
// south-east of the central four (col/row 5, one half-cell off true centre).
const START_COL = Math.floor(GRID / 2);
const START_ROW = Math.floor(GRID / 2);

// Colour order is also the cube-face index order.
const COLORS = [
  { name: 'Red', hex: 0xc10303, css: '#c10303', shape: 'circle' },
  { name: 'Green', hex: 0x049f27, css: '#049f27', shape: 'triangle' },
  { name: 'Blue', hex: 0x354cff, css: '#354cff', shape: 'square' },
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
// Mixed reality only: one immersive-ar session (the WebXR name for it), which
// is what gives the Quest its passthrough. The button's "AR" text is shown as "MR".
const mrButton = ARButton.createButton(renderer);
new MutationObserver(() => {
  const text = mrButton.textContent.replace(/\bAR\b/, 'MR');
  if (text !== mrButton.textContent) mrButton.textContent = text;
}).observe(mrButton, { childList: true, characterData: true, subtree: true });
mrButton.textContent = mrButton.textContent.replace(/\bAR\b/, 'MR');
document.body.appendChild(mrButton);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
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
// Home poses for the board, one per display mode, all in one place.
// position is in metres relative to the player's floor origin; tilt is degrees
// (0 flat, 90 facing the player).
const HOMES = {
  desktop: { position: new THREE.Vector3(0, 0.5, -2.0), tilt: 0, scale: 1 },
  mr: { position: new THREE.Vector3(0, -0.1, -1.75), tilt: 30, scale: 0.75 },
};
function currentHome() {
  return renderer.xr.getSession() ? HOMES.mr : HOMES.desktop;
}
const EXIT_MESSAGE_RISE = 0.4; // metres above eye height, clear of the tilted board
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
worldGroup.position.copy(HOMES.desktop.position);
scene.add(worldGroup);

// --- Sky ----------------------------------------------------------------------
// NASA SVS "Deep Star Maps 2020" (celestial coordinates, north celestial pole
// up): the whole sky as seen from Earth, on a big sphere inside worldGroup so
// it moves, turns, tilts, and scales with the board. The radius keeps the
// viewer inside the sphere over the whole drag-scale range (x0.4..x2.5) and
// inside the camera far plane. Two versions: "adjusted" (glow removed, stars
// softened and brightened) and "raw" (plain sRGB conversion of the NASA data).
// Resolution is what matters in a headset: 8k when the GPU allows it, else 4k.
const SKY_RADIUS = 30;
const skySuffix = renderer.capabilities.maxTextureSize >= 8192 ? '8k' : '4k';
const skyMaterial = new THREE.MeshBasicMaterial({ depthWrite: false, fog: false });
const skyGeometry = new THREE.SphereGeometry(SKY_RADIUS, 96, 48);
skyGeometry.scale(-1, 1, 1); // flips the faces so the inside shows, with the map the right way round
const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
skyMesh.renderOrder = -1;
skyMesh.visible = false; // until the first texture arrives
worldGroup.add(skyMesh);

const SKY_MODES = ['Adjusted', 'Raw', 'Off', 'Passthrough'];
const SKY_MESSAGES = ['adjusted', 'raw (unadjusted NASA data)', 'off (black)', 'passthrough'];
let skyMode = 0;
let skyRequest = 0;
// Passthrough needs an immersive-ar session whose display blends with the real world.
function passthroughAvailable() {
  const session = renderer.xr.isPresenting ? renderer.xr.getSession() : null;
  return !!session && session.environmentBlendMode !== undefined && session.environmentBlendMode !== 'opaque';
}
function nextSkyMode() {
  return (skyMode + 1) % (passthroughAvailable() ? SKY_MODES.length : SKY_MODES.length - 1);
}
function loadSky() {
  const request = ++skyRequest;
  scene.background = skyMode === 3 ? null : new THREE.Color(0x000000);
  if (skyMode >= 2) { // no texture; Off is a solid black sphere (AR sessions ignore scene.background), passthrough shows the room
    skyMaterial.color.set(0x000000);
    skyMesh.visible = skyMode === 2;
    if (skyMaterial.map) {
      skyMaterial.map.dispose();
      skyMaterial.map = null;
    }
    skyMaterial.needsUpdate = true;
    return;
  }
  const file = `./Assets/starmap_2020_${skySuffix}${skyMode === 0 ? '' : '_raw'}.jpg`;
  new THREE.TextureLoader().load(file, (texture) => {
    if (request !== skyRequest) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const old = skyMaterial.map;
    skyMaterial.map = texture;
    skyMaterial.color.set(0xffffff);
    skyMaterial.needsUpdate = true;
    skyMesh.visible = true;
    if (old) old.dispose(); // one 8k texture at a time keeps GPU memory down
  });
}
function toggleSky() {
  skyMode = nextSkyMode();
  loadSky();
  message = `Sky: ${SKY_MESSAGES[skyMode]}.`;
  updateHUD();
}
loadSky();

// Transparent board: faint plane + grid lines.
const BOARD_COLOR = '#0d8407';
const BOARD_OPACITY = 0.34; // tinted board surface, darkens the sky/passthrough behind it
const boardPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(BOARD_SIZE, BOARD_SIZE),
  new THREE.MeshBasicMaterial({ color: BOARD_COLOR, transparent: true, opacity: BOARD_OPACITY, depthWrite: false, side: THREE.DoubleSide })
);
boardPlane.renderOrder = -0.5; // after the sky, before the icons, so it darkens only what is behind the board
boardPlane.rotation.x = -Math.PI / 2;
boardPlane.position.y = 0.001;
worldGroup.add(boardPlane);

const GRID_COLOR = 0xfff005; // single colour so the panel can recolour every line
const grid = new THREE.GridHelper(BOARD_SIZE, GRID, GRID_COLOR, GRID_COLOR);
grid.position.y = 0.005;
worldGroup.add(grid);

// --- Flat icons (lie flat in the plane of the board) ------------------------
// Fill and border colour per shape; the appearance panel edits these.
const SHAPE_BORDER_WIDTH = 4; // px on the 256 px icon texture
const SHAPE_BORDER_COLOR = '#f9ff2c';
const shapeStyles = {};
for (const col of COLORS) shapeStyles[col.shape] = { fill: col.css, border: SHAPE_BORDER_COLOR, width: SHAPE_BORDER_WIDTH };

function makeIconTexture(shape, background = null) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 256, 256); }
  ctx.fillStyle = shapeStyles[shape].fill;
  ctx.strokeStyle = shapeStyles[shape].border;
  ctx.lineWidth = Math.max(shapeStyles[shape].width, 0.01);
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
const iconTextures = COLORS.map((col) => makeIconTexture(col.shape));

// --- Cube -------------------------------------------------------------------
// Deep-blue faces carrying the same coloured symbol as the board icons.
const CUBE_FACE_BLUE = '#0b1d65';
const CUBE_OPACITY = 0.63;
const cubeFaceMaterial = (colorIndex) => new THREE.MeshStandardMaterial({
  map: makeIconTexture(COLORS[colorIndex].shape, CUBE_FACE_BLUE),
  transparent: true,
  opacity: CUBE_OPACITY,
  depthWrite: false,
  side: THREE.DoubleSide, // inner faces show through the translucent cube
});
// BoxGeometry material order: +x east, -x west, +y up, -y down, +z south, -z north.
const cubeFaceColorIndices = [
  INITIAL_ORIENTATION.east, INITIAL_ORIENTATION.west, INITIAL_ORIENTATION.up,
  INITIAL_ORIENTATION.down, INITIAL_ORIENTATION.south, INITIAL_ORIENTATION.north,
];
const cubeMaterials = cubeFaceColorIndices.map(cubeFaceMaterial);
const cube = new THREE.Mesh(new THREE.BoxGeometry(CUBE, CUBE, CUBE), cubeMaterials);
const CUBE_EDGE_COLOR = '#767f0f';
const cubeEdgeMaterial = new THREE.LineBasicMaterial({ color: CUBE_EDGE_COLOR });
cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), cubeEdgeMaterial));
cube.renderOrder = 1; // after the board and icons so they show through it
worldGroup.add(cube);

// --- In-world status text (tilted up beyond the far edge) ---
// Past the north edge, tilted 30 degrees up from the board plane and facing
// the player on the south side. No background or border.
const panelCanvas = document.createElement('canvas');
panelCanvas.width = 1024; panelCanvas.height = 288;
const panelCtx = panelCanvas.getContext('2d');
const panelTexture = new THREE.CanvasTexture(panelCanvas);
panelTexture.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(
  new THREE.PlaneGeometry(1.8, 0.5),
  new THREE.MeshBasicMaterial({ map: panelTexture, transparent: true, side: THREE.DoubleSide })
);
panel.rotation.x = -Math.PI / 3;
panel.position.set(0, 0.1, -BOARD_SIZE / 2 - 0.35);
worldGroup.add(panel);

// --- Debug readout (small grey text) -------------------------------------------
// Shows where the viewer is and how the board is posed. Both are in the same
// scene (tracking-space) coordinates, so the numbers can be compared directly.
// Toggle with the P key; refreshed a few times a second, not every frame.
const DEBUG_SECONDS = 0.2;
let debugVisible = true;
let debugTimer = 0;
const debugCanvas = document.createElement('canvas');
debugCanvas.width = 1024; debugCanvas.height = 350;
const debugCtx = debugCanvas.getContext('2d');
const debugTexture = new THREE.CanvasTexture(debugCanvas);
debugTexture.colorSpace = THREE.SRGBColorSpace;
const debugPanelHeight = 1.8 * debugCanvas.height / debugCanvas.width;
const debugPanel = new THREE.Mesh(
  new THREE.PlaneGeometry(1.8, debugPanelHeight),
  new THREE.MeshBasicMaterial({ map: debugTexture, transparent: true, side: THREE.DoubleSide })
);
debugPanel.rotation.x = -Math.PI / 2;
// Just beyond the south edge of the board, with a small gap.
debugPanel.position.set(0, 0.012, BOARD_SIZE / 2 + debugPanelHeight / 2 + 0.05);
worldGroup.add(debugPanel);

// --- Session scores (flat in the board plane, left of the board) ---------------
// 640 px per metre, so the 52 px text matches the 46 px text on the main panel
// (1024 px across 1.8 m) in physical size.
const SCORES_W = 0.9, SCORES_H = 1.3;
const SCORES_FONT = 52;
const scoresCanvas = document.createElement('canvas');
scoresCanvas.width = 576; scoresCanvas.height = 832;
const scoresCtx = scoresCanvas.getContext('2d');
const scoresTexture = new THREE.CanvasTexture(scoresCanvas);
scoresTexture.colorSpace = THREE.SRGBColorSpace;
const scoresPanel = new THREE.Mesh(
  new THREE.PlaneGeometry(SCORES_W, SCORES_H),
  new THREE.MeshBasicMaterial({ map: scoresTexture, transparent: true, side: THREE.DoubleSide })
);
scoresPanel.rotation.x = -Math.PI / 2;
// Top edge level with the board's far edge, with a small gap on the left.
scoresPanel.position.set(-BOARD_SIZE / 2 - SCORES_W / 2 - 0.05, 0.012, -BOARD_SIZE / 2 + SCORES_H / 2);
worldGroup.add(scoresPanel);

function drawScoresPanel(records) {
  const ctx = scoresCtx;
  const columns = [20, 190, 380];
  ctx.clearRect(0, 0, scoresCanvas.width, scoresCanvas.height);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${SCORES_FONT}px system-ui, sans-serif`;
  ctx.fillText('Session scores', 20, 64);
  ctx.fillStyle = '#ffd166';
  ['Level', 'Score', 'Time'].forEach((label, i) => ctx.fillText(label, columns[i], 134));
  ctx.fillStyle = '#ffffff';
  ctx.font = `${SCORES_FONT}px system-ui, sans-serif`;
  if (!records.length) ctx.fillText('No scores yet.', 20, 204);
  records.forEach((record, row) => {
    [record.level, record.score, formatTime(record.elapsedSeconds)]
      .forEach((value, i) => ctx.fillText(String(value), columns[i], 204 + row * 64));
  });
  scoresTexture.needsUpdate = true;
}
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
  return [`Build   ${BUILD_TIMESTAMP}`, `Sky     ${SKY_MODES[skyMode]}`, player, board, pose, buttons];
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
const MESSAGE_SECONDS = 3;
let lastMessageSeen = null;
let messageShownAt = 0;
let levelStartedAt = null;
let levelEndedAt = null;
let displayedElapsedSeconds = 0;
let levelScore = 0;
const sessionRecords = [];

function elapsedLevelSeconds(now = performance.now()) {
  if (levelStartedAt === null) return 0;
  return Math.floor(((levelEndedAt ?? now) - levelStartedAt) / 1000);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function keyOf(col, row) { return `${col},${row}`; }

function removeIcon(entry) {
  worldGroup.remove(entry.mesh);
  entry.mesh.geometry.dispose();
  entry.mesh.material.dispose();
}

function clearIcons() {
  for (const entry of icons.values()) removeIcon(entry);
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
  roll = null;
  cubeCol = START_COL; cubeRow = START_ROW;
  orientation = { ...INITIAL_ORIENTATION };
  const p = cellToLocal(cubeCol, cubeRow);
  cube.position.set(p.x, CUBE / 2, p.z);
  cube.quaternion.identity();
  win = false;
  levelStartedAt = null;
  levelEndedAt = null;
  displayedElapsedSeconds = 0;
  levelScore = 0;
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
const hudTime = document.getElementById('hudTime');
const hudScore = document.getElementById('hudScore');
const hudMessage = document.getElementById('hudMessage');
const hudBuildTimestamp = document.getElementById('hudBuildTimestamp');
const hudRecords = document.getElementById('hudRecords');

function updateHUD() {
  hudLevel.textContent = String(level);
  hudRemaining.textContent = String(remaining);
  hudTime.textContent = levelStartedAt === null ? 'Ready' : formatTime(elapsedLevelSeconds());
  hudScore.textContent = String(levelScore);
  hudBuildTimestamp.textContent = `Build: ${BUILD_TIMESTAMP}`;
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
  panelCtx.font = 'bold 46px system-ui, sans-serif';
  panelCtx.textAlign = 'center';
  panelCtx.fillText(`Level ${level}   Remaining: ${remaining}`, 512, 58);
  panelCtx.fillText(`Time: ${levelStartedAt === null ? 'Ready' : formatTime(elapsedLevelSeconds())}   Score: ${levelScore}`, 512, 124);
  panelCtx.fillStyle = down.css;
  panelCtx.font = 'bold 42px system-ui, sans-serif';
  panelCtx.fillText(`Face down: ${down.name}`, 512, 184);
  panelCtx.fillStyle = '#ffffff';
  panelCtx.font = '32px system-ui, sans-serif';
  panelCtx.fillText(message.length > 58 ? message.slice(0, 58) + '…' : message, 512, 248);
  panelTexture.needsUpdate = true;
}

function updateSessionRecords() {
  sessionRecords.sort((a, b) => b.score - a.score || a.elapsedSeconds - b.elapsedSeconds);
  sessionRecords.length = Math.min(sessionRecords.length, 10);
  hudRecords.replaceChildren();
  for (const record of sessionRecords) {
    const row = hudRecords.insertRow();
    [record.level, record.score, formatTime(record.elapsedSeconds), record.completedAt]
      .forEach((value) => { row.insertCell().textContent = String(value); });
  }
  drawScoresPanel(sessionRecords);
}
drawScoresPanel(sessionRecords);

// --- Rolling ------------------------------------------------------------------
let roll = null; // {t, axis, totalAngle, edge, startOffset, startQuat, endPos, dir, destCol, destRow}

function tryRoll(dir) {
  if (roll || win) return;
  let dCol = 0, dRow = 0, axis = null, totalAngle = 0;
  if (dir === 'east') { dCol = 1; axis = new THREE.Vector3(0, 0, 1); totalAngle = -Math.PI / 2; }
  if (dir === 'west') { dCol = -1; axis = new THREE.Vector3(0, 0, 1); totalAngle = Math.PI / 2; }
  if (dir === 'north') { dRow = -1; axis = new THREE.Vector3(1, 0, 0); totalAngle = -Math.PI / 2; }
  if (dir === 'south') { dRow = 1; axis = new THREE.Vector3(1, 0, 0); totalAngle = Math.PI / 2; }
  const destCol = cubeCol + dCol;
  const destRow = cubeRow + dRow;
  if (destCol < 0 || destCol >= GRID || destRow < 0 || destRow >= GRID) {
    message = 'Edge — can\'t roll that way.';
    updateHUD();
    return;
  }
  if (levelStartedAt === null) {
    levelStartedAt = performance.now();
    displayedElapsedSeconds = 0;
    updateHUD();
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
  if (dir === 'east') orientation = { ...o, down: o.east, east: o.up, up: o.west, west: o.down };
  if (dir === 'west') orientation = { ...o, down: o.west, west: o.up, up: o.east, east: o.down };
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
    const matchAt = performance.now();
    removeIcon(entry);
    icons.delete(keyOf(cubeCol, cubeRow));
    remaining -= 1;
    levelScore += Math.max(0, 180 - elapsedLevelSeconds(matchAt));
    if (remaining <= 0) {
      win = true;
      levelEndedAt = matchAt;
      sessionRecords.push({
        level,
        score: levelScore,
        elapsedSeconds: elapsedLevelSeconds(levelEndedAt),
        completedAt: new Date().toLocaleDateString(),
      });
      updateSessionRecords();
      message = `Level complete! ${renderer.xr.isPresenting ? 'Pull a trigger' : 'Press N'} for the next level.`;
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
  else if (k === 'k') toggleSky();
  else if (k === '0') {
    if (renderer.xr.isPresenting) { resetWorldForMR(); return; }
    worldGroup.position.copy(HOMES.desktop.position);
    worldGroup.quaternion.identity();
    tiltDeg = 0;
    worldGroup.scale.setScalar(HOMES.desktop.scale);
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
let stickTimer = 0;
const STICK_REPEAT_SECONDS = 0.125; // one square per twentieth of a second while the stick is held
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
// Immersive start: centred on the board, tilted, slightly smaller board (see HOMES).
const homeQuat = (home) => new THREE.Quaternion().setFromAxisAngle(TILT_AXIS, home.tilt * Math.PI / 180);
function resetWorldForMR() {
  const home = currentHome();
  worldGroup.position.copy(home.position);
  worldGroup.quaternion.copy(homeQuat(home));
  tiltDeg = home.tilt;
  worldGroup.scale.setScalar(home.scale);
}
renderer.xr.addEventListener('sessionstart', () => {
  resetWorldForMR();
  restartLevel(); // entering or leaving MR restarts the current board
});
renderer.xr.addEventListener('sessionend', () => {
  if (exitTimer !== null) window.clearTimeout(exitTimer);
  exitTimer = null;
  gripHeld.fill(false); drag = null; exitPending = false;
  exitMessageMesh.visible = false;
  if (skyMode === 3) { skyMode = 0; loadSky(); } // passthrough only exists inside the session
  setMenuOpen(false);
  restartLevel();
});

// --- Controller menu --------------------------------------------------------
// A small panel attached to the LEFT controller, opened with the left menu
// button (or Y) and operated by pointing the RIGHT controller at it and
// pressing its trigger.
// Button indices measured on the Quest browser, left Touch controller.
const MENU_TOGGLE_BUTTONS = [12, 5]; // 12 = menu button, 5 = Y
const MENU_ROWS = 4;
const MENU_W = 512, MENU_H = 20 + MENU_ROWS * 150;
let menuOpen = false;
let menuHover = -1; // -1 none, 0 Debug, 1 Sky, 2 Reset view, 3 Exit MR
let menuPrev = false;
let exitPending = false;
let exitTimer = null;
const EXIT_MR_DELAY_MS = 3000;
const EXIT_MR_MESSAGE = 'Exiting MR in 3 seconds. Look forward; your view will be reset.';
let leftButtonsDown = '';
let leftController = null, rightController = null;

const exitMessageCanvas = document.createElement('canvas');
exitMessageCanvas.width = 1024;
exitMessageCanvas.height = 256;
const exitMessageCtx = exitMessageCanvas.getContext('2d');
exitMessageCtx.fillStyle = 'rgba(5, 5, 16, 0.9)';
exitMessageCtx.strokeStyle = '#ffffff';
exitMessageCtx.lineWidth = 6;
exitMessageCtx.beginPath();
exitMessageCtx.roundRect(8, 8, 1008, 240, 32);
exitMessageCtx.fill();
exitMessageCtx.stroke();
exitMessageCtx.fillStyle = '#ffffff';
exitMessageCtx.textAlign = 'center';
exitMessageCtx.textBaseline = 'middle';
exitMessageCtx.font = 'bold 60px system-ui, sans-serif';
exitMessageCtx.fillText('Exiting MR in 3 seconds', 512, 88);
exitMessageCtx.font = '40px system-ui, sans-serif';
exitMessageCtx.fillText('Look forward; your view will be reset.', 512, 172);
const exitMessageTexture = new THREE.CanvasTexture(exitMessageCanvas);
exitMessageTexture.colorSpace = THREE.SRGBColorSpace;
const exitMessageMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1.3, 0.325),
  new THREE.MeshBasicMaterial({ map: exitMessageTexture, transparent: true, side: THREE.DoubleSide })
);
exitMessageMesh.visible = false;
scene.add(exitMessageMesh);

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
  if (leftController) { leftController.add(menuMesh); leftController.add(appearanceLine); }
  if (rightController) { rightController.add(pointerLine); rightController.add(appearanceMesh); }
}

function drawMenu() {
  menuCtx.clearRect(0, 0, MENU_W, MENU_H);
  const rows = [`Debug: ${debugVisible ? 'On' : 'Off'}`, `Sky: ${SKY_MODES[nextSkyMode()]}`, 'Reset view', 'Exit MR'];
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
  if (open && appearanceOpen) setAppearanceOpen(false);
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
  const selected = menuHover;
  if (selected < 0) return;
  setMenuOpen(false);
  if (selected === 0) {
    debugVisible = !debugVisible;
    updateDebug();
  } else if (selected === 1) {
    toggleSky();
  } else if (selected === 2) {
    const home = currentHome();
    const atHome = worldGroup.position.distanceTo(home.position) < 0.005
      && Math.abs(worldGroup.scale.x - home.scale) < 0.005
      && worldGroup.quaternion.angleTo(homeQuat(home)) < 0.005;
    if (atHome) message = 'View is already at the home position.';
    else { resetWorldForMR(); message = 'View reset.'; }
    updateHUD();
  } else if (selected === 3) {
    const session = renderer.xr.getSession();
    if (session) {
      exitPending = true;
      message = EXIT_MR_MESSAGE;
      exitMessageMesh.visible = true;
      updateHUD();
      exitTimer = window.setTimeout(() => {
        exitTimer = null;
        if (renderer.xr.getSession() !== session) return;
        session.end().catch((error) => {
          exitPending = false;
          exitMessageMesh.visible = false;
          message = `Could not exit MR: ${error instanceof Error ? error.message : String(error)}`;
          updateHUD();
        });
      }, EXIT_MR_DELAY_MS);
    }
  }
}
controller0.addEventListener('selectstart', () => { if (controller0 === rightController) activateMenuItem(); });
controller1.addEventListener('selectstart', () => { if (controller1 === rightController) activateMenuItem(); });

// --- Appearance panel -------------------------------------------------------
// Opened with the RIGHT controller's B button; the panel rides on the right
// controller and is operated by pointing the LEFT controller and holding its
// trigger. A generic item list (board, cube, grid, cube edges, each shape's
// fill and border) is edited with a colour picker (hue/saturation), a
// brightness slider and, where it applies, an opacity slider. Values persist
// in localStorage.
const APPEARANCE_BUTTON = 5; // B on the right Touch controller
const AP_W = 512, AP_H = 610;
const AP_SELECT = { y: 10, h: 80 };
const AP_PARTS = { y: 100, h: 70 };
const AP_PICKER = { x: 10, y: 190, w: 492, h: 200 };
const AP_BRIGHT = { x: 20, y: 440, w: 472, h: 44 };
const AP_OPACITY = { x: 20, y: 540, w: 472, h: 44 };
const AP_STORAGE_KEY = 'cubeGameAppearance';
const AP_PANEL_WIDTH = 0.225;

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const AP_ITEMS = [
  { id: 'board', label: 'Board', parts: [{ id: '', label: 'Surface' }], alpha: true },
  { id: 'cube', label: 'Cube faces', parts: [{ id: '', label: 'Face colour' }], alpha: true },
  { id: 'grid', label: 'Grid lines', parts: [{ id: '', label: 'Lines' }] },
  { id: 'edges', label: 'Cube edges', parts: [{ id: '', label: 'Edges' }] },
  { id: 'shapeBorder', label: 'Shape borders', parts: [{ id: '', label: 'All shapes' }] },
  ...COLORS.map((col) => ({
    id: col.shape,
    label: titleCase(col.shape),
    parts: [{ id: '.fill', label: 'Fill' }],
  })),
];

function cssToHsv(css) {
  const n = parseInt(css.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max };
}

const appearance = {
  board: { ...cssToHsv(BOARD_COLOR), a: BOARD_OPACITY },
  cube: { ...cssToHsv(CUBE_FACE_BLUE), a: CUBE_OPACITY },
  grid: { ...cssToHsv(`#${GRID_COLOR.toString(16).padStart(6, '0')}`), a: 1 },
  edges: { ...cssToHsv(CUBE_EDGE_COLOR), a: 1 },
};
for (const col of COLORS) {
  appearance[`${col.shape}.fill`] = { ...cssToHsv(col.css), a: 1 };
}
appearance.shapeBorder = { ...cssToHsv(SHAPE_BORDER_COLOR), a: 1, w: SHAPE_BORDER_WIDTH }; // shared by every shape
try {
  const saved = JSON.parse(localStorage.getItem(AP_STORAGE_KEY));
  for (const key of Object.keys(appearance)) {
    if (saved && saved[key] && ['h', 's', 'v', 'a'].every((k) => Number.isFinite(saved[key][k]))) {
      Object.assign(appearance[key], saved[key]);
    }
  }
  if (!Number.isFinite(appearance.shapeBorder.w)) appearance.shapeBorder.w = SHAPE_BORDER_WIDTH;
} catch { /* ignore bad or unavailable storage */ }
let appearanceOpen = false;
let appearanceItem = 0;
let appearancePart = 0;
let appearancePrev = false;
let appearanceTriggerPrev = false;
let appearanceDrag = null; // 'picker' | 'bright' | 'opacity' while the trigger is held
let cubeDirty = false;
let cubeRebuildAt = 0;
const dirtyShapes = new Set();

const apKey = () => AP_ITEMS[appearanceItem].id + AP_ITEMS[appearanceItem].parts[appearancePart].id;
const BORDER_WIDTH_MAX = 30; // px on the 256 px icon texture
const isBorderKey = (key) => key === 'shapeBorder';

function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map((c) => Math.round(c * 255));
}
const hsvCss = (h, s, v) => `rgb(${hsvToRgb(h, s, v).join(',')})`;

function applyBoardAppearance() {
  const b = appearance.board;
  boardPlane.material.color.set(hsvCss(b.h, b.s, b.v));
  boardPlane.material.opacity = b.a;
}
function applyLineColors() {
  const g = appearance.grid, e = appearance.edges;
  grid.material.color.set(hsvCss(g.h, g.s, g.v));
  cubeEdgeMaterial.color.set(hsvCss(e.h, e.s, e.v));
}
function applyShapeStyles() {
  const b = appearance.shapeBorder;
  for (const col of COLORS) {
    const f = appearance[`${col.shape}.fill`];
    shapeStyles[col.shape] = { fill: hsvCss(f.h, f.s, f.v), border: hsvCss(b.h, b.s, b.v), width: b.w };
  }
}
function rebuildShapeTextures() {
  for (const shape of dirtyShapes) {
    const i = COLORS.findIndex((col) => col.shape === shape);
    const old = iconTextures[i];
    iconTextures[i] = makeIconTexture(shape);
    for (const entry of icons.values()) {
      if (entry.colorIndex === i) { entry.mesh.material.map = iconTextures[i]; entry.mesh.material.needsUpdate = true; }
    }
    old.dispose();
  }
  dirtyShapes.clear();
}
function rebuildCubeFaces() {
  const c = appearance.cube;
  const bg = hsvCss(c.h, c.s, c.v);
  cubeMaterials.forEach((mat, i) => {
    const old = mat.map;
    mat.map = makeIconTexture(COLORS[cubeFaceColorIndices[i]].shape, bg);
    mat.opacity = c.a;
    mat.needsUpdate = true;
    if (old) old.dispose();
  });
  cubeDirty = false;
  cubeRebuildAt = performance.now();
}
function flushAppearance() {
  if (dirtyShapes.size) { rebuildShapeTextures(); cubeDirty = true; }
  if (cubeDirty) rebuildCubeFaces();
}
// 2D-only table of the current settings, selectable so it can be copied as defaults.
const hudColors = document.getElementById('hudColors');
function updateColorTable() {
  const hex = (t) => `#${hsvToRgb(t.h, t.s, t.v).map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const rows = ['Item           Color    Opacity Border'];
  for (const [key, t] of Object.entries(appearance)) {
    const alpha = key === 'board' || key === 'cube' ? `${Math.round(t.a * 100)}%` : '-';
    const width = isBorderKey(key) ? `${Math.round(t.w)}px` : '-';
    rows.push(`${key.padEnd(14)} ${hex(t)} ${alpha.padEnd(7)} ${width}`);
  }
  hudColors.textContent = rows.join('\n');
  hudColors.style.display = debugVisible ? 'block' : 'none';
}
function saveAppearance() {
  try { localStorage.setItem(AP_STORAGE_KEY, JSON.stringify(appearance)); } catch { /* ignore */ }
}
applyShapeStyles();
applyBoardAppearance();
applyLineColors();
for (const col of COLORS) dirtyShapes.add(col.shape);
flushAppearance();
updateColorTable();

const appearanceCanvas = document.createElement('canvas');
appearanceCanvas.width = AP_W; appearanceCanvas.height = AP_H;
const apCtx = appearanceCanvas.getContext('2d');
const appearanceBaseCanvas = document.createElement('canvas');
appearanceBaseCanvas.width = AP_W; appearanceBaseCanvas.height = AP_H;
const appearanceBaseCtx = appearanceBaseCanvas.getContext('2d');
const appearanceTexture = new THREE.CanvasTexture(appearanceCanvas);
appearanceTexture.colorSpace = THREE.SRGBColorSpace;
const appearanceMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(AP_PANEL_WIDTH, AP_PANEL_WIDTH * AP_H / AP_W),
  new THREE.MeshBasicMaterial({ map: appearanceTexture, transparent: true, side: THREE.DoubleSide })
);
appearanceMesh.position.set(0, 0.15, -0.05);
appearanceMesh.rotation.x = -Math.PI / 4;
appearanceMesh.visible = false;
const appearanceLine = new THREE.Line(pointerLine.geometry, new THREE.LineBasicMaterial({ color: 0x9a9a9a }));
appearanceLine.visible = false;

function drawSlider(rect, label, fraction, trackFill) {
  apCtx.fillStyle = '#ffffff';
  apCtx.font = 'bold 30px system-ui, sans-serif';
  apCtx.textAlign = 'left';
  apCtx.textBaseline = 'alphabetic';
  apCtx.fillText(label, rect.x, rect.y - 10);
  apCtx.fillStyle = trackFill;
  apCtx.fillRect(rect.x, rect.y, rect.w, rect.h);
  apCtx.strokeStyle = '#9a9a9a';
  apCtx.lineWidth = 4;
  apCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  apCtx.fillStyle = '#ffffff';
  apCtx.fillRect(rect.x + fraction * rect.w - 6, rect.y - 6, 12, rect.h + 12);
}

let appearanceBaseItem = -1;
let appearanceBasePart = -1;
let appearanceLastDraw = 0;
const AP_DRAW_INTERVAL = 1000 / 30;

function drawAppearanceBase() {
  const item = AP_ITEMS[appearanceItem];
  appearanceBaseCtx.clearRect(0, 0, AP_W, AP_H);
  appearanceBaseCtx.fillStyle = 'rgba(20,20,30,0.94)';
  appearanceBaseCtx.fillRect(0, 0, AP_W, AP_H);
  appearanceBaseCtx.strokeStyle = '#9a9a9a';
  appearanceBaseCtx.lineWidth = 4;
  appearanceBaseCtx.strokeRect(2, 2, AP_W - 4, AP_H - 4);
  appearanceBaseCtx.textAlign = 'center';
  appearanceBaseCtx.textBaseline = 'middle';
  appearanceBaseCtx.font = 'bold 44px system-ui, sans-serif';
  [['<', 10], ['>', 422]].forEach(([arrow, x]) => {
    appearanceBaseCtx.fillStyle = 'rgba(60,60,80,0.9)';
    appearanceBaseCtx.fillRect(x, AP_SELECT.y, 80, AP_SELECT.h);
    appearanceBaseCtx.fillStyle = '#ffffff';
    appearanceBaseCtx.fillText(arrow, x + 40, AP_SELECT.y + 40);
  });
  appearanceBaseCtx.fillText(item.label, AP_W / 2, AP_SELECT.y + 40);
  const partW = (AP_W - 20) / item.parts.length;
  item.parts.forEach((part, i) => {
    const x = 10 + i * partW;
    appearanceBaseCtx.fillStyle = i === appearancePart ? '#3498db' : 'rgba(60,60,80,0.9)';
    appearanceBaseCtx.fillRect(x + 2, AP_PARTS.y, partW - 4, AP_PARTS.h);
    appearanceBaseCtx.fillStyle = '#ffffff';
    appearanceBaseCtx.font = 'bold 36px system-ui, sans-serif';
    appearanceBaseCtx.fillText(part.label, x + partW / 2, AP_PARTS.y + 36);
  });
  const p = AP_PICKER;
  const hue = appearanceBaseCtx.createLinearGradient(p.x, 0, p.x + p.w, 0);
  for (let i = 0; i <= 6; i++) hue.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
  appearanceBaseCtx.fillStyle = hue;
  appearanceBaseCtx.fillRect(p.x, p.y, p.w, p.h);
  const sat = appearanceBaseCtx.createLinearGradient(0, p.y, 0, p.y + p.h);
  sat.addColorStop(0, 'rgba(255,255,255,0)');
  sat.addColorStop(1, 'rgba(255,255,255,1)');
  appearanceBaseCtx.fillStyle = sat;
  appearanceBaseCtx.fillRect(p.x, p.y, p.w, p.h);
  appearanceBaseItem = appearanceItem;
  appearanceBasePart = appearancePart;
}

function drawAppearance(force = false) {
  const now = performance.now();
  if (!force && now - appearanceLastDraw < AP_DRAW_INTERVAL) return;
  if (appearanceBaseItem !== appearanceItem || appearanceBasePart !== appearancePart) drawAppearanceBase();
  const item = AP_ITEMS[appearanceItem];
  const t = appearance[apKey()];
  const p = AP_PICKER;
  apCtx.clearRect(0, 0, AP_W, AP_H);
  apCtx.drawImage(appearanceBaseCanvas, 0, 0);
  apCtx.strokeStyle = '#ffffff';
  apCtx.lineWidth = 4;
  apCtx.beginPath();
  apCtx.arc(p.x + (t.h / 360) * p.w, p.y + (1 - t.s) * p.h, 12, 0, Math.PI * 2);
  apCtx.stroke();
  apCtx.strokeStyle = '#000000';
  apCtx.lineWidth = 2;
  apCtx.stroke();
  const bright = apCtx.createLinearGradient(AP_BRIGHT.x, 0, AP_BRIGHT.x + AP_BRIGHT.w, 0);
  bright.addColorStop(0, '#000000');
  bright.addColorStop(1, hsvCss(t.h, t.s, 1));
  drawSlider(AP_BRIGHT, `Brightness ${Math.round(t.v * 100)}%`, t.v, bright);
  if (item.alpha) drawSlider(AP_OPACITY, `Opacity ${Math.round(t.a * 100)}%`, t.a, hsvCss(t.h, t.s, t.v));
  if (isBorderKey(apKey())) drawSlider(AP_OPACITY, `Border width ${Math.round(t.w)}`, t.w / BORDER_WIDTH_MAX, '#404050');
  appearanceTexture.needsUpdate = true;
  appearanceLastDraw = now;
}

function setAppearanceOpen(open) {
  appearanceOpen = open && !!rightController && !!leftController;
  if (appearanceOpen && menuOpen) setMenuOpen(false);
  appearanceMesh.visible = appearanceOpen;
  appearanceLine.visible = appearanceOpen;
  appearanceDrag = null;
  if (appearanceOpen) drawAppearance(true);
  else flushAppearance();
}

const apClamp01 = (v) => Math.min(1, Math.max(0, v));
function applyAppearanceDrag(px, py) {
  const key = apKey();
  const t = appearance[key];
  let changed = false;
  if (appearanceDrag === 'picker') {
    const h = apClamp01((px - AP_PICKER.x) / AP_PICKER.w) * 360;
    const s = 1 - apClamp01((py - AP_PICKER.y) / AP_PICKER.h);
    changed = h !== t.h || s !== t.s;
    t.h = h;
    t.s = s;
  } else if (appearanceDrag === 'bright') {
    const v = apClamp01((px - AP_BRIGHT.x) / AP_BRIGHT.w);
    changed = v !== t.v;
    t.v = v;
  } else if (appearanceDrag === 'opacity') {
    if (isBorderKey(key)) {
      const w = apClamp01((px - AP_OPACITY.x) / AP_OPACITY.w) * BORDER_WIDTH_MAX;
      changed = w !== t.w;
      t.w = w;
    } else {
      const a = apClamp01((px - AP_OPACITY.x) / AP_OPACITY.w);
      changed = a !== t.a;
      t.a = a;
    }
  }
  if (!changed) return;
  if (key === 'board') applyBoardAppearance();
  else if (key === 'cube') cubeDirty = true;
  else if (key === 'grid' || key === 'edges') applyLineColors();
  else {
    applyShapeStyles();
    if (isBorderKey(key)) for (const col of COLORS) dirtyShapes.add(col.shape);
    else dirtyShapes.add(key.split('.')[0]);
  }
  drawAppearance();
}

// Right stick left/right walks every (item, part) in order, wrapping around.
function stepAppearanceSelection(dir) {
  flushAppearance();
  const item = AP_ITEMS[appearanceItem];
  appearancePart += dir;
  if (appearancePart >= item.parts.length) {
    appearanceItem = (appearanceItem + 1) % AP_ITEMS.length;
    appearancePart = 0;
  } else if (appearancePart < 0) {
    appearanceItem = (appearanceItem - 1 + AP_ITEMS.length) % AP_ITEMS.length;
    appearancePart = AP_ITEMS[appearanceItem].parts.length - 1;
  }
  drawAppearance(true);
}
let appearanceStickReady = true;

function updateAppearance(triggerHeld, rightStick) {
  const sx = rightStick ? rightStick.x : 0;
  if (Math.abs(sx) < 0.3) appearanceStickReady = true;
  else if (Math.abs(sx) > 0.6 && appearanceStickReady) {
    appearanceStickReady = false;
    stepAppearanceSelection(sx > 0 ? 1 : -1);
  }
  let hit = null;
  scene.updateMatrixWorld();
  leftController.getWorldPosition(menuRaycaster.ray.origin);
  leftController.getWorldQuaternion(menuRayQuat);
  menuRaycaster.ray.direction.copy(menuRayDir.set(0, 0, -1).applyQuaternion(menuRayQuat));
  const h = menuRaycaster.intersectObject(appearanceMesh)[0];
  if (h && h.uv) hit = { x: h.uv.x * AP_W, y: (1 - h.uv.y) * AP_H };

  if (triggerHeld && !appearanceTriggerPrev && hit) {
    const item = AP_ITEMS[appearanceItem];
    const inRect = (r, pad) => hit.x >= r.x && hit.x <= r.x + r.w && hit.y >= r.y - pad && hit.y <= r.y + r.h + pad;
    if (hit.y >= AP_SELECT.y && hit.y <= AP_SELECT.y + AP_SELECT.h) {
      const step = hit.x < 256 ? -1 : 1;
      flushAppearance();
      appearanceItem = (appearanceItem + step + AP_ITEMS.length) % AP_ITEMS.length;
      appearancePart = 0;
      drawAppearance(true);
    } else if (hit.y >= AP_PARTS.y && hit.y <= AP_PARTS.y + AP_PARTS.h) {
      const part = Math.min(item.parts.length - 1, Math.max(0, Math.floor((hit.x - 10) / ((AP_W - 20) / item.parts.length))));
      if (part !== appearancePart) { flushAppearance(); appearancePart = part; drawAppearance(true); }
    } else if (inRect(AP_PICKER, 0)) appearanceDrag = 'picker';
    else if (inRect(AP_BRIGHT, 14)) appearanceDrag = 'bright';
    else if ((item.alpha || isBorderKey(apKey())) && inRect(AP_OPACITY, 14)) appearanceDrag = 'opacity';
  }
  if (!triggerHeld && appearanceDrag) {
    appearanceDrag = null;
    saveAppearance();
    drawAppearance(true);
  }
  if (appearanceDrag && hit) applyAppearanceDrag(hit.x, hit.y);
  appearanceTriggerPrev = triggerHeld;
  if ((cubeDirty || dirtyShapes.size) && performance.now() - cubeRebuildAt > 100) flushAppearance();
}

function readXRInput() {
  const session = renderer.xr.getSession();
  if (!session) return { grips: gripHeld, stick: null, rightStick: null, trigger: false, menuButton: false, appearanceButton: false, leftTrigger: false };
  let stick = null;
  let rightStick = null;
  let trigger = false;
  let menuButton = false;
  let appearanceButton = false;
  let leftTrigger = false;
  const leftDown = [];
  const sources = session.inputSources || [];
  for (const source of sources) {
    const gp = source.gamepad;
    if (!gp) continue;
    if (gp.buttons[0] && gp.buttons[0].pressed) trigger = true;
    if (source.handedness === 'right' && gp.buttons[APPEARANCE_BUTTON] && gp.buttons[APPEARANCE_BUTTON].pressed) {
      appearanceButton = true;
    }
    if (source.handedness === 'left') {
      if (gp.buttons[0] && gp.buttons[0].pressed) leftTrigger = true;
      gp.buttons.forEach((b, i) => { if (b.pressed) leftDown.push(i); });
      if (MENU_TOGGLE_BUTTONS.some((i) => gp.buttons[i] && gp.buttons[i].pressed)) menuButton = true;
    }
    if (gp.axes) {
      const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0];
      const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1];
      if (source.handedness === 'right' && typeof ax === 'number' && typeof ay === 'number') rightStick = { x: ax, y: ay };
      // Either thumbstick can roll the cube; use whichever is pushed further.
      if (typeof ax === 'number' && typeof ay === 'number'
        && (!stick || Math.hypot(ax, ay) > Math.hypot(stick.x, stick.y))) {
        stick = { x: ax, y: ay };
      }
    }
  }
  leftButtonsDown = leftDown.join(',');
  return { grips: gripHeld, stick, rightStick, trigger, menuButton, appearanceButton, leftTrigger };
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
  if (levelStartedAt !== null && !win) {
    const elapsed = elapsedLevelSeconds();
    if (elapsed !== displayedElapsedSeconds) {
      displayedElapsedSeconds = elapsed;
      updateHUD();
    }
  }

  // Messages set anywhere are timed here and cleared after a few seconds,
  // except while the level-complete prompt or the exit countdown is showing.
  if (message !== lastMessageSeen) {
    lastMessageSeen = message;
    messageShownAt = performance.now();
  } else if (message && !win && !exitPending && performance.now() - messageShownAt > MESSAGE_SECONDS * 1000) {
    message = '';
    lastMessageSeen = message;
    updateHUD();
  }

  debugTimer += dt;
  if (debugTimer >= DEBUG_SECONDS) { debugTimer = 0; updateDebug(); updateColorTable(); }
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

  if (exitPending) {
    const viewerPosition = renderer.xr.getCamera(camera).getWorldPosition(new THREE.Vector3());
    worldGroup.getWorldPosition(exitMessageMesh.position);
    exitMessageMesh.position.y = viewerPosition.y + EXIT_MESSAGE_RISE;
    exitMessageMesh.lookAt(viewerPosition);
    if (message !== EXIT_MR_MESSAGE) {
      message = EXIT_MR_MESSAGE;
      updateHUD();
    }
    renderer.render(scene, camera);
    return;
  }

  const input = readXRInput();
  const dragging = updateWorldDrag(input);

  if (input.menuButton && !menuPrev) setMenuOpen(!menuOpen);
  menuPrev = input.menuButton;
  if (menuOpen) updateMenuHover();
  if (input.appearanceButton && !appearancePrev) setAppearanceOpen(!appearanceOpen);
  appearancePrev = input.appearanceButton;
  if (appearanceOpen) updateAppearance(input.leftTrigger, input.rightStick);
  const uiOpen = menuOpen || appearanceOpen;

  // Grip held: the stick's forward/back axis tilts the board instead of rolling.
  // Pull back raises the board toward you; push forward lays it flat.
  if (dragging && input.stick && !uiOpen) {
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
  if (!dragging && !roll && !uiOpen) {
    if (input.stick) {
      const mag = Math.hypot(input.stick.x, input.stick.y);
      if (mag < 0.3) { stickReady = true; stickTimer = 0; }
      else if (mag > 0.6) {
        // Fires on the first push, then repeats while held.
        stickTimer -= dt;
        if (stickReady || stickTimer <= 0) {
          stickReady = false;
          stickTimer = STICK_REPEAT_SECONDS;
          if (Math.abs(input.stick.x) > Math.abs(input.stick.y)) {
            tryRoll(input.stick.x > 0 ? 'east' : 'west');
          } else {
            tryRoll(input.stick.y > 0 ? 'south' : 'north');
          }
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
