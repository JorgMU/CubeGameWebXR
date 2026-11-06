import * as THREE from 'three';

// Build timestamp, computed from file Last-Modified headers (see buildTime.js)
import { BUILD_TIMESTAMP } from './buildTime.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// Import build timestamp (calculated dynamically from file modification dates)

// Import configuration
import { GRID, BOARD_SIZE, CELL, CUBE, COLORED_FRACTION, ROLL_SECONDS, START_COL, START_ROW, COLORS, INITIAL_ORIENTATION, HOMES, EXIT_MESSAGE_RISE, ROTATE_GAIN, SCALE_GAIN, TILT_STEP, TILT_MAX, TILT_REPEAT_SECONDS, SKY_RADIUS, SKY_MODES, SKY_MESSAGES, MESSAGE_SECONDS, DEBUG_SECONDS, AP_W, AP_H, AP_SELECT, AP_PARTS, AP_PICKER, AP_BRIGHT, AP_OPACITY, AP_STORAGE_KEY, AP_PANEL_WIDTH, BORDER_WIDTH_MAX, APPEARANCE_REBUILD_MS, BOARD_COLOR, BOARD_OPACITY, BOARD_ICON_OPACITY, CUBE_FACE_COLOR, CUBE_ICON_OPACITY, CUBE_OPACITY, CUBE_EDGE_COLOR, GRID_COLOR, SHAPE_BORDER_COLOR, SHAPE_BORDER_WIDTH } from './config.js';

// Import utilities
import { cellToLocal, keyOf, hsvCss, cssToHsv, apClamp01, formatTime, triggerHaptic, setHapticGamepad } from './utils.js';

// Import state management
import {
  gameState,
  getLevel, setLevel, nextLevel as incrementLevel,
  getRemaining, setRemaining, getWin, setWin,
  getCubePosition, setCubePosition, getOrientation, setOrientation, resetCubePosition, getLevelStartedAt, setLevelStartedAt,
  setLevelEndedAt,
  getDisplayedElapsedSeconds, setDisplayedElapsedSeconds,
  getLevelScore, setLevelScore,
  elapsedLevelSeconds, resetLevelTiming,
  getRoll, setRoll, clearRoll,
  getPattern, setPattern,
  getIcons, clearIcons, addIcon, removeIcon, getIcon,
  getMessage, setMessage,
  getMessageShownAt, setMessageShownAt,
  getLastMessageSeen, setLastMessageSeen,
  getCubeColorDirty, setCubeColorDirty,
  getDirtyShapes, addDirtyShape, clearDirtyShapes,
  getDirtyCubeShapes, addDirtyCubeShape, clearDirtyCubeShapes,
  getTiltDeg, setTiltDeg,
  getTiltReady, setTiltReady,
  getTiltTimer, setTiltTimer,
  getSkyMode, setSkyMode,
  getSkyRequest, incrementSkyRequest,
  getStickReady, setStickReady,
  getStickTimer, setStickTimer,
  getTriggerPrev, setTriggerPrev,
  getLeftButtonsDown, setLeftButtonsDown,
  getRightButtonsDown, setRightButtonsDown,
  getDrag, setDrag,
  getGripHeld,
  getMenuOpen, setMenuOpen,
  getMenuHover, setMenuHover,
  getMenuPrev, setMenuPrev,
  getExitPending, setExitPending,
  getExitTimer, setExitTimer,
  getDebugVisible, setDebugVisible, getDebugTimer, setDebugTimer,
  getLastHapticAt, setLastHapticAt,
  getAudioCtx, setAudioCtx,
  getCelebrateT, setCelebrateT,
  getAppearance, setAppearance,
  getAppearanceOpen, setAppearanceOpen,
  getAppearanceItem, setAppearanceItem,
  getAppearancePart, setAppearancePart,
  getAppearancePrev, setAppearancePrev,
  getAppearanceTriggerPrev, setAppearanceTriggerPrev,
  getAppearanceDrag, setAppearanceDrag,
  getSessionRecords, addSessionRecord, clearSessionRecords
} from './state.js';

// Import scene and rendering modules
import { initScene, getRenderer, getScene, getCamera, getWorldGroup, xrGetSession, xrIsPresenting } from './scene.js';
import { initShapeStyles, shapeStyles, drawIcon, makeIconTexture, redrawIconTexture, createIconTextures, createCubeIconTextures } from './textures.js';
// (board/grid/panel materials are created inline in main.js, as in the pre-refactor version)
import { initCube, getCube, getCubeMaterials, getCubeShapeMaterials, getCubeFaceColorIndices } from './cube.js';

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
// Tilt is held in state.js only (getTiltDeg/setTiltDeg); no local copy here.

// Tilt about the board's own left-right axis; positive raises the far edge.
function stepTilt(dir) {
  const tiltDeg = getTiltDeg();
  const next = THREE.MathUtils.clamp(tiltDeg + dir * TILT_STEP, 0, TILT_MAX);
  if (next === tiltDeg) return;
  const q = new THREE.Quaternion().setFromAxisAngle(TILT_AXIS, (next - tiltDeg) * Math.PI / 180);
  worldGroup.quaternion.multiply(q);
  const drag = getDrag();
  if (drag) drag.worldQuat.multiply(q);
  setTiltDeg(next);
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


// Passthrough needs an immersive-ar session whose display blends with the real world.
function passthroughAvailable() {
  const session = xrIsPresenting() ? xrGetSession() : null;
  return !!session && session.environmentBlendMode !== undefined && session.environmentBlendMode !== 'opaque';
}
function nextSkyMode() {
  const skyMode = getSkyMode();
  return (skyMode + 1) % (passthroughAvailable() ? SKY_MODES.length : SKY_MODES.length - 1);
}
function loadSky() {
  const skyMode = getSkyMode();
  const request = incrementSkyRequest();
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
    if (request !== getSkyRequest()) { texture.dispose(); return; }
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
  const mode = nextSkyMode();
  setSkyMode(mode);
  loadSky();
  setMessage(`Sky: ${SKY_MESSAGES[mode]}.`);
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

const grid = new THREE.GridHelper(BOARD_SIZE, GRID, GRID_COLOR, GRID_COLOR);
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
cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE, CUBE, CUBE)), cubeEdgeMaterial));
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
// East of the board, centred north-south, with a small gap. Orientation
// is unchanged (long side east-west, text top to the north), so it reads
// the same way from the south as it did on the south edge — it is just
// no longer in front of the player, below the board. Was:
// position.set(0, 0.012, BOARD_SIZE / 2 + debugPanelHeight / 2 + 0.05)
debugPanel.position.set(BOARD_SIZE / 2 + 1.8 / 2 + 0.05, 0.012, 0);
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
  const tiltDeg = getTiltDeg();
  const skyMode = getSkyMode();
  const pose = `Board   yaw ${yawDeg.toFixed(0)}°  tilt ${tiltDeg}° (0 flat, 90 facing you)`;
  const leftButtons = `Left buttons down: ${getLeftButtonsDown() || '-'}`;
  const rightButtons = `Right buttons down: ${getRightButtonsDown() || '-'}`;
  return [`Build   ${BUILD_TIMESTAMP}`, `Sky     ${SKY_MODES[skyMode]}`, player, board, pose, leftButtons, rightButtons];
}

