// ─────────────────────────────────────────────────────────────────────────────
// CodeDrop Client
// ─────────────────────────────────────────────────────────────────────────────

// Get snippet ID from URL
const snippetId = window.location.pathname.slice(1).match(/^[a-zA-Z0-9]{8,12}$/)?.[0] || null;

// DOM refs
const editor       = document.getElementById('code-editor');
const gutter       = document.getElementById('gutter-inner');
const charCount    = document.getElementById('char-count');
const lineCount    = document.getElementById('line-count');
const sizeCount    = document.getElementById('size-count');
const splash       = document.getElementById('splash');
const shareBtn     = document.getElementById('share-btn');
const newBtn       = document.getElementById('new-btn');
const copyBtn      = document.getElementById('copy-btn');
const sharePanel   = document.getElementById('share-panel');
const shareUrlInput= document.getElementById('share-url-input');
const copyUrlBtn   = document.getElementById('copy-url-btn');
const closePanelBtn= document.getElementById('close-panel-btn');
const langSelect   = document.getElementById('lang-select');
const titleInput   = document.getElementById('title-input');
const codeView     = document.getElementById('code-view');
const codeHL       = document.getElementById('code-highlighted');
const loadingOl    = document.getElementById('loading-overlay');
const errorState   = document.getElementById('error-state');
const expiryBadge  = document.getElementById('expiry-badge');
const expiryText   = document.getElementById('expiry-text');
const expiryContainer = document.getElementById('expiry-container');
const toast        = document.getElementById('toast');
const newBanner    = document.getElementById('new-banner');

// ─── State ───────────────────────────────────────────────────────────────────
let isViewMode = false;
let expiresAt  = null;
let expiryTimer= null;
let toastTimer = null;
let sharing    = false;

// ─── Initialization ───────────────────────────────────────────────────────────
if (snippetId) {
  loadSnippet(snippetId);
} else {
  loadingOl.classList.add('hidden');
  editor.focus();
  updateStats();
}

// Check if we just created a new snippet (from localStorage flag)
if (sessionStorage.getItem('just_shared') === '1') {
  sessionStorage.removeItem('just_shared');
  setTimeout(() => {
    newBanner.classList.add('show');
    setTimeout(() => newBanner.classList.remove('show'), 2500);
  }, 400);
}

// ─── Load Snippet ─────────────────────────────────────────────────────────────
async function loadSnippet(id) {
  loadingOl.classList.remove('hidden');
  try {
    const res = await fetch('/api/snippets/' + id);
    if (!res.ok) {
      loadingOl.classList.add('hidden');
      errorState.classList.remove('hidden');
      document.getElementById('gutter').style.display = 'none';
      return;
    }
    const data = await res.json();
    loadingOl.classList.add('hidden');
    enterViewMode(data);
  } catch (e) {
    loadingOl.classList.add('hidden');
    errorState.classList.remove('hidden');
  }
}

function enterViewMode(data) {
  isViewMode = true;
  expiresAt = data.expiresAt;

  // Hide editor, show view
  editor.style.display = 'none';
  if (gutter && gutter.parentElement) {
    gutter.parentElement.style.display = 'none'; // hide gutter
  }
  splash.classList.add('hidden');
  codeView.classList.remove('hidden');

  // Show copy button, hide share
  shareBtn.style.display = 'none';
  copyBtn.style.display = 'flex';

  // Set title & lang
  titleInput.value = data.title || 'Untitled Snippet';
  titleInput.readOnly = true;
  langSelect.value = data.language || 'plaintext';
  langSelect.disabled = true;

  // Syntax highlight
  const hlLang = mapLangToHL(data.language);
  if (hlLang && hljs.getLanguage(hlLang)) {
    codeHL.innerHTML = hljs.highlight(data.code, { language: hlLang }).value;
  } else {
    codeHL.textContent = data.code;
  }

  // Stats
  const lines = data.code.split('\n').length;
  lineCount.textContent = lines;
  charCount.textContent = data.code.length;
  sizeCount.textContent = formatSize(new Blob([data.code]).size);

  // Expiry timer
  expiryContainer.style.display = 'flex';
  startExpiryTimer();

  // Share panel
  shareUrlInput.value = location.href;
  sharePanel.classList.add('open');
  updateShareMeta(data);
}

// ─── Stats Update (editor mode) ───────────────────────────────────────────────
function updateStats() {
  const code = editor.value;
  const lines = code ? code.split('\n').length : 0;
  lineCount.textContent = lines;
  charCount.textContent = code.length;
  sizeCount.textContent = formatSize(new Blob([code]).size);
  updateGutter(lines);
  splash.classList.toggle('hidden', code.length > 0);
}

function updateGutter(lines) {
  let html = '';
  for (let i = 1; i <= Math.max(lines, 1); i++) {
    html += '<span class="gutter-line">' + i + '</span>';
  }
  gutter.innerHTML = html;
}

// Sync gutter scroll with editor
editor.addEventListener('scroll', () => {
  gutter.parentElement.scrollTop = editor.scrollTop;
});

// ─── Editor Events ────────────────────────────────────────────────────────────
editor.addEventListener('input', updateStats);

