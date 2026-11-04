import * as THREE from 'three';
import { GRID, CELL } from './config.js';

// Math utilities
export function cellToLocal(col, row) {
  const centre = (GRID - 1) / 2;
  return new THREE.Vector3((col - centre) * CELL, 0, (row - centre) * CELL);
}

export function keyOf(col, row) {
  return `${col},${row}`;
}

// Color utilities
export function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [r + m, g + m, b + m];
}

export function rgbToHex(r, g, b) {
  return ((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)).toString(16).padStart(6, '0');
}

export function hsvCss(h, s, v) {
  const [r, g, b] = hsvToRgb(h, s, v);
  return `#${rgbToHex(r, g, b)}`;
}

export function cssToHsv(css) {
  const n = parseInt(css.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max };
}

// Clamping
export const apClamp01 = (x) => Math.max(0, Math.min(1, x));

// Formatting
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60), s = Math.floor(seconds) % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Haptics
export function triggerHaptic(intensity, duration, hand = 'left') {
  if (!('vibrate' in navigator)) return;
  if (hand === 'left' && window.leftGamepad?.vibrationActuator) {
    window.leftGamepad.vibrationActuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration,
      weakMagnitude: intensity,
      strongMagnitude: intensity,
    });
  } else if (hand === 'right' && window.rightGamepad?.vibrationActuator) {
    window.rightGamepad.vibrationActuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration,
      weakMagnitude: intensity,
      strongMagnitude: intensity,
    });
  }
}