function updateDebug() {
  const lines = debugLines();
  const debugVisible = getDebugVisible();
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
// All state is managed through gameState object via state.js accessor functions

function removeIconMesh(entry) {
  worldGroup.remove(entry.mesh);
  entry.mesh.geometry.dispose();
  entry.mesh.material.dispose();
}

function buildIconsFromPattern() {
  const icons = getIcons();
  // clearIcons() only clears the map; without removing the old meshes first,
  // a rebuild (e.g. entering/leaving MR, which restarts the level) left the
  // old icons in worldGroup underneath the new ones. Matching then removed
  // only the new mesh, so the old one stayed visible while the game logic
  // correctly counted the square as cleared. Remove old meshes first.
  for (const entry of icons.values()) removeIconMesh(entry);
  clearIcons();
  const pattern = getPattern();
  for (const cell of pattern) {
    const geo = new THREE.PlaneGeometry(CELL * 0.85, CELL * 0.85);
    const mat = new THREE.MeshBasicMaterial({ map: iconTextures[cell.colorIndex], transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    const p = cellToLocal(cell.col, cell.row);
    mesh.position.set(p.x, 0.002, p.z);
    worldGroup.add(mesh);
    addIcon(keyOf(cell.col, cell.row), { colorIndex: cell.colorIndex, mesh });
  }
  applyBoardIconOpacity();
  setRemaining(pattern.length);
}

function nextLevel() {
  incrementLevel();
  generateLevel();
}

function generateLevel() {
  const pattern = [];
  for (let col = 0; col < GRID; col++) {
    for (let row = 0; row < GRID; row++) {
      if (col === START_COL && row === START_ROW) continue; // start square stays blank
      if (Math.random() < COLORED_FRACTION) {
        pattern.push({ col, row, colorIndex: Math.floor(Math.random() * COLORS.length) });
      }
    }
  }
  // Guarantee a meaningful level even on an unlucky roll.
  while (pattern.length < 6) {
    const col = Math.floor(Math.random() * GRID);
    const row = Math.floor(Math.random() * GRID);
    if (col === START_COL && row === START_ROW) continue;
    if (pattern.some((c) => c.col === col && c.row === row)) continue;
    pattern.push({ col, row, colorIndex: Math.floor(Math.random() * COLORS.length) });
  }
  setPattern(pattern);
  resetCubeAndWin(false);
  buildIconsFromPattern();
  const level = getLevel();
  const remaining = getRemaining();
  setMessage(`Level ${level}: clear ${remaining} coloured squares.`);
  updateHUD();
}

function resetCubeAndWin(isRestart) {
  clearRoll();
  resetCubePosition(START_COL, START_ROW, INITIAL_ORIENTATION);
  const p = cellToLocal(START_COL, START_ROW);
  cube.position.set(p.x, CUBE / 2 + 0.004, p.z);
  cube.quaternion.identity();
  setWin(false);
  stopCelebration();
  resetLevelTiming();
  if (isRestart) {
    const level = getLevel();
    setMessage(`Level ${level} restarted.`);
  }
}

function restartLevel() {
  resetCubeAndWin(true);
  buildIconsFromPattern();
  updateHUD();
}

// --- HUD ----------------------------------------------------------------------
const hud = document.getElementById('hud');
const hudLevel = document.getElementById('hudLevel');
const hudRemaining = document.getElementById('hudRemaining');
const hudDown = document.getElementById('hudDown');
const hudTime = document.getElementById('hudTime');
const hudScore = document.getElementById('hudScore');
const hudMessage = document.getElementById('hudMessage');
const hudBuildTimestamp = document.getElementById('hudBuildTimestamp');
const hudRecords = document.getElementById('hudRecords');

function updateHUD() {
  const level = getLevel();
  const remaining = getRemaining();
  const levelStartedAt = getLevelStartedAt();
  const levelScore = getLevelScore();
  const orientation = getOrientation();
  const message = getMessage();
  
  hudLevel.textContent = String(level);
  hudRemaining.textContent = String(remaining);
  hudTime.textContent = levelStartedAt === null ? 'Ready' : formatTime(elapsedLevelSeconds());
  hudScore.textContent = String(levelScore);
  hudBuildTimestamp.textContent = `Build: ${BUILD_TIMESTAMP}`;
  const down = COLORS[orientation.down];
  hudDown.textContent = down.name;
  hudDown.style.color = down.css;
  hudMessage.textContent = message;
  drawStatusPanel(level, remaining, levelStartedAt, levelScore, down, message);
}

// In-world panel: text only, no background fill and no border.
function drawStatusPanel(level, remaining, levelStartedAt, levelScore, down, message) {
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

function clearScores() {
  clearSessionRecords();
  updateSessionRecords();
  setMessage('Scores cleared.');
}

function updateSessionRecords() {
  const sessionRecords = getSessionRecords();
  hudRecords.replaceChildren();
  if (!sessionRecords.length) {
    const row = hudRecords.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.textContent = 'Complete a level to add a record.';
  }
  for (const record of sessionRecords) {
    const row = hudRecords.insertRow();
    [record.level, record.score, formatTime(record.elapsedSeconds), record.completedAt]
      .forEach((value) => { row.insertCell().textContent = String(value); });
  }
  drawScoresPanel(sessionRecords);
}
// Populate both the HUD table and the in-world scores panel from the
// persisted records (if any) on load — not just after the first win.
updateSessionRecords();

// --- Rolling ------------------------------------------------------------------

function tryRoll(dir) {
  const roll = getRoll();
  const win = getWin();
  if (roll || win) return;
  
  let dCol = 0, dRow = 0, axis = null, totalAngle = 0;
  if (dir === 'east') { dCol = 1; axis = new THREE.Vector3(0, 0, 1); totalAngle = -Math.PI / 2; }
  if (dir === 'west') { dCol = -1; axis = new THREE.Vector3(0, 0, 1); totalAngle = Math.PI / 2; }
  if (dir === 'north') { dRow = -1; axis = new THREE.Vector3(1, 0, 0); totalAngle = -Math.PI / 2; }
  if (dir === 'south') { dRow = 1; axis = new THREE.Vector3(1, 0, 0); totalAngle = Math.PI / 2; }
  
  const pos = getCubePosition();
  const destCol = pos.col + dCol;
  const destRow = pos.row + dRow;
  if (destCol < 0 || destCol >= GRID || destRow < 0 || destRow >= GRID) {
    setMessage('Edge — can\'t roll that way.');
    updateHUD();
    return;
  }
  
  let levelStartedAt = getLevelStartedAt();
  if (levelStartedAt === null) {
    levelStartedAt = performance.now();
    setLevelStartedAt(levelStartedAt);
    setDisplayedElapsedSeconds(0);
    updateHUD();
  }
  
  const startPos = cube.position.clone();
  const endLocal = cellToLocal(destCol, destRow);
  const endPos = new THREE.Vector3(endLocal.x, CUBE / 2 + 0.004, endLocal.z);
  const edge = new THREE.Vector3((startPos.x + endPos.x) / 2, 0, (startPos.z + endPos.z) / 2);
  
  const newRoll = {
    t: 0, axis, totalAngle, edge,
    startOffset: startPos.clone().sub(edge),
    startQuat: cube.quaternion.clone(),
    endPos, dir, destCol, destRow,
  };
  setRoll(newRoll);
}

function applyOrientationAfterRoll(dir) {
  const o = getOrientation();
  let newOrient;
  if (dir === 'east') newOrient = { ...o, down: o.east, east: o.up, up: o.west, west: o.down };
  if (dir === 'west') newOrient = { ...o, down: o.west, west: o.up, up: o.east, east: o.down };
  if (dir === 'north') newOrient = { ...o, down: o.north, north: o.up, up: o.south, south: o.down };
  if (dir === 'south') newOrient = { ...o, down: o.south, south: o.up, up: o.north, north: o.down };
  setOrientation(newOrient);
}

// Synthesized click (no audio asset). The context is created and resumed on
// the first user gesture because browsers block audio before that.
function unlockAudio() {
  try {
    let ctx = getAudioCtx();
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      setAudioCtx(ctx);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* audio is optional */ }
}
for (const type of ['keydown', 'pointerdown']) window.addEventListener(type, unlockAudio);

function playClick() {
  const audioCtx = getAudioCtx();
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
  const audioCtx = getAudioCtx();
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
  setCelebrateT(0);
}

function stopCelebration() {
  setCelebrateT(null);
  confetti.visible = false;
  panel.scale.setScalar(1);
}

function updateCelebration(dt) {
  const celebrateT = getCelebrateT();
  if (celebrateT === null) return;
  const newCelebrateT = celebrateT + dt;
  if (newCelebrateT >= CELEBRATE_SECONDS) { stopCelebration(); return; }
  const k = newCelebrateT / CELEBRATE_SECONDS;
  for (let i = 0; i < CONFETTI_COUNT * 3; i++) confettiPositions[i] += confettiVelocities[i] * dt;
  confettiGeometry.attributes.position.needsUpdate = true;
  confetti.material.opacity = 1 - k * k;
  panel.scale.setScalar(1 + 0.12 * Math.sin(k * Math.PI * 4) * (1 - k));
  setCelebrateT(newCelebrateT);
}

function finishRoll() {
  const roll = getRoll();
  const pos = { col: roll.destCol, row: roll.destRow };
  setCubePosition(pos.col, pos.row);
  cube.position.copy(roll.endPos);
  const endQuat = new THREE.Quaternion().setFromAxisAngle(roll.axis, roll.totalAngle).multiply(roll.startQuat);
  cube.quaternion.copy(endQuat);
  const dir = roll.dir;
  clearRoll();
  applyOrientationAfterRoll(dir);
  
  const keyStr = keyOf(pos.col, pos.row);
  const entry = getIcon(keyStr);
  const orientation = getOrientation();
  
  if (entry && entry.colorIndex === orientation.down) {
    const matchAt = performance.now();
    removeIconMesh(entry);
    removeIcon(keyStr);
    
    let remaining = getRemaining();
    remaining -= 1;
    setRemaining(remaining);
    
    let levelScore = getLevelScore();
    levelScore += Math.max(0, 180 - elapsedLevelSeconds(matchAt));
    setLevelScore(levelScore);
    
    triggerHaptic(remaining <= 0 ? 1 : 0.8, remaining <= 0 ? 250 : 100);
    playSwoop();
    
    if (remaining <= 0) {
      setWin(true);
      setLevelEndedAt(matchAt);
      addSessionRecord({
        level: getLevel(),
        score: levelScore,
        elapsedSeconds: elapsedLevelSeconds(matchAt),
        completedAt: new Date().toLocaleDateString(),
      });
      updateSessionRecords();
      startCelebration();
      setMessage(`Level complete! ${renderer.xr.isPresenting ? 'Pull a trigger' : 'Press N'} for the next level.`);
    } else {
      setMessage(`Matched ${COLORS[orientation.down].name}! ${remaining} left.`);
    }
  } else if (entry) {
    playClick();
    triggerHaptic(0.3, 25);
    setMessage(`Down is ${COLORS[orientation.down].name}, square needs ${COLORS[entry.colorIndex].name}.`);
  } else {
    playClick();
    triggerHaptic(0.3, 25);
    setMessage('Blank square.');
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
  else if (k === 'p') { setDebugVisible(!getDebugVisible()); updateDebug(); updateColorTable(); }
  else if (k === 'c') clearScores(); // clear the persisted top-10 scores (no undo)
  else if (k === 'h') { hud.style.display = hud.style.display === 'none' ? '' : 'none'; } // H: hide/show the top-left HUD panel (2D mode). Was Space; Space is the standard key for activating a focused control, so it is left free for that.
  else if (k === 't') stepTilt(e.shiftKey ? -1 : 1); // desktop tilt: T up, Shift+T down (was missing in 2D mode)
  else if (k === 'k') toggleSky();
  else if (k === '0') {
    if (renderer.xr.isPresenting) { resetWorldForMR(); return; }
    worldGroup.position.copy(HOMES.desktop.position);
    worldGroup.quaternion.copy(homeQuat(HOMES.desktop));
    setTiltDeg(HOMES.desktop.tilt);
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
document.getElementById('btnDebug').addEventListener('click', () => { setDebugVisible(!getDebugVisible()); updateDebug(); updateColorTable(); });
document.getElementById('btnClearScores').addEventListener('click', clearScores);
document.getElementById('btnForceRefresh').addEventListener('click', () => { const url = new URL(location.href); url.searchParams.set('fresh', String(Date.now())); location.href = url.toString(); });

// --- Copy settings (2D only) ------------------------------------------------
// A 2D HUD button that copies the current settings as one JSONC object:
// boardLayout, boardHome_2D, boardHome_MR, appearance, skybox. Colours are hex, as in
// config.js, so the dump pastes straight into a settings file. In 2D the
// page is focused and the click is a user gesture, so
// navigator.clipboard.writeText() works there — inside an immersive
// session it does not reliably (no page focus, and a controller trigger
// is not the gesture the browser wants), which is why this button lives
// in the 2D HUD only and there is no in-headset copy.
// If the clipboard write fails (or the API is unavailable), the dump is
// shown in a textbox instead — the pattern other pages use with an
// iframe + textbox + copy button, done here as a plain overlay because
// no iframe is needed on the same page — with its own Copy button
// (clipboard API, then the old textarea/execCommand fallback) and Close.
const copyOverlay = document.getElementById('copyOverlay');
const copyText = document.getElementById('copyText');

function buildSettingsDump() {
  const ap = getAppearance();
  const hex = (e) => hsvCss(e.h, e.s, e.v);
  const d = HOMES.desktop, m = HOMES.mr;
  const orientation = getOrientation();
  // JSONC: JSON with // comments. JSON.stringify cannot emit comments, so
  // each section is stringified on its own and the comment lines are
  // added around it. The result still parses as JSON once the comment
  // lines are stripped, and it is the shape a config.jsonc file would use.
  const ind = (v, n) => JSON.stringify(v, null, 2).split('\n').join('\n' + ' '.repeat(n));
  const settings = {
    boardLayout: {
      grid: GRID,
      boardSize: BOARD_SIZE,
      coloredFraction: COLORED_FRACTION,
      rollSeconds: ROLL_SECONDS,
    },
    boardHome_2D: {
      position: { x: d.position.x, y: d.position.y, z: d.position.z },
      tilt: d.tilt,
      scale: d.scale,
    },
    boardHome_MR: {
      position: { x: m.position.x, y: m.position.y, z: m.position.z },
      tilt: m.tilt,
      scale: m.scale,
    },
    appearance: {
      board: { color: hex(ap.board), opacity: ap.board.a },
      boardIcons: { opacity: ap.boardIcons.a },
      cube: { color: hex(ap.cube), opacity: ap.cube.a },
      cubeIcons: { opacity: ap.cubeIcons.a },
      grid: { color: hex(ap.grid) },
      edges: { color: hex(ap.edges) },
      shapeBorder: { color: hex(ap.shapeBorder), width: ap.shapeBorder.w },
      ...Object.fromEntries(COLORS.map((col) => [col.shape, { fill: hex(ap[`${col.shape}.fill`]) }])),
    },
    skybox: {
      mode: SKY_MODES[getSkyMode()],
      modes: SKY_MODES,
      passthroughAvailable: passthroughAvailable(),
    },
  };
  const lines = [];
  lines.push('// CubeGameWebXR settings — copied ' + new Date().toISOString());
  lines.push('// Build: ' + BUILD_TIMESTAMP + ' — Level ' + getLevel() + ', ' + getRemaining() + ' remaining, face down ' + COLORS[orientation.down].name);
  lines.push('// These are the live values (saved appearance included). Paste into');
  lines.push('// app/config.jsonc to make them the defaults — but note the saved');
  lines.push('// appearance in this browser still wins until it is cleared.');
  lines.push('{');
  lines.push('  // Board layout — geometry shared by 2D and MR');
  lines.push('  "boardLayout": ' + ind(settings.boardLayout, 2) + ',');
  lines.push('  // Board home, 2D (desktop browser)');
  lines.push('  "boardHome_2D": ' + ind(settings.boardHome_2D, 2) + ',');
  lines.push('  // Board home, MR (Quest passthrough)');
  lines.push('  "boardHome_MR": ' + ind(settings.boardHome_MR, 2) + ',');
  lines.push('  // Appearance — everything editable from the B-button panel. Colours are hex, opacity 0–1.');
  lines.push('  // boardIcons / cubeIcons are opacity-only: their shapes take their colour from the Fill items.');
  lines.push('  "appearance": ' + ind(settings.appearance, 2) + ',');
  lines.push('  // Skybox — Passthrough only exists inside an MR session; leaving a session resets it to Adjusted');
  lines.push('  "skybox": ' + ind(settings.skybox, 2));
  lines.push('}');
  return lines.join('\n');
}

function openCopyOverlay(text) {
  copyText.value = text;
  copyOverlay.classList.add('open');
  copyText.focus();
  copyText.select();
}

function closeCopyOverlay() {
  copyOverlay.classList.remove('open');
}

async function copyTextFromOverlay() {
  const text = copyText.value;
  const done = () => { closeCopyOverlay(); setMessage('Settings copied to clipboard.'); updateHUD(); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); done(); return; } catch (e) { /* fall through */ }
  }
  try {
    copyText.focus();
    copyText.select();
    if (document.execCommand('copy')) { done(); return; }
  } catch (e) { /* fall through */ }
  setMessage('Copy failed — select the text and copy it by hand.');
  updateHUD();
}

async function copySettingsDump() {
  const text = buildSettingsDump();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Settings copied to clipboard.');
      updateHUD();
      return;
    } catch (e) { /* fall through to the textbox */ }
  }
  openCopyOverlay(text);
  setMessage('Clipboard write failed — copy the text from the box.');
  updateHUD();
}
document.getElementById('btnCopySettings').addEventListener('click', copySettingsDump);
document.getElementById('btnCopyText').addEventListener('click', copyTextFromOverlay);
document.getElementById('btnCopyClose').addEventListener('click', closeCopyOverlay);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && copyOverlay.classList.contains('open')) closeCopyOverlay(); });

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

