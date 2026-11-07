import * as THREE from 'three';

// Build timestamp, computed from file Last-Modified headers (see buildTime.js)
import { BUILD_TIMESTAMP } from './buildTime.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// Import build timestamp (calculated dynamically from file modification dates)

// Import configuration
import { CELL, CUBE, BOARD_DEPTH, START_COL, START_ROW, COLORS, INITIAL_ORIENTATION, EXIT_MESSAGE_RISE, ROTATE_GAIN, SCALE_GAIN, TILT_STEP, TILT_MAX, TILT_REPEAT_SECONDS, SKY_RADIUS, SKY_MODES, SKY_MESSAGES, MESSAGE_SECONDS, DEBUG_SECONDS, AP_W, AP_H, AP_SELECT, AP_PARTS, AP_PICKER, AP_BRIGHT, AP_OPACITY, AP_STORAGE_KEY, AP_PANEL_WIDTH, BORDER_WIDTH_MAX, APPEARANCE_REBUILD_MS } from './config.js';
// v30: the session defaults (board layout, homes, appearance, skybox)
// moved to docs/sessionConfig.js; GRID, BOARD_SIZE, COLORED_FRACTION,
// ROLL_SECONDS, HOMES and the appearance colours used to be imported
// from config.js and are now read from SESSION_DEFAULTS.
import { SESSION_DEFAULTS } from './sessionConfig.js';

// Import utilities
import { cellToLocal, keyOf, shapeName, hsvCss, cssToHsv, apClamp01, formatTime, triggerHaptic, setHapticGamepad } from './utils.js';

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
  getMatchBurstT, setMatchBurstT,
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
import { initScene, getRenderer, getScene, getCamera, getWorldGroup, xrGetSession, xrIsPresenting, resetCameraToDesktop } from './scene.js';
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
// (translate / yaw-rotate / scale). Desktop: arrows roll, Q/E rotate,
// +/- scale, N next level, R restart level, 0 reset world transform,
// Ctrl+Arrow moves the world (one cell step, hold to repeat),
// mouse wheel scales the world like +/-.
// ---------------------------------------------------------------------------

// v30: short local names for the session defaults main.js uses all
// over. The values themselves are only defined in sessionConfig.js.
const BOARD_LAYOUT = SESSION_DEFAULTS.boardLayout;
const HOME_2D = SESSION_DEFAULTS.boardHome_2D;
const HOME_MR = SESSION_DEFAULTS.boardHome_MR;
const defAppearance = SESSION_DEFAULTS.appearance;

// Initialize Three.js scene, camera, renderer
initScene();

const renderer = getRenderer();
const scene = getScene();
const camera = getCamera();
const worldGroup = getWorldGroup();

// Ensure desktop scale is set correctly at startup
worldGroup.scale.setScalar(HOME_2D.scale);

function currentHome() {
  return xrGetSession() ? HOME_MR : HOME_2D;
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
  new THREE.PlaneGeometry(BOARD_LAYOUT.boardSize, BOARD_DEPTH),
  new THREE.MeshBasicMaterial({ color: defAppearance.board.color, transparent: true, opacity: defAppearance.board.opacity, depthWrite: false, side: THREE.DoubleSide })
);
boardPlane.renderOrder = -0.5; // after the sky, before the icons, so it darkens only what is behind the board
boardPlane.rotation.x = -Math.PI / 2;
boardPlane.position.y = 0.001;
worldGroup.add(boardPlane);

// v30: the grid colour comes from the session defaults now (it used
// to be GRID_COLOR from config.js); applyLineColors() still rewrites
// the baked vertex colours at startup, so this is the initial colour.
// v40: the board is rectangular (17 across, 11 deep), and GridHelper
// only makes square grids — so the grid is built by hand as line
// segments, one line per cell boundary, in the board plane. The
// geometry carries a colour attribute like GridHelper's, so
// applyLineColors() rewrites it the same way.
const gridColorHex = parseInt(defAppearance.grid.color.slice(1), 16);
function buildGridGeometry() {
  const cols = BOARD_LAYOUT.cols, rows = BOARD_LAYOUT.rows;
  const w = BOARD_LAYOUT.boardSize, d = BOARD_DEPTH;
  const positions = [];
  for (let i = 0; i <= cols; i++) {
    const x = -w / 2 + i * CELL;
    positions.push(x, 0, -d / 2, x, 0, d / 2);
  }
  for (let j = 0; j <= rows; j++) {
    const z = -d / 2 + j * CELL;
    positions.push(-w / 2, 0, z, w / 2, 0, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const gc = new THREE.Color(gridColorHex);
  const count = positions.length / 3;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { colors[i * 3] = gc.r; colors[i * 3 + 1] = gc.g; colors[i * 3 + 2] = gc.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
const grid = new THREE.LineSegments(
  buildGridGeometry(),
  new THREE.LineBasicMaterial({ vertexColors: true, color: 0xffffff })
);
grid.position.y = 0.005;
worldGroup.add(grid);

// Initialize shape styles and icon textures
initShapeStyles();
const iconTextures = createIconTextures();
const cubeIconTextures = createCubeIconTextures();

// Initialize cube
initCube(cubeIconTextures);
const cube = getCube();
// The cube's only edge set (v40: cube.js used to add a second,
// identical one inside initCube — removed, so an edge opacity
// slider would not render darker than the number says).
const cubeEdgeMaterial = new THREE.LineBasicMaterial({ color: defAppearance.edges.color });
cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE, CUBE, CUBE)), cubeEdgeMaterial));
worldGroup.add(cube);

// --- In-world status text (tilted up beyond the far edge) ---
// Past the north edge, tilted 30 degrees up from the board plane and facing
// the player on the south side. As wide as the board (3.09 m) and just
// tall enough to hold the text. Its bottom edge sits level with the
// board: the panel is 0.5 m tall at a 60-degree tilt, so its bottom
// edge sits 0.125 m below its centre — v39 raised the centre from
// y 0.1 to y 0.13, where the bottom edge dipped 2.5 cm below the board
// and read as "- /"; now it sits 5 mm above the board plane ("_/"),
// aligned but not touching. A thin border in the grid colour frames
// it (see panelBorder below), and v40 fills it with the board face
// colour at the board's opacity and adds a divider (panelDivider)
// between the status lines and the message.
// v40: the panel is as wide as the board — its canvas is 576 px per
// metre, the same density as the 2.0 m panel's 1152 px canvas.
const PANEL_PX_PER_M = 576;
const PANEL_CANVAS_W = Math.round(BOARD_LAYOUT.boardSize * PANEL_PX_PER_M); // 1780
const PANEL_HALF_W = BOARD_LAYOUT.boardSize / 2; // 1.545
const panelCanvas = document.createElement('canvas');
panelCanvas.width = PANEL_CANVAS_W; panelCanvas.height = 288;
const panelCtx = panelCanvas.getContext('2d');
const panelTexture = new THREE.CanvasTexture(panelCanvas);
panelTexture.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(
  new THREE.PlaneGeometry(BOARD_LAYOUT.boardSize, 0.5),
  new THREE.MeshBasicMaterial({ map: panelTexture, transparent: true, side: THREE.DoubleSide })
);
panel.rotation.x = -Math.PI / 3;
panel.position.set(0, 0.13, -BOARD_DEPTH / 2 - 0.35);
worldGroup.add(panel);

// v38: a border around the status text, drawn with the same thin lines
// as the grid (a LineBasicMaterial in the grid colour, kept in step by
// applyLineColors). It hugs the panel edge — as wide as the board, just
// tall enough for the text — and is a child of the panel so it follows
// its tilt, set a hair in front of the panel face so it does not
// z-fight with the texture. v39: shown in 2D as well as MR — it was
// MR-only at first, which read as a missing line on desktop.
const panelBorderMaterial = new THREE.LineBasicMaterial({ color: gridColorHex });
const panelBorder = new THREE.LineSegments(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-PANEL_HALF_W, -0.25, 0), new THREE.Vector3(PANEL_HALF_W, -0.25, 0),
    new THREE.Vector3(PANEL_HALF_W, -0.25, 0), new THREE.Vector3(PANEL_HALF_W, 0.25, 0),
    new THREE.Vector3(PANEL_HALF_W, 0.25, 0), new THREE.Vector3(-PANEL_HALF_W, 0.25, 0),
    new THREE.Vector3(-PANEL_HALF_W, 0.25, 0), new THREE.Vector3(-PANEL_HALF_W, -0.25, 0),
  ]),
  panelBorderMaterial
);
panelBorder.position.z = 0.002;
panelBorder.visible = true;
panel.add(panelBorder);

