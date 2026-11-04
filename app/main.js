import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// Import build timestamp (calculated dynamically from file modification dates)
import { BUILD_TIMESTAMP } from './buildTime.js';

// Import configuration
import { GRID, BOARD_SIZE, CELL, CUBE, COLORED_FRACTION, ROLL_SECONDS, START_COL, START_ROW, COLORS, INITIAL_ORIENTATION, HOMES, EXIT_MESSAGE_RISE, ROTATE_GAIN, SCALE_GAIN, TILT_STEP, TILT_MAX, TILT_REPEAT_SECONDS, SKY_RADIUS, SKY_MODES, SKY_MESSAGES, MESSAGE_SECONDS, DEBUG_SECONDS, AP_W, AP_H, AP_SELECT, AP_PARTS, AP_PICKER, AP_BRIGHT, AP_OPACITY, AP_STORAGE_KEY, AP_PANEL_WIDTH, BORDER_WIDTH_MAX, APPEARANCE_REBUILD_MS, SESSION_RECORDS_MAX, BOARD_COLOR, BOARD_OPACITY, CUBE_FACE_BLUE, CUBE_OPACITY, CUBE_EDGE_COLOR, GRID_COLOR, SHAPE_BORDER_COLOR, SHAPE_BORDER_WIDTH } from './config.js';

// Import utilities
import { cellToLocal, keyOf, hsvToRgb, rgbToHex, hsvCss, cssToHsv, apClamp01, formatTime, triggerHaptic } from './utils.js';

// Import state management
import { gameState, resetCubePosition, setLevel, setMessage, setWin, getRoll, setRoll, addSessionRecord, getAppearance, setAppearance, markCubeColorDirty, clearCubeColorDirty, addDirtyCubeShape, clearDirtyCubeShapes, addDirtyShape, clearDirtyShapes } from './state.js';

// Import scene and rendering modules
import { initScene, getRenderer, getScene, getCamera, getWorldGroup, onWindowResize, setAnimationLoop, xrGetSession, xrIsPresenting } from './scene.js';
import { initShapeStyles, shapeStyles, drawIcon, makeIconTexture, redrawIconTexture, createIconTextures, createCubeIconTextures } from './textures.js';
import { createBoardMaterial, createGridMaterial, createIconMaterial, createSkyMaterial, createPanelMaterial, createDebugMaterial } from './materials.js';
import { initCube, getCube, getCubeMaterials, getCubeFaceColorIndices, setCubePosition, resetCubeTransform, getCubePosition, getCubeQuaternion, setCubeQuaternion, applyRollAnimation, setCubeMaterialOpacity } from './cube.js';

// ---------------------------------------------------------------------------
// Cube Game WebXR — v5, 11x11 board
// A horizontal 11x11 board floating in front of the player. Roll a cube with a
// different colour on each face. A square clears only when the cube's
// FACE-DOWN face matches that square's flat icon. Clear all coloured
// squares to finish the level. No timer or lose condition.
// Controls: Quest thumbstick rolls; hold BOTH grips to drag the world
// (translate / yaw-rotate / scale). Desktop: arrows/WASD roll, Q/E rotate,
// +/- scale, N next level, R restart level, 0 reset world transform,
// Ctrl+Arrow moves the world (one cell step, hold to repeat),
// mouse wheel scales the world like +/-.
// ---------------------------------------------------------------------------

// Initialize Three.js scene, camera, renderer
initScene();

const renderer = getRenderer();
const scene = getScene();
const camera = getCamera();
const worldGroup = getWorldGroup();

// Ensure desktop scale is set correctly at startup
worldGroup.scale.setScalar(HOMES.desktop.scale);

function currentHome() {
  return xrGetSession() ? HOMES.mr : HOMES.desktop;
}

// Board and tilt
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TILT_AXIS = new THREE.Vector3(1, 0, 0);
let tiltDeg = 0;
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

// --- Sky ----------------------------------------------------------------------
// NASA SVS "Deep Star Maps 2020" (celestial coordinates, north celestial pole
// up): the whole sky as seen from Earth, on a big sphere inside worldGroup so
// it moves, turns, tilts, and scales with the board. The radius keeps the
// viewer inside the sphere over the whole drag-scale range (x0.4..x2.5) and
// inside the camera far plane. Two versions: "adjusted" (glow removed, stars
// softened and brightened) and "raw" (plain sRGB conversion of the NASA data).
// Resolution is what matters in a headset: 8k when the GPU allows it, else 4k.
const skySuffix = renderer.capabilities.maxTextureSize >= 8192 ? '8k' : '4k';
const skyMaterial = new THREE.MeshBasicMaterial({ depthWrite: false, fog: false });
const skyGeometry = new THREE.SphereGeometry(SKY_RADIUS, 96, 48);
skyGeometry.scale(-1, 1, 1); // flips the faces so the inside shows, with the map the right way round
const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
skyMesh.renderOrder = -1;
skyMesh.visible = false; // until the first texture arrives
worldGroup.add(skyMesh);

