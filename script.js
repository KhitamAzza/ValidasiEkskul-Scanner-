// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzoz8-2qB1KkGn0iOvGxAX4qnJL9ou7QAJ3i-ZFG5riQbaqgkv3jwNuE7y_pWDEOTfb/exec';

// ═══════════════════════════════════════
// AUDIO - Custom Sound Effects
// ═══════════════════════════════════════
const amanSound = new Audio('AMAN.mp3');
const belumSound = new Audio('TIDAK_TUNTAS.mp3');

amanSound.load();
belumSound.load();

function playSound(status) {
  const sound = status === 'AMAN' ? amanSound : belumSound;
  sound.currentTime = 0;
  sound.play().catch(err => console.log('Audio blocked:', err));
}

// ═══════════════════════════════════════
// DATA STORAGE
// ═══════════════════════════════════════
let studentsData = [];
let photosData = [];
let scanner = null;
let isScanning = true;
let modalStack = [];
let selectedSearchIndex = -1;

// ═══════════════════════════════════════
// API
// ═══════════════════════════════════════
async function api(action, payload = {}) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload })
  });
  return res.json();
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initAppWithLoading();
});

async function initAppWithLoading() {
  const overlay = document.getElementById('loadingOverlay');
  const subtext = document.getElementById('loadingSubtext');

  try {
    subtext.textContent = 'Memulai kamera...';
    initScanner();

    subtext.textContent = 'Mengambil data siswa...';
    await loadData();

    subtext.textContent = 'Menyiapkan aplikasi...';
    setupEventListeners();
    initBluetoothScanner();

    overlay.classList.add('hidden');
    toast('Aplikasi siap digunakan');

  } catch (e) {
    console.error('Init error:', e);
    subtext.textContent = 'Error: ' + e.message;
    toast('❌ Error memuat data: ' + e.message);
    setTimeout(() => overlay.classList.add('hidden'), 3000);
  }
}

// ═══════════════════════════════════════
// QR SCANNER
// ═══════════════════════════════════════
function initScanner() {
  scanner = new Html5Qrcode('reader');
  const config = {
    fps: 10,
    qrbox: { width: 220, height: 220 },
    aspectRatio: 1.0,
    formatsToSupport: [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.AZTEC,
      Html5QrcodeSupportedFormats.DATA_MATRIX,
      Html5QrcodeSupportedFormats.PDF_417,
      Html5QrcodeSupportedFormats.MAXICODE,
    ],
  };
  scanner.start(
    { facingMode: 'environment' },
    config,
    onScanSuccess,
    onScanFailure
  ).catch(err => {
    toast('Gagal mengakses kamera: ' + err.message);
    console.error('Scanner init error:', err);
  });
}

function onScanSuccess(decodedText) {
  if (!isScanning) return;
  isScanning = false;
  const studentId = decodedText.trim();

  const resultBar = document.getElementById('scannedResult');
  const resultId = document.getElementById('scannedId');
  resultId.textContent = studentId;
  resultBar.classList.add('active');

  const student = findStudent(studentId);
  if (student) {
    showStampAnimation(student, () => {
      showStudentModal(student);
    });
    toast('Siswa ditemukan: ' + student.nama);
  } else {
    toast('Siswa tidak ditemukan: ' + studentId);
    setTimeout(resumeScanner, 2000);
  }
}

function onScanFailure(error) {
  // Ignore scan failures
}

function resumeScanner() {
  const resultBar = document.getElementById('scannedResult');
  resultBar.classList.remove('active');
  document.getElementById('scannedId').textContent = '';
  isScanning = true;
}

// ═══════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════
async function loadData() {
  const btn = document.getElementById('btnRefresh');
  const isInit = !document.getElementById('loadingOverlay').classList.contains('hidden');

  if (btn) {
    btn.classList.add('spin');
    btn.disabled = true;
  }

  try {
    const [studentsR, photosR] = await Promise.all([
      api('getStudentData'),
      api('getAllPhotos')
    ]);

    if (studentsR.success) {
      studentsData = studentsR.students || [];
      window.attendanceHeaders = studentsR.attendanceHeaders || [];
      studentsData.forEach(s => {
        s.attendanceHeaders = window.attendanceHeaders;
      });
    } else {
      throw new Error(studentsR.error || 'Failed to load students');
    }

    if (photosR.success) {
      photosData = photosR.photos || [];
    } else {
      throw new Error(photosR.error || 'Failed to load photos');
    }

    if (!isInit) {
      toast(`Data dimuat: ${studentsData.length} siswa`);
    }
  } catch (err) {
    console.error('Load data error:', err);
    if (!isInit) {
      toast('Gagal memuat data: ' + err.message);
    }
    throw err;
  } finally {
    if (btn) {
      btn.classList.remove('spin');
      btn.disabled = false;
    }
  }
}

