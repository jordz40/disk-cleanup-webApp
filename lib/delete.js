'use strict';

const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { classify } = require('./rules');
const { runPowerShell } = require('./powershell');

async function sendToRecycleBin(paths) {
  const listPath = path.join(
    os.tmpdir(),
    `filechecker-${crypto.randomBytes(8).toString('hex')}.json`
  );
  await fsp.writeFile(listPath, JSON.stringify(paths), 'utf8');
  const safeListPath = listPath.replace(/'/g, "''");

  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName Microsoft.VisualBasic
$items = @(Get-Content -LiteralPath '${safeListPath}' -Raw -Encoding UTF8 | ConvertFrom-Json)
$results = New-Object System.Collections.ArrayList
foreach ($item in $items) {
  $p = [string]$item
  try {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw 'File tidak ditemukan' }
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    [void]$results.Add([pscustomobject]@{ path = $p; ok = $true; error = '' })
  } catch {
    [void]$results.Add([pscustomobject]@{ path = $p; ok = $false; error = $_.Exception.Message })
  }
}
ConvertTo-Json -InputObject @($results) -Depth 3 -Compress
`;

  try {
    const result = await runPowerShell(script);
    const raw = (result.stdout || '').replace(/^\uFEFF/, '').trim();
    if (!raw) {
      return paths.map((p) => ({
        path: p,
        ok: false,
        error: (result.stderr || 'PowerShell tidak mengembalikan hasil').slice(0, 300)
      }));
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return paths.map((p) => ({
        path: p,
        ok: false,
        error: 'Gagal membaca hasil PowerShell'
      }));
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((item) => ({
      path: item.path,
      ok: !!item.ok,
      error: item.error || ''
    }));
  } finally {
    fsp.unlink(listPath).catch(() => {});
  }
}

async function deleteFiles(paths, { permanent = false } = {}) {
  const result = {
    mode: permanent ? 'permanent' : 'recycle',
    deleted: [],
    failed: [],
    freedBytes: 0,
    movedBytes: 0
  };

  const valid = [];
  for (const filePath of paths) {
    let st;
    try {
      st = await fsp.lstat(filePath);
    } catch {
      result.failed.push({ path: filePath, error: 'File tidak ditemukan' });
      continue;
    }
    if (!st.isFile()) {
      result.failed.push({ path: filePath, error: 'Bukan file biasa, dilewati' });
      continue;
    }
    const info = classify(filePath);
    if (info.level === 'protected') {
      result.failed.push({ path: filePath, error: info.reason });
      continue;
    }
    valid.push({ path: filePath, size: st.size });
  }

  if (!valid.length) return result;

  if (permanent) {
    for (const item of valid) {
      try {
        try {
          await fsp.unlink(item.path);
        } catch (err) {
          if (err.code === 'EPERM' || err.code === 'EACCES') {
            await fsp.chmod(item.path, 0o666);
            await fsp.unlink(item.path);
          } else {
            throw err;
          }
        }
        result.deleted.push(item.path);
        result.freedBytes += item.size;
      } catch (err) {
        result.failed.push({ path: item.path, error: err.message });
      }
    }
    return result;
  }

  const outcomes = await sendToRecycleBin(valid.map((item) => item.path));
  const sizeByPath = new Map(valid.map((item) => [item.path.toLowerCase(), item.size]));
  for (const outcome of outcomes) {
    if (outcome.ok) {
      result.deleted.push(outcome.path);
      result.movedBytes += sizeByPath.get(String(outcome.path).toLowerCase()) || 0;
    } else {
      result.failed.push({ path: outcome.path, error: outcome.error });
    }
  }
  return result;
}

module.exports = { deleteFiles };
