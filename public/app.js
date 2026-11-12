'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const ICON = {
  shield:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/></svg>',
  alert:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  spark:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
};

const STATUS = {
  protected: { cls: 'protected', label: 'Dilindungi', icon: ICON.shield },
  suggest: { cls: 'suggest', label: 'Saran hapus', icon: ICON.spark },
  caution: { cls: 'caution', label: 'Hati-hati', icon: ICON.alert },
  ok: { cls: 'ok', label: 'Bisa dihapus', icon: ICON.check }
};

const state = {
  files: [],
  dirs: [],
  view: 'files',
  sort: { key: 'size', dir: 'desc' },
  query: '',
  category: 'all',
  level: 'all',
  selected: new Set(),
  sizeByPath: new Map(),
  stats: null,
  scanning: false,
  finished: false,
  source: null,
  renderLimit: 250,
  suggestedCount: 0,
  suggestedSize: 0,
  dialogOpen: false,
  apps: [],
  appsLoaded: false,
  appsLoading: false,
  appsError: '',
  appSort: { key: 'size', dir: 'desc' },
  pendingUninstall: null
};

const el = {
  rootPath: $('#rootPath'),
  minSize: $('#minSize'),
  includeSystem: $('#includeSystem'),
  scanBtn: $('#scanBtn'),
  cancelBtn: $('#cancelBtn'),
  progress: $('#progress'),
  progressTitle: $('#progressTitle'),
  progressDetail: $('#progressDetail'),
  progressElapsed: $('#progressElapsed'),
  statScanned: $('#statScanned'),
  statScannedSub: $('#statScannedSub'),
  statCandidates: $('#statCandidates'),
  statCandidatesSub: $('#statCandidatesSub'),
  statSuggested: $('#statSuggested'),
  statSuggestedSub: $('#statSuggestedSub'),
  statSelected: $('#statSelected'),
  statSelectedSub: $('#statSelectedSub'),
  fileTable: $('#fileTable'),
  dirTable: $('#dirTable'),
  appTable: $('#appTable'),
  fileBody: $('#fileBody'),
  dirBody: $('#dirBody'),
  appBody: $('#appBody'),
  refreshApps: $('#refreshApps'),
  statsSection: $('.stats'),
  selectionBox: $('.selection'),
  legend: $('.legend'),
  appsHint: $('#appsHint'),
  emptyState: $('#emptyState'),
  emptyTitle: $('#emptyTitle'),
  emptyText: $('#emptyText'),
  resultCount: $('#resultCount'),
  searchInput: $('#searchInput'),
  categoryFilter: $('#categoryFilter'),
  levelFilter: $('#levelFilter'),
  selectAll: $('#selectAll'),
  selectionSize: $('#selectionSize'),
  selectionCount: $('#selectionCount'),
  deleteBtn: $('#deleteBtn'),
  deleteHint: $('#deleteHint'),
  confirmDialog: $('#confirmDialog'),
  dialogTitle: $('#dialogTitle'),
  dialogSubtitle: $('#dialogSubtitle'),
  dialogSummary: $('#dialogSummary'),
  dialogNote: $('#dialogNote'),
  dialogResults: $('#dialogResults'),
  modeFieldset: $('#modeFieldset'),
  cancelDelete: $('#cancelDelete'),
  confirmDelete: $('#confirmDelete'),
  toasts: $('#toasts'),
  driveLabel: $('#driveLabel'),
  driveFree: $('#driveFree'),
  driveFill: $('#driveFill')
};

const collator = new Intl.Collator('id-ID', { sensitivity: 'base', numeric: true });
const numberFormat = new Intl.NumberFormat('id-ID');
const dateFormat = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

function formatCount(value) {
  return numberFormat.format(value || 0);
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormat.format(date);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function statusOf(item) {
  if (item.level === 'protected') return STATUS.protected;
  if (item.suggested) return STATUS.suggest;
  if (item.level === 'caution') return STATUS.caution;
  return STATUS.ok;
}

function statusOfDir(item) {
  if (item.level === 'protected') return STATUS.protected;
  if (item.level === 'caution') return STATUS.caution;
  return { cls: 'ok', label: 'Bisa dibersihkan', icon: ICON.check };
}

function toast(message, type = 'info') {
  const node = document.createElement('div');
  node.className = `toast${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`;
  const icon = type === 'error' ? ICON.alert : type === 'success' ? ICON.check : ICON.spark;
  node.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
  el.toasts.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(4px)';
    node.style.transition = 'opacity 200ms ease, transform 200ms ease';
    setTimeout(() => node.remove(), 220);
  }, type === 'error' ? 7000 : 4200);
}

