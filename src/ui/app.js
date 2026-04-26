/**
 * Frontend Application Logic
 * Vanilla JavaScript for KSeF Sync Web UI
 */

// DOM Elements
const syncButton = document.getElementById('syncButton');
const dateFromInput = document.getElementById('dateFrom');
const dateToInput = document.getElementById('dateTo');
const invoiceTypeRadios = document.querySelectorAll('input[name="invoiceType"]');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const syncResult = document.getElementById('syncResult');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const monthSelect = document.getElementById('monthSelect');
const invoicesBody = document.getElementById('invoicesBody');
const invoiceCount = document.getElementById('invoiceCount');

// Stat elements (match redesigned HTML)
const statEnv = document.getElementById('statEnv');
const statLastSync = document.getElementById('statLastSync');
const statTotal = document.getElementById('statTotal');
const statFolder = document.getElementById('statFolder');

// Diagnostics
const nipStatus = document.getElementById('nipStatus');
const folderStatus = document.getElementById('folderStatus');
const connectionStatus = document.getElementById('connectionStatus');

const footerEnv = document.getElementById('footerEnv');
const openFolderBtn = document.getElementById('openFolderBtn');
const toastContainer = document.getElementById('toastContainer');

// System diagnostics + logs
const badgeSystem = document.getElementById('badgeSystem');
const badgeKsef = document.getElementById('badgeKsef');
const badgeDisk = document.getElementById('badgeDisk');
const badgeConfig = document.getElementById('badgeConfig');
const logFeed = document.getElementById('logFeed');
const logLevelFilter = document.getElementById('logLevelFilter');
const logModuleFilter = document.getElementById('logModuleFilter');
const diagRefreshBtn = document.getElementById('diagRefreshBtn');
const diagDownloadLogsBtn = document.getElementById('diagDownloadLogsBtn');

let logsEventSource = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setDefaultDates();
  loadStatus();
  loadDiagnose();
  startLogStream();
  generateMonthOptions();
  loadInvoices();

  if (syncButton) syncButton.addEventListener('click', handleSync);
  if (monthSelect) monthSelect.addEventListener('change', loadInvoices);
  if (openFolderBtn) openFolderBtn.addEventListener('click', handleOpenFolder);

  if (diagRefreshBtn) diagRefreshBtn.addEventListener('click', () => {
    loadDiagnose();
    restartLogStream();
  });
  if (diagDownloadLogsBtn) diagDownloadLogsBtn.addEventListener('click', () => {
    window.location.href = '/api/logs/download';
  });
  if (logLevelFilter) logLevelFilter.addEventListener('change', restartLogStream);
  if (logModuleFilter) logModuleFilter.addEventListener('change', restartLogStream);
});

/**
 * Set default dates (today for dateTo, 1 month ago for dateFrom)
 */
function setDefaultDates() {
  const today = new Date();
  const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

  if (dateToInput) dateToInput.valueAsDate = today;
  if (dateFromInput && !dateFromInput.value) dateFromInput.valueAsDate = oneMonthAgo;
}

/**
 * Load and display status
 */
async function loadStatus() {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error('Failed to fetch status');

    const status = await response.json();

    // Update status indicator
    if (status.connected) {
      statusDot?.classList.remove('disconnected');
      statusDot?.classList.add('connected');
      if (statusText) statusText.textContent = 'Połączono';
    } else {
      statusDot?.classList.remove('connected');
      statusDot?.classList.add('disconnected');
      if (statusText) statusText.textContent = 'Brak połączenia';
    }

    // Update status section
    if (statEnv) statEnv.textContent = status.environment || '-';
    if (nipStatus) nipStatus.textContent = status.nip || '-';
    if (statLastSync) statLastSync.textContent = status.lastSync ? formatDateTime(status.lastSync) : 'Nigdy';
    if (statTotal) statTotal.textContent = (status.totalInvoices || 0).toString();
    if (statFolder) statFolder.textContent = status.outputDir || '-';
    if (folderStatus) folderStatus.textContent = status.outputDir || '-';
    if (footerEnv) footerEnv.textContent = status.environment || '-';
    if (connectionStatus) connectionStatus.textContent = status.connected ? 'Połączono' : 'Brak połączenia';
  } catch (error) {
    console.error('Error loading status:', error);
    statusDot?.classList.remove('connected');
    statusDot?.classList.add('disconnected');
    if (statusText) statusText.textContent = 'Błąd';
    showToast('Błąd ładowania statusu', 'error');
  }
}