// v40: a divider across the panel, in the same line as the border —
// it splits the fixed top section (Level, Time, Cube shape / Board
// shape) from the temporary message below, so the top lines never move when
// the message appears or expires. Same material as the border, so it
// follows the grid colour. Local y -0.118 is canvas y 212, between
// the Cube / Board row (baseline 181) and the message row (baseline 258).
const panelDivider = new THREE.LineSegments(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-PANEL_HALF_W, -0.118, 0), new THREE.Vector3(PANEL_HALF_W, -0.118, 0),
  ]),
  panelBorderMaterial
);
panelDivider.position.z = 0.002;
panel.add(panelDivider);

// --- Debug readout (small grey text) -------------------------------------------
// Shows where the viewer is and how the board is posed. Both are in the same
// scene (tracking-space) coordinates, so the numbers can be compared directly.
// Toggle with the P key; refreshed a few times a second, not every frame.
// v38: this in-world panel is MR only — in 2D the readout lives in the HUD
// panel below the scores (see updateDebug).
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
debugPanel.position.set(BOARD_LAYOUT.boardSize / 2 + 1.8 / 2 + 0.05, 0.012, 0);
worldGroup.add(debugPanel);

// --- Top 10 Scores (flat in the board plane, left of the board) ---------------
// 640 px per metre, so the 52 px text matches the 46 px text on the main panel
// (576 px per metre) in physical size.
// v38: hidden in 2D — the side text is too hard to read from the desktop
// camera, and the scores already live on the HUD panel. Shown by
// sessionstart, hidden by sessionend, so it is an MR-only panel now.
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
scoresPanel.position.set(-BOARD_LAYOUT.boardSize / 2 - SCORES_W / 2 - 0.05, 0.012, -BOARD_DEPTH / 2 + SCORES_H / 2);
scoresPanel.visible = false; // MR only — see the comment above
worldGroup.add(scoresPanel);

// --- Exit MR button (flat in the board plane, south edge, centred) ----------
// Just past the south (near) edge, centred, so it sits just in front of
// the player at the bottom edge. It only shows while an MR
// session is running — there is nothing to exit in 2D — and it is
// operated the same way as the Y menu: point the RIGHT controller at
// it and pull the trigger. Pointing at it highlights it bright green.
// v32: half the size it was, and aligned to the board's corner — its
// right edge flush with the board's east edge, hugging the corner just
// outside the board instead of floating 0.05 m off it.
// v35: at the board's own level (y 0, not 0.012) and 0.04 m outside
// the board's edge, so there is a clear gap between it and the board
// instead of it hugging the edge. (The gap was 0.4 m at first; that
// put the button too low — south is downhill with the board's 30° MR
// tilt — so it is 0.04 m.)
// v36: tried at the north-east corner, but too far away to use there;
// now centred on the south edge, just off the bottom edge as it was
// before, only centred instead of at the corner.
const EXIT_BUTTON_W = 0.275, EXIT_BUTTON_H = 0.06875;
const exitButtonCanvas = document.createElement('canvas');
exitButtonCanvas.width = 512; exitButtonCanvas.height = 128;
const exitButtonCtx = exitButtonCanvas.getContext('2d');
const exitButtonTexture = new THREE.CanvasTexture(exitButtonCanvas);
exitButtonTexture.colorSpace = THREE.SRGBColorSpace;
function drawExitButton(hovered) {
  exitButtonCtx.clearRect(0, 0, exitButtonCanvas.width, exitButtonCanvas.height);
  // v36: when nobody is pointing at it the background is 95%
  // transparent (alpha 0.05) — just the dark-green text and border
  // showing, so it does not shout from the corner of the board.
  // Pointed at, it is the usual translucent dark background.
  exitButtonCtx.fillStyle = hovered ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.05)';
  exitButtonCtx.fillRect(0, 0, exitButtonCanvas.width, exitButtonCanvas.height);
  exitButtonCtx.strokeStyle = hovered ? '#00ff66' : '#007a33';
  exitButtonCtx.lineWidth = 6;
  exitButtonCtx.shadowColor = '#00ff66';
  exitButtonCtx.shadowBlur = hovered ? 18 : 0;
  exitButtonCtx.strokeRect(3, 3, 506, 122);
  exitButtonCtx.fillStyle = hovered ? '#00ff66' : '#007a33';
  exitButtonCtx.font = 'bold 64px system-ui, sans-serif';
  exitButtonCtx.textAlign = 'center';
  exitButtonCtx.textBaseline = 'middle';
  exitButtonCtx.fillText('Exit MR', 256, 66);
  exitButtonTexture.needsUpdate = true;
}
drawExitButton(false);
const exitButtonMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(EXIT_BUTTON_W, EXIT_BUTTON_H),
  new THREE.MeshBasicMaterial({ map: exitButtonTexture, transparent: true, side: THREE.DoubleSide })
);
exitButtonMesh.rotation.x = -Math.PI / 2;
exitButtonMesh.position.set(
  0,
  0,
  BOARD_DEPTH / 2 + EXIT_BUTTON_H / 2 + 0.04
);
exitButtonMesh.visible = false; // shown by sessionstart, hidden by sessionend
worldGroup.add(exitButtonMesh);
let exitButtonHover = false;

// v35: laser pointer for the Exit MR button. A green line from the
// right controller to the button while it is hovered.
// v36: on ray-exit the laser does not freeze on the button any more —
// it keeps following the controller, pointing where the controller
// points at the last hit distance, and fades out over 2 s. Ray-enter
// shows it; two seconds after ray-exit it is gone. It lives in the
// scene (not the world group) because its endpoints are world
// positions, and it is never frustum-culled because those endpoints
// move every frame.
const exitLaserGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
const exitLaserMaterial = new THREE.LineBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0 });
const exitLaser = new THREE.Line(exitLaserGeometry, exitLaserMaterial);
exitLaser.visible = false;
exitLaser.frustumCulled = false;
scene.add(exitLaser);
const exitLaserOrigin = new THREE.Vector3();
let exitLaserUntil = 0; // performance.now() ms: the laser stays visible (fading) until this time
let exitLaserDist = 1; // controller-to-button distance at the last hover, for the post-exit ray
const EXIT_LASER_LINGER_MS = 2000;