// ═══════════════════════════════════════
// STUDENT LOOKUP
// ═══════════════════════════════════════
function findStudent(id) {
  const student = studentsData.find(s => s.idSiswa === id);
  if (!student) return null;
  const foto = photosData.find(f => f.idSiswa === id);
  return {
    ...student,
    fotoUrl: foto ? buildPhotoUrl(foto.fotoId) : null,
    fotoId: foto ? foto.fotoId : null,
  };
}

function buildPhotoUrl(fotoId) {
  if (!fotoId) return null;
  if (fotoId.startsWith('http')) return fotoId;
  return `https://lh3.googleusercontent.com/d/${fotoId}=s400`;
}

// ═══════════════════════════════════════
// MODAL MANAGEMENT
// ═══════════════════════════════════════
function showStampAnimation(student, onComplete) {
  const overlay = document.getElementById('stampOverlay');
  const photo = document.getElementById('stampPhoto');
  const text = document.getElementById('stampText');
  const name = document.getElementById('stampName');

  photo.className = 'stamp-photo';
  photo.src = student.fotoUrl || '';
  photo.onerror = function() {
    this.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👤</text></svg>';
  };

  const isAman = student.status === 'AMAN';
  if (!isAman) {
    photo.classList.add('grayscale');
  }
  text.innerHTML = isAman ? 'AMAN' : 'BELUM<br>TUNTAS';
  text.className = 'stamp-text ' + (isAman ? 'aman' : 'belum');
  name.textContent = student.nama;

  playSound(student.status);
  overlay.classList.add('active');

  setTimeout(() => {
    overlay.classList.remove('active');
    if (onComplete) onComplete();
  }, 3000);
}

function showStudentModal(student) {
  const modal = document.getElementById('modalInfo');
  const content = document.getElementById('modalInfoContent');

  document.getElementById('infoPhoto').src = student.fotoUrl || '';
  document.getElementById('infoName').textContent = student.nama;
  document.getElementById('infoClass').textContent = student.kelas;
  document.getElementById('infoId').textContent = student.idSiswa;
  document.getElementById('infoEkstra').textContent = student.ekstra;
  document.getElementById('infoDenda').textContent = formatRupiah(student.denda);
  document.getElementById('infoDendaBayar').textContent = formatRupiah(student.dendaDibayar);
  document.getElementById('infoSisa').textContent = formatRupiah(student.sisaDenda);
  document.getElementById('infoSyarat').textContent = student.syaratKhusus === 'TRUE' ? 'Ya' : 'Tidak';

  const statusEl = document.getElementById('infoStatus');
  statusEl.textContent = student.status === 'AMAN' ? '✓ AMAN' : '⚠ BELUM TUNTAS';
  statusEl.className = 'status-badge ' + (student.status === 'AMAN' ? 'status-aman' : 'status-belum');

  content.dataset.studentId = student.idSiswa;
  openModal(modal);
}

function showDetailModal(studentId) {
  const student = findStudent(studentId);
  if (!student) return;

  const modal = document.getElementById('modalDetail');

  document.getElementById('detailPhoto').src = student.fotoUrl || '';
  document.getElementById('detailName').textContent = student.nama;
  document.getElementById('detailClass').textContent = student.kelas;

  const statusEl = document.getElementById('detailStatus');
  statusEl.textContent = student.status === 'AMAN' ? '✓ AMAN' : '⚠ BELUM TUNTAS';
  statusEl.className = 'status-badge ' + (student.status === 'AMAN' ? 'status-aman' : 'status-belum');

  const list = document.getElementById('assessmentList');
  list.innerHTML = generateAssessmentList(student);

  openModal(modal);
}

function getAttendanceBadgeClass(val) {
  const v = String(val).toUpperCase().trim();
  if (v === 'ALPHA') return 'attendance-alpha';
  if (v === 'TERLAMBAT') return 'attendance-terlambat';
  if (v === 'PAGI') return 'attendance-pagi';
  if (v === 'H' || v === 'HADIR') return 'attendance-hadir';
  if (v === 'SAKIT') return 'attendance-sakit';
  if (v === 'IZIN') return 'attendance-izin';
  return 'attendance-other';
}