function isSelectable(item) {
  return item.level !== 'protected';
}

function selectedSize() {
  let total = 0;
  for (const path of state.selected) total += state.sizeByPath.get(path) || 0;
  return total;
}

function updateSelectionUI() {
  const size = selectedSize();
  const count = state.selected.size;
  el.selectionSize.textContent = formatBytes(size);
  el.selectionCount.textContent = count ? `${formatCount(count)} file dipilih` : 'Belum ada file dipilih';
  el.statSelected.textContent = formatBytes(size);
  el.statSelectedSub.textContent = count ? `${formatCount(count)} file ditandai` : 'Belum ada file dipilih';
  el.deleteBtn.disabled = count === 0;

  const visible = filteredFiles().filter(isSelectable);
  const selectedVisible = visible.filter((file) => state.selected.has(file.path));
  el.selectAll.checked = visible.length > 0 && selectedVisible.length === visible.length;
  el.selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length;
}

function updateStatsUI() {
  if (!state.stats) {
    el.statScanned.textContent = '—';
    el.statScannedSub.textContent = 'Belum ada pemindaian';
    el.statCandidates.textContent = '—';
    el.statCandidatesSub.textContent = `Ukuran minimum ${formatBytes(state.minSizeBytes || 10 * 1024 * 1024)}`;
    el.statSuggested.textContent = '—';
    el.statSuggestedSub.textContent = 'Cache, log, dump, dependency';
    return;
  }

  const stats = state.stats;
  el.statScanned.textContent = formatCount(stats.files);
  el.statScannedSub.textContent = `${formatCount(stats.dirs)} folder · ${formatBytes(stats.bytes)} · ${formatDuration(stats.elapsedMs)}`;
  el.statCandidates.textContent = formatCount(state.files.length);
  const sizeLabel = state.minSizeBytes ? `≥ ${formatBytes(state.minSizeBytes)}` : 'semua ukuran';
  el.statCandidatesSub.textContent = `${formatBytes(state.files.reduce((sum, file) => sum + file.size, 0))} · ${sizeLabel}`;
  el.statSuggested.textContent = formatBytes(state.suggestedSize);
  el.statSuggestedSub.textContent = `${formatCount(state.suggestedCount)} file bisa dibersihkan`;
}

function compare(key) {
  if (key === 'size') return (a, b) => a.size - b.size;
  if (key === 'mtime') return (a, b) => new Date(a.mtime) - new Date(b.mtime);
  if (key === 'category') return (a, b) => collator.compare(a.category, b.category);
  return (a, b) => collator.compare(a.name || a.path, b.name || b.path);
}

function filteredFiles() {
  const query = state.query.trim().toLowerCase();
  return state.files.filter((file) => {
    if (state.level === 'removable' && file.level === 'protected') return false;
    if (state.level === 'suggested' && !file.suggested) return false;
    if (state.level === 'caution' && file.level !== 'caution') return false;
    if (state.level === 'protected' && file.level !== 'protected') return false;
    if (state.category !== 'all' && file.category !== state.category) return false;
    if (query && !file.path.toLowerCase().includes(query) && !file.name.toLowerCase().includes(query)) return false;
    return true;
  });
}

function sortedFiles() {
  const list = filteredFiles();
  const direction = state.sort.dir === 'asc' ? 1 : -1;
  const comparator = compare(state.sort.key);
  list.sort((a, b) => comparator(a, b) * direction);
  return list;
}

function renderSortHeaders() {
  $$('.sort-btn[data-sort]').forEach((button) => {
    const th = button.closest('th');
    if (!th) return;
    if (button.dataset.sort === state.sort.key) {
      th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('aria-sort');
    }
  });
}

