import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// ---------------------------------------------------------------------------
// Cube Game WebXR — v1, 10x10 board
// A horizontal 10x10 board floating in front of the player. Roll a cube with a
// different colour on each face. A square clears only when the cube's
// FACE-DOWN face matches that square's flat icon. Clear all coloured
// squares to finish the level. No timer, no lose condition in v1.
// Controls: Quest thumbstick rolls; hold BOTH grips to drag the world
// (translate / yaw-rotate / scale). Desktop: arrows/WASD roll, Q/E rotate,
// +/- scale, N next level, R restart level, 0 reset world transform.
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
const WORLD_HOME = new THREE.Vector3(0, 1.0, -2.0);
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

// --- In-world status panel (standing at the near edge, facing the player) ---
const panelCanvas = document.createElement('canvas');
panelCanvas.width = 1024; panelCanvas.height = 288;
const panelCtx = panelCanvas.getContext('2d');
const panelTexture = new THREE.CanvasTexture(panelCanvas);
panelTexture.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(
  new THREE.PlaneGeometry(1.8, 0.5),
  new THREE.MeshBasicMaterial({ map: panelTexture, transparent: false })
);
panel.position.set(0, 0.55, BOARD_SIZE / 2 + 0.35);
worldGroup.add(panel);

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
  // In-world panel
  panelCtx.fillStyle = '#0b1020';
  panelCtx.fillRect(0, 0, 1024, 288);
  panelCtx.strokeStyle = '#88aaff'; panelCtx.lineWidth = 6;
  panelCtx.strokeRect(6, 6, 1012, 276);
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
let roll = null; // {t, axis, totalAngle, edge, startOffset, startPos, startQuat, endPos, dir}

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
    startPos, startQuat: cube.quaternion.clone(),
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
  if (k === 'arrowup' || k === 'w') tryRoll('north');
  else if (k === 'arrowdown' || k === 's') tryRoll('south');
  else if (k === 'arrowleft' || k === 'a') tryRoll('west');
  else if (k === 'arrowright' || k === 'd') tryRoll('east');
  else if (k === 'n') nextLevel();
  else if (k === 'r') restartLevel();
  else if (k === 'q') worldGroup.rotateY(Math.PI / 12);
  else if (k === 'e') worldGroup.rotateY(-Math.PI / 12);
  else if (k === '=' || k === '+') worldGroup.scale.multiplyScalar(1.1);
  else if (k === '-' || k === '_') worldGroup.scale.multiplyScalar(0.9);
  else if (k === '0') {
    worldGroup.position.copy(WORLD_HOME);
    worldGroup.quaternion.identity();
    worldGroup.scale.setScalar(1);
  }
});
document.getElementById('btnNext').addEventListener('click', nextLevel);
document.getElementById('btnRestart').addEventListener('click', restartLevel);

// --- XR controllers: thumbstick roll + two-grip world drag ---------------------
const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);
scene.add(controller0, controller1);

let stickReady = true;
let triggerPrev = false;
let drag = null; // {mid, angle, dist, worldPos, worldQuat, worldScale}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpMid = new THREE.Vector3();

function readXRInput() {
  const session = renderer.xr.getSession();
  if (!session) return { grips: [false, false], stick: null, trigger: false };
  const grips = [false, false];
  let stick = null;
  let trigger = false;
  const sources = session.inputSources || [];
  for (let i = 0; i < sources.length; i++) {
    const gp = sources[i].gamepad;
    if (!gp) continue;
    if (gp.buttons[1] && gp.buttons[1].pressed) grips[i < 2 ? i : 0] = true;
    if (gp.buttons[0] && gp.buttons[0].pressed) trigger = true;
    if (!stick && gp.axes) {
      const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0];
      const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1];
      if (typeof ax === 'number' && typeof ay === 'number') stick = { x: ax, y: ay };
    }
  }
  // Grips are indexed by controller order in practice; also accept the
  // controller groups' squeeze state via the session sources count.
  // The two entries above cover left + right when both are present.
  return { grips, stick, trigger };
}

function updateWorldDrag(input) {
  const bothGrips = input.grips[0] && input.grips[1];
  if (!bothGrips) { drag = null; return false; }
  controller0.getWorldPosition(tmpA);
  controller1.getWorldPosition(tmpB);
  tmpMid.addVectors(tmpA, tmpB).multiplyScalar(0.5);
  const delta = new THREE.Vector3().subVectors(tmpB, tmpA);
  // Yaw angle of the hand-to-hand vector, measured so a positive yaw
  // (Three's rotationY) matches the hands turning toward -z from +x.
  const angle = Math.atan2(-delta.z, delta.x);
  const dist = delta.length();
  if (!drag) {
    drag = {
      mid: tmpMid.clone(), angle, dist,
      worldPos: worldGroup.position.clone(),
      worldQuat: worldGroup.quaternion.clone(),
      worldScale: worldGroup.scale.x,
    };
    return true;
  }
  const midDelta = tmpMid.clone().sub(drag.mid);
  worldGroup.position.copy(drag.worldPos).add(midDelta);
  const yawDelta = angle - drag.angle;
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawDelta);
  worldGroup.quaternion.copy(yawQuat).multiply(drag.worldQuat);
  const scaleFactor = THREE.MathUtils.clamp(dist / Math.max(drag.dist, 0.001), 0.4, 2.5);
  worldGroup.scale.setScalar(drag.worldScale * scaleFactor);
  return true;
}

// --- Main loop ------------------------------------------------------------------
const clock = new THREE.Clock();
generateLevel();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

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

  if (!dragging && !roll) {
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