let skyMode = 0;
let skyRequest = 0;
// Passthrough needs an immersive-ar session whose display blends with the real world.
function passthroughAvailable() {
  const session = xrIsPresenting() ? xrGetSession() : null;
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
const boardPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(BOARD_SIZE, BOARD_SIZE),
  new THREE.MeshBasicMaterial({ color: BOARD_COLOR, transparent: true, opacity: BOARD_OPACITY, depthWrite: false, side: THREE.DoubleSide })
);
boardPlane.renderOrder = -0.5; // after the sky, before the icons, so it darkens only what is behind the board
boardPlane.rotation.x = -Math.PI / 2;
boardPlane.position.y = 0.001;
worldGroup.add(boardPlane);

const grid = new THREE.GridHelper(BOARD_SIZE, GRID, 0xfff005, 0xfff005);
grid.position.y = 0.005;
worldGroup.add(grid);

// Initialize shape styles and icon textures
initShapeStyles();
const iconTextures = createIconTextures();
const cubeIconTextures = createCubeIconTextures();

// Initialize cube
initCube(cubeIconTextures);
const cube = getCube();
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
let debugVisible = false;
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
  const leftButtons = `Left buttons down: ${leftButtonsDown || '-'}`;
  const rightButtons = `Right buttons down: ${rightButtonsDown || '-'}`;
  return [`Build   ${BUILD_TIMESTAMP}`, `Sky     ${SKY_MODES[skyMode]}`, player, board, pose, leftButtons, rightButtons];
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
    mesh.position.set(p.x, 0.002, p.z);
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
  cube.position.set(p.x, CUBE / 2 + 0.004, p.z);
  cube.quaternion.identity();
  win = false;
  stopCelebration();
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
  const endPos = new THREE.Vector3(endLocal.x, CUBE / 2 + 0.004, endLocal.z);
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

// Pulses controllers in MR; hand is 'left', 'right' or omitted for both.
let lastHapticAt = 0;

// Synthesized click (no audio asset). The context is created and resumed on
// the first user gesture because browsers block audio before that.
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* audio is optional */ }
}
for (const type of ['keydown', 'pointerdown']) window.addEventListener(type, unlockAudio);

function playClick() {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(900, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.03);
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.05);
}

function playSwoop() {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(350, t);
  osc.frequency.exponentialRampToValueAtTime(1400, t + 0.22);
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(0.14, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.28);
}

