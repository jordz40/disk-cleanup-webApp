'use strict';

const path = require('path');

const SYSTEM_DIRS = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  'c:\\$recycle.bin',
  'c:\\system volume information',
  'c:\\recovery',
  'c:\\boot',
  'c:\\perflogs',
  'c:\\$winreagent',
  'c:\\config.msi',
  'c:\\msocache'
];

const PROTECTED_ROOT_FILES = new Set([
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'dumpstack.log.tmp',
  'dumpstack.log',
  'bootmgr',
  'bootnxt',
  'ntldr',
  'boot.ini',
  'autoexec.bat',
  'config.sys',
  'bootsect.bak',
  'boottel.dat',
  'bootstat.dat'
]);

const TEMP_SEGMENTS = new Set([
  'temp',
  'tmp',
  'temporary',
  'cache',
  'caches',
  'cachedata',
  'cachestorage',
  'code cache',
  'gpucache',
  'shadercache',
  'd3dscache',
  'crashpad',
  'crashdumps',
  'service worker',
  'blob_storage',
  'log',
  'logs',
  'npm-cache',
  'yarn-cache'
]);

const EXT_CATEGORY = new Map();
function register(category, exts) {
  for (const ext of exts) EXT_CATEGORY.set(ext, category);
}

register('Video', ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.m2ts', '.3gp']);
register('Audio', ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.wma', '.opus', '.aiff', '.mid']);
register('Gambar', ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.heic', '.heif', '.raw', '.cr2', '.nef', '.arw', '.dng', '.psd', '.ai']);
register('Dokumen', ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.csv', '.rtf', '.odt', '.ods', '.odp', '.epub', '.mobi']);
register('Arsip', ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz', '.cab', '.lz', '.zst']);
register('Image disk', ['.iso', '.img', '.vhd', '.vhdx', '.vmdk', '.dmg']);
register('Installer', ['.msi', '.msp', '.appx', '.msix', '.msixbundle', '.bundle', '.pkg', '.deb', '.rpm']);
register('Aplikasi', ['.exe', '.appref-ms', '.lnk', '.jar']);
register('Database', ['.mdf', '.ldf', '.sqlite', '.sqlite3', '.db', '.bak', '.dbf']);
register('Kode', ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rs', '.php', '.rb', '.json', '.xml', '.yml', '.yaml']);

const LOG_EXTS = new Set(['.log', '.etl', '.dmp', '.mdmp', '.wer', '.evtx', '.trace', '.vmem', '.vsv', '.vmss', '.vmsn', '.hprof', '.heapdump']);
const TEMP_EXTS = new Set(['.tmp', '.temp', '.part', '.partial', '.crdownload', '.download', '.~temp']);

function normalize(p) {
  try {
    return path.win32.normalize(p).toLowerCase();
  } catch {
    return String(p).toLowerCase();
  }
}

function segmentsOf(p) {
  const parsed = path.win32.parse(p);
  const rest = p.slice(parsed.root.length);
  return { root: parsed.root, segments: rest ? rest.split('\\') : [] };
}

function isProtected(p) {
  const { root, segments } = segmentsOf(p);
  if (!segments.length) return true;
  const name = segments[segments.length - 1];

  if (/^ntuser(\.|$)/.test(name)) return true;
  if (root === 'c:\\' && segments.length === 1 && PROTECTED_ROOT_FILES.has(name)) return true;
  if (name === 'bootstat.dat') return true;

  for (const dir of SYSTEM_DIRS) {
    if (p === dir || p.startsWith(dir + '\\')) return true;
  }
  if (p.includes('\\system volume information\\') || p.includes('\\$recycle.bin\\')) return true;
  return false;
}

function isInPersonalFolder(p) {
  return /^c:\\users\\[^\\]+\\(documents|desktop|pictures|videos|music|onedrive)(\\|$)/.test(p);
}

function isInAppData(p) {
  return /^c:\\users\\[^\\]+\\(appdata|appdata\\local|appdata\\roaming|appdata\\locallow)(\\|$)/.test(p);
}

function hasSegment(p, names) {
  for (const seg of segmentsOf(p).segments) {
    if (names.has(seg)) return true;
  }
  return false;
}

function categorize(p) {
  const ext = path.win32.extname(p);

  if (hasSegment(p, TEMP_SEGMENTS)) {
    return {
      category: 'Cache & Temp',
      suggested: true,
      reason: 'Cache atau file sementara. Aman dibersihkan.'
    };
  }

  if (TEMP_EXTS.has(ext)) {
    return {
      category: 'File sementara',
      suggested: true,
      reason: 'Sisa unduhan atau file sementara. Aman dihapus.'
    };
  }

  if (LOG_EXTS.has(ext)) {
    return {
      category: 'Log & Dump',
      suggested: true,
      reason: 'File log atau crash dump. Aman dihapus.'
    };
  }

  if (p.includes('\\.git\\') || p.endsWith('\\.git')) {
    return {
      category: 'Git',
      caution: true,
      reason: 'Repositori Git. Jangan hapus manual.'
    };
  }

  if (p.includes('\\node_modules\\') || p.endsWith('\\node_modules')) {
    return {
      category: 'Dependency',
      suggested: true,
      reason: 'Dependency proyek. Bisa dibuat ulang.'
    };
  }

  if (isInPersonalFolder(p)) {
    return {
      category: EXT_CATEGORY.get(ext) || 'Data pribadi',
      caution: true,
      reason: 'Data pribadi. Pastikan tidak dibutuhkan.'
    };
  }

  if (isInAppData(p)) {
    return {
      category: EXT_CATEGORY.get(ext) || 'Data aplikasi',
      caution: true,
      reason: 'Data aplikasi. Salah hapus bisa merusak aplikasi.'
    };
  }

  const category = EXT_CATEGORY.get(ext);
  if (category === 'Image disk') {
    return {
      category,
      caution: true,
      reason: 'Image disk atau backup. Pastikan tidak dibutuhkan.'
    };
  }
  if (category === 'Arsip') {
    return {
      category,
      reason: 'Arsip. Pastikan isinya tidak dibutuhkan sebelum dihapus.'
    };
  }
  if (category === 'Installer') {
    return {
      category,
      caution: true,
      reason: 'Installer aplikasi. Hapus hanya jika aplikasinya sudah terpasang.'
    };
  }
  if (category) {
    return { category, reason: '' };
  }

  return { category: 'Lainnya', reason: '' };
}

function classify(filePath) {
  const p = normalize(filePath);
  if (isProtected(p)) {
    return {
      level: 'protected',
      category: 'Sistem',
      suggested: false,
      reason: 'Sistem Windows. Tidak bisa dihapus dari aplikasi ini.'
    };
  }

  const info = categorize(p);
  return {
    level: info.caution ? 'caution' : 'ok',
    category: info.category,
    suggested: !!info.suggested,
    reason: info.reason || ''
  };
}

module.exports = {
  classify,
  isProtected,
  normalize,
  SYSTEM_DIRS
};
