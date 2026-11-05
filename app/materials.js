import * as THREE from 'three';
import { CUBE_OPACITY, CUBE_EDGE_COLOR, BOARD_COLOR, BOARD_OPACITY, GRID_COLOR } from './config.js';
import { makeIconTexture } from './textures.js';
import { COLORS } from './config.js';

// Cube materials
export function createCubeFaceMaterial(colorIndex, iconTextures) {
  // Transparent mode (opacity < 1, the user's case at 0.6): the far faces
  // must be visible through the near faces, so the material is DoubleSide
  // and does NOT write depth — depthTest stays on, so the board and other
  // opaque objects still occlude the cube correctly. At opacity 1 the
  // cube is opaque: FrontSide + depthWrite, as a solid cube. The mode is
  // switched in applyCubeOpacity() / setCubeMaterialOpacity(); the
  // per-face sorting that makes this work is in cube.js (six separate
  // planes, not one BoxGeometry — see there).
  return new THREE.MeshStandardMaterial({
    map: iconTextures[colorIndex],
    transparent: CUBE_OPACITY < 1,
    opacity: CUBE_OPACITY,
    side: CUBE_OPACITY < 1 ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: CUBE_OPACITY >= 1,
  });
}

export function createCubeMaterials(iconTextures, cubeFaceColorIndices) {
  return cubeFaceColorIndices.map(colorIndex => createCubeFaceMaterial(colorIndex, iconTextures));
}

export function createCubeEdgeMaterial() {
  return new THREE.LineBasicMaterial({ color: CUBE_EDGE_COLOR });
}

// Board materials
export function createBoardMaterial() {
  const boardTex = makeIconTexture('square', BOARD_COLOR);
  return new THREE.MeshBasicMaterial({
    map: boardTex,
    transparent: true,
    opacity: BOARD_OPACITY,
    side: THREE.DoubleSide,
  });
}

export function createGridMaterial() {
  return new THREE.LineBasicMaterial({ color: GRID_COLOR });
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