function setBadge(el, ok) {
  if (!el) return;
  el.classList.remove('ok', 'fail');
  el.classList.add(ok ? 'ok' : 'fail');
}

async function loadDiagnose() {
  try {
    const res = await fetch('/api/diagnose');
    if (!res.ok) throw new Error('Failed to fetch diagnose');
    const report = await res.json();

    const checks = report.checks || {};
    const systemOk = report.status === 'ok';

    setBadge(badgeSystem, systemOk);
    setBadge(badgeKsef, checks.ksef?.status === 'pass');
    setBadge(badgeDisk, checks.storage?.status === 'pass');
    setBadge(badgeConfig, checks.config?.status === 'pass' && checks.env?.status === 'pass');
  } catch (e) {
    setBadge(badgeSystem, false);
    setBadge(badgeKsef, false);
    setBadge(badgeDisk, false);
    setBadge(badgeConfig, false);
  }
}

function restartLogStream() {
  try {
    if (logsEventSource) logsEventSource.close();
  } catch {}
  if (logFeed) logFeed.textContent = 'Łączenie z log stream…';
  startLogStream();
}

function formatLogLine(entry) {
  const ts = entry.time || entry.timestamp || entry.ts || entry.date;
  const t = ts ? new Date(ts).toLocaleTimeString('pl-PL') : '';
  const lvl = String(entry.level || '').toUpperCase();
  const mod = entry.module ? `[${entry.module}]` : '';
  const msg = entry.msg || entry.message || '';
  return `${t} ${lvl} ${mod} ${msg}`.trim();
}

function startLogStream() {
  const level = logLevelFilter?.value || '';
  const module = logModuleFilter?.value || '';

  const url = new URL('/api/logs/stream', window.location.origin);
  if (level) url.searchParams.set('level', level);
  if (module) url.searchParams.set('module', module);

  logsEventSource = new EventSource(url.toString());
  const maxLines = 200;
  let buffer = [];

  logsEventSource.onmessage = (ev) => {
    try {
      const entry = JSON.parse(ev.data);
      buffer.push(formatLogLine(entry));
      if (buffer.length > maxLines) buffer = buffer.slice(buffer.length - maxLines);
      if (logFeed) logFeed.textContent = buffer.join('\n');
    } catch {
      // ignore
    }
  };

  logsEventSource.onerror = () => {
    if (logFeed && logFeed.textContent.includes('Łączenie') === false) {
      // keep current logs
      return;
    }
    if (logFeed) logFeed.textContent = 'Nie można połączyć z log stream.';
  };
}

/**
 * Load invoices based on selected month
 */
async function loadInvoices() {
  try {
    const month = monthSelect?.value;
    const type = document.querySelector('input[name="invoiceType"]:checked')?.value || 'wszystkie';

    const url = new URL('/api/invoices', window.location.origin);
    if (month) url.searchParams.append('month', month);
    url.searchParams.append('type', type);

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch invoices');

    const data = await response.json();
    const invoices = data.invoices || [];

    if (!invoicesBody) return;

    if (invoices.length === 0) {
      invoicesBody.innerHTML = '<tr class="empty-row"><td colspan="4" class="empty-state">Brak pobranych faktur dla wybranego miesiąca</td></tr>';
    } else {
      invoicesBody.innerHTML = invoices
        .map((inv) => `<tr>
          <td>${formatDate(inv.date)}</td>
          <td>${inv.nip}</td>
          <td title="${inv.ksefRef}">${shorten(inv.ksefRef, 30)}</td>
          <td class="col-actions"><button class="download-btn" onclick="downloadInvoice('${inv.ksefRef}', '${inv.fileName || 'faktura.pdf'}')" aria-label="Pobierz">⬇️</button></td>
        </tr>`)
        .join('');
    }

    if (invoiceCount) invoiceCount.textContent = invoices.length.toString();
  } catch (error) {
    console.error('Error loading invoices:', error);
    if (invoicesBody) invoicesBody.innerHTML = '<tr class="empty-row"><td colspan="4" class="empty-state">Błąd podczas ładowania faktur</td></tr>';
    showToast('Błąd podczas ładowania faktur', 'error');
  }
}

/**
 * Generate month options for select
 */
