import * as THREE from 'three';
import { CUBE_FACE_BLUE, CUBE_OPACITY, CUBE_EDGE_COLOR, BOARD_COLOR, BOARD_OPACITY, GRID_COLOR } from './config.js';
import { makeIconTexture } from './textures.js';
import { COLORS } from './config.js';

// Cube materials
export function createCubeFaceMaterial(colorIndex, iconTextures) {
  return new THREE.MeshStandardMaterial({
    map: iconTextures[colorIndex],
    transparent: true,
    opacity: CUBE_OPACITY,
    depthWrite: true,
    depthTest: false,
    side: THREE.DoubleSide,
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
