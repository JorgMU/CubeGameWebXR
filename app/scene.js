import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { HOMES } from './config.js';

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
  const desktopHome = HOMES.desktop;
  worldGroup.position.set(desktopHome.position.x, desktopHome.position.y, desktopHome.position.z);
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