const STICK_REPEAT_SECONDS = 0.125; // one square per twentieth of a second while the stick is held
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpMid = new THREE.Vector3();

// Grip state comes from each controller's own squeeze events, so it always
// matches the controller object whose position the world drag reads.
const gripHeld = getGripHeld(); // state.js array, single source of truth
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
  setTiltDeg(home.tilt);
  worldGroup.scale.setScalar(home.scale);
}
// 2D start: apply the desktop home pose. initScene() sets the position
// and scale, but not the tilt — without this the board would start flat
// even though HOMES.desktop.tilt is 20, and the first T press would
// jump from 0. MR is unaffected: sessionstart calls resetWorldForMR()
// with the MR home.
if (!renderer.xr.isPresenting) {
  worldGroup.quaternion.copy(homeQuat(HOMES.desktop));
  setTiltDeg(HOMES.desktop.tilt);
}
renderer.xr.addEventListener('sessionstart', () => {
  unlockAudio();
  // Start clean: a menu/appearance panel left visible by a previous session
  // must not already be up (and hovered) on relaunch, or the first trigger
  // press will immediately activate whatever row it was pointing at.
  setMenuOpenLocal(false);
  setAppearanceOpenLocal(false);
  setMenuPrev(false);
  setAppearancePrev(false);
  setTriggerPrev(false);
  resetWorldForMR();
  restartLevel(); // entering or leaving MR restarts the current board
});
renderer.xr.addEventListener('sessionend', () => {
  const exitTimer = getExitTimer();
  if (exitTimer !== null) window.clearTimeout(exitTimer);
  setExitTimer(null);
  gripHeld.fill(false); setDrag(null); setExitPending(false);
  exitMessageMesh.visible = false;
  if (getSkyMode() === 3) { setSkyMode(0); loadSky(); } // passthrough only exists inside the session
  // Use the Local closers, not the state-only setters: they hide the meshes
  // and pointer line and reset hover to -1. setMenuOpen(false) alone left
  // menuMesh.visible true and the old hover (e.g. Exit MR) intact, so the
  // menu was still up on relaunch and the next trigger press re-activated it.
  setMenuOpenLocal(false);
  setAppearanceOpenLocal(false);
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
let menuHover = -1; // -1 none, 0 Debug, 1 Sky, 2 Reset view, 3 Exit MR
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
  const menuHover = getMenuHover();
  const debugVisible = getDebugVisible();
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

function setMenuOpenLocal(open) {
  if (open && getAppearanceOpen()) setAppearanceOpenLocal(false);
  const newMenuOpen = open && !!leftController;
  setMenuOpen(newMenuOpen);
  menuMesh.visible = newMenuOpen;
  pointerLine.visible = newMenuOpen && !!rightController;
  setMenuHover(-1);
  if (newMenuOpen) drawMenu();
}

const menuRaycaster = new THREE.Raycaster();
const menuRayDir = new THREE.Vector3();
const menuRayQuat = new THREE.Quaternion();

function updateMenuHover() {
  let hover = -1;
  const menuOpenState = getMenuOpen();
  if (menuOpenState && rightController) {
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
  const menuHover = getMenuHover();
  if (hover !== menuHover) { setMenuHover(hover); drawMenu(); }
}

function activateMenuItem() {
  const menuOpenState = getMenuOpen();
  if (!menuOpenState) return;
  const selected = getMenuHover();
  if (selected < 0) return;
  triggerHaptic(0.4, 40, 'left');
  setMenuOpenLocal(false);
  if (selected === 0) {
    setDebugVisible(!getDebugVisible());
    updateDebug();
  } else if (selected === 1) {
    toggleSky();
  } else if (selected === 2) {
    const home = currentHome();
    const atHome = worldGroup.position.distanceTo(home.position) < 0.005
      && Math.abs(worldGroup.scale.x - home.scale) < 0.005
      && worldGroup.quaternion.angleTo(homeQuat(home)) < 0.005;
    if (atHome) setMessage('View is already at the home position.');
    else { resetWorldForMR(); setMessage('View reset.'); }
    updateHUD();
  } else if (selected === 3) {
    const session = renderer.xr.getSession();
    if (session) {
      setExitPending(true);
      setMessage(EXIT_MR_MESSAGE);
      exitMessageMesh.visible = true;
      updateHUD();
      const timer = window.setTimeout(() => {
        setExitTimer(null);
        if (renderer.xr.getSession() !== session) return;
        session.end().catch((error) => {
          setExitPending(false);
          exitMessageMesh.visible = false;
          setMessage(`Could not exit MR: ${error instanceof Error ? error.message : String(error)}`);
          updateHUD();
        });
      }, EXIT_MR_DELAY_MS);
      setExitTimer(timer);
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
  // Board icons have no colour of their own — each shape's colour comes
  // from its Fill item — so this item is opacity-only: no picker, no
  // brightness slider (see drawAppearance/drawAppearanceBase).
  { id: 'boardIcons', label: 'Board icons', parts: [{ id: '', label: 'Icons' }], alpha: true, opacityOnly: true },
  { id: 'cube', label: 'Cube faces', parts: [{ id: '', label: 'Face colour' }], alpha: true },
  { id: 'cubeIcons', label: 'Cube icons', parts: [{ id: '', label: 'Icons' }], alpha: true, opacityOnly: true },
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
  boardIcons: { h: 0, s: 0, v: 1, a: BOARD_ICON_OPACITY },
  cube: { ...cssToHsv(CUBE_FACE_COLOR), a: CUBE_OPACITY },
  cubeIcons: { h: 0, s: 0, v: 1, a: CUBE_ICON_OPACITY },
  grid: { ...cssToHsv(`#${GRID_COLOR.toString(16).padStart(6, '0')}`), a: 1 },
  edges: { ...cssToHsv(CUBE_EDGE_COLOR), a: 1 },
};
for (const col of COLORS) {
  appearance[`${col.shape}.fill`] = { ...cssToHsv(col.css), a: 1 };
}
appearance.shapeBorder = { ...cssToHsv(SHAPE_BORDER_COLOR), a: 1, w: SHAPE_BORDER_WIDTH };
try {
  const saved = JSON.parse(localStorage.getItem(AP_STORAGE_KEY));
  const isOldCubeDefault = saved && saved.cube && (
    // Old green background default (#036500), or fixed8's white icon default.
    (Math.abs(saved.cube.h - 120) < 1 && Math.abs(saved.cube.s - 1) < 0.05 && Math.abs(saved.cube.v - 0.396) < 0.02) ||
    (Math.abs(saved.cube.s) < 0.05 && Math.abs(saved.cube.v - 1) < 0.02)
  );
  if (isOldCubeDefault) {
    // Both were defaults for the wrong layer: green hid the green triangle
    // as a background, white as a background would hide the yellow star.
    // Reset to the new dark-grey default, keeping opacity.
    saved.cube = { ...cssToHsv(CUBE_FACE_COLOR), a: saved.cube.a };
  }
  for (const key of Object.keys(appearance)) {
    if (saved && saved[key] && ['h', 's', 'v', 'a'].every((k) => Number.isFinite(saved[key][k]))) {
      Object.assign(appearance[key], saved[key]);
    }
  }
  // Saves from before the split have no cubeIcons entry, and their shapes
  // rendered at the face opacity — keep that as the shape opacity rather
  // than the fresh default, so the cube looks the same as before. Only
  // when a save exists: a fresh load (no save) must keep the config
  // default instead.
  if (saved && !saved.cubeIcons) appearance.cubeIcons.a = appearance.cube.a;
  if (!Number.isFinite(appearance.shapeBorder.w)) appearance.shapeBorder.w = SHAPE_BORDER_WIDTH;
} catch { /* ignore bad or unavailable storage */ }
setAppearance(appearance);

const apKey = () => {
  const item = getAppearanceItem();
  const part = getAppearancePart();
  return AP_ITEMS[item].id + AP_ITEMS[item].parts[part].id;
};
const isBorderKey = (key) => key === 'shapeBorder';

function applyBoardAppearance() {
  const appearance = getAppearance();
  const b = appearance.board;
  boardPlane.material.color.set(hsvCss(b.h, b.s, b.v));
  boardPlane.material.opacity = b.a;
}
function applyBoardIconOpacity() {
  const a = getAppearance().boardIcons.a;
  for (const entry of getIcons().values()) entry.mesh.material.opacity = a;
}
function applyLineColors() {
  const appearance = getAppearance();
  const g = appearance.grid, e = appearance.edges;
  // GridHelper bakes its colours into the geometry's vertex colours and
  // its material colour only multiplies them — so setting material.color
  // alone did nothing while the baked colour was black (black x green
  // is still black). That is why a grid colour change showed in the
  // debug table but the lines stayed black. Update the vertex colours
  // themselves, and reset material.color to white so they show true.
  const c = new THREE.Color(hsvCss(g.h, g.s, g.v));
  const colors = grid.geometry.attributes.color;
  for (let i = 0; i < colors.count; i++) colors.setXYZ(i, c.r, c.g, c.b);
  colors.needsUpdate = true;
  grid.material.color.set(0xffffff);
  cubeEdgeMaterial.color.set(hsvCss(e.h, e.s, e.v));
}
function applyShapeStyles() {
  const appearance = getAppearance();
  const b = appearance.shapeBorder;
  for (const col of COLORS) {
    const f = appearance[`${col.shape}.fill`];
    shapeStyles[col.shape] = { fill: hsvCss(f.h, f.s, f.v), border: hsvCss(b.h, b.s, b.v), width: b.w };
  }
}
function rebuildShapeTextures() {
  const dirtyShapes = getDirtyShapes();
  const dirtyCubeShapes = getDirtyCubeShapes();
  for (const shape of dirtyShapes) {
    const i = COLORS.findIndex((col) => col.shape === shape);
    redrawIconTexture(iconTextures[i], shape);
    addDirtyCubeShape(shape);
  }
  clearDirtyShapes();
}
function applyCubeOpacity() {
  const appearance = getAppearance();
  const a = appearance.cube.a;
  getCubeMaterials().forEach((mat) => {
    mat.opacity = a;
    mat.transparent = a < 1;
    mat.side = a < 1 ? THREE.DoubleSide : THREE.FrontSide;
    mat.depthWrite = a >= 1;
    mat.needsUpdate = true;
  });
  // Shapes keep their own opacity; only their side follows the face mode
  // (DoubleSide while transparent so far shapes show through, FrontSide
  // when solid so they are culled with the faces).
  getCubeShapeMaterials().forEach((mat) => {
    mat.side = a < 1 ? THREE.DoubleSide : THREE.FrontSide;
    mat.needsUpdate = true;
  });
}
function applyCubeShapeOpacity() {
  const a = getAppearance().cubeIcons.a;
  getCubeShapeMaterials().forEach((mat) => { mat.opacity = a; mat.needsUpdate = true; });
}
function rebuildCubeFaces() {
  const appearance = getAppearance();
  // Face backgrounds are plain colours now (no map); the shapes live on
  // their own planes just outside the faces (see cube.js), so the two
  // opacities are independent. A background-colour change only re-tints
  // the face materials; only a shape-colour change redraws a shape
  // texture — and it is redrawn without a background, so the face
  // colour shows through it.
  const bg = hsvCss(appearance.cube.h, appearance.cube.s, appearance.cube.v);
  getCubeMaterials().forEach((mat) => mat.color.set(bg));
  const dirtyCubeShapes = getDirtyCubeShapes();
  getCubeShapeMaterials().forEach((mat, i) => {
    const shape = COLORS[getCubeFaceColorIndices()[i]].shape;
    if (dirtyCubeShapes.has(shape)) redrawIconTexture(mat.map, shape);
  });
  applyCubeOpacity();
  setCubeColorDirty(false);
  clearDirtyCubeShapes();
}
function flushAppearance() {
  const dirtyShapes = getDirtyShapes();
  const dirtyCubeShapes = getDirtyCubeShapes();
  const cubeColorDirty = getCubeColorDirty();
  if (dirtyShapes.size) rebuildShapeTextures();
  if (cubeColorDirty || dirtyCubeShapes.size) rebuildCubeFaces();
}
function updateColorTable() {
  const appearance = getAppearance();
  const debugVisible = getDebugVisible();
  const hex = (t) => hsvCss(t.h, t.s, t.v);
  const rows = ['Item           Color    Opacity Border'];
  for (const [key, t] of Object.entries(appearance)) {
    const alpha = key === 'board' || key === 'cube' || key === 'boardIcons' || key === 'cubeIcons' ? `${Math.round(t.a * 100)}%` : '-';
    const width = isBorderKey(key) ? `${Math.round(t.w)}px` : '-';
    const color = key === 'boardIcons' || key === 'cubeIcons' ? '-' : hex(t);
    rows.push(`${key.padEnd(14)} ${color} ${alpha.padEnd(7)} ${width}`);
  }
  hudColors.textContent = rows.join('\n');
  hudColors.style.display = debugVisible ? 'block' : 'none';
}
function saveAppearance() {
  const appearance = getAppearance();
  try { localStorage.setItem(AP_STORAGE_KEY, JSON.stringify(appearance)); } catch { /* ignore */ }
}

const hudColors = document.getElementById('hudColors');
applyShapeStyles();
applyBoardAppearance();
applyCubeShapeOpacity(); // migrated saves may carry a different shape opacity than the fresh default
applyLineColors();
for (const col of COLORS) addDirtyShape(col.shape);
setCubeColorDirty(true);
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
  const appearanceItem = getAppearanceItem();
  const appearancePart = getAppearancePart();
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
  if (item.opacityOnly) { appearanceBaseItem = appearanceItem; appearanceBasePart = appearancePart; return; }
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
  const appearanceItem = getAppearanceItem();
  const appearancePart = getAppearancePart();
  // The base (dark background, header, part row, picker gradient) was never
  // drawn in the refactored version, so only the sliders showed -- exactly
  // the cropped-looking panel in the screenshot, with the picker circle
  // floating over the stars. Restore the base draw when item/part changes.
  if (appearanceBaseItem !== appearanceItem || appearanceBasePart !== appearancePart) drawAppearanceBase();
  const item = AP_ITEMS[appearanceItem];
  const appearance = getAppearance();
  const t = appearance[apKey()];
  const p = AP_PICKER;
  apCtx.clearRect(0, 0, AP_W, AP_H);
  apCtx.drawImage(appearanceBaseCanvas, 0, 0);
  if (!item.opacityOnly) {
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
  }
  if (item.alpha) drawSlider(AP_OPACITY, `Opacity ${Math.round(t.a * 100)}%`, t.a, item.opacityOnly ? '#404050' : hsvCss(t.h, t.s, t.v));
  if (isBorderKey(apKey())) drawSlider(AP_OPACITY, `Border width ${Math.round(t.w)}`, t.w / BORDER_WIDTH_MAX, '#404050');
  appearanceTexture.needsUpdate = true;
}

function setAppearanceOpenLocal(open) {
  const newAppearanceOpen = open && !!rightController && !!leftController;
  setAppearanceOpen(newAppearanceOpen);
  if (newAppearanceOpen && getMenuOpen()) setMenuOpenLocal(false);
  appearanceMesh.visible = newAppearanceOpen;
  appearanceLine.visible = newAppearanceOpen;
  setAppearanceDrag(null);
  if (newAppearanceOpen) drawAppearance(true);
  else flushAppearance();
}

function applyAppearanceDrag(px, py) {
  const key = apKey();
  const appearance = getAppearance();
  const t = appearance[key];
  let changed = false;
  const appearanceDrag = getAppearanceDrag();
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
  const lastHapticAt = getLastHapticAt();
  if (now - lastHapticAt > 80) { setLastHapticAt(now); triggerHaptic(0.1, 15, 'left'); }
  if (key === 'board') applyBoardAppearance();
  else if (key === 'boardIcons') applyBoardIconOpacity();
  else if (key === 'cube') {
    applyCubeOpacity();
    if (appearanceDrag !== 'opacity') setCubeColorDirty(true);
  }
  else if (key === 'cubeIcons') applyCubeShapeOpacity();
  else if (key === 'grid' || key === 'edges') applyLineColors();
  else {
    applyShapeStyles();
    if (isBorderKey(key)) for (const col of COLORS) addDirtyShape(col.shape);
    else addDirtyShape(key.split('.')[0]);
  }
  drawAppearance();
}

function stepAppearanceSelection(dir) {
  flushAppearance();
  const item = AP_ITEMS[getAppearanceItem()];
  let newPart = getAppearancePart() + dir;
  let newItem = getAppearanceItem();
  if (newPart >= item.parts.length) {
    newItem = (newItem + 1) % AP_ITEMS.length;
    newPart = 0;
  } else if (newPart < 0) {
    newItem = (newItem - 1 + AP_ITEMS.length) % AP_ITEMS.length;
    newPart = AP_ITEMS[newItem].parts.length - 1;
  }
  setAppearanceItem(newItem);
  setAppearancePart(newPart);
  drawAppearance(true);
}

function updateAppearance(triggerHeld, rightStick) {
  const sx = rightStick ? rightStick.x : 0;
  let appearanceStickReady = getStickReady(); // Reuse stick ready state or create separate one
  if (Math.abs(sx) < 0.3) {
    // Reset when stick is released
  } else if (Math.abs(sx) > 0.6 && appearanceStickReady) {
    setStickReady(false);
    stepAppearanceSelection(sx > 0 ? 1 : -1);
  }
  if (Math.abs(sx) < 0.3) setStickReady(true);
  
  let hit = null;
  scene.updateMatrixWorld();
  leftController.getWorldPosition(menuRaycaster.ray.origin);
  leftController.getWorldQuaternion(menuRayQuat);
  menuRaycaster.ray.direction.copy(menuRayDir.set(0, 0, -1).applyQuaternion(menuRayQuat));
  const h = menuRaycaster.intersectObject(appearanceMesh)[0];
  if (h && h.uv) hit = { x: h.uv.x * AP_W, y: (1 - h.uv.y) * AP_H };

  const appearanceTriggerPrev = getAppearanceTriggerPrev();
  if (triggerHeld && !appearanceTriggerPrev && hit) {
    triggerHaptic(0.3, 30, 'left');
    const item = AP_ITEMS[getAppearanceItem()];
    const inRect = (r, pad) => hit.x >= r.x && hit.x <= r.x + r.w && hit.y >= r.y - pad && hit.y <= r.y + r.h + pad;
    if (hit.y >= AP_SELECT.y && hit.y <= AP_SELECT.y + AP_SELECT.h) {
      const step = hit.x < 256 ? -1 : 1;
      flushAppearance();
      let newItem = (getAppearanceItem() + step + AP_ITEMS.length) % AP_ITEMS.length;
      setAppearanceItem(newItem);
      setAppearancePart(0);
      drawAppearance(true);
    } else if (hit.y >= AP_PARTS.y && hit.y <= AP_PARTS.y + AP_PARTS.h) {
      const part = Math.min(item.parts.length - 1, Math.max(0, Math.floor((hit.x - 10) / ((AP_W - 20) / item.parts.length))));
      if (part !== getAppearancePart()) { flushAppearance(); setAppearancePart(part); drawAppearance(true); }
    } else if (!item.opacityOnly && inRect(AP_PICKER, 0)) setAppearanceDrag('picker');
    else if (!item.opacityOnly && inRect(AP_BRIGHT, 14)) setAppearanceDrag('bright');
    else if ((item.alpha || isBorderKey(apKey())) && inRect(AP_OPACITY, 14)) setAppearanceDrag('opacity');
  }
  const appearanceDrag = getAppearanceDrag();
  if (!triggerHeld && appearanceDrag) {
    setAppearanceDrag(null);
    flushAppearance();
    saveAppearance();
    drawAppearance(true);
  }
  if (appearanceDrag && hit) applyAppearanceDrag(hit.x, hit.y);
  setAppearanceTriggerPrev(triggerHeld);
  
  const cubeColorDirty = getCubeColorDirty();
  const dirtyShapes = getDirtyShapes();
  const dirtyCubeShapes = getDirtyCubeShapes();
  if ((cubeColorDirty || dirtyCubeShapes.size || dirtyShapes.size) && performance.now() > APPEARANCE_REBUILD_MS) flushAppearance();
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
    if (source.handedness === 'left' || source.handedness === 'right') setHapticGamepad(source.handedness, gp);
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
      if (typeof ax === 'number' && typeof ay === 'number'
        && (!stick || Math.hypot(ax, ay) > Math.hypot(stick.x, stick.y))) {
        stick = { x: ax, y: ay };
      }
    }
  }
  setLeftButtonsDown(leftDown.join(','));
  setRightButtonsDown(rightDown.join(','));
  return { grips: gripHeld, stick, rightStick, trigger, menuButton, appearanceButton, leftTrigger };
}

function updateWorldDrag(input) {
  const held = [input.grips[0], input.grips[1]];
  const mode = held[0] && held[1] ? 'both' : held[0] ? 0 : held[1] ? 1 : null;
  if (mode === null) { setDrag(null); return false; }

  controller0.getWorldPosition(tmpA);
  controller1.getWorldPosition(tmpB);
  const delta = new THREE.Vector3().subVectors(tmpB, tmpA);
  const angle = Math.atan2(-delta.z, delta.x);
  const dist = delta.length();
  if (mode === 'both') tmpMid.addVectors(tmpA, tmpB).multiplyScalar(0.5);
  else tmpMid.copy(mode === 0 ? tmpA : tmpB);

  const drag = getDrag();
  if (!drag || drag.mode !== mode) {
    setDrag({
      mode, mid: tmpMid.clone(), angle, dist,
      worldPos: worldGroup.position.clone(),
      worldQuat: worldGroup.quaternion.clone(),
      worldScale: worldGroup.scale.x,
    });
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
  
  const levelStartedAt = getLevelStartedAt();
  const win = getWin();
  if (levelStartedAt !== null && !win) {
    const elapsed = elapsedLevelSeconds();
    const displayedElapsedSeconds = getDisplayedElapsedSeconds();
    if (elapsed !== displayedElapsedSeconds) {
      setDisplayedElapsedSeconds(elapsed);
      updateHUD();
    }
  }

  const message = getMessage();
  const lastMessageSeen = getLastMessageSeen();
  const messageShownAt = getMessageShownAt();
  if (message !== lastMessageSeen) {
    setLastMessageSeen(message);
    setMessageShownAt(performance.now());
  } else if (message && !win && !getExitPending() && performance.now() - messageShownAt > MESSAGE_SECONDS * 1000) {
    setMessage('');
    setLastMessageSeen('');
    updateHUD();
  }

  let debugTimer = getDebugTimer();
  debugTimer += dt;
  if (debugTimer >= DEBUG_SECONDS) { setDebugTimer(0); updateDebug(); updateColorTable(); }
  else { setDebugTimer(debugTimer); }
  
  const roll = getRoll();
  if (roll) {
    const newT = roll.t + dt;
    const pRaw = Math.min(newT / ROLL_SECONDS, 1);
    const p = pRaw * pRaw * (3 - 2 * pRaw);
    const angle = roll.totalAngle * p;
    const q = new THREE.Quaternion().setFromAxisAngle(roll.axis, angle);
    cube.position.copy(roll.edge).add(roll.startOffset.clone().applyQuaternion(q));
    cube.quaternion.copy(q).multiply(roll.startQuat);
    if (pRaw >= 1) finishRoll();
    else {
      const updatedRoll = { ...roll, t: newT };
      setRoll(updatedRoll);
    }
  }

  if (getExitPending()) {
    const viewerPosition = renderer.xr.getCamera(camera).getWorldPosition(new THREE.Vector3());
    worldGroup.getWorldPosition(exitMessageMesh.position);
    exitMessageMesh.position.y = viewerPosition.y + EXIT_MESSAGE_RISE;
    exitMessageMesh.lookAt(viewerPosition);
    const msg = getMessage();
    if (msg !== EXIT_MR_MESSAGE) {
      setMessage(EXIT_MR_MESSAGE);
      updateHUD();
    }
    renderer.render(scene, camera);
    return;
  }

  const input = readXRInput();
  const dragging = updateWorldDrag(input);

  const menuPrev = getMenuPrev();
  if (input.menuButton && !menuPrev) setMenuOpenLocal(!getMenuOpen());
  setMenuPrev(input.menuButton);
  if (getMenuOpen()) updateMenuHover();
  
  const appearancePrev = getAppearancePrev();
  if (input.appearanceButton && !appearancePrev) setAppearanceOpenLocal(!getAppearanceOpen());
  setAppearancePrev(input.appearanceButton);
  if (getAppearanceOpen()) updateAppearance(input.leftTrigger, input.rightStick);
  const uiOpen = getMenuOpen() || getAppearanceOpen();

  if (dragging && input.stick && !uiOpen) {
    const y = input.stick.y;
    if (Math.abs(y) < 0.3) { setTiltReady(true); setTiltTimer(0); }
    else if (Math.abs(y) > 0.6) {
      let tiltTimer = getTiltTimer();
      tiltTimer -= dt;
      if (getTiltReady() || tiltTimer <= 0) {
        stepTilt(y > 0 ? 1 : -1);
        setTiltReady(false);
        setTiltTimer(TILT_REPEAT_SECONDS);
      } else {
        setTiltTimer(tiltTimer);
      }
    }
  } else { setTiltReady(true); setTiltTimer(0); }

  if (!dragging && !getRoll() && !uiOpen) {
    if (input.stick) {
      const mag = Math.hypot(input.stick.x, input.stick.y);
      if (mag < 0.3) { setStickReady(true); setStickTimer(0); }
      else if (mag > 0.6) {
        let stickTimer = getStickTimer();
        stickTimer -= dt;
        if (getStickReady() || stickTimer <= 0) {
          setStickReady(false);
          setStickTimer(STICK_REPEAT_SECONDS);
          if (Math.abs(input.stick.x) > Math.abs(input.stick.y)) {
            tryRoll(input.stick.x > 0 ? 'east' : 'west');
          } else {
            tryRoll(input.stick.y > 0 ? 'south' : 'north');
          }
        } else {
          setStickTimer(stickTimer);
        }
      }
    }
    const triggerPrev = getTriggerPrev();
    if (getWin() && input.trigger && !triggerPrev) nextLevel();
  }
  setTriggerPrev(input.trigger);

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
