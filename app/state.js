// Centralized game state manager
// This module manages all game state and provides accessor functions for consistent state management.
import { INITIAL_ORIENTATION, START_COL, START_ROW } from './config.js';

export const gameState = {
  // Level and progression
  level: 1,
  remaining: 0,
  win: false,
  
  // Cube position and orientation
  cubeCol: START_COL,
  cubeRow: START_ROW,
  orientation: { ...INITIAL_ORIENTATION },
  
  // Game timing
  levelStartedAt: null,
  levelEndedAt: null,
  displayedElapsedSeconds: 0,
  levelScore: 0,
  
  // Rolling animation
  roll: null, // {t, axis, totalAngle, edge, startOffset, startQuat, endPos, dir, destCol, destRow}
  
  // Patterns and icons
  currentPattern: [],
  icons: new Map(), // "col,row" -> {colorIndex, mesh}
  
  // Messages
  message: 'Roll the cube onto a matching flat icon.',
  messageShownAt: 0,
  lastMessageSeen: null,
  
  // Rendering state
  cubeColorDirty: false,
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
  stickReady: true,
  stickTimer: 0,
  triggerPrev: false,
  leftButtonsDown: null,
  rightButtonsDown: null,
  drag: null, // {mode: 0 | 1 | 'both', mid, angle, dist, worldPos, worldQuat, worldScale}
  gripHeld: [false, false],
  
  // Menu
  menuOpen: false,
  menuHover: -1, // -1 none, 0 Debug, 1 Sky, 2 Reset view, 3 Exit MR
  menuPrev: false,
  exitPending: false,
  exitTimer: null,
  
  // Debug
  debugVisible: false,
  debugTimer: 0,
  
  // Audio and effects
  lastHapticAt: 0,
  audioCtx: null,
  celebrateT: null,
  
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

// ============================================================================
// Level and Game Management
// ============================================================================

export function getLevel() {
  return gameState.level;
}

export function setLevel(levelNum) {
  gameState.level = levelNum;
}

export function nextLevel() {
  gameState.level += 1;
}

export function getRemaining() {
  return gameState.remaining;
}

export function setRemaining(count) {
  gameState.remaining = count;
}

export function decrementRemaining() {
  if (gameState.remaining > 0) gameState.remaining--;
}

export function getWin() {
  return gameState.win;
}

export function setWin(won) {
  gameState.win = won;
}

// ============================================================================
// Cube Position and Orientation
// ============================================================================

export function getCubePosition() {
  return { col: gameState.cubeCol, row: gameState.cubeRow };
}

export function setCubePosition(col, row) {
  // Accept either (col, row) or ({col, row}); a single object arg used to
  // silently store the object as cubeCol and undefined as cubeRow, which
  // produced NaN cube positions and made the cube vanish after one roll.
  if (col !== null && typeof col === 'object') { row = col.row; col = col.col; }
  gameState.cubeCol = col;
  gameState.cubeRow = row;
}

export function getOrientation() {
  return gameState.orientation;
}

export function setOrientation(orientation) {
  gameState.orientation = { ...orientation };
}

export function resetCubePosition(col, row, orientation) {
  gameState.cubeCol = col;
  gameState.cubeRow = row;
  gameState.orientation = { ...orientation };
}

export function resetCubeState() {
  gameState.cubeCol = START_COL;
  gameState.cubeRow = START_ROW;
  gameState.orientation = { ...INITIAL_ORIENTATION };
  gameState.roll = null;
}

// ============================================================================
// Game Timing
// ============================================================================

export function getLevelStartedAt() {
  return gameState.levelStartedAt;
}

export function setLevelStartedAt(timestamp) {
  gameState.levelStartedAt = timestamp;
}

export function getLevelEndedAt() {
  return gameState.levelEndedAt;
}

export function setLevelEndedAt(timestamp) {
  gameState.levelEndedAt = timestamp;
}

export function getDisplayedElapsedSeconds() {
  return gameState.displayedElapsedSeconds;
}

export function setDisplayedElapsedSeconds(seconds) {
  gameState.displayedElapsedSeconds = seconds;
}

export function getLevelScore() {
  return gameState.levelScore;
}

export function setLevelScore(score) {
  gameState.levelScore = score;
}

export function elapsedLevelSeconds(now = performance.now()) {
  if (gameState.levelStartedAt === null) return 0;
  return Math.floor(((gameState.levelEndedAt ?? now) - gameState.levelStartedAt) / 1000);
}

export function resetLevelTiming() {
  gameState.levelStartedAt = null;
  gameState.levelEndedAt = null;
  gameState.displayedElapsedSeconds = 0;
  gameState.levelScore = 0;
}

// ============================================================================
// Rolling Animation
// ============================================================================

export function getRoll() {
  return gameState.roll;
}

export function setRoll(rollState) {
  gameState.roll = rollState;
}

export function clearRoll() {
  gameState.roll = null;
}

// ============================================================================
// Pattern and Icons
// ============================================================================

export function getPattern() {
  return gameState.currentPattern;
}

export function setPattern(pattern) {
  gameState.currentPattern = pattern;
}

export function getIcons() {
  return gameState.icons;
}

export function clearIcons() {
  gameState.icons.clear();
}

export function addIcon(key, entry) {
  gameState.icons.set(key, entry);
}

export function removeIcon(key) {
  gameState.icons.delete(key);
}

export function getIcon(key) {
  return gameState.icons.get(key);
}

// ============================================================================
// Messages
// ============================================================================

export function getMessage() {
  return gameState.message;
}

export function setMessage(msg) {
  gameState.message = msg;
}

export function getMessageShownAt() {
  return gameState.messageShownAt;
}

export function setMessageShownAt(timestamp) {
  gameState.messageShownAt = timestamp;
}

export function getLastMessageSeen() {
  return gameState.lastMessageSeen;
}

export function setLastMessageSeen(msg) {
  gameState.lastMessageSeen = msg;
}

// ============================================================================
// Rendering State
// ============================================================================

export function getCubeColorDirty() {
  return gameState.cubeColorDirty;
}

export function setCubeColorDirty(dirty) {
  gameState.cubeColorDirty = dirty;
}

export function getDirtyShapes() {
  return gameState.dirtyShapes;
}

export function addDirtyShape(shape) {
  gameState.dirtyShapes.add(shape);
}

export function clearDirtyShapes() {
  gameState.dirtyShapes.clear();
}

export function getDirtyCubeShapes() {
  return gameState.dirtyCubeShapes;
}

export function addDirtyCubeShape(shape) {
  gameState.dirtyCubeShapes.add(shape);
}

export function clearDirtyCubeShapes() {
  gameState.dirtyCubeShapes.clear();
}

// ============================================================================
// World Transform (Tilt)
// ============================================================================

export function getTiltDeg() {
  return gameState.tiltDeg;
}

export function setTiltDeg(degrees) {
  gameState.tiltDeg = degrees;
}

export function getTiltReady() {
  return gameState.tiltReady;
}

export function setTiltReady(ready) {
  gameState.tiltReady = ready;
}

export function getTiltTimer() {
  return gameState.tiltTimer;
}

export function setTiltTimer(timer) {
  gameState.tiltTimer = timer;
}

// ============================================================================
// Sky
// ============================================================================

export function getSkyMode() {
  return gameState.skyMode;
}

export function setSkyMode(mode) {
  gameState.skyMode = mode;
}

export function getSkyRequest() {
  return gameState.skyRequest;
}

export function incrementSkyRequest() {
  return ++gameState.skyRequest;
}

// ============================================================================
// Input State
// ============================================================================

export function getStickReady() {
  return gameState.stickReady;
}

export function setStickReady(ready) {
  gameState.stickReady = ready;
}

export function getStickTimer() {
  return gameState.stickTimer;
}

export function setStickTimer(timer) {
  gameState.stickTimer = timer;
}

export function getTriggerPrev() {
  return gameState.triggerPrev;
}

export function setTriggerPrev(prev) {
  gameState.triggerPrev = prev;
}

export function getLeftButtonsDown() {
  return gameState.leftButtonsDown;
}

export function setLeftButtonsDown(buttons) {
  gameState.leftButtonsDown = buttons;
}

export function getRightButtonsDown() {
  return gameState.rightButtonsDown;
}

export function setRightButtonsDown(buttons) {
  gameState.rightButtonsDown = buttons;
}

export function getDrag() {
  return gameState.drag;
}

export function setDrag(drag) {
  gameState.drag = drag;
}

export function getGripHeld() {
  return gameState.gripHeld;
}

// ============================================================================
// Menu
// ============================================================================

export function getMenuOpen() {
  return gameState.menuOpen;
}

export function setMenuOpen(open) {
  gameState.menuOpen = open;
}

export function getMenuHover() {
  return gameState.menuHover;
}

export function setMenuHover(hover) {
  gameState.menuHover = hover;
}

export function getMenuPrev() {
  return gameState.menuPrev;
}

export function setMenuPrev(prev) {
  gameState.menuPrev = prev;
}

export function getExitPending() {
  return gameState.exitPending;
}

export function setExitPending(pending) {
  gameState.exitPending = pending;
}

export function getExitTimer() {
  return gameState.exitTimer;
}

export function setExitTimer(timer) {
  gameState.exitTimer = timer;
}

// ============================================================================
// Debug
// ============================================================================

export function getDebugVisible() {
  return gameState.debugVisible;
}

export function setDebugVisible(visible) {
  gameState.debugVisible = visible;
}

export function toggleDebugVisible() {
  gameState.debugVisible = !gameState.debugVisible;
}

export function getDebugTimer() {
  return gameState.debugTimer;
}

export function setDebugTimer(timer) {
  gameState.debugTimer = timer;
}

// ============================================================================
// Audio and Effects
// ============================================================================

export function getLastHapticAt() {
  return gameState.lastHapticAt;
}

export function setLastHapticAt(timestamp) {
  gameState.lastHapticAt = timestamp;
}

export function getAudioCtx() {
  return gameState.audioCtx;
}

export function setAudioCtx(ctx) {
  gameState.audioCtx = ctx;
}

export function getCelebrateT() {
  return gameState.celebrateT;
}

export function setCelebrateT(t) {
  gameState.celebrateT = t;
}

// ============================================================================
// Appearance
// ============================================================================

export function getAppearance() {
  return gameState.appearance;
}

export function setAppearance(appearance) {
  gameState.appearance = appearance;
}

export function getAppearanceOpen() {
  return gameState.appearanceOpen;
}

export function setAppearanceOpen(open) {
  gameState.appearanceOpen = open;
}

export function getAppearanceItem() {
  return gameState.appearanceItem;
}

export function setAppearanceItem(item) {
  gameState.appearanceItem = item;
}

export function getAppearancePart() {
  return gameState.appearancePart;
}

export function setAppearancePart(part) {
  gameState.appearancePart = part;
}

export function getAppearancePrev() {
  return gameState.appearancePrev;
}

export function setAppearancePrev(prev) {
  gameState.appearancePrev = prev;
}

export function getAppearanceTriggerPrev() {
  return gameState.appearanceTriggerPrev;
}

export function setAppearanceTriggerPrev(prev) {
  gameState.appearanceTriggerPrev = prev;
}

export function getAppearanceDrag() {
  return gameState.appearanceDrag;
}

export function setAppearanceDrag(drag) {
  gameState.appearanceDrag = drag;
}

// ============================================================================
// Session Records
// ============================================================================

export function getSessionRecords() {
  return gameState.sessionRecords;
}

export function addSessionRecord(record) {
  gameState.sessionRecords.push(record);
  gameState.sessionRecords.sort((a, b) => b.score - a.score || a.elapsedSeconds - b.elapsedSeconds);
  gameState.sessionRecords.length = Math.min(gameState.sessionRecords.length, 10);
}

export function clearSessionRecords() {
  gameState.sessionRecords.length = 0;
}