function drawScoresPanel(records) {
  const ctx = scoresCtx;
  const columns = [20, 190, 380];
  ctx.clearRect(0, 0, scoresCanvas.width, scoresCanvas.height);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${SCORES_FONT}px system-ui, sans-serif`;
  ctx.fillText('Top 10 Scores', 20, 64);
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
  // v38: the in-world debug panel is MR only — in 2D the readout lives
  // in the HUD panel below the scores, since the side text is too hard
  // to read from the desktop camera.
  debugPanel.visible = debugVisible && renderer.xr.isPresenting;
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
  for (let col = 0; col < BOARD_LAYOUT.cols; col++) {
    for (let row = 0; row < BOARD_LAYOUT.rows; row++) {
      if (col === START_COL && row === START_ROW) continue; // start square stays blank
      if (Math.random() < BOARD_LAYOUT.coloredFraction) {
        pattern.push({ col, row, colorIndex: Math.floor(Math.random() * COLORS.length) });
      }
    }
  }
  // Guarantee a meaningful level even on an unlucky roll.
  while (pattern.length < 6) {
    const col = Math.floor(Math.random() * BOARD_LAYOUT.cols);
    const row = Math.floor(Math.random() * BOARD_LAYOUT.rows);
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
const hudDownShape = document.getElementById('hudDownShape');
const hudDownCube = document.getElementById('hudDownCube');
const hudBoardWord = document.getElementById('hudBoardWord');
const hudBoardShape = document.getElementById('hudBoardShape');
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
  hudDownShape.textContent = shapeName(down.shape);
  hudDownShape.style.color = down.css;
  hudDownCube.style.color = down.css;
  // v39: the square under the cube, for the "Board:" half of the line —
  // the icon there, if any (getIcon returns undefined for a blank square).
  const pos = getCubePosition();
  const entry = getIcon(keyOf(pos.col, pos.row));
  const board = entry ? COLORS[entry.colorIndex] : null;
  hudBoardWord.style.color = board ? board.css : '';
  hudBoardShape.textContent = board ? shapeName(board.shape) : 'Blank';
  hudBoardShape.style.color = board ? board.css : '';
  hudMessage.textContent = message;
  drawStatusPanel(level, remaining, levelStartedAt, levelScore, down, board, message);
}

// In-world panel: filled with the board face colour, with a divider
// (a 3D line, panelDivider) between the fixed status lines and the
// temporary message below.
function drawStatusPanel(level, remaining, levelStartedAt, levelScore, down, board, message) {
  // v40: the panel is filled with the board face colour (below), and
  // the text is split by the divider into a fixed top section — Level,
  // Time, Cube shape / Board shape — and a bottom section for the temporary
  // message. The three top lines never move now: before, the block was
  // centred on the rows actually drawn, so it jumped up whenever the
  // message expired after 3 seconds.
  const appearance = getAppearance();
  const b = appearance.board;
  panelCtx.clearRect(0, 0, PANEL_CANVAS_W, 288);
  // Fill with the board face colour, at the board's opacity, so the
  // panel reads as part of the board. globalAlpha carries the opacity;
  // the text is drawn after it is restored to 1.
  panelCtx.globalAlpha = b.a;
  panelCtx.fillStyle = hsvCss(b.h, b.s, b.v);
  panelCtx.fillRect(0, 0, PANEL_CANVAS_W, 288);
  panelCtx.globalAlpha = 1;
  panelCtx.textAlign = 'center';
  panelCtx.fillStyle = '#ffffff';
  panelCtx.font = 'bold 46px system-ui, sans-serif';
  panelCtx.fillText(`Level ${level}   Remaining: ${remaining}`, PANEL_CANVAS_W / 2, 55);
  panelCtx.fillText(`Time: ${levelStartedAt === null ? 'Ready' : formatTime(elapsedLevelSeconds())}   Score: ${levelScore}`, PANEL_CANVAS_W / 2, 121);
  // Face Down / Board row (v40): shape names in their own colours —
  // "<down shape> : Cube | Board: <board shape>". The shape words and
  // the Cube / Board words take the colour of the face or square they
  // belong to; the separators stay white. A blank square reads
  // "Board: Blank", both in white.
  panelCtx.font = 'bold 42px system-ui, sans-serif';
  // v43: the separator is pinned to the panel centre — the left half
  // ("<shape> : Cube") is right-justified against it and the right half
  // ("Board: <shape>") left-justified from it — so the | never moves
  // when a shape name changes length. Before, the whole line was
  // centred as one run and the | drifted with the total width.
  const left = [
    { text: shapeName(down.shape), color: down.css },
    { text: ' : ', color: '#ffffff' },
    { text: 'Cube', color: down.css },
  ];
  const sep = { text: ' | ', color: '#ffffff' };
  const right = [
    { text: 'Board', color: board ? board.css : '#ffffff' },
    { text: ': ', color: '#ffffff' },
    board ? { text: shapeName(board.shape), color: board.css } : { text: 'Blank', color: '#ffffff' },
  ];
  const runW = (run) => run.reduce((sum, p) => sum + panelCtx.measureText(p.text).width, 0);
  const drawRun = (run, x) => {
    panelCtx.textAlign = 'left';
    for (const p of run) {
      panelCtx.fillStyle = p.color;
      panelCtx.fillText(p.text, x, 181);
      x += panelCtx.measureText(p.text).width;
    }
  };
  const cx = PANEL_CANVAS_W / 2;
  const sepW = panelCtx.measureText(sep.text).width;
  drawRun(left, cx - sepW / 2 - runW(left));
  panelCtx.fillStyle = sep.color;
  panelCtx.textAlign = 'left';
  panelCtx.fillText(sep.text, cx - sepW / 2, 181);
  drawRun(right, cx + sepW / 2);
  panelCtx.textAlign = 'center';
  // Temporary message, centred in the bottom section (below the
  // divider at canvas y 212). Drawn only while there is one; the
  // section stays empty otherwise, and the top lines do not move.
  if (message) {
    panelCtx.fillStyle = '#ffffff';
    panelCtx.font = '32px system-ui, sans-serif';
    panelCtx.fillText(message.length > 89 ? message.slice(0, 89) + '…' : message, PANEL_CANVAS_W / 2, 258); // 89 chars fits the wider panel; was 58 at 1152 px
  }
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

// Edge feedback (v40): a buzz-buzz error sound plus a matching double
// haptic pulse when a roll is rejected at the board edge. Throttled —
// a held stick retries every 0.125 s, and buzzing on every retry would
// machine-gun. The haptic fires on both hands (null = both, per
// triggerHaptic); with no gamepad connected it is a silent no-op, so
// the 2D keyboard path still gets the sound.
let lastEdgeBuzzAt = 0;
function playEdgeFeedback() {
  const now = performance.now();
  if (now - lastEdgeBuzzAt < 500) return;
  lastEdgeBuzzAt = now;
  playErrorBuzz();
  triggerHaptic(0.7, 90, null);
  window.setTimeout(() => triggerHaptic(0.7, 90, null), 160);
}

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
  if (destCol < 0 || destCol >= BOARD_LAYOUT.cols || destRow < 0 || destRow >= BOARD_LAYOUT.rows) {
    setMessage('Edge — can\'t roll that way.');
    updateHUD();
    playEdgeFeedback();
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

// Error buzz-buzz (no audio asset): two short low square-wave buzzes
// for a rejected move, matching the double haptic pulse in
// playEdgeFeedback. Same guard as the other sounds — silent when
// audio is not running yet.
function playErrorBuzz() {
  const audioCtx = getAudioCtx();
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  for (let i = 0; i < 2; i++) {
    const start = t + i * 0.16;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.12);
  }
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
  stopMatchBurst(); // the win takes over from any in-flight match burst
  const tint = new THREE.Color();
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const o = i * 3;
    confettiPositions[o] = (Math.random() - 0.5) * BOARD_LAYOUT.boardSize;
    confettiPositions[o + 1] = 0.02;
    confettiPositions[o + 2] = (Math.random() - 0.5) * BOARD_DEPTH;
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

// --- Match burst: a mini version of the level-win celebration ---------------
// Same confetti look (six shape colours, soft round sprite, additive),
// but one small burst out of the top of the cube instead of 150 pieces
// across the whole board — and no panel bounce. Fired from finishRoll()
// on a match that does not complete the level; the win celebration takes
// over on the final match. A fast re-match just re-seeds it.
const MATCH_BURST_COUNT = 40;
const MATCH_BURST_SECONDS = 1.2;
const matchBurstPositions = new Float32Array(MATCH_BURST_COUNT * 3);
const matchBurstColors = new Float32Array(MATCH_BURST_COUNT * 3);
const matchBurstVelocities = new Float32Array(MATCH_BURST_COUNT * 3);
const matchBurstGeometry = new THREE.BufferGeometry();
matchBurstGeometry.setAttribute('position', new THREE.BufferAttribute(matchBurstPositions, 3));
matchBurstGeometry.setAttribute('color', new THREE.BufferAttribute(matchBurstColors, 3));
const matchBurst = new THREE.Points(matchBurstGeometry, new THREE.PointsMaterial({
  size: 0.05, map: confettiSprite, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
matchBurst.frustumCulled = false;
matchBurst.visible = false;
worldGroup.add(matchBurst);

function startMatchBurst() {
  // The cube rests on the board, so its centre is CUBE/2 up and its top
  // face is one CUBE above the board; the burst starts just above it.
  const ox = cube.position.x, oy = cube.position.y + CUBE / 2 + 0.02, oz = cube.position.z;
  const tint = new THREE.Color();
  for (let i = 0; i < MATCH_BURST_COUNT; i++) {
    const o = i * 3;
    matchBurstPositions[o] = ox + (Math.random() - 0.5) * 0.04;
    matchBurstPositions[o + 1] = oy;
    matchBurstPositions[o + 2] = oz + (Math.random() - 0.5) * 0.04;
    matchBurstVelocities[o] = (Math.random() - 0.5) * 0.3;
    matchBurstVelocities[o + 1] = 0.3 + Math.random() * 0.5;
    matchBurstVelocities[o + 2] = (Math.random() - 0.5) * 0.3;
    tint.setHex(COLORS[i % COLORS.length].hex);
    matchBurstColors[o] = tint.r; matchBurstColors[o + 1] = tint.g; matchBurstColors[o + 2] = tint.b;
  }
  matchBurstGeometry.attributes.position.needsUpdate = true;
  matchBurstGeometry.attributes.color.needsUpdate = true;
  matchBurst.material.opacity = 1;
  matchBurst.visible = true;
  setMatchBurstT(0);
}

function stopMatchBurst() {
  setMatchBurstT(null);
  matchBurst.visible = false;
}

function updateMatchBurst(dt) {
  const t = getMatchBurstT();
  if (t === null) return;
  const nt = t + dt;
  if (nt >= MATCH_BURST_SECONDS) { stopMatchBurst(); return; }
  const k = nt / MATCH_BURST_SECONDS;
  for (let i = 0; i < MATCH_BURST_COUNT * 3; i++) matchBurstPositions[i] += matchBurstVelocities[i] * dt;
  matchBurstGeometry.attributes.position.needsUpdate = true;
  matchBurst.material.opacity = 1 - k * k;
  setMatchBurstT(nt);
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
      startMatchBurst(); // mini celebration out of the top of the cube
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
  // v33: while a confirmation dialog is open, every key but Escape is
  // ignored (Escape closes it). This goes before Ctrl+Arrow so the
  // world cannot move under the dialog either.
  if (confirmOverlay.classList.contains('open')) {
    if (k === 'escape') closeConfirm();
    return;
  }
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
  // v33: arrow keys and WASD both roll again — D, S and A are free
  // now that debug is *, copy is C and the resets are O and H.
  // TAB hides the panel (preventDefault stops the browser moving
  // focus instead).
  if (k === 'tab') { e.preventDefault(); toggleHudPanel(); }
  else if (k === 'arrowup' || k === 'w') tryRoll('north');
  else if (k === 'arrowdown' || k === 's') tryRoll('south');
  else if (k === 'arrowleft' || k === 'a') tryRoll('west');
  else if (k === 'arrowright' || k === 'd') tryRoll('east');
  else if (k === 'n') nextLevel();
  else if (k === 'r') restartLevel();
  else if (k === 'q') rotateLeft();
  else if (k === 'e') rotateRight();
  else if (k === '<') rotateLeft(); // <: rotate left (same as Q)
  else if (k === '>') rotateRight(); // >: rotate right (same as E)
  else if (k === '=' || k === '+') worldGroup.scale.multiplyScalar(1.1);
  else if (k === '-' || k === '_') worldGroup.scale.multiplyScalar(0.9);
  else if (k === '*') toggleDebug(); // *: show debug info (was D, was P)
  else if (k === 'x') requestClearScores(); // X: clear the persisted top-10 scores (asks first, no undo)
  else if (k === 'c') copySessionConfig(); // C: copy settings
  else if (k === 'f') forceRefresh(); // F: force refresh
  else if (k === 'o') requestResetColors(); // O: reset colours to the server defaults (asks first, no undo)
  else if (k === 'h') resetHome(); // H: reset the board to its home position
  else if (k === '?') toggleHelpPanel(); // ?: show/hide the help panel (bottom right)
  else if (k === '[') stepTilt(1); // [: tilt board up
  else if (k === ']') stepTilt(-1); // ]: tilt board down
  else if (k === 't') stepTilt(e.shiftKey ? -1 : 1); // desktop tilt: T up, Shift+T down (was missing in 2D mode)
  else if (k === 'k') toggleSky();
  else if (k === '0') resetHome();
});
// Mouse wheel scales the world, exactly like +/- on the keyboard:
// scroll up enlarges (x1.1), scroll down shrinks (x0.9). passive: false
// so preventDefault() can stop the page itself from scrolling/zooming.
window.addEventListener('wheel', (e) => {
  e.preventDefault();
  worldGroup.scale.multiplyScalar(e.deltaY < 0 ? 1.1 : 0.9);
}, { passive: false });
// v31: Hide panel — the same toggle as the H key used to be, as a
// button, so the panel can be hidden and brought back with the mouse.
// v33: the key is TAB now, and hiding the panel also hides every
// button in the top-right bar except Hide/Show itself (so you can
// bring it all back) — the MR button is separate and stays.
// v40: the label matches the other toggle buttons now — "Show Panel"
// when hidden, "Hide Panel" when shown — instead of the fixed
// "Hide/Show Panel". And the panel starts hidden on page load (see
// setHudVisible(false) below), so only this button and the MR button
// show until TAB or the button brings it all back.
const btnHidePanel = document.getElementById('btnHidePanel');
function updatePanelLabel() {
  btnHidePanel.querySelector('.label').textContent = hud.style.display === 'none' ? 'Show Panel' : 'Hide Panel';
}
function setHudVisible(visible) {
  hud.style.display = visible ? '' : 'none';
  document.querySelectorAll('#hudButtons button').forEach((b) => {
    if (b.id !== 'btnHidePanel') b.style.display = visible ? '' : 'none';
  });
  updatePanelLabel();
}
function toggleHudPanel() {
  setHudVisible(hud.style.display === 'none');
}
btnHidePanel.addEventListener('click', toggleHudPanel);
setHudVisible(false); // the panel starts hidden on page load

// v34: the help panel — the help text lives in its own panel at the
// bottom left, off by default. (The debug readout and colour table
// used to live here too; v38 moved the debug readout back to the main
// panel, and v39 moved the colour table there as well, so neither is
// tied to "help" any more.) The Show Help button and the ? key toggle
// it. It is independent of the main panel: hiding the main panel does
// not close it, and opening it does not show the main panel.
// v39: the button label follows the state — "Show Help" when closed,
// "Hide Help" when open.
const helpPanel = document.getElementById('helpPanel');
const btnHelp = document.getElementById('btnHelp');
function updateHelpLabel() {
  btnHelp.querySelector('.label').textContent = helpPanel.classList.contains('open') ? 'Hide Help' : 'Show Help';
}
function toggleHelpPanel() {
  helpPanel.classList.toggle('open');
  updateHelpLabel();
}
btnHelp.addEventListener('click', toggleHelpPanel);
updateHelpLabel();

// v33: confirmation dialog for the two destructive actions (Reset
// Colors, Clear Scores). Same dark-box pattern as the copy overlay.
// The action runs only when Confirm is pressed; Cancel and Escape
// just close it. While it is open the game key handler ignores
// every key but Escape (see above).
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmText = document.getElementById('confirmText');
let confirmCallback = null;
function askConfirm(message, onConfirm) {
  confirmText.textContent = message;
  confirmCallback = onConfirm;
  confirmOverlay.classList.add('open');
}
function closeConfirm() {
  confirmOverlay.classList.remove('open');
  confirmCallback = null;
}
document.getElementById('btnConfirmYes').addEventListener('click', () => {
  const cb = confirmCallback;
  closeConfirm();
  if (cb) cb();
});
document.getElementById('btnConfirmNo').addEventListener('click', closeConfirm);
function requestClearScores() {
  askConfirm('Clear the saved top-10 scores? This can\'t be undone.', clearScores);
}
function requestResetColors() {
  askConfirm('Reset all colours to the server defaults? This clears your saved colours and can\'t be undone.', resetColors);
}

// v33: Reset Colors — the old Reset All split in two. This half clears
// the saved appearance (and nothing else) and rebuilds it from the
// session defaults in sessionConfig.js, then re-applies everything
// the same way startup does. The sky goes back to the session default
// too. The top-10 scores are NOT touched (that is Clear Scores' job).
// No undo — the caller asks for confirmation first (see
// requestResetColors).
function resetColors() {
  try { localStorage.removeItem(AP_STORAGE_KEY); } catch { /* ignore */ }
  setAppearance(buildDefaultAppearance());
  const defaultSky = SKY_MODES.indexOf(SESSION_DEFAULTS.skybox.mode);
  setSkyMode(defaultSky >= 0 ? defaultSky : 0);
  loadSky();
  applyShapeStyles();
  applyBoardAppearance();
  applyCubeShapeOpacity();
  applyBoardIconOpacity();
  applyLineColors();
  for (const col of COLORS) { addDirtyShape(col.shape); addDirtyCubeShape(col.shape); }
  setCubeColorDirty(true);
  flushAppearance();
  updateColorTable();
  setMessage('Colours reset to the server defaults.');
  updateHUD();
}
document.getElementById('btnResetColors').addEventListener('click', requestResetColors);

// v36: Reset Home — the board back to its home position, tilt and
// scale (2D home on desktop, MR home in a session). This used to be
// inline in the 0 key; the Reset Home button and the H key use it now.
// The setDrag(null) is the fix for a reset that sometimes did not
// tilt back: while a drag is active, updateWorldDrag re-applies the
// drag snapshot's pose (position, quaternion and scale) every frame,
// so a reset made mid-drag was undone on the very next frame.
// Clearing the drag here makes it re-snapshot at the home pose
// instead, so the reset sticks. In pure 2D there is no other code
// that writes the tilt after a reset, so if it ever happens again
// the debug readout's tilt number tells which half failed: the old
// tilt still showing means the reset did not run; 20 showing with
// the board still tilted means the pose was overwritten after it.
function resetHome() {
  setDrag(null);
  if (renderer.xr.isPresenting) { resetWorldForMR(); }
  else {
    worldGroup.position.copy(HOME_2D.position);
    worldGroup.quaternion.copy(homeQuat(HOME_2D));
    setTiltDeg(HOME_2D.tilt);
    worldGroup.scale.setScalar(HOME_2D.scale);
    // v37: Reset Home resets the player too, not just the board.
    // Coming out of MR leaves the camera at the headset's last pose
    // (the headset's own centre adjustment), so the view stays wrong
    // even with the board home. In a session the headset owns the
    // camera, so this only applies on desktop.
    resetCameraToDesktop();
  }
  setMessage('View reset.');
  updateHUD();
}
document.getElementById('btnResetHome').addEventListener('click', resetHome);

// v32: named so the D and F keys can call the same actions as the buttons.
// v39: the Debug button label follows the state — "Show Debug" when the
// readout is off, "Hide Debug" when it is on.
const btnDebug = document.getElementById('btnDebug');
function updateDebugLabel() {
  btnDebug.querySelector('.label').textContent = getDebugVisible() ? 'Hide Debug' : 'Show Debug';
}
function toggleDebug() { setDebugVisible(!getDebugVisible()); updateDebug(); updateColorTable(); updateDebugLabel(); }
updateDebugLabel();
function forceRefresh() {
  const url = new URL(location.href);
  url.searchParams.set('fresh', String(Date.now()));
  location.href = url.toString();
}
// v34: named so the Rotate Left/Right buttons and the < > keys can
// call the same actions as Q and E. Left is counterclockwise as seen
// by the player (the Q direction).
// v36: the step is 7.5° (Math.PI / 24), half the old 15° — the keys
// and the buttons share these functions, so both step 7.5° now.
function rotateLeft() { worldGroup.rotateOnWorldAxis(WORLD_UP, Math.PI / 24); }
function rotateRight() { worldGroup.rotateOnWorldAxis(WORLD_UP, -Math.PI / 24); }
document.getElementById('btnNext').addEventListener('click', nextLevel);
document.getElementById('btnRestart').addEventListener('click', restartLevel);
btnDebug.addEventListener('click', toggleDebug);
document.getElementById('btnClearScores').addEventListener('click', requestClearScores);
document.getElementById('btnForceRefresh').addEventListener('click', forceRefresh);
// v33: Tilt and Zoom buttons — the same actions as the [ ] and +/-
// keys, for clicking.
document.getElementById('btnTiltUp').addEventListener('click', () => stepTilt(1));
document.getElementById('btnTiltDown').addEventListener('click', () => stepTilt(-1));
document.getElementById('btnZoomIn').addEventListener('click', () => worldGroup.scale.multiplyScalar(1.1));
document.getElementById('btnZoomOut').addEventListener('click', () => worldGroup.scale.multiplyScalar(0.9));
document.getElementById('btnRotateLeft').addEventListener('click', rotateLeft);
document.getElementById('btnRotateRight').addEventListener('click', rotateRight);

// --- Copy settings (2D only) ------------------------------------------------
// A 2D HUD button that copies the current settings as ECMAScript:
// `export const SESSION_DEFAULTS = { ... }`, ready to paste into
// docs/sessionConfig.js. Colours are hex, as in config.js. In 2D the
// page is focused and the click is a user gesture, so
// navigator.clipboard.writeText() works there — inside an immersive
// session it does not reliably (no page focus, and a controller trigger
// is not the gesture the browser wants), which is why this button lives
// in the 2D HUD only and there is no in-headset copy.
// If the clipboard write fails (or the API is unavailable), the script
// is shown in a textbox instead — the pattern other pages use with an
// iframe + textbox + copy button, done here as a plain overlay because
// no iframe is needed on the same page — with its own Copy button
// (clipboard API, then the old textarea/execCommand fallback) and Close.
const copyOverlay = document.getElementById('copyOverlay');
const copyText = document.getElementById('copyText');

// Small serializer: like JSON.stringify with 2-space indent, but object
// keys are left unquoted when they are valid identifiers, so the output
// is ECMAScript rather than JSON. Strings stay double-quoted via
// JSON.stringify, which is valid JS too.
function toJS(value, level) {
  const pad = '  '.repeat(level);
  const padIn = '  '.repeat(level + 1);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[\n' + value.map((v) => padIn + toJS(v, level + 1)).join(',\n') + '\n' + pad + ']';
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const key = (k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
  return '{\n' + entries.map(([k, v]) => padIn + key(k) + ': ' + toJS(v, level + 1)).join(',\n') + '\n' + pad + '}';
}

function buildSessionConfigScript() {
  const ap = getAppearance();
  const hex = (e) => hsvCss(e.h, e.s, e.v);
  const d = SESSION_DEFAULTS.boardHome_2D, m = SESSION_DEFAULTS.boardHome_MR;
  const orientation = getOrientation();
  const settings = {
    boardLayout: {
      cols: BOARD_LAYOUT.cols,
      rows: BOARD_LAYOUT.rows,
      boardSize: BOARD_LAYOUT.boardSize,
      coloredFraction: BOARD_LAYOUT.coloredFraction,
      rollSeconds: BOARD_LAYOUT.rollSeconds,
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
      grid: { color: hex(ap.grid), opacity: ap.grid.a },
      edges: { color: hex(ap.edges), opacity: ap.edges.a },
      shapeBorder: { color: hex(ap.shapeBorder), width: ap.shapeBorder.w },
      ...Object.fromEntries(COLORS.map((col) => [col.shape, { fill: hex(ap[`${col.shape}.fill`]) }])),
    },
    skybox: {
      mode: SKY_MODES[getSkyMode()],
    },
  };
  const lines = [];
  lines.push('// CubeGameWebXR session defaults — copied ' + new Date().toISOString());
  lines.push('// Build: ' + BUILD_TIMESTAMP + ' — Level ' + getLevel() + ', ' + getRemaining() + ' remaining, face down ' + COLORS[orientation.down].name);
  lines.push('// These are the live values (saved appearance included). Paste into');
  lines.push('// docs/sessionConfig.js to make them the defaults — but note the saved');
  lines.push('// appearance in this browser still wins until it is cleared.');
  lines.push('export const SESSION_DEFAULTS = {');
  lines.push('  // Board layout — geometry shared by 2D and MR');
  lines.push('  boardLayout: ' + toJS(settings.boardLayout, 1) + ',');
  lines.push('  // Board home, 2D (desktop browser)');
  lines.push('  boardHome_2D: ' + toJS(settings.boardHome_2D, 1) + ',');
  lines.push('  // Board home, MR (Quest passthrough)');
  lines.push('  boardHome_MR: ' + toJS(settings.boardHome_MR, 1) + ',');
  lines.push('  // Appearance — everything editable from the B-button panel. Colours are hex, opacity 0–1.');
  lines.push('  // boardIcons / cubeIcons are opacity-only: their shapes take their colour from the Fill items.');
  lines.push('  appearance: ' + toJS(settings.appearance, 1) + ',');
  lines.push('  // Skybox — Passthrough only exists inside an MR session; leaving a session resets it to Adjusted');
  lines.push('  skybox: ' + toJS(settings.skybox, 1));
  lines.push('};');
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

async function copySessionConfig() {
  const text = buildSessionConfigScript();
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
document.getElementById('btnCopySettings').addEventListener('click', copySessionConfig);
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
// v40: D-pad stick zones — the stick rolls like a D-pad, not a free
// analogue stick. Each cardinal direction owns a 60° wedge (± the
// half-width below); the 30° gaps centred on the diagonals roll
// nothing, so a push near a diagonal no longer flips direction with
// the slightest wobble. The angle is measured with y down, so 0° is
// east, 90° south, 180° west and -90° north — the same mapping the
// old dominant-axis test used.
const STICK_WEDGE_HALF_DEGREES = 30;
function stickRollDirection(x, y) {
  const angle = Math.atan2(y, x) * 180 / Math.PI;
  const dirs = [
    { name: 'east', angle: 0 },
    { name: 'south', angle: 90 },
    { name: 'west', angle: 180 },
    { name: 'north', angle: -90 },
  ];
  let best = null, bestDiff = Infinity;
  for (const d of dirs) {
    let diff = Math.abs(angle - d.angle);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = d.name; }
  }
  return bestDiff <= STICK_WEDGE_HALF_DEGREES + 1e-9 ? best : null; // the epsilon keeps a stick sitting exactly on the 30° edge inside the wedge instead of losing it to float rounding
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpMid = new THREE.Vector3();

// Grip state comes from each controller's own squeeze events, so it always
// matches the controller object whose position the world drag reads.
const gripHeld = getGripHeld(); // state.js array, single source of truth
[controller0, controller1].forEach((controller, i) => {
  controller.addEventListener('squeezestart', () => { gripHeld[i] = true; });
  controller.addEventListener('squeezeend', () => { gripHeld[i] = false; });
});
// Immersive start: centred on the board, tilted, slightly smaller board (see boardHome_2D / boardHome_MR in sessionConfig.js).
const homeQuat = (home) => new THREE.Quaternion().setFromAxisAngle(TILT_AXIS, home.tilt * Math.PI / 180);
function resetWorldForMR() {
  setDrag(null); // see resetHome: a stale drag snapshot would re-apply the old pose
  const home = currentHome();
  worldGroup.position.copy(home.position);
  worldGroup.quaternion.copy(homeQuat(home));
  setTiltDeg(home.tilt);
  worldGroup.scale.setScalar(home.scale);
}
// 2D start: apply the desktop home pose. initScene() sets the position
// and scale, but not the tilt — without this the board would start flat
// even though the desktop home tilt is 20, and the first T press would
// jump from 0. MR is unaffected: sessionstart calls resetWorldForMR()
// with the MR home.
if (!renderer.xr.isPresenting) {
  worldGroup.quaternion.copy(homeQuat(HOME_2D));
  setTiltDeg(HOME_2D.tilt);
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
  // v39: hide the help panel and the debug readout too — they are 2D
  // panels, and leaving them up means coming back to a cluttered
  // desktop. Hiding only changes visibility: the help text stays in
  // its div and the last debug lines stay in hudDebug (updateDebug
  // returns early when hidden, before writing anything), so nothing
  // is cleared.
  helpPanel.classList.remove('open');
  updateHelpLabel();
  setDebugVisible(false);
  updateDebugLabel();
  exitButtonMesh.visible = true; // the board's Exit MR button is an in-session control
  scoresPanel.visible = true; // the side panels are MR only (the status border is always on now)
  updateDebug(); // refresh the in-world debug panel's visibility right away
  resetWorldForMR();
  restartLevel(); // entering or leaving MR restarts the current board
});
renderer.xr.addEventListener('sessionend', () => {
  const exitTimer = getExitTimer();
  if (exitTimer !== null) window.clearTimeout(exitTimer);
  setExitTimer(null);
  gripHeld.fill(false); setDrag(null); setExitPending(false);
  exitMessageMesh.visible = false;
  exitButtonMesh.visible = false;
  exitButtonHover = false;
  drawExitButton(false);
  scoresPanel.visible = false;
  // v39: hide the help panel and the debug readout on leaving a
  // session as well, for the same reason as on entry — and the same
  // guarantee: visibility only, the text stays put.
  helpPanel.classList.remove('open');
  updateHelpLabel();
  setDebugVisible(false);
  updateDebugLabel();
  updateDebug(); // hides the in-world debug panel right away
  exitLaser.visible = false;
  exitLaserUntil = 0;
  if (getSkyMode() === 3) { setSkyMode(0); loadSky(); } // passthrough only exists inside the session
  // Use the Local closers, not the state-only setters: they hide the meshes
  // and pointer line and reset hover to -1. setMenuOpen(false) alone left
  // menuMesh.visible true and the old hover (e.g. Exit MR) intact, so the
  // menu was still up on relaunch and the next trigger press re-activated it.
  setMenuOpenLocal(false);
  setAppearanceOpenLocal(false);
  // v36: coming out of MR, put the board back at the 2D home pose.
  // Until now it stayed wherever the session left it (MR home pose,
  // plus any moves/tilts made in the session), so the board came back
  // in strange places — which is also what made a later Reset Home
  // in 2D look like it was not tilting back. Applied explicitly from
  // HOME_2D rather than via resetHome(): inside this handler
  // isPresenting may still read true, which would take the MR branch.
  worldGroup.position.copy(HOME_2D.position);
  worldGroup.quaternion.copy(homeQuat(HOME_2D));
  setTiltDeg(HOME_2D.tilt);
  worldGroup.scale.setScalar(HOME_2D.scale);
  resetCameraToDesktop(); // the session leaves the camera at the headset's last pose
  restartLevel();
});

// --- Controller menu --------------------------------------------------------
// A small panel attached to the LEFT controller, opened with the left menu
// button (or Y) and operated by pointing the RIGHT controller at it and
// pressing its trigger.
// Button indices measured on the Quest browser, left Touch controller.
const MENU_TOGGLE_BUTTONS = [12, 5]; // 12 = menu button, 5 = Y
// v36: the rows are 60% as tall as they were (90 px pitch, 78 px box,
// 34 px font) — they were too tall. Row indices are named so
// activateMenuItem reads like the menu itself.
const MENU_DEBUG = 0, MENU_SKY = 1, MENU_RESET_HOME = 2, MENU_NEXT = 3,
  MENU_RESTART = 4, MENU_CLEAR = 5, MENU_RESET_COLORS = 6, MENU_EXIT = 7;
const MENU_ROWS = 8;
const MENU_ROW_H = 90, MENU_ROW_BOX = 78, MENU_TOP = 12, MENU_FONT_PX = 34;
// v36: an inactive hint row at the bottom, half the row height and
// half the font size — it just says the rest of the options live
// outside the session. It is drawn, never highlighted or selectable.
const MENU_HINT_H = MENU_ROW_H / 2, MENU_HINT_FONT_PX = MENU_FONT_PX / 2;
const MENU_W = 512, MENU_H = MENU_TOP + MENU_ROWS * MENU_ROW_H + MENU_HINT_H;
let menuHover = -1; // -1 none, otherwise a MENU_* row above
// v36: arm-then-confirm for the destructive menu rows. The in-page
// confirm dialog is not visible inside a session, so the first tap on
// Clear Scores / Reset Colors arms that row (re-labelled) and the
// second tap within 5 s confirms. Selecting any other row, closing
// the menu, or the timeout disarms it.
let menuConfirm = null; // 'clear' | 'reset' | null
let menuConfirmUntil = 0;
const MENU_CONFIRM_MS = 5000;
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
// v36: the whole menu is 25% smaller than the old 0.2 m wide —
// fonts and everything scale with the mesh, so the canvas is untouched.
const MENU_WORLD_W = 0.15;
const menuMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(MENU_WORLD_W, MENU_WORLD_W * MENU_H / MENU_W),
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
  const rows = [
    `Debug: ${debugVisible ? 'On' : 'Off'}`,
    `Sky: ${SKY_MODES[nextSkyMode()]}`,
    'Reset Home',
    'Next Level',
    'Restart Level',
    menuConfirm === 'clear' ? 'Confirm clear?' : 'Clear Scores',
    menuConfirm === 'reset' ? 'Confirm reset?' : 'Reset Colors',
    'Exit MR',
  ];
  rows.forEach((label, i) => {
    const y = MENU_TOP + i * MENU_ROW_H;
    const armed = (i === MENU_CLEAR && menuConfirm === 'clear')
      || (i === MENU_RESET_COLORS && menuConfirm === 'reset');
    menuCtx.fillStyle = armed
      ? (i === menuHover ? '#c0392b' : '#8e2f2f')
      : (i === menuHover ? '#3498db' : 'rgba(20,20,30,0.92)');
    menuCtx.fillRect(10, y, MENU_W - 20, MENU_ROW_BOX);
    menuCtx.strokeStyle = '#9a9a9a';
    menuCtx.lineWidth = 4;
    menuCtx.strokeRect(10, y, MENU_W - 20, MENU_ROW_BOX);
    menuCtx.fillStyle = '#ffffff';
    menuCtx.font = `bold ${MENU_FONT_PX}px system-ui, sans-serif`;
    menuCtx.textAlign = 'center';
    menuCtx.textBaseline = 'middle';
    menuCtx.fillText(label, MENU_W / 2, y + MENU_ROW_BOX / 2);
  });
  // Inactive hint row at the bottom: half-size grey text, no box,
  // never highlighted. The hover math maps this strip to row 8,
  // which fails the `row < MENU_ROWS` check, so it can never be
  // selected; activateMenuItem only ever sees rows 0-7.
  menuCtx.fillStyle = '#9a9a9a';
  menuCtx.font = `${MENU_HINT_FONT_PX}px system-ui, sans-serif`;
  menuCtx.textAlign = 'center';
  menuCtx.textBaseline = 'middle';
  menuCtx.fillText('Exit MR for Other Options', MENU_W / 2, MENU_TOP + MENU_ROWS * MENU_ROW_H + MENU_HINT_H / 2);
  menuTexture.needsUpdate = true;
}

function setMenuOpenLocal(open) {
  if (open && getAppearanceOpen()) setAppearanceOpenLocal(false);
  const newMenuOpen = open && !!leftController;
  setMenuOpen(newMenuOpen);
  if (!newMenuOpen) menuConfirm = null; // closing the menu disarms a pending confirm
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
      const row = Math.floor((y - MENU_TOP) / MENU_ROW_H);
      if (row >= 0 && row < MENU_ROWS && (y - MENU_TOP) % MENU_ROW_H <= MENU_ROW_BOX) hover = row;
    }
  }
  const menuHover = getMenuHover();
  if (hover !== menuHover) { setMenuHover(hover); drawMenu(); }
  // An armed confirm lapses after 5 s; re-label the row when it does.
  if (menuConfirm && performance.now() > menuConfirmUntil) {
    menuConfirm = null;
    drawMenu();
  }
}

// Same ray as the menu hover, but against the Exit MR button on the
// board. Only while a session is running; the button is hidden in 2D.
// The highlight is the aiming feedback while hovering — and the laser
// (v35) draws the ray itself: it appears on ray-enter, follows the
// controller, and 2 s after ray-exit it is gone (v36).
function updateExitButtonHover() {
  let hover = false;
  let hitPoint = null;
  if (renderer.xr.isPresenting && rightController && exitButtonMesh.visible) {
    scene.updateMatrixWorld();
    rightController.getWorldPosition(menuRaycaster.ray.origin);
    rightController.getWorldQuaternion(menuRayQuat);
    menuRaycaster.ray.direction.copy(menuRayDir.set(0, 0, -1).applyQuaternion(menuRayQuat));
    const hit = menuRaycaster.intersectObject(exitButtonMesh)[0];
    if (hit) { hover = true; hitPoint = hit.point; }
  }
  if (hover !== exitButtonHover) { exitButtonHover = hover; drawExitButton(hover); }
  const now = performance.now();
  const pos = exitLaserGeometry.attributes.position;
  if (hover && hitPoint) {
    // Ray-enter / hovering: live laser, right controller to the button.
    rightController.getWorldPosition(exitLaserOrigin);
    exitLaserDist = exitLaserOrigin.distanceTo(hitPoint);
    pos.setXYZ(0, exitLaserOrigin.x, exitLaserOrigin.y, exitLaserOrigin.z);
    pos.setXYZ(1, hitPoint.x, hitPoint.y, hitPoint.z);
    pos.needsUpdate = true;
    exitLaserMaterial.opacity = 1;
    exitLaser.visible = true;
    exitLaserUntil = now + EXIT_LASER_LINGER_MS;
  } else if (now < exitLaserUntil && rightController) {
    // Ray-exit: the laser stays for 2 s, but it follows the
    // controller now — it points where the controller points, at the
    // last hit distance, instead of sticking to the button — fading out.
    rightController.getWorldPosition(exitLaserOrigin);
    const dir = menuRaycaster.ray.direction;
    pos.setXYZ(0, exitLaserOrigin.x, exitLaserOrigin.y, exitLaserOrigin.z);
    pos.setXYZ(1, exitLaserOrigin.x + dir.x * exitLaserDist, exitLaserOrigin.y + dir.y * exitLaserDist, exitLaserOrigin.z + dir.z * exitLaserDist);
    pos.needsUpdate = true;
    exitLaserMaterial.opacity = (exitLaserUntil - now) / EXIT_LASER_LINGER_MS;
    exitLaser.visible = true;
  } else {
    exitLaser.visible = false;
  }
}

function activateMenuItem() {
  const menuOpenState = getMenuOpen();
  if (!menuOpenState) return;
  const selected = getMenuHover();
  if (selected < 0) return;
  triggerHaptic(0.4, 40, 'left');
  // Destructive rows arm first (see the menuConfirm note above):
  // the first tap arms the row and re-labels it; the second tap
  // within 5 s confirms and closes the menu.
  if (selected === MENU_CLEAR) {
    if (menuConfirm === 'clear' && performance.now() < menuConfirmUntil) {
      menuConfirm = null;
      setMenuOpenLocal(false);
      clearScores();
      updateHUD(); // clearScores sets the message but does not redraw the HUD
    } else {
      menuConfirm = 'clear';
      menuConfirmUntil = performance.now() + MENU_CONFIRM_MS;
      setMessage('Select Clear Scores again to confirm.');
      updateHUD();
      drawMenu();
    }
    return;
  }
  if (selected === MENU_RESET_COLORS) {
    if (menuConfirm === 'reset' && performance.now() < menuConfirmUntil) {
      menuConfirm = null;
      setMenuOpenLocal(false);
      resetColors();
    } else {
      menuConfirm = 'reset';
      menuConfirmUntil = performance.now() + MENU_CONFIRM_MS;
      setMessage('Select Reset Colors again to confirm.');
      updateHUD();
      drawMenu();
    }
    return;
  }
  // Any other row disarms a pending confirm.
  menuConfirm = null;
  setMenuOpenLocal(false);
  if (selected === MENU_DEBUG) {
    setDebugVisible(!getDebugVisible());
    updateDebug();
  } else if (selected === MENU_SKY) {
    toggleSky();
  } else if (selected === MENU_RESET_HOME) {
    // v36: the old 'Reset view' row was this same action in a session,
    // so it is now named like the button it mirrors.
    resetHome();
  } else if (selected === MENU_NEXT) {
    nextLevel();
  } else if (selected === MENU_RESTART) {
    restartLevel();
  } else if (selected === MENU_EXIT) {
    requestExitMR();
  }
}

// Shared by the Y menu's Exit MR row and the Exit MR button on the
// board: a 3-second grace period (look forward; the view resets),
// then the session ends. Ignored when no session is running, or when
// an exit is already pending.
function requestExitMR() {
  if (getExitPending()) return;
  const session = renderer.xr.getSession();
  if (!session) return;
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

// Right trigger: the Y menu's rows when the menu is open, otherwise
// the Exit MR button on the board when it is pointed at.
function onRightSelectStart() {
  if (getMenuOpen()) { activateMenuItem(); return; }
  if (exitButtonHover) requestExitMR();
}
controller0.addEventListener('selectstart', () => { if (controller0 === rightController) onRightSelectStart(); });
controller1.addEventListener('selectstart', () => { if (controller1 === rightController) onRightSelectStart(); });

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
  // v40: the two icon pages are one page now — neither has a colour
  // of its own (each shape's colour comes from its Fill item), so
  // both opacity sliders fit on one page. The board-icons slider
  // lives at the brightness rect and the cube-icons slider at the
  // opacity rect; see drawAppearance and the drag start below.
  { id: 'icons', label: 'Icons', parts: [{ id: '', label: 'Board + Cube' }], alpha: true, opacityOnly: true, combinedIcons: true },
  { id: 'cube', label: 'Cube faces', parts: [{ id: '', label: 'Face colour' }], alpha: true },
  { id: 'grid', label: 'Grid lines', parts: [{ id: '', label: 'Lines' }], alpha: true },
  { id: 'edges', label: 'Cube edges', parts: [{ id: '', label: 'Edges' }], alpha: true },
  { id: 'shapeBorder', label: 'Shape borders', parts: [{ id: '', label: 'All shapes' }] },
  ...COLORS.map((col) => ({
    id: col.shape,
    label: titleCase(col.shape),
    parts: [{ id: '.fill', label: 'Fill' }],
  })),
];

// v30: the default values moved to docs/sessionConfig.js
// (SESSION_DEFAULTS.appearance); this only converts them from hex to
// the HSV the panel works in, then merges the saved appearance over
// them, as before.
// v31: factored into a function so Reset defaults can rebuild the
// same object on demand.
function buildDefaultAppearance() {
  const a = {
    board: { ...cssToHsv(defAppearance.board.color), a: defAppearance.board.opacity },
    boardIcons: { h: 0, s: 0, v: 1, a: defAppearance.boardIcons.opacity },
    cube: { ...cssToHsv(defAppearance.cube.color), a: defAppearance.cube.opacity },
    cubeIcons: { h: 0, s: 0, v: 1, a: defAppearance.cubeIcons.opacity },
    grid: { ...cssToHsv(defAppearance.grid.color), a: defAppearance.grid.opacity },
    edges: { ...cssToHsv(defAppearance.edges.color), a: defAppearance.edges.opacity },
  };
  for (const col of COLORS) {
    a[`${col.shape}.fill`] = { ...cssToHsv(defAppearance[col.shape].fill), a: 1 };
  }
  a.shapeBorder = { ...cssToHsv(defAppearance.shapeBorder.color), a: 1, w: defAppearance.shapeBorder.width };
  return a;
}
const appearance = buildDefaultAppearance();
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
    saved.cube = { ...cssToHsv(defAppearance.cube.color), a: saved.cube.a };
  }
  // v40: the old grid default was dark green #0c3700 at full opacity;
  // the new one is black at full opacity (v41; was 25% in v40). A save
  // that still holds the old default (never customised) moves to the
  // new one; a customised grid colour is left alone. #0c3700 is about
  // h 107, s 1, v 0.216.
  const isOldGridDefault = saved && saved.grid && (
    Math.abs(saved.grid.h - 107) < 1 && Math.abs(saved.grid.s - 1) < 0.05 && Math.abs(saved.grid.v - 0.216) < 0.02
  );
  if (isOldGridDefault) {
    saved.grid = { ...cssToHsv(defAppearance.grid.color), a: defAppearance.grid.opacity };
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
  if (!Number.isFinite(appearance.shapeBorder.w)) appearance.shapeBorder.w = defAppearance.shapeBorder.width;
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
  panelBorderMaterial.color.copy(c); // the status border and divider are grid lines too
  cubeEdgeMaterial.color.set(hsvCss(e.h, e.s, e.v));
  // Opacity (v40): the grid lines, the status border and divider, and
  // the cube edges each have their own opacity now. The border and
  // divider follow the grid's opacity because they are grid-colour
  // lines. transparent stays on so dragging the slider does not
  // recompile the material; at opacity 1 it renders the same.
  grid.material.transparent = true;
  grid.material.opacity = g.a;
  panelBorderMaterial.transparent = true;
  panelBorderMaterial.opacity = g.a;
  cubeEdgeMaterial.transparent = true;
  cubeEdgeMaterial.opacity = e.a;
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
    const alpha = key === 'board' || key === 'cube' || key === 'boardIcons' || key === 'cubeIcons' || key === 'grid' || key === 'edges' ? `${Math.round(t.a * 100)}%` : '-';
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
  if (item.combinedIcons) {
    // One page, two sliders: board icons at the brightness rect,
    // cube icons at the opacity rect. Both are opacity-only, so the
    // picker area above stays empty, as on the old single pages.
    drawSlider(AP_BRIGHT, `Board icons Opacity ${Math.round(appearance.boardIcons.a * 100)}%`, appearance.boardIcons.a, '#404050');
    drawSlider(AP_OPACITY, `Cube icons Opacity ${Math.round(appearance.cubeIcons.a * 100)}%`, appearance.cubeIcons.a, '#404050');
  } else {
    if (item.alpha) drawSlider(AP_OPACITY, `Opacity ${Math.round(t.a * 100)}%`, t.a, item.opacityOnly ? '#404050' : hsvCss(t.h, t.s, t.v));
    if (isBorderKey(apKey())) drawSlider(AP_OPACITY, `Border width ${Math.round(t.w)}`, t.w / BORDER_WIDTH_MAX, '#404050');
  }
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
  const appearanceDrag = getAppearanceDrag();
  // v40: on the combined Icons page the drag carries its own key
  // ('opacity:boardIcons' / 'opacity:cubeIcons'); everywhere else
  // the key is the selected item+part.
  const key = appearanceDrag && appearanceDrag.startsWith('opacity:') ? appearanceDrag.slice(8) : apKey();
  const appearance = getAppearance();
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
  } else if (appearanceDrag === 'opacity' || (appearanceDrag && appearanceDrag.startsWith('opacity:'))) {
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
  if (key === 'board') { applyBoardAppearance(); updateHUD(); } // the status panel fill follows the board colour live
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
    } else if (item.combinedIcons && inRect(AP_BRIGHT, 14)) setAppearanceDrag('opacity:boardIcons');
    else if (item.combinedIcons && inRect(AP_OPACITY, 14)) setAppearanceDrag('opacity:cubeIcons');
    else if (!item.opacityOnly && inRect(AP_PICKER, 0)) setAppearanceDrag('picker');
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
  updateMatchBurst(dt);
  
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
    const pRaw = Math.min(newT / BOARD_LAYOUT.rollSeconds, 1);
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
  if (renderer.xr.isPresenting) updateExitButtonHover();
  
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
        const dir = stickRollDirection(input.stick.x, input.stick.y);
        if (!dir) { setStickReady(true); setStickTimer(0); } // in a diagonal gap: nothing, and no queued roll
        else {
          let stickTimer = getStickTimer();
          stickTimer -= dt;
          if (getStickReady() || stickTimer <= 0) {
            setStickReady(false);
            setStickTimer(STICK_REPEAT_SECONDS);
            tryRoll(dir);
          } else {
            setStickTimer(stickTimer);
          }
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
