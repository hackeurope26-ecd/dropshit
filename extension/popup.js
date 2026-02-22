/**
 * Dropshit — popup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * State machine for the extension popup. Four states: idle, loading, result, error.
 * All transitions use CSS opacity + translateY (200ms ease).
 */

// ─── DOM References ───────────────────────────────────────────────────────────

const stateIdle    = document.getElementById('stateIdle');
const stateLoading = document.getElementById('stateLoading');
const stateResult  = document.getElementById('stateResult');
const stateError   = document.getElementById('stateError');

const ctaBtn   = document.getElementById('ctaBtn');
const retryBtn = document.getElementById('retryBtn');
const demoPill = document.getElementById('demoPill');

const STEPS = {
  reading:   document.getElementById('stepReading'),
  analysing: document.getElementById('stepAnalysing'),
  searching: document.getElementById('stepSearching'),
};

const STEP_ORDER = ['reading', 'analysing', 'searching'];

// ─── State Machine ────────────────────────────────────────────────────────────

let _currentState = null;

/**
 * Internal: cross-fade to a new state element.
 * Sets display:flex, waits two animation frames so the browser paints the
 * initial opacity:0 position, then adds .active to trigger the CSS transition.
 * @param {HTMLElement} next
 */
function _transitionTo(next) {
  if (_currentState === next) return;

  const prev = _currentState;
  _currentState = next;

  // Fade out previous state, then hide from layout after transition completes
  if (prev) {
    prev.classList.remove('active');
    setTimeout(() => { prev.style.display = 'none'; }, 210);
  }

  // Reveal next state at opacity 0, then trigger transition on next paint
  next.style.display = 'flex';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      next.classList.add('active');
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * STATE: Idle
 * Shows the "Check this product" CTA button.
 * Call this on load or to reset after an error.
 */
function showIdle() {
  demoPill.classList.add('hidden');
  _transitionTo(stateIdle);
}

/**
 * STATE: Loading
 * Animates the pipeline step list. Each call updates which step is active,
 * marking previous steps as completed. Safe to call multiple times.
 *
 * @param {'reading' | 'analysing' | 'searching'} step — The currently active step.
 */
function showLoading(step) {
  _transitionTo(stateLoading);

  const activeIndex = STEP_ORDER.indexOf(step);

  STEP_ORDER.forEach((key, i) => {
    const el = STEPS[key];
    el.classList.remove('active', 'completed');

    if (i < activeIndex)      el.classList.add('completed');
    else if (i === activeIndex) el.classList.add('active');
    // upcoming steps: no class — label stays at muted #333
  });
}

/**
 * STATE: Result
 * Renders the full price comparison result and transitions to the result state.
 *
 * @param {Object}   data
 * @param {string}   data.originalImage    — og:image URL from the dropshipper page
 * @param {string}   data.originalPrice    — e.g. "€89.99"
 * @param {string}   data.originalSite     — e.g. "trendyfinds.com"
 * @param {string}   data.matchImage       — AliExpress product image URL
 * @param {string}   data.matchPrice       — e.g. "€4.60"
 * @param {string}   data.matchUrl         — AliExpress listing URL
 * @param {number}   data.matchConfidence  — 0 to 1, e.g. 0.92
 * @param {number}   data.markupPercent    — e.g. 1854
 * @param {string}   data.claudeSummary    — One-line plain English from Claude
 * @param {string[]} data.keyFeatures      — e.g. ["Generic product", "No brand"]
 * @param {number}   data.totalSaved       — Running euros total, e.g. 340
 * @param {boolean}  [isDemo=false]        — If true, shows the "Demo" pill
 */
function renderResult(data, isDemo = false) {
  // Demo pill visibility
  demoPill.classList.toggle('hidden', !isDemo);

  // Markup hero — green + "better" for negative markup, red + "markup" otherwise
  const markupHero = document.getElementById('markupHero');
  const isNegativeMarkup = data.markupPercent < 0;
  markupHero.textContent = isNegativeMarkup
    ? `${Math.abs(data.markupPercent).toLocaleString()}% better`
    : `${data.markupPercent.toLocaleString()}% markup`;
  markupHero.classList.toggle('markup-hero--green', isNegativeMarkup);

  // Prices and site names
  document.getElementById('originalPrice').textContent = data.originalPrice;
  document.getElementById('originalSite').textContent  = data.originalSite;
  document.getElementById('matchPrice').textContent    = data.matchPrice;

  // Match deep link
  const matchLink = document.getElementById('matchLink');
  matchLink.href = data.matchUrl;
  matchLink.textContent = `${data.matchSite || 'source'} ↗`;

  // Product image — hide if load fails (e.g. CORS block)
  const img = document.getElementById('matchImage');
  img.style.display = 'block';
  img.src = data.matchImage;
  img.onerror = () => { img.style.display = 'none'; };

  // Confidence badge — percentage pill
  const pct = Math.round(data.matchConfidence * 100);
  document.getElementById('confidenceBadge').innerHTML =
    `<span class="confidence-inner">${pct}% match</span>`;

  // Claude one-liner
  document.getElementById('claudeSummary').textContent = data.claudeSummary;

  // Key feature pills — horizontal scroll row
  document.getElementById('featuresRow').innerHTML = data.keyFeatures
    .map(f => `<span class="feature-pill">${f}</span>`)
    .join('');

  // Savings total
  document.getElementById('totalSaved').textContent = `€${data.totalSaved}`;

  // Persist running total to extension storage
  _storageSet({ totalSaved: data.totalSaved });

  // Scroll result pane back to top before revealing
  stateResult.scrollTop = 0;

  _transitionTo(stateResult);
}

/**
 * STATE: Error
 * Shows an error message with a "Try again" link that calls showIdle().
 *
 * @param {string} [message] — Optional override. Defaults to "Couldn't read this page."
 */
function showError(message) {
  demoPill.classList.add('hidden');
  document.getElementById('errorMessage').textContent =
    message || "Couldn't read this page.";
  _transitionTo(stateError);
}

// ─── Chrome Storage Helpers ───────────────────────────────────────────────────
// Wrapped in try/catch so the popup still works when opened outside the
// extension context (e.g. a plain browser tab during development).

function _storageSet(data) {
  try { chrome.storage.local.set(data); } catch { /* non-extension context */ }
}

function _storageGet(keys, cb) {
  try { chrome.storage.local.get(keys, cb); } catch { /* non-extension context */ }
}

// ─── Event Wiring ─────────────────────────────────────────────────────────────

// CTA button → kick off analysis in the background service worker
ctaBtn.addEventListener('click', () => {
  showLoading('reading');
  const port = chrome.runtime.connect({ name: 'analyze' });
  port.onMessage.addListener(({ step, success, data, error }) => {
    if (step) showLoading(step);
    else if (success) renderResult(data);
    else showError(error);
  });
});

// Retry link → reset to idle
retryBtn.addEventListener('click', showIdle);

// Demo link → run fake sequence (no API), only when user clicks
const demoLink = document.getElementById('demoLink');
if (demoLink) demoLink.addEventListener('click', _runDemoSequence);

// ─── Demo Sequence ────────────────────────────────────────────────────────────
// Cycles through all three loading steps at 600 ms each, then renders
// fake data. Only runs when user clicks "View demo" (no auto-run).

const fakeData = {
  originalImage:   'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400',
  originalPrice:   '€89.99',
  originalSite:    'trendyfinds.com',
  matchImage:      'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400',
  matchPrice:      '€4.60',
  matchUrl:        'https://aliexpress.com',
  matchConfidence: 0.92,
  markupPercent:   1854,
  claudeSummary:   'Generic silicone cable organiser sold by 300+ AliExpress suppliers.',
  keyFeatures:     ['Generic product', 'No brand', '300+ suppliers', 'Shopify store'],
  totalSaved:      340,
};

/**
 * Runs the demo loading animation then renders fakeData.
 * Call this only when user explicitly asks for the demo (e.g. "View demo" link).
 */
function _runDemoSequence() {
  showLoading('reading');
  setTimeout(() => showLoading('analysing'), 600);
  setTimeout(() => showLoading('searching'), 1200);
  setTimeout(() => renderResult(fakeData, /* isDemo */ true), 1800);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// Show idle immediately on open; no auto-demo — user must click CTA or "View demo"
showIdle();

// Restore persisted totalSaved (will be used when renderResult is called for real)
_storageGet('totalSaved', (result) => {
  if (result?.totalSaved !== undefined) {
    // Available for real renderResult calls — fakeData has its own static value
  }
});
