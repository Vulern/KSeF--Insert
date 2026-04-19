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
const envStatus = document.getElementById('envStatus');
const nipStatus = document.getElementById('nipStatus');
const lastSyncStatus = document.getElementById('lastSyncStatus');
const totalStatus = document.getElementById('totalStatus');
const folderStatus = document.getElementById('folderStatus');
const footerEnv = document.getElementById('footerEnv');
const openFolderBtn = document.getElementById('openFolderBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setDefaultDates();
  loadStatus();
  loadInvoices();
  generateMonthOptions();

  // Event listeners
  syncButton.addEventListener('click', handleSync);
  monthSelect.addEventListener('change', loadInvoices);
  openFolderBtn.addEventListener('click', handleOpenFolder);
});

/**
 * Set default dates (today for dateTo, 1 month ago for dateFrom)
 */
function setDefaultDates() {
  const today = new Date();
  const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

  const formatDate = (date) => date.toISOString().split('T')[0];

  // dateFromInput already has a default, but let's make it dynamic
  dateToInput.valueAsDate = today;
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
      statusDot.classList.remove('disconnected');
      statusDot.classList.add('connected');
      statusText.textContent = 'Połączono';
    } else {
      statusDot.classList.remove('connected');
      statusDot.classList.add('disconnected');
      statusText.textContent = 'Brak połączenia';
    }

    // Update status section
    envStatus.textContent = status.environment || '-';
    nipStatus.textContent = status.nip || '-';
    lastSyncStatus.textContent = status.lastSync ? formatDateTime(status.lastSync) : 'Nigdy';
    totalStatus.textContent = (status.totalInvoices || 0).toString();
    folderStatus.textContent = status.outputDir || '-';
    footerEnv.textContent = status.environment || '-';
  } catch (error) {
    console.error('Error loading status:', error);
    statusDot.classList.remove('connected');
    statusDot.classList.add('disconnected');
    statusText.textContent = 'Błąd';
  }
}

/**
 * Load invoices based on selected month
 */
async function loadInvoices() {
  try {
    const month = monthSelect.value;
    const type = document.querySelector('input[name="invoiceType"]:checked').value;

    const url = new URL('/api/invoices', window.location.origin);
    if (month) url.searchParams.append('month', month);
    url.searchParams.append('type', type);

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch invoices');

    const data = await response.json();
    const invoices = data.invoices || [];

    // Render table
    if (invoices.length === 0) {
      invoicesBody.innerHTML = '<tr><td colspan="4" class="empty">Brak faktur do wyświetlenia</td></tr>';
    } else {
      invoicesBody.innerHTML = invoices
        .map(
          (inv) =>
            `<tr>
          <td>${formatDate(inv.date)}</td>
          <td>${inv.nip}</td>
          <td>${inv.ksefRef.substring(0, 20)}...</td>
          <td><button class="download-btn" onclick="downloadInvoice('${inv.ksefRef}', '${inv.fileName}')">⬇️</button></td>
        </tr>`
        )
        .join('');
    }

    invoiceCount.textContent = invoices.length.toString();
  } catch (error) {
    console.error('Error loading invoices:', error);
    invoicesBody.innerHTML = '<tr><td colspan="4" class="empty">Błąd podczas ładowania faktur</td></tr>';
  }
}

/**
 * Generate month options for select
 */
function generateMonthOptions() {
  const currentDate = new Date();
  const months = [];

  // Generate last 12 months
  for (let i = 0; i < 12; i++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const value = date.toISOString().substring(0, 7); // "2024-01"
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
  const dateFrom = dateFromInput.value;
  const dateTo = dateToInput.value;
  const type = document.querySelector('input[name="invoiceType"]:checked').value;

  if (!dateFrom || !dateTo) {
    alert('Podaj zarówno datę początkową jak i końcową');
    return;
  }

  // Disable button
  syncButton.disabled = true;
  progressContainer.classList.remove('hidden');
  syncResult.classList.add('hidden');

  try {
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom, dateTo, type }),
    });

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      // Process complete lines
      for (let i = 0; i < lines.length - 1; i++) {
        processSSELine(lines[i]);
      }

      // Keep incomplete line in buffer
      buffer = lines[lines.length - 1];
    }

    // Process any remaining data
    if (buffer) {
      processSSELine(buffer);
    }

    loadStatus();
    loadInvoices();
  } catch (error) {
    console.error('Sync error:', error);
    progressText.textContent = '❌ Błąd podczas synchronizacji';
    alert('Błąd: ' + error.message);
  } finally {
    syncButton.disabled = false;
  }
}

/**
 * Process Server-Sent Events line
 */
function processSSELine(line) {
  if (line.startsWith('event: progress')) {
    // Next line will have data
  } else if (line.startsWith('data: ')) {
    try {
      const data = JSON.parse(line.substring(6));

      if (data.status) {
        progressText.textContent = data.status;

        if (data.total > 0 && data.current !== undefined) {
          const percentage = Math.round((data.current / data.total) * 100);
          progressFill.style.width = percentage + '%';
        }
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  } else if (line.startsWith('event: done')) {
    // Next line will have result data
  } else if (line.includes('"downloaded"')) {
    try {
      const data = JSON.parse(line.replace('data: ', ''));
      showSyncResult(data);
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * Show sync result
 */
function showSyncResult(result) {
  progressContainer.classList.add('hidden');
  syncResult.classList.remove('hidden');

  document.getElementById('resultDownloaded').textContent = (result.downloaded || 0).toString();
  document.getElementById('resultSkipped').textContent = (result.skipped || 0).toString();
  document.getElementById('resultErrors').textContent = (result.errors || 0).toString();

  progressText.textContent = 'Synchronizacja zakończona!';
}

/**
 * Download invoice
 */
async function downloadInvoice(ksefRef, fileName) {
  try {
    const response = await fetch(`/api/invoices/${ksefRef}/download`);
    if (!response.ok) throw new Error('Download failed');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Download error:', error);
    alert('Błąd podczas pobierania pliku');
  }
}

/**
 * Handle open folder button
 */
function handleOpenFolder() {
  const folderPath = folderStatus.textContent;
  alert(`Folder z plikami:\n\n${folderPath}\n\nOtwórz ten folder ręcznie w eksploratorze plików.`);
}

/**
 * Format date string
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('pl-PL');
}

/**
 * Format date and time
 */
function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('pl-PL') + ' ' + date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

// Periodically refresh status and invoices
setInterval(loadStatus, 30000); // Every 30 seconds
