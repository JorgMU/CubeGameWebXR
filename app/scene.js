import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
// v30: the home poses moved to app/sessionConfig.js
// (SESSION_DEFAULTS.boardHome_2D / .boardHome_MR).
import { SESSION_DEFAULTS } from './sessionConfig.js';

let renderer, scene, camera, worldGroup;

export function initScene() {
  // Renderer
  const canvas = document.getElementById('renderCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  // MR Button
  const mrButton = ARButton.createButton(renderer);
  // Glowy green border and text, like a bright computer display,
  // two-tone like the 2D buttons (see index.html): dark green at
  // rest, bright green + glow on hover. Size is left to three.js:
  // ARButton sets width/left itself (100 px for START MR, 150 px
  // for MR NOT SUPPORTED) and resets them when the support check
  // resolves, so overriding those was fighting it — v18 did, and it
  // is reverted here. Only padding, border and colours are
  // overridden, once: three.js sets those in stylizeElement() at
  // creation and never touches them again, so this sticks without
  // any re-applying. Padding is a bit less than three.js's
  // 12px 6px: 8px 6px. The hover half lives in index.html
  // (#ARButton:hover) because the rest colours are inline styles.
  // Note the rest state is dark green AND at three.js's 0.5 opacity
  // until hover, so it reads dimmer than the 2D buttons at rest;
  // on hover three.js raises opacity to 1.0 and the bright green +
  // glow show exactly as on the 2D buttons.
  mrButton.style.padding = '8px 6px';
  mrButton.style.border = '1px solid #007a33';
  mrButton.style.color = '#007a33';
  mrButton.style.background = 'rgba(0,0,0,0.35)';
  mrButton.style.textShadow = 'none';
  mrButton.style.boxShadow = 'none';
  new MutationObserver(() => {
    const text = mrButton.textContent.replace(/\bAR\b/, 'MR');
    if (text !== mrButton.textContent) mrButton.textContent = text;
  }).observe(mrButton, { childList: true, characterData: true, subtree: true });
  mrButton.textContent = mrButton.textContent.replace(/\bAR\b/, 'MR');
  document.body.appendChild(mrButton);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // Camera
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 4.2, 1.8);
  camera.lookAt(0, 1.0, -2.0);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(3, 6, 2);
  scene.add(sun);

  // World group (everything that moves together)
  worldGroup = new THREE.Group();
  const desktopHome = SESSION_DEFAULTS.boardHome_2D;
  worldGroup.position.set(desktopHome.position.x, desktopHome.position.y, desktopHome.position.z);
  worldGroup.scale.setScalar(desktopHome.scale);
  scene.add(worldGroup);

  return { renderer, scene, camera, worldGroup };
}

export function getRenderer() {
  return renderer;
}

export function getScene() {
  return scene;
}

export function getCamera() {
  return camera;
}

export function getWorldGroup() {
  return worldGroup;
}

export function onWindowResize(width, height) {
  if (!camera || !renderer) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

export function setAnimationLoop(callback) {
  renderer.setAnimationLoop(callback);
}

export function xrGetSession() {
  return renderer.xr.isPresenting ? renderer.xr.getSession() : null;
}

export function xrIsPresenting() {
  return renderer.xr.isPresenting;
}