function renderFiles() {
  const list = sortedFiles();
  const visible = list.slice(0, state.renderLimit);

  el.fileBody.innerHTML = visible
    .map((file) => {
      const status = statusOf(file);
      const reason = file.reason || (file.level === 'ok' ? 'Aman dihapus bila tidak dibutuhkan' : '');
      const checked = state.selected.has(file.path);
      const disabled = !isSelectable(file);
      const rowClass = [
        file.level === 'protected' ? 'is-protected' : '',
        file.level === 'caution' ? 'is-caution' : '',
        file.suggested ? 'is-suggest' : '',
        checked ? 'is-selected' : ''
      ]
        .filter(Boolean)
        .join(' ');

      return `<tr class="${rowClass}" data-path="${escapeHtml(file.path)}">
        <td class="cell-check">
          <input type="checkbox" data-select="${escapeHtml(file.path)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="Pilih ${escapeHtml(file.name)}">
        </td>
        <td class="cell-name">
          <span class="fname" title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</span>
          <span class="fpath" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
        </td>
        <td class="cell-cat"><span class="tag">${escapeHtml(file.category)}</span></td>
        <td class="cell-size">${formatBytes(file.size)}</td>
        <td class="cell-date">${formatDate(file.mtime)}</td>
        <td class="cell-status">
          <div class="status">
            <span class="status-line status-${status.cls}">${status.icon}${status.label}</span>
            <span class="status-reason" title="${escapeHtml(reason)}">${escapeHtml(reason)}</span>
          </div>
        </td>
        <td class="cell-action">
          <button class="btn btn-icon" data-reveal="${escapeHtml(file.path)}" title="Buka lokasi file" aria-label="Buka lokasi ${escapeHtml(file.name)}">${ICON.folder}</button>
        </td>
      </tr>`;
    })
    .join('');

  if (list.length > visible.length) {
    el.fileBody.insertAdjacentHTML(
      'beforeend',
      `<tr><td colspan="7" style="text-align:center;height:44px">
        <button class="btn btn-ghost" id="loadMore">Muat ${formatCount(Math.min(250, list.length - visible.length))} file lagi · ${formatCount(list.length - visible.length)} tersisa</button>
      </td></tr>`
    );
  }

  if (state.view === 'files') {
    el.resultCount.textContent = list.length
      ? `${formatCount(visible.length)} dari ${formatCount(list.length)} file · ${formatBytes(list.reduce((sum, file) => sum + file.size, 0))}`
      : '';
  }
}

function renderDirs() {
  el.dirBody.innerHTML = state.dirs
    .map((dir) => {
      const status = statusOfDir(dir);
      const reason = `${formatCount(dir.files)} file di dalamnya`;
      return `<tr class="${dir.level === 'protected' ? 'is-protected' : dir.level === 'caution' ? 'is-caution' : ''}" data-path="${escapeHtml(dir.path)}">
        <td class="cell-name">
          <span class="fname" title="${escapeHtml(dir.path)}">${escapeHtml(dir.name)}</span>
          <span class="fpath" title="${escapeHtml(dir.path)}">${escapeHtml(dir.path)}</span>
        </td>
        <td class="cell-cat"><span class="tag">${escapeHtml(dir.category)}</span></td>
        <td class="cell-size">${formatBytes(dir.size)}</td>
        <td class="cell-status">
          <div class="status">
            <span class="status-line status-${status.cls}">${status.icon}${status.label}</span>
            <span class="status-reason" title="${escapeHtml(reason)}">${escapeHtml(reason)}</span>
          </div>
        </td>
        <td class="cell-action">
          <button class="btn btn-icon" data-reveal="${escapeHtml(dir.path)}" data-folder="1" title="Buka folder" aria-label="Buka folder ${escapeHtml(dir.name)}">${ICON.folder}</button>
        </td>
      </tr>`;
    })
    .join('');

  if (state.view === 'dirs') {
    el.resultCount.textContent = state.dirs.length ? `${formatCount(state.dirs.length)} folder terbesar` : '';
  }
}

function compareApps(key) {
  if (key === 'size') return (a, b) => (a.size || 0) - (b.size || 0);
  if (key === 'date') return (a, b) => new Date(a.installDate || 0) - new Date(b.installDate || 0);
  return (a, b) => collator.compare(a.name, b.name);
}

function filteredApps() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.apps.slice();
  return state.apps.filter(
    (app) =>
      app.name.toLowerCase().includes(query) ||
      (app.publisher || '').toLowerCase().includes(query) ||
      (app.location || '').toLowerCase().includes(query)
  );
}

