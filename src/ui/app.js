/**
 * Frontend Application Logic
 * Vanilla JavaScript for KSeF Sync Web UI
 */

// DOM Elements
const syncButton = document.getElementById('syncButton');
const dateFromInput = document.getElementById('dateFrom');
const dateToInput = document.getElementById('dateTo');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const syncResult = document.getElementById('syncResult');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const monthSelect = document.getElementById('monthSelect');
const invoicesBody = document.getElementById('invoicesBody');
const invoiceCount = document.getElementById('invoiceCount');
const statEnv = document.getElementById('statEnv');
const nipStatus = document.getElementById('nipStatus');
const statLastSync = document.getElementById('statLastSync');
const statTotal = document.getElementById('statTotal');
const statFolder = document.getElementById('statFolder');
const footerEnv = document.getElementById('footerEnv');
const openFolderBtn = document.getElementById('openFolderBtn');
const connectionStatus = document.getElementById('connectionStatus');
const folderStatus = document.getElementById('folderStatus');

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

  dateFromInput.value = formatDate(oneMonthAgo);
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
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Połączono';
      if (connectionStatus) connectionStatus.textContent = 'Połączono';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = 'Brak połączenia';
      if (connectionStatus) connectionStatus.textContent = 'Brak połączenia';
    }

    // Update status section
    if (statEnv) statEnv.textContent = status.environment || '-';
    if (nipStatus) nipStatus.textContent = status.nip || '-';
    if (statLastSync) statLastSync.textContent = status.lastSync ? formatDateTime(status.lastSync) : 'Nigdy';
    if (statTotal) statTotal.textContent = (status.totalInvoices || 0).toString();
    
    if (statFolder) {
        statFolder.textContent = status.outputDir || '-';
        statFolder.title = status.outputDir || '';
    }
    
    if (folderStatus) {
        folderStatus.textContent = status.outputDir || '-';
        folderStatus.title = status.outputDir || '';
    }

    if (footerEnv) footerEnv.textContent = status.environment || '-';
  } catch (error) {
    console.error('Error loading status:', error);
    statusDot.className = 'status-dot disconnected';
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
      invoicesBody.innerHTML = '<tr><td colspan="4" class="empty-state">Brak faktur do wyświetlenia</td></tr>';
    } else {
      invoicesBody.innerHTML = invoices
        .map(
          (inv) =>
            `<tr>
          <td>${formatDate(inv.date)}</td>
          <td>${inv.nip}</td>
          <td title="${inv.ksefRef}">${inv.ksefRef.substring(0, 20)}...</td>
          <td class="col-actions">
            <button class="btn btn-secondary btn-sm" onclick="downloadInvoice('${inv.ksefRef}', '${inv.fileName}')">
              <span>⬇️</span> Pobierz
            </button>
          </td>
        </tr>`
        )
        .join('');
    }

    invoiceCount.textContent = invoices.length.toString();
  } catch (error) {
    console.error('Error loading invoices:', error);
    invoicesBody.innerHTML = '<tr><td colspan="4" class="empty-state">Błąd podczas ładowania faktur</td></tr>';
  }
}

/**
 * Generate month options for select
 */
function generateMonthOptions() {
  const currentDate = new Date();
  monthSelect.innerHTML = '<option value="">Wszystkie miesiące</option>';

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
    showToast('Podaj zarówno datę początkową jak i końcową', 'error');
    return;
  }

  // Disable button
  syncButton.disabled = true;
  progressContainer.classList.remove('hidden');
  syncResult.classList.add('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = 'Inicjowanie synchronizacji...';

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
    showToast('Błąd: ' + error.message, 'error');
  } finally {
    syncButton.disabled = false;
  }
}

/**
 * Process Server-Sent Events line
 */
function processSSELine(line) {
  if (line.startsWith('data: ')) {
    try {
      const data = JSON.parse(line.substring(6));

      if (data.status) {
        progressText.textContent = data.status;

        if (data.total > 0 && data.current !== undefined) {
          const percentage = Math.round((data.current / data.total) * 100);
          progressFill.style.width = percentage + '%';
        }
      }

      if (data.downloaded !== undefined) {
          showSyncResult(data);
      }
    } catch (e) {
      // Ignore JSON parse errors
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

  showToast('Synchronizacja zakończona pomyślnie!', 'success');
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
    showToast('Plik pobrany pomyślnie');
  } catch (error) {
    console.error('Download error:', error);
    showToast('Błąd podczas pobierania pliku', 'error');
  }
}

/**
 * Handle open folder button
 */
function handleOpenFolder() {
  const folderPath = statFolder.textContent;
  navigator.clipboard.writeText(folderPath).then(() => {
    showToast('Ścieżka skopiowana do schowka');
  });
  alert(`Folder z plikami:\n\n${folderPath}\n\nŚcieżka została skopiowana do schowka. Otwórz ten folder ręcznie w eksploratorze plików.`);
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        background-color: var(--color-bg-card);
        color: var(--color-text-primary);
        padding: 12px 24px;
        border-radius: 8px;
        border: 1px solid var(--color-border-light);
        margin-bottom: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: toast-in 0.3s ease-out;
        display: flex;
        align-items: center;
        gap: 12px;
    `;
    
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toast-out 0.3s ease-in';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Add toast animations to head
const style = document.createElement('style');
style.textContent = `
    .toast-container {
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 9999;
    }
    @keyframes toast-in {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes toast-out {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

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