function generateAssessmentList(student) {
  const items = [];

  const attendanceHeaders = student.attendanceHeaders || [];
  const attendanceValues = student.attendance || [];

  attendanceHeaders.forEach((header, i) => {
    const val = attendanceValues[i] || 'Belum ada data';
    const formattedDate = formatIndonesianDate(header);
    const dateStr = formattedDate || header;
    const badgeClass = getAttendanceBadgeClass(val);
    const displayVal = String(val).toUpperCase() || 'BELUM ADA DATA';

    items.push({
      label: `${dateStr}`,
      badge: `<span class="attendance-badge ${badgeClass}">${displayVal}</span>`,
      done: false,
      detail: ''
    });
  });

  const syarat = student.syaratKhusus === 'TRUE';
  items.push({
    label: 'Syarat Khusus',
    done: syarat,
    detail: syarat ? 'Sudah' : 'Belum'
  });

  const sisaDenda = parseFloat(student.sisaDenda) || 0;
  items.push({
    label: 'Sisa Denda Lunas',
    done: sisaDenda === 0,
    detail: sisaDenda === 0 ? 'Rp 0' : `Rp ${sisaDenda.toLocaleString('id-ID')}`
  });

  items.push({
    label: 'Status Kelulusan',
    done: student.status === 'AMAN',
    detail: student.status === 'AMAN' ? 'Lulus' : 'Belum Tuntas'
  });

  return items.map(item => `
    <li class="assessment-item">
      ${item.badge ? '' : `<span class="check-icon ${item.done ? 'check-done' : 'check-pending'}">${item.done ? '✓' : '!'}</span>`}
      <div style="flex:1;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <span>${item.label}</span>
          ${item.badge || ''}
        </div>
        ${item.detail ? `<div style="font-size: 13px; color: #888; margin-top: 2px;">${item.detail}</div>` : ''}
      </div>
    </li>
  `).join('');
}

function formatIndonesianDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);

  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) return dateStr;

  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  return `${day} ${months[month]} ${year}`;
}

function openModal(modal) {
  modal.classList.add('active');
  modalStack.push(modal);
}

function closeTopModal() {
  if (modalStack.length === 0) return;
  const modal = modalStack.pop();
  modal.classList.remove('active');
  if (modalStack.length === 0) {
    resumeScanner();
  }
}

function closeAllModals() {
  while (modalStack.length > 0) {
    const modal = modalStack.pop();
    modal.classList.remove('active');
  }
  resumeScanner();
}

// ═══════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════
function openSearch() {
  const dialog = document.getElementById('searchDialog');
  dialog.classList.add('active');
  isScanning = false;
  setTimeout(() => {
    const input = document.getElementById('searchInput');
    input.focus();
    input.select();
  }, 150);
}

function closeSearch(skipResume) {
  const dialog = document.getElementById('searchDialog');
  dialog.classList.remove('active');
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '<div class="loading-state">Ketik untuk mencari siswa...</div>';
  if (!skipResume) {
    isScanning = true;
  }
}

