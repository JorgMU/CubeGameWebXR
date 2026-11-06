import * as THREE from 'three';
// v30: the appearance defaults moved to app/sessionConfig.js
// (SESSION_DEFAULTS.appearance); the material factories read them
// from there now instead of from config.js.
import { SESSION_DEFAULTS } from './sessionConfig.js';
import { makeIconTexture } from './textures.js';
import { COLORS } from './config.js';

const ap = SESSION_DEFAULTS.appearance;

// Cube materials. Each face is two planes (see cube.js): a plain-colour
// background and, just outside it, the shape on its own. That is what
// lets the face opacity and the shape opacity be adjusted separately —
// before, background and shape were baked into one texture on one
// material, so one opacity moved both.
export function createCubeFaceMaterial() {
  // Transparent mode (opacity < 1, the user's case at 0.6): the far faces
  // must be visible through the near faces, so the material is DoubleSide
  // and does NOT write depth — depthTest stays on, so the board and other
  // opaque objects still occlude the cube correctly. At opacity 1 the
  // cube is opaque: FrontSide + depthWrite, as a solid cube. The mode is
  // switched in applyCubeOpacity() / setCubeMaterialOpacity(); the
  // per-face sorting that makes this work is in cube.js (six separate
  // planes, not one BoxGeometry — see there).
  return new THREE.MeshStandardMaterial({
    transparent: ap.cube.opacity < 1,
    opacity: ap.cube.opacity,
    side: ap.cube.opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: ap.cube.opacity >= 1,
  });
}

export function createCubeMaterials() {
  return Array.from({ length: 6 }, () => createCubeFaceMaterial());
}

export function createCubeShapeMaterial(colorIndex, iconTextures) {
  // Shape only: the texture has a transparent background (drawn without
  // one), so the face colour shows through it. Always transparent (the
  // texture has transparent pixels); side follows the face opacity mode,
  // switched with it in applyCubeOpacity() / setCubeMaterialOpacity().
  return new THREE.MeshStandardMaterial({
    map: iconTextures[colorIndex],
    transparent: true,
    opacity: ap.cubeIcons.opacity,
    side: ap.cube.opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: false,
  });
}

export function createCubeShapeMaterials(iconTextures, cubeFaceColorIndices) {
  return cubeFaceColorIndices.map(colorIndex => createCubeShapeMaterial(colorIndex, iconTextures));
}

export function createCubeEdgeMaterial() {
  return new THREE.LineBasicMaterial({ color: ap.edges.color });
}

// Board materials
export function createBoardMaterial() {
  const boardTex = makeIconTexture('square', ap.board.color);
  return new THREE.MeshBasicMaterial({
    map: boardTex,
    transparent: true,
    opacity: ap.board.opacity,
    side: THREE.DoubleSide,
  });
}

export function createGridMaterial() {
  return new THREE.LineBasicMaterial({ color: ap.grid.color });
}

// Icon materials
export function createIconMaterial(iconTexture) {
  return new THREE.MeshBasicMaterial({
    map: iconTexture,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

// Sky material
export function createSkyMaterial() {
  return new THREE.MeshBasicMaterial({ depthWrite: false, fog: false });
}

// Panel materials
export function createPanelMaterial(texture) {
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

// Debug panel material
export function createDebugMaterial(texture) {
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
}
