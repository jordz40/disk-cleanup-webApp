'use strict';

const fsp = require('fs').promises;
const path = require('path');
const { classify, SYSTEM_DIRS } = require('./rules');

class TopHeap {
  constructor(limit, sizeOf) {
    this.limit = limit;
    this.sizeOf = sizeOf;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  offer(item) {
    const score = this.sizeOf(item);
    if (this.items.length < this.limit) {
      this.items.push(item);
      this.up(this.items.length - 1);
      return;
    }
    if (score > this.sizeOf(this.items[0])) {
      this.items[0] = item;
      this.down(0);
    }
  }

  up(index) {
    const items = this.items;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.sizeOf(items[parent]) <= this.sizeOf(items[index])) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }

  down(index) {
    const items = this.items;
    const length = items.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.sizeOf(items[left]) < this.sizeOf(items[smallest])) smallest = left;
      if (right < length && this.sizeOf(items[right]) < this.sizeOf(items[smallest])) smallest = right;
      if (smallest === index) break;
      [items[smallest], items[index]] = [items[index], items[smallest]];
      index = smallest;
    }
  }

  sorted() {
    return this.items.slice().sort((a, b) => this.sizeOf(b) - this.sizeOf(a));
  }
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

function depthOf(p) {
  let depth = 0;
  for (let i = 0; i < p.length; i++) if (p[i] === '\\') depth++;
  return depth;
}

function isSkippedDir(fullPath) {
  const lower = fullPath.toLowerCase();
  return SYSTEM_DIRS.some((dir) => lower === dir);
}

async function scan(options) {
  const {
    root,
    includeSystem = false,
    minSize = 10 * 1024 * 1024,
    topN = 3000,
    maxFiles = 1500000,
    maxDepth = 48,
    onProgress,
    isCancelled = () => false
  } = options;

  const startedAt = Date.now();
  const heap = new TopHeap(topN, (file) => file.size);
  const dirBytes = new Map();
  const dirFiles = new Map();
  const skipped = [];

  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;
  let errorCount = 0;
  let cancelled = false;
  let truncated = false;
  let lastReport = 0;

  function report(currentDir, force = false) {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastReport < 250) return;
    lastReport = now;
    onProgress({
      files: fileCount,
      dirs: dirCount,
      bytes: totalBytes,
      elapsedMs: now - startedAt,
      currentDir
    });
  }

  async function readDir(dir, depth) {
    if (isCancelled()) {
      cancelled = true;
      return [];
    }

    dirCount++;
    if (!dirBytes.has(dir)) dirBytes.set(dir, 0);

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      errorCount++;
      return [];
    }

    const subdirs = [];
    const files = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!includeSystem && isSkippedDir(full)) {
          skipped.push(full);
          continue;
        }
        if (depth + 1 > maxDepth) {
          skipped.push(full);
          continue;
        }
        subdirs.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }

    if (files.length) {
      const stats = await mapLimit(files, 32, async (filePath) => {
        try {
          const st = await fsp.lstat(filePath);
          return { path: filePath, st };
        } catch {
          errorCount++;
          return null;
        }
      });

      for (const item of stats) {
        if (!item) continue;
        const { path: filePath, st } = item;
        if (!st.isFile()) continue;

        fileCount++;
        totalBytes += st.size;
        dirBytes.set(dir, (dirBytes.get(dir) || 0) + st.size);
        dirFiles.set(dir, (dirFiles.get(dir) || 0) + 1);

        if (st.size >= minSize) {
          heap.offer({ path: filePath, size: st.size, mtime: st.mtimeMs });
        }

        if (fileCount >= maxFiles) {
          truncated = true;
          cancelled = true;
          break;
        }
      }
    }

    report(dir);
    if (cancelled) return [];
    return subdirs;
  }

  let frontier = [root];
  let depth = 0;

  while (frontier.length) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }

    const next = [];
    for (let i = 0; i < frontier.length; i += 32) {
      const batch = frontier.slice(i, i + 32);
      const results = await mapLimit(batch, 8, (dir) => readDir(dir, depth));
      for (const list of results) {
        for (const dir of list) next.push(dir);
      }
      if (cancelled) break;
    }

    if (cancelled) break;
    frontier = next;
    depth++;
    report(frontier[0] || root, true);
  }

  const dirKeys = Array.from(dirBytes.keys()).sort((a, b) => depthOf(b) - depthOf(a));
  for (const dir of dirKeys) {
    const parent = path.win32.dirname(dir);
    if (!parent || parent === dir) continue;
    dirBytes.set(parent, (dirBytes.get(parent) || 0) + dirBytes.get(dir));
    dirFiles.set(parent, (dirFiles.get(parent) || 0) + (dirFiles.get(dir) || 0));
  }

  const files = heap.sorted().map((file) => {
    const info = classify(file.path);
    return {
      path: file.path,
      name: path.win32.basename(file.path),
      size: file.size,
      mtime: new Date(file.mtime).toISOString(),
      level: info.level,
      category: info.category,
      suggested: info.suggested,
      reason: info.reason
    };
  });

  const rootPrefix = root.endsWith('\\') ? root : root + '\\';
  const dirs = Array.from(dirBytes.entries())
    .filter(([dir]) => dir !== root && dir.startsWith(rootPrefix))
    .map(([dir, bytes]) => {
      const info = classify(dir);
      return {
        path: dir,
        name: path.win32.basename(dir),
        size: bytes,
        files: dirFiles.get(dir) || 0,
        level: info.level,
        category: info.category,
        reason: info.reason
      };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, 300);

  report(root, true);

  return {
    root,
    includeSystem,
    minSize,
    files,
    dirs,
    skipped,
    stats: {
      files: fileCount,
      dirs: dirCount,
      bytes: totalBytes,
      errors: errorCount,
      elapsedMs: Date.now() - startedAt,
      cancelled,
      truncated,
      topN
    }
  };
}

async function checkAccess(files, limit = 1200) {
  const targets = files.slice(0, limit).filter((file) => file.level !== 'protected');
  await mapLimit(targets, 24, async (file) => {
    let handle;
    try {
      handle = await fsp.open(file.path, 'r+');
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'ETXTBSY') {
        file.level = 'protected';
        file.reason = 'File sedang dipakai aplikasi lain. Tutup aplikasinya dulu.';
      } else if (err.code === 'EACCES' || err.code === 'EPERM') {
        file.level = 'protected';
        file.reason = 'File read-only atau butuh hak administrator untuk dihapus.';
      } else if (err.code === 'ENOENT') {
        file.level = 'protected';
        file.reason = 'File sudah tidak ada saat diperiksa.';
      }
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
    }
  });
  return files;
}

module.exports = { scan, checkAccess };
