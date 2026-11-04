// Centralized game state manager

export const gameState = {
  // Level and progression
  level: 1,
  remaining: 0,
  win: false,
  
  // Cube position and orientation
  cubeCol: 0,
  cubeRow: 0,
  orientation: {},
  
  // Game timing
  levelStartedAt: null,
  levelEndedAt: null,
  displayedElapsedSeconds: 0,
  levelScore: 0,
  
  // Rolling animation
  roll: null, // {t, axis, totalAngle, edge, startOffset, startQuat, endPos, dir, destCol, destRow}
  
  // Patterns and icons
  currentPattern: [],
  icons: new Map(),
  
  // Messages
  message: 'Roll the cube onto a matching flat icon.',
  messageShownAt: 0,
  lastMessageSeen: null,
  
  // Rendering state
  cubeColorDirty: false,
  cubeRebuildAt: 0,
  dirtyShapes: new Set(),
  dirtyCubeShapes: new Set(),
  
  // World transform
  tiltDeg: 0,
  tiltReady: true,
  tiltTimer: 0,
  
  // Sky
  skyMode: 0,
  skyRequest: 0,
  
  // Input state
  leftButtonsDown: null,
  rightButtonsDown: null,
  
  // Debug
  debugVisible: true,
  debugTimer: 0,
  
  // Appearance
  appearanceOpen: false,
  appearanceItem: 0,
  appearancePart: 0,
  appearancePrev: false,
  appearanceTriggerPrev: false,
  appearanceDrag: null,
  appearance: {},
  
  // Session records
  sessionRecords: [],
};

export function resetCubePosition(col, row, orientation) {
  gameState.cubeCol = col;
  gameState.cubeRow = row;
  gameState.orientation = { ...orientation };
  gameState.roll = null;
}

export function setLevel(levelNum) {
  gameState.level = levelNum;
}

export function setMessage(msg) {
  gameState.message = msg;
}

export function setWin(won) {
  gameState.win = won;
}

export function getRoll() {
  return gameState.roll;
}

export function setRoll(rollState) {
  gameState.roll = rollState;
}

export function addSessionRecord(record) {
  gameState.sessionRecords.push(record);
  gameState.sessionRecords.sort((a, b) => b.score - a.score || a.elapsedSeconds - b.elapsedSeconds);
  gameState.sessionRecords.length = Math.min(gameState.sessionRecords.length, 10);
}

export function getAppearance() {
  return gameState.appearance;
}

export function setAppearance(appearance) {
  gameState.appearance = appearance;
}

export function markCubeColorDirty() {
  gameState.cubeColorDirty = true;
}

export function clearCubeColorDirty() {
  gameState.cubeColorDirty = false;
}

export function addDirtyCubeShape(shape) {
  gameState.dirtyCubeShapes.add(shape);
}

export function clearDirtyCubeShapes() {
  gameState.dirtyCubeShapes.clear();
}

export function addDirtyShape(shape) {
  gameState.dirtyShapes.add(shape);
}

export function clearDirtyShapes() {
  gameState.dirtyShapes.clear();
}
