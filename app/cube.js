import * as THREE from 'three';
import { CUBE, INITIAL_ORIENTATION, CUBE_OPACITY } from './config.js';
import { cellToLocal } from './utils.js';
import { createCubeMaterials, createCubeEdgeMaterial } from './materials.js';

let cube;
let cubeMaterials;
let cubeFaceColorIndices;

export function initCube(iconTextures) {
  cubeFaceColorIndices = [
    INITIAL_ORIENTATION.east, INITIAL_ORIENTATION.west, INITIAL_ORIENTATION.up,
    INITIAL_ORIENTATION.down, INITIAL_ORIENTATION.south, INITIAL_ORIENTATION.north,
  ];

  cubeMaterials = createCubeMaterials(iconTextures);
  cube = new THREE.Mesh(new THREE.BoxGeometry(CUBE, CUBE, CUBE), cubeMaterials);
  
  const cubeEdgeMaterial = createCubeEdgeMaterial();
  cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), cubeEdgeMaterial));
  cube.renderOrder = 1;

  return cube;
}

export function getCube() {
  return cube;
}

export function getCubeMaterials() {
  return cubeMaterials;
}

export function getCubeFaceColorIndices() {
  return cubeFaceColorIndices;
}

export function setCubePosition(col, row) {
  const p = cellToLocal(col, row);
  cube.position.set(p.x, CUBE / 2 + 0.004, p.z);
}

export function resetCubeTransform() {
  cube.quaternion.identity();
}

export function getCubePosition() {
  return cube.position.clone();
}

export function getCubeQuaternion() {
  return cube.quaternion.clone();
}

export function setCubeQuaternion(quat) {
  cube.quaternion.copy(quat);
}

export function applyRollAnimation(quaternion) {
  cube.quaternion.copy(quaternion);
}

export function setCubeMaterialOpacity(opacity) {
  cubeMaterials.forEach((mat) => { mat.opacity = opacity; });
}