function performSearch(query) {
  const resultsEl = document.getElementById('searchResults');
  selectedSearchIndex = -1;

  if (!query.trim()) {
    resultsEl.innerHTML = '<div class="loading-state">Ketik untuk mencari siswa...</div>';
    return;
  }
  const q = query.toLowerCase();
  const results = studentsData.filter(s =>
    s.nama.toLowerCase().includes(q) ||
    s.idSiswa.toLowerCase().includes(q) ||
    s.kelas.toLowerCase().includes(q)
  );
  if (results.length === 0) {
    resultsEl.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <div>Tidak ada hasil untuk "${escapeHtml(query)}"</div>
      </div>
    `;
    return;
  }
  resultsEl.innerHTML = results.map(s => {
    const foto = photosData.find(f => f.idSiswa === s.idSiswa);
    const fotoUrl = foto ? buildPhotoUrl(foto.fotoId) : '';
    const statusClass = s.status === 'AMAN' ? 'status-aman' : 'status-belum';
    return `
      <div class="search-result-item" data-id="${escapeHtml(s.idSiswa)}">
        <img class="result-photo" src="${fotoUrl || ''}" alt="" onerror="this.style.display='none'">
        <div class="result-info">
          <div class="result-name">${escapeHtml(s.nama)}</div>
          <div class="result-class">${escapeHtml(s.kelas)} · ID: ${escapeHtml(s.idSiswa)}</div>
        </div>
        <span class="result-status ${statusClass}">${s.status === 'AMAN' ? 'AMAN' : 'BELUM'}</span>
      </div>
    `;
  }).join('');

  selectedSearchIndex = 0;
  const items = resultsEl.querySelectorAll('.search-result-item');
  updateSearchSelection(items, 0);
}

function updateSearchSelection(items, index) {
  items.forEach((item, i) => {
    item.classList.toggle('keyboard-selected', i === index);
  });
  if (items[index]) {
    items[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ═══════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════
function setupEventListeners() {
  // Button clicks
  document.getElementById('btnSearch').addEventListener('click', openSearch);
  document.getElementById('btnRefresh').addEventListener('click', loadData);

  document.getElementById('btnDetail').addEventListener('click', (e) => {
    e.stopPropagation();
    const studentId = document.getElementById('modalInfoContent').dataset.studentId;
    showDetailModal(studentId);
  });

  document.getElementById('btnCloseSearch').addEventListener('click', closeSearch);

  // Search input
  const searchInput = document.getElementById('searchInput');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => performSearch(e.target.value), 200);
  });

  // Search results click
  document.getElementById('searchResults').addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (item) {
      const id = item.dataset.id;
      const student = findStudent(id);
      if (student) {
        closeSearch(true);
        playSound(student.status);
        showStudentModal(student);
      }
    }
  });

  // Modal backdrop clicks
  document.getElementById('modalInfo').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeTopModal();
  });
  document.getElementById('modalDetail').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeTopModal();
  });

  // Prevent modal content clicks from closing
  document.getElementById('modalInfoContent').addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('modalDetailContent').addEventListener('click', (e) => e.stopPropagation());

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter: Open search
    if (e.code === 'Enter' && e.ctrlKey) {
      const searchOpen = document.getElementById('searchDialog').classList.contains('active');
      const activeElement = document.activeElement;
      const isInputFocused = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
      if (!searchOpen && !isInputFocused && modalStack.length === 0) {
        e.preventDefault();
        openSearch();
        setTimeout(() => document.getElementById('searchInput').focus(), 100);
      }
    }

    // Space: Close top modal
    if (e.code === 'Space') {
      const searchOpen = document.getElementById('searchDialog').classList.contains('active');
      const activeElement = document.activeElement;
      const isInputFocused = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
      if (!searchOpen && !isInputFocused && modalStack.length > 0) {
        e.preventDefault();
        closeTopModal();
      }
    }

    // Escape: Close search or modal
    if (e.code === 'Escape') {
      const searchOpen = document.getElementById('searchDialog').classList.contains('active');
      if (searchOpen) {
        closeSearch();
      } else if (modalStack.length > 0) {
        closeTopModal();
      }
    }
  });
}

// Scanned result bar click — reopen modal
document.getElementById('scannedResult').addEventListener('click', () => {
  const id = document.getElementById('scannedId').textContent;
  if (id) {
    const student = findStudent(id);
    if (student) showStudentModal(student);
  }
});

// ═══════════════════════════════════════
// BLUETOOTH BARCODE SCANNER
// ═══════════════════════════════════════
let barcodeBuffer = "";
let lastKeyTime = 0;
const BARCODE_TIMEOUT = 50;
const MIN_BARCODE_LENGTH = 5;

function initBluetoothScanner() {
  document.addEventListener('keydown', (e) => {
    const activeElement = document.activeElement;
    const isRealInputFocused = activeElement && (
      (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') &&
      activeElement.id !== 'scannerInput'
    );
    const searchOpen = document.getElementById('searchDialog').classList.contains('active');
    const anyModalOpen = modalStack.length > 0;

    if (isRealInputFocused || searchOpen || anyModalOpen) return;

    const now = Date.now();
    const timeDiff = now - lastKeyTime;
    lastKeyTime = now;

    if (timeDiff > BARCODE_TIMEOUT) {
      barcodeBuffer = "";
    }

    if (e.key.length === 1) {
      barcodeBuffer += e.key;
    } else if (e.code === 'Enter') {
      if (barcodeBuffer.length >= MIN_BARCODE_LENGTH) {
        e.preventDefault();
        const barcode = barcodeBuffer.trim();
        barcodeBuffer = "";
        handleBarcodeScan(barcode);
      } else {
        barcodeBuffer = "";
      }
    }
  });
}

function handleBarcodeScan(barcode) {
  console.log('Barcode scanned:', barcode);

  if (!isScanning) return;
  isScanning = false;

  const resultBar = document.getElementById('scannedResult');
  const resultId = document.getElementById('scannedId');
  resultId.textContent = barcode;
  resultBar.classList.add('active');

  const student = findStudent(barcode);
  if (student) {
    showStampAnimation(student, () => {
      showStudentModal(student);
    });
    toast('Siswa ditemukan: ' + student.nama);
  } else {
    toast('Siswa tidak ditemukan: ' + barcode);
    setTimeout(resumeScanner, 2000);
  }
}

// ═══════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════
function formatRupiah(value) {
  const num = parseFloat(value) || 0;
  return 'Rp ' + num.toLocaleString('id-ID');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