// --- Level-win celebration: particle burst plus a bouncing status panel ---
const CONFETTI_COUNT = 150;
const CELEBRATE_SECONDS = 2.2;
const confettiPositions = new Float32Array(CONFETTI_COUNT * 3);
const confettiColors = new Float32Array(CONFETTI_COUNT * 3);
const confettiVelocities = new Float32Array(CONFETTI_COUNT * 3);
const confettiGeometry = new THREE.BufferGeometry();
confettiGeometry.setAttribute('position', new THREE.BufferAttribute(confettiPositions, 3));
confettiGeometry.setAttribute('color', new THREE.BufferAttribute(confettiColors, 3));
const confettiSprite = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const confetti = new THREE.Points(confettiGeometry, new THREE.PointsMaterial({
  size: 0.05, map: confettiSprite, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
confetti.frustumCulled = false;
confetti.visible = false;
worldGroup.add(confetti);
let celebrateT = null;

function startCelebration() {
  const tint = new THREE.Color();
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const o = i * 3;
    confettiPositions[o] = (Math.random() - 0.5) * BOARD_SIZE;
    confettiPositions[o + 1] = 0.02;
    confettiPositions[o + 2] = (Math.random() - 0.5) * BOARD_SIZE;
    confettiVelocities[o] = (Math.random() - 0.5) * 0.15;
    confettiVelocities[o + 1] = 0.25 + Math.random() * 0.45;
    confettiVelocities[o + 2] = (Math.random() - 0.5) * 0.15;
    tint.setHex(COLORS[i % COLORS.length].hex);
    confettiColors[o] = tint.r; confettiColors[o + 1] = tint.g; confettiColors[o + 2] = tint.b;
  }
  confettiGeometry.attributes.position.needsUpdate = true;
  confettiGeometry.attributes.color.needsUpdate = true;
  confetti.material.opacity = 1;
  confetti.visible = true;
  celebrateT = 0;
}

function stopCelebration() {
  celebrateT = null;
  confetti.visible = false;
  panel.scale.setScalar(1);
}

function updateCelebration(dt) {
  if (celebrateT === null) return;
  celebrateT += dt;
  if (celebrateT >= CELEBRATE_SECONDS) { stopCelebration(); return; }
  const k = celebrateT / CELEBRATE_SECONDS;
  for (let i = 0; i < CONFETTI_COUNT * 3; i++) confettiPositions[i] += confettiVelocities[i] * dt;
  confettiGeometry.attributes.position.needsUpdate = true;
  confetti.material.opacity = 1 - k * k;
  panel.scale.setScalar(1 + 0.12 * Math.sin(k * Math.PI * 4) * (1 - k));
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
    triggerHaptic(remaining <= 0 ? 1 : 0.8, remaining <= 0 ? 250 : 100);
    playSwoop();
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
      startCelebration();
      message = `Level complete! ${renderer.xr.isPresenting ? 'Pull a trigger' : 'Press N'} for the next level.`;
    } else {
      message = `Matched ${COLORS[orientation.down].name}! ${remaining} left.`;
    }
  } else if (entry) {
    playClick();
    triggerHaptic(0.3, 25);
    message = `Down is ${COLORS[orientation.down].name}, square needs ${COLORS[entry.colorIndex].name}.`;
  } else {
    playClick();
    triggerHaptic(0.3, 25);
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
  unlockAudio();
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
let rightButtonsDown = '';
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
  triggerHaptic(0.4, 40, 'left');
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
let cubeColorDirty = false;
let cubeRebuildAt = 0;
const dirtyShapes = new Set();
const dirtyCubeShapes = new Set();

const apKey = () => AP_ITEMS[appearanceItem].id + AP_ITEMS[appearanceItem].parts[appearancePart].id;
const isBorderKey = (key) => key === 'shapeBorder';

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
    redrawIconTexture(iconTextures[i], shape);
    dirtyCubeShapes.add(shape);
  }
  dirtyShapes.clear();
}
function applyCubeOpacity() {
  const a = appearance.cube.a;
  getCubeMaterials().forEach((mat) => { mat.opacity = a; });
}
function rebuildCubeFaces() {
  const bg = hsvCss(appearance.cube.h, appearance.cube.s, appearance.cube.v);
  const cubeMaterials = getCubeMaterials();
  cubeMaterials.forEach((mat, i) => {
    const shape = COLORS[getCubeFaceColorIndices()[i]].shape;
    if (cubeColorDirty || dirtyCubeShapes.has(shape)) redrawIconTexture(mat.map, shape, bg);
  });
  applyCubeOpacity();
  cubeColorDirty = false;
  dirtyCubeShapes.clear();
  cubeRebuildAt = performance.now();
}
function flushAppearance() {
  if (dirtyShapes.size) rebuildShapeTextures();
  if (cubeColorDirty || dirtyCubeShapes.size) rebuildCubeFaces();
}
// 2D-only table of the current settings, selectable so it can be copied as defaults.
const hudColors = document.getElementById('hudColors');
function updateColorTable() {
  const hex = (t) => hsvCss(t.h, t.s, t.v);
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
cubeColorDirty = true;
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
  const now = performance.now();
  if (now - lastHapticAt > 80) { lastHapticAt = now; triggerHaptic(0.1, 15, 'left'); }
  if (key === 'board') applyBoardAppearance();
  else if (key === 'cube') {
    applyCubeOpacity(); // opacity is a material value, so it updates live without touching textures
    if (appearanceDrag !== 'opacity') cubeColorDirty = true;
  }
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
    triggerHaptic(0.3, 30, 'left');
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
    flushAppearance();
    saveAppearance();
    drawAppearance(true);
  }
  if (appearanceDrag && hit) applyAppearanceDrag(hit.x, hit.y);
  appearanceTriggerPrev = triggerHeld;
  if ((cubeColorDirty || dirtyCubeShapes.size || dirtyShapes.size) && performance.now() - cubeRebuildAt > APPEARANCE_REBUILD_MS) flushAppearance();
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
  const rightDown = [];
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
    if (source.handedness === 'right') {
      gp.buttons.forEach((b, i) => { if (b.pressed) rightDown.push(i); });
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
  rightButtonsDown = rightDown.join(',');
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
  updateCelebration(dt);
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
