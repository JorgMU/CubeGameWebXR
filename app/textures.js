import * as THREE from 'three';
import { COLORS, SHAPE_BORDER_COLOR, SHAPE_BORDER_WIDTH } from './config.js';

// Shape styles for drawing icons
export let shapeStyles = {};

export function initShapeStyles() {
  shapeStyles = {};
  for (const col of COLORS) {
    shapeStyles[col.shape] = { fill: col.css, border: SHAPE_BORDER_COLOR, width: SHAPE_BORDER_WIDTH };
  }
}

export function drawIcon(c, shape, background = null) {
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 256, 256); }
  ctx.fillStyle = shapeStyles[shape].fill;
  ctx.strokeStyle = shapeStyles[shape].border;
  ctx.lineWidth = Math.max(shapeStyles[shape].width, 0.01);
  ctx.beginPath();
  const cx = 128, cy = 128, r = 84;
  if (shape === 'circle') {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else if (shape === 'triangle') {
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r * 0.8); ctx.lineTo(cx - r, cy + r * 0.8); ctx.closePath();
  } else if (shape === 'square') {
    ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
  } else if (shape === 'diamond') {
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.PI / 5) * i;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fill(); ctx.stroke();
}

export function makeIconTexture(shape, background = null) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  drawIcon(c, shape, background);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function redrawIconTexture(tex, shape, background = null) {
  drawIcon(tex.image, shape, background);
  tex.needsUpdate = true;
}

export function createIconTextures() {
  return COLORS.map((col) => makeIconTexture(col.shape));
}
