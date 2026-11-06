// Build timestamp for the HUD, computed from Last-Modified headers.
// This is how the user checks that the latest files actually loaded:
// the HUD date moves whenever any served file changes.
// Fallback is the build label in config.js, NOT the current time -- using
// "now" would make the timestamp change on every load even when no file
// changed, which would defeat its purpose.
import { BUILD_LABEL } from './config.js';

const FILES_TO_CHECK = [
  './index.html',
  './main.js',
  './config.js',
  './sessionConfig.js',
  './state.js',
  './cube.js',
  './materials.js',
  './scene.js',
  './textures.js',
  './utils.js',
];

async function getFileModifiedTime(filePath) {
  try {
    const response = await fetch(filePath, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-0' },
      cache: 'reload', // never read Last-Modified from a cached copy, and prime the cache with the fresh file
    });
    const lastModified = response.headers.get('Last-Modified');
    if (lastModified) return new Date(lastModified);
  } catch (e) {
    console.debug(`Could not fetch Last-Modified for ${filePath}:`, e.message);
  }
  return null;
}

function formatTimestamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const sec = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}@${h}:${min}:${sec}`;
}

export async function calculateBuildTimestamp() {
  const timestamps = [];
  for (const file of FILES_TO_CHECK) {
    const modTime = await getFileModifiedTime(file);
    if (modTime) timestamps.push(modTime);
  }
  if (timestamps.length === 0) return BUILD_LABEL;
  return formatTimestamp(new Date(Math.max(...timestamps.map((t) => t.getTime()))));
}

export const BUILD_TIMESTAMP = await calculateBuildTimestamp();