function generateMonthOptions() {
  if (!monthSelect) return;
  const currentDate = new Date();

  monthSelect.innerHTML = '<option value="">Wszystkie miesiące</option>';

  for (let i = 0; i < 12; i++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const value = date.toISOString().substring(0, 7);
    const label = date.toLocaleDateString('pl-PL', { year: 'numeric', month: 'long' });

    const option = document.createElement('option');
    option.value = value;
    option.textContent = label.charAt(0).toUpperCase() + label.slice(1);

    monthSelect.appendChild(option);
  }
}

/**
 * Handle sync button click
 */
async function handleSync() {
  const dateFrom = dateFromInput?.value;
  const dateTo = dateToInput?.value;
  const type = document.querySelector('input[name="invoiceType"]:checked')?.value || 'wszystkie';

  if (!dateFrom || !dateTo) {
    showToast('Podaj zarówno datę początkową jak i końcową', 'warning');
    return;
  }

  if (syncButton) syncButton.disabled = true;
  progressContainer?.classList.remove('hidden');
  syncResult?.classList.add('hidden');
  if (progressFill) progressFill.style.width = '0%';
  if (progressText) progressText.textContent = 'Inicjowanie synchronizacji...';

  try {
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom, dateTo, type }),
    });

    if (!response.body) throw new Error('No response body for streaming');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      for (let i = 0; i < lines.length - 1; i++) processSSELine(lines[i]);

      buffer = lines[lines.length - 1];
    }

    if (buffer) processSSELine(buffer);

    await loadStatus();
    await loadInvoices();
    showToast('Synchronizacja zakończona', 'success');
  } catch (error) {
    console.error('Sync error:', error);
    if (progressText) progressText.textContent = '❌ Błąd podczas synchronizacji';
    showToast('Błąd synchronizacji: ' + (error.message || error), 'error');
  } finally {
    if (syncButton) syncButton.disabled = false;
  }
}

/**
 * Process Server-Sent Events line
 */
function processSSELine(line) {
  if (!line) return;
  if (line.startsWith('data: ')) {
    try {
      const payload = JSON.parse(line.substring(6));

      if (payload.status && progressText) progressText.textContent = payload.status;
      if (payload.total > 0 && payload.current !== undefined && progressFill) {
        const percentage = Math.round((payload.current / payload.total) * 100);
        progressFill.style.width = percentage + '%';
      }
      if (payload.done || payload.downloaded !== undefined) showSyncResult(payload);
    } catch (e) {
      // ignore
    }
  }
}

/**
 * Show sync result
 */
function showSyncResult(result) {
  progressContainer?.classList.add('hidden');
  syncResult?.classList.remove('hidden');

  const rDownloaded = document.getElementById('resultDownloaded');
  const rSkipped = document.getElementById('resultSkipped');
  const rErrors = document.getElementById('resultErrors');

  if (rDownloaded) rDownloaded.textContent = (result.downloaded || 0).toString();
  if (rSkipped) rSkipped.textContent = (result.skipped || 0).toString();
  if (rErrors) rErrors.textContent = (result.errors || 0).toString();

  if (progressText) progressText.textContent = 'Synchronizacja zakończona!';
}

/**
 * Download invoice
 */
async function downloadInvoice(ksefRef, fileName) {
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(ksefRef)}/download`);
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'invoice.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Download error:', error);
    showToast('Błąd podczas pobierania pliku', 'error');
  }
}

/**
 * Handle open folder button
 */
function handleOpenFolder() {
  const folderPath = folderStatus?.textContent || '-';
  if (navigator.clipboard && folderPath !== '-') {
    navigator.clipboard.writeText(folderPath).then(() => showToast('Ścieżka skopiowana do schowka', 'info'));
  } else {
    showToast(`Folder: ${folderPath}`, 'info');
  }
}

function shorten(text, max = 30) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + '...';
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('pl-PL');
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('pl-PL') + ' ' + date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

// Periodically refresh status and invoices
setInterval(loadStatus, 30000);

/* Simple toast notifications */
function showToast(message, type = 'info', duration = 4000) {
  const container = toastContainer || document.getElementById('toastContainer');
  if (!container) {
    try { alert(message); } catch (e) { console.log(message); }
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('exit');
    setTimeout(() => { if (toast.parentNode === container) container.removeChild(toast); }, 400);
  }, duration);
}