// Tab key → insert spaces
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const spaces = '  ';

    if (e.shiftKey) {
      // Dedent: remove leading spaces from selected lines
      const before = editor.value.substring(0, start);
      const after = editor.value.substring(end);
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineContent = editor.value.substring(lineStart, end);
      if (lineContent.startsWith('  ')) {
        editor.value = editor.value.substring(0, lineStart) + lineContent.slice(2) + after;
        editor.selectionStart = editor.selectionEnd = start - 2;
      }
    } else {
      editor.value = editor.value.substring(0, start) + spaces + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + spaces.length;
    }
    updateStats();
  }

  // Ctrl+Enter → Share
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    if (!isViewMode) shareSnippet();
  }

  // Ctrl+N → New
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    window.location.href = '/';
  }

  // Auto-close brackets/quotes
  const pairs = { '(': ')', '[': ']', '{': '}', '"': '"' };
  pairs["'"] = "'";
  pairs['`'] = '`';
  if (pairs[e.key]) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start === end) {
      e.preventDefault();
      const closing = pairs[e.key];
      editor.value = editor.value.substring(0, start) + e.key + closing + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 1;
      updateStats();
    }
  }
});

// ─── Share ────────────────────────────────────────────────────────────────────
shareBtn.addEventListener('click', shareSnippet);

async function shareSnippet() {
  if (sharing || isViewMode) return;
  const code = editor.value.trim();
  if (!code) { showToast('⚠️ Nothing to share!', 'error'); return; }

  sharing = true;
  shareBtn.disabled = true;
  shareBtn.innerHTML = '<span class="icon">◌</span> Sharing…';

  try {
    const res = await fetch('/api/snippets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        language: langSelect.value,
        title: titleInput.value || 'Untitled Snippet',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to share');
    }

    const { id } = await res.json();
    const url = location.origin + '/' + id;

    // Copy URL to clipboard
    await navigator.clipboard.writeText(url).catch(() => {});

    sessionStorage.setItem('just_shared', '1');
    window.location.href = '/' + id;

  } catch (err) {
    showToast('❌ ' + err.message, 'error');
    shareBtn.disabled = false;
    shareBtn.innerHTML = '<span class="icon">⬡</span> Share';
    sharing = false;
  }
}

// ─── Copy Code ────────────────────────────────────────────────────────────────
copyBtn.addEventListener('click', () => {
  const code = codeHL.textContent || '';
  navigator.clipboard.writeText(code).then(() => {
    showToast('✓ Code copied to clipboard', 'success');
  });
});

// Keyboard shortcut in view mode
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
    e.preventDefault();
    if (isViewMode) copyBtn.click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    if (isViewMode) { e.preventDefault(); window.location.href = '/'; }
  }
});

// ─── New snippet ──────────────────────────────────────────────────────────────
newBtn.addEventListener('click', () => { window.location.href = '/'; });

// ─── Share Panel ──────────────────────────────────────────────────────────────
closePanelBtn.addEventListener('click', () => {
  sharePanel.classList.remove('open');
});

copyUrlBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(shareUrlInput.value).then(() => {
    showToast('✓ Link copied!', 'success');
    copyUrlBtn.innerHTML = '<span class="icon">✓</span> Copied';
    setTimeout(() => { copyUrlBtn.innerHTML = '<span class="icon">⎘</span> Copy'; }, 1500);
  });
});

shareUrlInput.addEventListener('click', () => shareUrlInput.select());

function updateShareMeta(data) {
  document.getElementById('share-lang').textContent = data.language || 'plaintext';
  document.getElementById('share-size').textContent = formatSize(new Blob([data.code]).size);
}

// ─── Expiry Timer ─────────────────────────────────────────────────────────────
function startExpiryTimer() {
  if (expiryTimer) clearInterval(expiryTimer);
  tickExpiry();
  expiryTimer = setInterval(tickExpiry, 1000);
}

function tickExpiry() {
  if (!expiresAt) return;
  const remaining = Math.max(0, expiresAt - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const text = remaining === 0
    ? 'Expired'
    : mins + ':' + String(secs).padStart(2, '0') + ' remaining';

  expiryText.textContent = text;

  expiryBadge.classList.remove('alive', 'warning', 'danger');
  if (remaining === 0) {
    expiryBadge.classList.add('danger');
    clearInterval(expiryTimer);
  } else if (remaining < 60000) {
    expiryBadge.classList.add('danger');
  } else if (remaining < 180000) {
    expiryBadge.classList.add('warning');
  } else {
    expiryBadge.classList.add('alive');
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 2500);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function mapLangToHL(lang) {
  const map = {
    javascript: 'javascript', typescript: 'typescript', python: 'python',
    rust: 'rust', go: 'go', java: 'java', cpp: 'cpp', c: 'c',
    csharp: 'csharp', php: 'php', ruby: 'ruby', swift: 'swift',
    kotlin: 'kotlin', scala: 'scala', html: 'html', css: 'css',
    scss: 'scss', json: 'json', yaml: 'yaml', toml: 'ini',
    bash: 'bash', sql: 'sql', graphql: 'graphql', dockerfile: 'dockerfile',
    markdown: 'markdown', xml: 'xml', lua: 'lua', haskell: 'haskell',
    elixir: 'elixir', erlang: 'erlang', ocaml: 'ocaml',
    dart: 'dart', nim: 'nim', zig: 'zig',
  };
  return map[lang] || null;
}

// ─── Language select → update page title ──────────────────────────────────────
langSelect.addEventListener('change', () => {
  if (!isViewMode) updateStats();
});

// Initial stats
updateStats();
