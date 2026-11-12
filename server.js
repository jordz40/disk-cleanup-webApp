'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const { scan, checkAccess } = require('./lib/scanner');
const { deleteFiles } = require('./lib/delete');
const { listApps, uninstallApp } = require('./lib/apps');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_PORT = Number(process.env.PORT) || 4321;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJson(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Payload terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON tidak valid'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const target = path.resolve(PUBLIC_DIR, '.' + pathname);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Tidak ditemukan');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

async function listDrives() {
  const drives = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    try {
      const stats = await fsp.statfs(`${letter}:\\`);
      const total = stats.bsize * stats.blocks;
      if (!total) continue;
      const free = stats.bsize * stats.bavail;
      drives.push({ letter: `${letter}:`, total, free, used: total - free });
    } catch {
      /* drive tidak tersedia */
    }
  }
  return drives;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}

function normalizeRoot(input) {
  if (!input) return 'C:\\';
  const trimmed = String(input).trim();
  if (/^[a-zA-Z]:$/.test(trimmed)) return trimmed.toUpperCase() + '\\';
  return trimmed;
}

async function handleScan(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const root = normalizeRoot(url.searchParams.get('root'));
  const includeSystem = url.searchParams.get('system') === '1';
  const minSizeMb = Number(url.searchParams.get('minSizeMb'));
  const minSize = Number.isFinite(minSizeMb) && minSizeMb >= 0 ? minSizeMb * 1024 * 1024 : 10 * 1024 * 1024;
  const topN = Math.min(Math.max(Number(url.searchParams.get('topN')) || 3000, 100), 10000);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  res.on('close', () => {
    if (!res.writableEnded) closed = true;
  });

  const send = (payload) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let stat;
  try {
    stat = await fsp.stat(root);
    if (!stat.isDirectory()) throw new Error('Path bukan folder');
  } catch (err) {
    send({ type: 'error', message: `Folder tidak bisa dibuka: ${err.message}` });
    res.end();
    return;
  }

  send({ type: 'start', root, minSize, includeSystem });

  try {
    const result = await scan({
      root,
      includeSystem,
      minSize,
      topN,
      onProgress: (progress) => send({ type: 'progress', ...progress }),
      isCancelled: () => closed
    });

    if (closed) return;

    await checkAccess(result.files);
    send({ type: 'done', ...result });
    res.end();
  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
}

async function handleDelete(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const paths = Array.isArray(body.paths) ? body.paths.filter((p) => typeof p === 'string') : [];
  if (!paths.length) return sendJson(res, 400, { error: 'Tidak ada file yang dipilih' });
  if (paths.length > 5000) return sendJson(res, 400, { error: 'Maksimal 5000 file per proses' });

  try {
    const result = await deleteFiles(paths, { permanent: !!body.permanent });
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  try {
    if (pathname === '/api/drives' && req.method === 'GET') {
      return sendJson(res, 200, { drives: await listDrives() });
    }

    if (pathname === '/api/scan' && req.method === 'GET') {
      return handleScan(req, res);
    }

    if (
      (pathname === '/api/delete' || pathname === '/api/reveal' || pathname === '/api/apps/uninstall') &&
      req.method === 'POST' &&
      !originAllowed(req)
    ) {
      return sendJson(res, 403, { error: 'Origin tidak diizinkan' });
    }

    if (pathname === '/api/apps' && req.method === 'GET') {
      const data = await listApps(url.searchParams.get('refresh') === '1');
      return sendJson(res, 200, data);
    }

    if (pathname === '/api/apps/uninstall' && req.method === 'POST') {
      const body = await readJson(req, 64 * 1024);
      if (!body.id || typeof body.id !== 'string') return sendJson(res, 400, { error: 'ID aplikasi kosong' });
      try {
        const result = await uninstallApp(body.id);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message });
      }
    }

    if (pathname === '/api/delete' && req.method === 'POST') {
      return handleDelete(req, res);
    }

    if (pathname === '/api/reveal' && req.method === 'POST') {
      const body = await readJson(req, 64 * 1024);
      const target = typeof body.path === 'string' ? body.path : '';
      if (!target) return sendJson(res, 400, { error: 'Path kosong' });
      try {
        await fsp.access(target);
      } catch {
        return sendJson(res, 404, { error: 'Path tidak ditemukan' });
      }
      const args = body.folder ? [target] : [`/select,${target}`];
      spawn('explorer.exe', args, { detached: true, windowsHide: true }).unref();
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res);
    }

    sendJson(res, 405, { error: 'Metode tidak didukung' });
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  }
});

function listen(port, attempts = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts < 10) {
      listen(port + 1, attempts + 1);
      return;
    }
    console.error('Gagal menjalankan server:', err.message);
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log('');
    console.log('  File Checker berjalan di ' + url);
    console.log('  Tutup jendela ini (Ctrl+C) untuk menghentikan aplikasi.');
    console.log('');
    if (!process.argv.includes('--no-open')) {
      spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true }).unref();
    }
  });
}

listen(DEFAULT_PORT);
