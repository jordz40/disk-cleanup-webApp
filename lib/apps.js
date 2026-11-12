'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { runPowerShell } = require('./powershell');

const LIST_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$items = @(Get-ItemProperty -Path $paths |
  Where-Object {
    $_.DisplayName -and
    -not $_.SystemComponent -and
    -not $_.ParentKeyName -and
    $_.ReleaseType -notmatch 'Update|Hotfix|Security Update' -and
    $_.DisplayName -notmatch '^(KB[0-9]+|Update for |Security Update for )'
  } |
  Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, InstallDate, EstimatedSize, UninstallString, QuietUninstallString, PSPath)
ConvertTo-Json -InputObject $items -Depth 3 -Compress
`;

const cache = { apps: [], at: 0, loading: null };

function parseInstallDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{8}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

function parseUninstallCommand(command) {
  const trimmed = String(command || '').trim();
  if (!trimmed) return null;

  const msi = trimmed.match(/msiexec(?:\.exe)?\s+.*?(\{[0-9A-Fa-f-]{36}\})/i);
  if (msi) {
    return { file: 'msiexec.exe', args: ['/x', msi[1]], display: `msiexec.exe /x ${msi[1]}` };
  }

  let file = '';
  let argsText = '';
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    if (end > 0) {
      file = trimmed.slice(1, end);
      argsText = trimmed.slice(end + 1).trim();
    }
  }

  if (!file) {
    const match = trimmed.match(/^(.+?\.exe)(?:\s+([\s\S]*))?$/i);
    if (match) {
      file = match[1].trim();
      argsText = (match[2] || '').trim();
    } else {
      file = trimmed;
      argsText = '';
    }
  }

  const args = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let token;
  while ((token = pattern.exec(argsText))) {
    args.push(token[1] !== undefined ? token[1] : token[2]);
  }

  return { file, args, display: trimmed };
}

function sourceOf(psPath) {
  const value = String(psPath || '');
  if (value.includes('WOW6432Node')) return '32-bit';
  if (value.includes('HKEY_CURRENT_USER')) return 'Pengguna';
  return '64-bit';
}

function normalizeApp(item) {
  const name = String(item.DisplayName || '').replace(/\s+/g, ' ').trim();
  if (!name) return null;

  const estimated = Number(item.EstimatedSize);
  const location = String(item.InstallLocation || '').trim().replace(/^"|"$/g, '');
  const uninstallString = String(item.UninstallString || '').trim();
  const quietUninstallString = String(item.QuietUninstallString || '').trim();

  return {
    id: String(item.PSPath || '').trim() || `${name}-${item.DisplayVersion || ''}`,
    name,
    version: String(item.DisplayVersion || '').trim(),
    publisher: String(item.Publisher || '').trim(),
    size: Number.isFinite(estimated) && estimated > 0 ? estimated * 1024 : null,
    installDate: parseInstallDate(item.InstallDate),
    location,
    uninstallString: uninstallString || quietUninstallString,
    quiet: !uninstallString && !!quietUninstallString,
    source: sourceOf(item.PSPath)
  };
}

async function readRegistryApps() {
  const result = await runPowerShell(LIST_SCRIPT, 90000);
  const raw = (result.stdout || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('Tidak bisa membaca daftar aplikasi dari registry Windows');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Format daftar aplikasi tidak dikenali');
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Map();

  for (const item of items) {
    const app = normalizeApp(item);
    if (!app) continue;
    const key = `${app.name}|${app.version}`.toLowerCase();
    const previous = seen.get(key);

    if (!previous) {
      seen.set(key, app);
      continue;
    }

    seen.set(key, {
      ...previous,
      size: previous.size || app.size,
      uninstallString: previous.uninstallString || app.uninstallString,
      quiet: previous.quiet && app.quiet,
      installDate: previous.installDate || app.installDate,
      location: previous.location || app.location,
      publisher: previous.publisher || app.publisher
    });
  }

  return Array.from(seen.values()).sort((a, b) => {
    if ((b.size || 0) !== (a.size || 0)) return (b.size || 0) - (a.size || 0);
    return a.name.localeCompare(b.name, 'id');
  });
}

async function listApps(force = false) {
  if (!force && cache.apps.length && Date.now() - cache.at < 60000) {
    return buildPayload();
  }

  if (!cache.loading) {
    cache.loading = readRegistryApps()
      .then((apps) => {
        cache.apps = apps;
        cache.at = Date.now();
        return apps;
      })
      .finally(() => {
        cache.loading = null;
      });
  }

  await cache.loading;
  return buildPayload();
}

function buildPayload() {
  const totalSize = cache.apps.reduce((sum, app) => sum + (app.size || 0), 0);
  return {
    apps: cache.apps.map((app) => ({
      id: app.id,
      name: app.name,
      version: app.version,
      publisher: app.publisher,
      size: app.size,
      installDate: app.installDate,
      location: app.location,
      uninstallString: app.uninstallString,
      source: app.source
    })),
    count: cache.apps.length,
    totalSize,
    updatedAt: new Date(cache.at).toISOString()
  };
}

async function uninstallApp(id) {
  await listApps(false);
  const app = cache.apps.find((item) => item.id === id);
  if (!app) {
    const error = new Error('Aplikasi tidak ditemukan. Muat ulang daftar aplikasi.');
    error.status = 404;
    throw error;
  }
  if (!app.uninstallString) {
    const error = new Error('Aplikasi ini tidak menyediakan uninstaller.');
    error.status = 400;
    throw error;
  }

  const command = parseUninstallCommand(app.uninstallString);
  let launched = false;
  let lastError = null;

  try {
    if (fs.existsSync(command.file)) {
      const workingDir = path.dirname(command.file);
      const child = spawn(command.file, command.args, {
        cwd: fs.existsSync(workingDir) ? workingDir : undefined,
        detached: true,
        stdio: 'ignore'
      });
      await onceSpawn(child);
      child.unref();
      launched = true;
    }
  } catch (err) {
    lastError = err;
  }

  if (!launched) {
    try {
      const child = spawn(app.uninstallString, { shell: true, detached: true, stdio: 'ignore' });
      await onceSpawn(child);
      child.unref();
      launched = true;
    } catch (err) {
      lastError = err;
    }
  }

  if (!launched) {
    throw new Error(`Uninstaller tidak bisa dijalankan: ${lastError ? lastError.message : 'perintah tidak valid'}`);
  }

  cache.at = 0;
  return { ok: true, name: app.name, command: command.display };
}

function onceSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

module.exports = {
  listApps,
  uninstallApp,
  parseUninstallCommand
};
