import * as THREE from 'three';
import { CUBE, INITIAL_ORIENTATION } from './config.js';
import { cellToLocal } from './utils.js';
import { createCubeMaterials, createCubeShapeMaterials } from './materials.js';

let cube;
let cubeMaterials;
let cubeShapeMaterials;
let cubeFaceColorIndices;

export function initCube(iconTextures) {
  cubeFaceColorIndices = [
    INITIAL_ORIENTATION.east, INITIAL_ORIENTATION.west, INITIAL_ORIENTATION.up,
    INITIAL_ORIENTATION.down, INITIAL_ORIENTATION.south, INITIAL_ORIENTATION.north,
  ];

  cubeMaterials = createCubeMaterials();
  cubeShapeMaterials = createCubeShapeMaterials(iconTextures, cubeFaceColorIndices);
  // Six separate planes, one per face, in a group — NOT one BoxGeometry.
  // A BoxGeometry draws its six faces in a fixed material order, never
  // sorted by distance, so with a transparent cube the back face (drawn
  // last) blended over the front, and with FrontSide the back faces were
  // culled entirely and never showed through at all. That is the trap the
  // earlier fixes fell into: depthTest:false + DoubleSide on a box, then
  // FrontSide on a box, both wrong in opposite ways. Separate plane
  // meshes are ordinary transparent objects, so Three.js sorts them by
  // distance every frame — far faces first, near face last — and the
  // shapes on the far side show through the near faces, in the right
  // order, at 60% opacity. Face order matches BoxGeometry's material
  // order: east, west, up, down, south, north. Each plane is rotated so
  // its icon is upright viewed from outside that face.
  const h = CUBE / 2;
  const faces = [
    { pos: [h, 0, 0], rot: [0, Math.PI / 2, 0] },   // east  (+x)
    { pos: [-h, 0, 0], rot: [0, -Math.PI / 2, 0] }, // west  (-x)
    { pos: [0, h, 0], rot: [-Math.PI / 2, 0, 0] },  // up    (+y), icon top to the north
    { pos: [0, -h, 0], rot: [Math.PI / 2, 0, 0] },  // down  (-y)
    { pos: [0, 0, h], rot: [0, 0, 0] },             // south (+z)
    { pos: [0, 0, -h], rot: [0, Math.PI, 0] },      // north (-z)
  ];
  cube = new THREE.Group();
  const shapeEps = 0.0015; // shape plane sits just outside its face, so it
  // draws over the face without z-fighting. The face position already
  // lies along its own normal, so scaling it out a little moves the
  // plane straight outwards.
  faces.forEach((face, i) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CUBE, CUBE), cubeMaterials[i]);
    mesh.position.set(face.pos[0], face.pos[1], face.pos[2]);
    mesh.rotation.set(face.rot[0], face.rot[1], face.rot[2]);
    cube.add(mesh);
    const shapeMesh = new THREE.Mesh(new THREE.PlaneGeometry(CUBE, CUBE), cubeShapeMaterials[i]);
    const so = (h + shapeEps) / h;
    shapeMesh.position.set(face.pos[0] * so, face.pos[1] * so, face.pos[2] * so);
    shapeMesh.rotation.set(face.rot[0], face.rot[1], face.rot[2]);
    cube.add(shapeMesh);
  });

  // v40: no edges here any more — main.js adds the cube's only edge
  // set after initCube, and that is the one applyLineColors updates
  // (B-panel colour, Reset Colors). This one was a second, identical
  // set that nobody ever updated, drawn underneath the other.

  return cube;
}

export function getCube() {
  return cube;
}

export function getCubeMaterials() {
  return cubeMaterials;
}

export function getCubeShapeMaterials() {
  return cubeShapeMaterials;
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
  cubeMaterials.forEach((mat) => {
    mat.opacity = opacity;
    mat.transparent = opacity < 1;
    // Mode switch with the opacity: transparent = DoubleSide, no depth
    // write (far faces visible through near faces, sorted back-to-front);
    // opaque = FrontSide, depth write (solid cube, back faces culled).
    mat.side = opacity < 1 ? THREE.DoubleSide : THREE.FrontSide;
    mat.depthWrite = opacity >= 1;
    mat.needsUpdate = true;
  });
  // Shapes keep their own opacity; only their side follows the face mode.
  cubeShapeMaterials.forEach((mat) => {
    mat.side = opacity < 1 ? THREE.DoubleSide : THREE.FrontSide;
    mat.needsUpdate = true;
  });
}