function sortedApps() {
  const list = filteredApps();
  const direction = state.appSort.dir === 'asc' ? 1 : -1;
  const comparator = compareApps(state.appSort.key);
  list.sort((a, b) => comparator(a, b) * direction);
  return list;
}

function renderAppSortHeaders() {
  $$('[data-app-sort]').forEach((button) => {
    const th = button.closest('th');
    if (!th) return;
    if (button.dataset.appSort === state.appSort.key) {
      th.setAttribute('aria-sort', state.appSort.dir === 'asc' ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('aria-sort');
    }
  });
}

function renderApps() {
  const list = sortedApps();
  el.appBody.innerHTML = list
    .map((app) => {
      const meta = [app.publisher, app.version ? `v${app.version}` : ''].filter(Boolean).join(' · ');
      const disabled = !app.uninstallString;
      return `<tr data-app-id="${escapeHtml(app.id)}">
        <td class="cell-name">
          <span class="fname" title="${escapeHtml(app.name)}">${escapeHtml(app.name)}</span>
          <span class="fsub" title="${escapeHtml(meta)}">${escapeHtml(meta || 'Publisher tidak diketahui')}</span>
        </td>
        <td class="cell-size">${app.size ? formatBytes(app.size) : '—'}</td>
        <td class="cell-date">${app.installDate ? formatDate(app.installDate) : '—'}</td>
        <td class="cell-action">
          <button class="btn btn-uninstall" data-uninstall="${escapeHtml(app.id)}" ${disabled ? 'disabled' : ''} title="${disabled ? 'Aplikasi ini tidak menyediakan uninstaller' : 'Buka uninstaller aplikasi'}">Uninstall</button>
        </td>
      </tr>`;
    })
    .join('');

  if (state.view === 'apps') {
    const total = list.reduce((sum, app) => sum + (app.size || 0), 0);
    const unknown = list.filter((app) => !app.size).length;
    const unknownText = unknown ? ` · ${formatCount(unknown)} tanpa ukuran` : '';
    el.resultCount.textContent = list.length
      ? `${formatCount(list.length)} aplikasi · ${formatBytes(total)}${unknownText}`
      : '';
  }
}

async function loadApps(force = false) {
  if (state.appsLoading) return;
  if (state.appsLoaded && !force) return;

  state.appsLoading = true;
  state.appsError = '';
  el.refreshApps.disabled = true;
  renderAll();

  try {
    const response = await fetch(`/api/apps${force ? '?refresh=1' : ''}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Gagal memuat daftar aplikasi');
    state.apps = data.apps || [];
    state.appsLoaded = true;
  } catch (err) {
    state.appsError = err.message;
    toast(err.message, 'error');
  } finally {
    state.appsLoading = false;
    el.refreshApps.disabled = false;
    renderAll();
  }
}

function updateViewChrome() {
  const isApps = state.view === 'apps';
  el.statsSection.hidden = isApps;
  el.categoryFilter.hidden = isApps;
  el.levelFilter.hidden = isApps;
  el.refreshApps.hidden = !isApps;
  el.selectionBox.hidden = isApps;
  el.legend.hidden = isApps;
  el.deleteBtn.hidden = isApps;
  el.deleteHint.hidden = isApps;
  el.appsHint.hidden = !isApps;
  el.searchInput.placeholder = isApps ? 'Cari aplikasi atau publisher' : 'Cari nama atau lokasi file';
}

function renderEmpty() {
  const isApps = state.view === 'apps';
  const hasData = isApps ? state.apps.length : state.view === 'files' ? state.files.length : state.dirs.length;
  const listLength = isApps
    ? filteredApps().length
    : state.view === 'files'
      ? filteredFiles().length
      : state.dirs.length;

  const showEmpty = listLength === 0 && (isApps || !state.scanning);
  el.emptyState.hidden = !showEmpty;
  el.fileTable.hidden = state.view !== 'files' || showEmpty;
  el.dirTable.hidden = state.view !== 'dirs' || showEmpty;
  el.appTable.hidden = !isApps || showEmpty;

  if (!showEmpty) return;

  if (isApps) {
    if (state.appsLoading) {
      el.emptyTitle.textContent = 'Memuat aplikasi terinstal…';
      el.emptyText.textContent = 'Membaca daftar Program & Features dari registry Windows.';
    } else if (!state.appsLoaded && state.appsError) {
      el.emptyTitle.textContent = 'Gagal memuat aplikasi';
      el.emptyText.textContent = state.appsError;
    } else if (!hasData) {
      el.emptyTitle.textContent = 'Tidak ada aplikasi terdeteksi';
      el.emptyText.textContent = 'Daftar aplikasi dibaca dari registry Windows. Coba klik Muat ulang.';
    } else {
      el.emptyTitle.textContent = 'Tidak ada aplikasi yang cocok';
      el.emptyText.textContent = 'Ubah kata kunci pencarian.';
    }
    return;
  }

  if (!hasData && !state.stats) {
    el.emptyTitle.textContent = 'Belum ada hasil';
    el.emptyText.innerHTML =
      'Tekan <strong>Pindai</strong> untuk mencari file terbesar. Hasil bisa diurutkan, difilter, lalu kamu checklist sendiri file yang ingin dihapus. File abu-abu tidak bisa dihapus.';
  } else if (state.view === 'dirs') {
    el.emptyTitle.textContent = 'Tidak ada folder yang cocok';
    el.emptyText.textContent = 'Coba ubah folder yang dipindai atau sertakan folder sistem.';
  } else if (!hasData) {
    el.emptyTitle.textContent = 'Tidak ada file di atas ukuran minimum';
    el.emptyText.textContent = 'Turunkan ukuran minimum atau pindai folder lain.';
  } else {
    el.emptyTitle.textContent = 'Tidak ada file yang cocok';
    el.emptyText.textContent = 'Ubah kata kunci pencarian atau filter kategori dan status.';
  }
}

function renderAll() {
  renderFiles();
  renderDirs();
  renderApps();
  renderEmpty();
  renderSortHeaders();
  renderAppSortHeaders();
  updateStatsUI();
  updateSelectionUI();
  updateViewChrome();
}

function clearSelection() {
  state.selected.clear();
  $$('.data-table tbody tr.is-selected').forEach((row) => row.classList.remove('is-selected'));
  $$('.data-table tbody input[type="checkbox"]').forEach((box) => {
    box.checked = false;
  });
  updateSelectionUI();
}

function setSelection(path, checked) {
  if (checked) state.selected.add(path);
  else state.selected.delete(path);
}

function selectAllVisible(checked) {
  for (const file of filteredFiles()) {
    if (!isSelectable(file)) continue;
    setSelection(file.path, checked);
  }
  renderAll();
}

function refreshCategories() {
  const categories = Array.from(new Set(state.files.map((file) => file.category))).sort((a, b) => collator.compare(a, b));
  const current = el.categoryFilter.value;
  el.categoryFilter.innerHTML =
    '<option value="all">Semua kategori</option>' +
    categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  if (categories.includes(current)) el.categoryFilter.value = current;
  else {
    state.category = 'all';
    el.categoryFilter.value = 'all';
  }
}

function startScan() {
  if (state.scanning) return;

  const root = el.rootPath.value.trim() || 'C:\\';
  const minSizeMb = Number(el.minSize.value);
  const includeSystem = el.includeSystem.checked;

  state.scanning = true;
  state.finished = false;
  state.files = [];
  state.dirs = [];
  state.stats = null;
  state.minSizeBytes = minSizeMb * 1024 * 1024;
  state.suggestedCount = 0;
  state.suggestedSize = 0;
  state.selected.clear();
  state.sizeByPath = new Map();
  state.renderLimit = 250;
  refreshCategories();

  el.scanBtn.disabled = true;
  el.cancelBtn.hidden = false;
  el.progress.hidden = false;
  el.progressTitle.textContent = 'Memindai folder…';
  el.progressDetail.textContent = root;
  el.progressElapsed.textContent = '0:00';
  el.emptyState.hidden = true;
  renderAll();

  const params = new URLSearchParams({
    root,
    system: includeSystem ? '1' : '0',
    minSizeMb: String(minSizeMb)
  });

  const source = new EventSource(`/api/scan?${params.toString()}`);
  state.source = source;

  source.onmessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === 'start') {
      el.progressTitle.textContent = 'Memindai folder…';
      el.progressDetail.textContent = payload.root;
      return;
    }

    if (payload.type === 'progress') {
      el.progressDetail.textContent = `${formatCount(payload.files)} file · ${formatCount(payload.dirs)} folder · ${formatBytes(payload.bytes)}`;
      el.progressElapsed.textContent = formatDuration(payload.elapsedMs);
      el.progressDetail.title = payload.currentDir || '';
      return;
    }

    if (payload.type === 'done') {
      finishScan(payload);
      return;
    }

    if (payload.type === 'error') {
      failScan(payload.message);
    }
  };

  source.onerror = () => {
    if (state.finished) return;
    failScan('Koneksi ke pemindai terputus.');
  };
}

function finishScan(payload) {
  state.finished = true;
  state.scanning = false;
  if (state.source) {
    state.source.close();
    state.source = null;
  }

  state.files = payload.files || [];
  state.dirs = payload.dirs || [];
  state.stats = payload.stats || null;
  state.minSizeBytes = payload.minSize;
  state.sizeByPath = new Map(state.files.map((file) => [file.path, file.size]));

  state.suggestedCount = 0;
  state.suggestedSize = 0;
  for (const file of state.files) {
    if (file.suggested && file.level !== 'protected') {
      state.suggestedCount++;
      state.suggestedSize += file.size;
    }
  }

  el.progress.hidden = true;
  el.scanBtn.disabled = false;
  el.cancelBtn.hidden = true;

  refreshCategories();
  renderAll();

  const stats = state.stats || {};
  if (stats.truncated) {
    toast(`Pemindaian berhenti di batas ${formatCount(stats.files)} file. Pindai folder yang lebih spesifik untuk hasil lengkap.`, 'error');
  } else if (!state.files.length) {
    toast('Pemindaian selesai, tidak ada file di atas ukuran minimum.', 'info');
  } else {
    toast(`Pemindaian selesai: ${formatCount(state.files.length)} file kandidat ditemukan.`, 'success');
  }
}

function failScan(message) {
  state.finished = true;
  state.scanning = false;
  if (state.source) {
    state.source.close();
    state.source = null;
  }
  el.progress.hidden = true;
  el.scanBtn.disabled = false;
  el.cancelBtn.hidden = true;
  state.stats = null;
  renderEmpty();
  toast(message, 'error');
}

function cancelScan() {
  if (!state.scanning) return;
  state.finished = true;
  state.scanning = false;
  if (state.source) {
    state.source.close();
    state.source = null;
  }
  el.progress.hidden = true;
  el.scanBtn.disabled = false;
  el.cancelBtn.hidden = true;
  renderEmpty();
  toast('Pemindaian dibatalkan.', 'info');
}

function openDeleteDialog() {
  if (!state.selected.size) return;

  state.pendingUninstall = null;
  const paths = Array.from(state.selected);
  const total = selectedSize();
  const protectedCount = paths.length;

  state.dialogOpen = true;
  el.dialogTitle.textContent = 'Hapus file terpilih?';
  el.dialogSubtitle.textContent = 'Periksa kembali daftar pilihan sebelum melanjutkan.';
  el.dialogSummary.innerHTML = `
    <div class="summary-item"><span>File dipilih</span><strong>${formatCount(protectedCount)}</strong></div>
    <div class="summary-item"><span>Total ukuran</span><strong>${formatBytes(total)}</strong></div>
  `;
  el.dialogNote.innerHTML =
    '<strong>Catatan:</strong> menghapus ke Recycle Bin belum membebaskan ruang disk sampai Recycle Bin dikosongkan. Pilih hapus permanen bila ruang harus langsung terbebas.';
  el.dialogResults.hidden = true;
  el.dialogResults.innerHTML = '';
  el.dialogNote.hidden = false;
  el.modeFieldset.hidden = false;
  el.modeFieldset.querySelector('input[value="recycle"]').checked = true;
  el.cancelDelete.textContent = 'Batal';
  el.cancelDelete.hidden = false;
  el.confirmDelete.hidden = false;
  el.confirmDelete.disabled = false;
  el.confirmDelete.textContent = 'Hapus';

  el.confirmDialog.showModal();
}

function closeDialog() {
  state.dialogOpen = false;
  state.pendingUninstall = null;
  if (el.confirmDialog.open) el.confirmDialog.close();
}

function openUninstallDialog(id) {
  const app = state.apps.find((item) => item.id === id);
  if (!app) return;

  state.pendingUninstall = app;
  state.dialogOpen = true;

  el.dialogTitle.textContent = `Uninstall ${app.name}?`;
  el.dialogSubtitle.textContent =
    [app.publisher, app.version ? `versi ${app.version}` : ''].filter(Boolean).join(' · ') || 'Aplikasi terinstal';
  el.dialogSummary.innerHTML = `
    <div class="summary-item"><span>Ukuran</span><strong>${app.size ? formatBytes(app.size) : 'Tidak diketahui'}</strong></div>
    <div class="summary-item"><span>Terpasang</span><strong>${app.installDate ? formatDate(app.installDate) : '—'}</strong></div>
  `;
  el.dialogNote.innerHTML =
    '<strong>Uninstaller aplikasi akan dibuka di jendela terpisah.</strong> Ikuti langkahnya sampai selesai. Beberapa aplikasi meminta izin Administrator.' +
    `<div class="cmd-preview">${escapeHtml(app.uninstallString)}</div>`;
  el.dialogResults.hidden = true;
  el.dialogResults.innerHTML = '';
  el.dialogNote.hidden = false;
  el.modeFieldset.hidden = true;
  el.cancelDelete.textContent = 'Batal';
  el.cancelDelete.hidden = false;
  el.confirmDelete.hidden = false;
  el.confirmDelete.disabled = false;
  el.confirmDelete.textContent = 'Buka uninstaller';

  el.confirmDialog.showModal();
}

async function confirmUninstall() {
  const app = state.pendingUninstall;
  if (!app) return;

  el.confirmDelete.disabled = true;
  el.confirmDelete.textContent = 'Membuka…';

  try {
    const response = await fetch('/api/apps/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: app.id })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Gagal menjalankan uninstaller');

    closeDialog();
    toast(`Uninstaller ${app.name} dibuka. Selesaikan prosesnya di jendela uninstaller.`, 'success');
    setTimeout(() => {
      if (state.view === 'apps') loadApps(true);
    }, 8000);
  } catch (err) {
    el.confirmDelete.disabled = false;
    el.confirmDelete.textContent = 'Buka uninstaller';
    toast(err.message, 'error');
  }
}

async function confirmDelete() {
  if (state.pendingUninstall) return confirmUninstall();
  if (!state.selected.size) return;

  const permanent = el.confirmDialog.querySelector('input[name="deleteMode"]:checked')?.value === 'permanent';
  const paths = Array.from(state.selected);

  el.confirmDelete.disabled = true;
  el.confirmDelete.textContent = 'Menghapus…';

  try {
    const response = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, permanent })
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || 'Gagal menghapus file');

    const deleted = new Set(result.deleted.map((p) => String(p).toLowerCase()));
    state.files = state.files.filter((file) => !deleted.has(file.path.toLowerCase()));
    state.dirs = state.dirs.filter((dir) => !deleted.has(dir.path.toLowerCase()));

    for (const path of paths) {
      state.selected.delete(path);
      state.sizeByPath.delete(path);
    }

    state.suggestedCount = 0;
    state.suggestedSize = 0;
    for (const file of state.files) {
      if (file.suggested && file.level !== 'protected') {
        state.suggestedCount++;
        state.suggestedSize += file.size;
      }
    }

    renderAll();
    loadDrives();

    const failed = result.failed || [];
    if (failed.length) {
      el.dialogTitle.textContent = 'Sebagian file gagal dihapus';
      el.dialogSubtitle.textContent = `${formatCount(result.deleted.length)} berhasil, ${formatCount(failed.length)} gagal.`;
      el.dialogSummary.innerHTML = '';
      el.modeFieldset.hidden = true;
      el.dialogNote.hidden = true;
      el.dialogResults.hidden = false;
      el.dialogResults.innerHTML = failed
        .map(
          (item) => `<div class="result-row">
            <span class="rpath">${escapeHtml(item.path)}</span>
            <span class="rerror">${escapeHtml(item.error || 'Gagal dihapus')}</span>
          </div>`
        )
        .join('');
      el.confirmDelete.hidden = true;
      el.cancelDelete.textContent = 'Tutup';
      el.cancelDelete.hidden = false;
    } else {
      closeDialog();
      const freed = permanent ? `${formatBytes(result.freedBytes)} ruang dibebaskan.` : `${formatBytes(result.movedBytes)} dipindahkan ke Recycle Bin.`;
      toast(`${formatCount(result.deleted.length)} file dihapus. ${freed}`, 'success');
    }
  } catch (err) {
    el.confirmDelete.disabled = false;
    el.confirmDelete.textContent = 'Hapus';
    toast(err.message, 'error');
  }
}

async function reveal(path, folder) {
  try {
    await fetch('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, folder: !!folder })
    });
  } catch {
    toast('Tidak bisa membuka Windows Explorer.', 'error');
  }
}

async function loadDrives() {
  try {
    const response = await fetch('/api/drives');
    if (!response.ok) return;
    const { drives } = await response.json();
    if (!drives.length) return;

    const drive = drives.find((item) => item.letter === 'C:') || drives[0];
    const percent = Math.round((drive.used / drive.total) * 100);
    el.driveLabel.textContent = `${drive.letter} ${percent}% terpakai`;
    el.driveFree.textContent = `${formatBytes(drive.free)} kosong dari ${formatBytes(drive.total)}`;
    el.driveFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    el.driveFill.classList.toggle('is-high', percent >= 85);
    document.querySelector('#driveBar').setAttribute(
      'aria-label',
      `Disk ${drive.letter} terpakai ${percent} persen, ${formatBytes(drive.free)} kosong`
    );
  } catch {
    /* diamkan */
  }
}

function bindEvents() {
  el.scanBtn.addEventListener('click', startScan);
  el.cancelBtn.addEventListener('click', cancelScan);

  el.rootPath.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') startScan();
  });

  el.searchInput.addEventListener('input', () => {
    state.query = el.searchInput.value;
    state.renderLimit = 250;
    renderAll();
  });

  el.categoryFilter.addEventListener('change', () => {
    state.category = el.categoryFilter.value;
    state.renderLimit = 250;
    renderAll();
  });

  el.levelFilter.addEventListener('change', () => {
    state.level = el.levelFilter.value;
    state.renderLimit = 250;
    renderAll();
  });

  $$('.sort-btn[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        state.sort.key = key;
        state.sort.dir = key === 'name' || key === 'category' ? 'asc' : 'desc';
      }
      state.renderLimit = 250;
      renderAll();
    });
  });

  $$('.sort-btn[data-app-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.appSort;
      if (state.appSort.key === key) {
        state.appSort.dir = state.appSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        state.appSort.key = key;
        state.appSort.dir = key === 'name' ? 'asc' : 'desc';
      }
      renderAll();
    });
  });

  el.appBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-uninstall]');
    if (!button || button.disabled) return;
    openUninstallDialog(button.dataset.uninstall);
  });

  el.refreshApps.addEventListener('click', () => loadApps(true));

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.view = tab.dataset.view;
      $$('.tab').forEach((item) => item.setAttribute('aria-selected', String(item === tab)));
      renderAll();
      if (state.view === 'apps') loadApps();
    });
  });

  el.selectAll.addEventListener('change', () => selectAllVisible(el.selectAll.checked));

  el.fileBody.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-select]');
    if (!input) return;
    const path = input.dataset.select;
    setSelection(path, input.checked);
    const row = input.closest('tr');
    if (row) row.classList.toggle('is-selected', input.checked);
    updateSelectionUI();
  });

  for (const body of [el.fileBody, el.dirBody]) {
    body.addEventListener('click', (event) => {
      const button = event.target.closest('[data-reveal]');
      if (!button) return;
      reveal(button.dataset.reveal, button.dataset.folder === '1');
    });
  }

  el.fileBody.addEventListener('click', (event) => {
    if (event.target.closest('#loadMore')) {
      state.renderLimit += 250;
      renderFiles();
    }
  });

  el.deleteBtn.addEventListener('click', openDeleteDialog);
  el.cancelDelete.addEventListener('click', closeDialog);
  el.confirmDelete.addEventListener('click', confirmDelete);

  el.confirmDialog.addEventListener('click', (event) => {
    if (event.target === el.confirmDialog) closeDialog();
  });
}

bindEvents();
loadDrives();
setInterval(loadDrives, 60000);
renderAll();
