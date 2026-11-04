// Dynamic build timestamp calculated from Last-Modified headers of core files

const FILES_TO_CHECK = [
  './index.html',
  './main.js',
  './config.js',
  './cube.js',
  './materials.js'
];

async function getFileModifiedTime(filePath) {
  try {
    // Use GET with Range header to minimize data transfer while still getting headers
    const response = await fetch(filePath, { 
      method: 'GET',
      headers: { 'Range': 'bytes=0-0' }
    });
    const lastModified = response.headers.get('Last-Modified');
    if (lastModified) {
      return new Date(lastModified);
    }
  } catch (e) {
    // File fetch failed, skip this file
    console.debug(`Could not fetch Last-Modified for ${filePath}:`, e.message);
  }
  return null;
}

function formatTimestamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}@${hours}:${minutes}:${seconds}`;
}

export async function calculateBuildTimestamp() {
  const timestamps = [];

  for (const file of FILES_TO_CHECK) {
    const modTime = await getFileModifiedTime(file);
    if (modTime) {
      timestamps.push(modTime);
    }
  }

  if (timestamps.length === 0) {
    // Fallback: use current time if no files have Last-Modified headers
    console.debug('No files with Last-Modified headers found, using current time');
    return formatTimestamp(new Date());
  }

  // Find the most recent timestamp
  const newestTime = new Date(Math.max(...timestamps.map(t => t.getTime())));
  return formatTimestamp(newestTime);
}

// Pre-calculate on module load for immediate use
export const BUILD_TIMESTAMP = await calculateBuildTimestamp();

