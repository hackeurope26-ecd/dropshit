import { analyzeImages } from "./services/analyzeImages.js";
import { EXTRACTOR_SYSTEM_PROMPT, EXTRACTOR_PROMPT } from "./pipeline/prompts.js";
import { detectDropshipping } from "./pipeline/combiner.js";
import { synthesiseVerdict } from "./services/synthesiseVerdict.js";

const MATCH_THRESHOLD = 0.90; // minimum visual_match_score to show a result

// ─── Tab State ────────────────────────────────────────────────────────────────
// Per-tab analysis state persisted to chrome.storage.session so popup reads it
// on open regardless of when the pipeline started.
//
// Schema: { status: 'loading'|'done'|'error', step?, data?, error?, url }

const tabPorts = new Map();        // tabId → Set<port>
const activePipelines = new Set(); // tabIds with a running pipeline

function broadcast(tabId, message) {
    const ports = tabPorts.get(tabId);
    if (!ports) return;
    for (const port of ports) {
        try { port.postMessage(message); } catch { /* port disconnected */ }
    }
}

async function setTabState(tabId, state) {
    try { await chrome.storage.session.set({ [`preload_${tabId}`]: state }); } catch {}
}

async function getTabState(tabId) {
    try {
        const r = await chrome.storage.session.get(`preload_${tabId}`);
        return r[`preload_${tabId}`] ?? null;
    } catch { return null; }
}

async function clearTabState(tabId) {
    try { await chrome.storage.session.remove(`preload_${tabId}`); } catch {}
}

// ─── Preload URL Patterns ─────────────────────────────────────────────────────
// The extension auto-starts analysis when a tab navigates to one of these.

const PRELOAD_PATTERNS = [
    /etsy\.com\/listing\//,
    /amazon\.(com|co\.uk|de|fr|it|es|ca|com\.au)\/.*\/dp\//,
    /\.myshopify\.com\/products\//,
];

function shouldPreload(url) {
    return isInjectableUrl(url) && PRELOAD_PATTERNS.some(p => p.test(url));
}

// ─── Page Scraper ─────────────────────────────────────────────────────────────

async function extractProductData(tabId) {
    const [{ result: pageData }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const clone = document.body.cloneNode(true);
            clone.querySelectorAll('script, style, nav, footer, header, iframe, svg')
                .forEach(el => el.remove());

            const images = Array.from(document.querySelectorAll('img'))
                .map(img => ({
                    src: img.src,
                    width: img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0,
                    height: img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0,
                }))
                .filter(img => img.src?.startsWith('https://'))
                .sort((a, b) => (b.width * b.height) - (a.width * a.height))
                .slice(0, 10);

            return { text: clone.innerText.slice(0, 15000), images };
        }
    });

    const response = await fetch('http://localhost:3000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'NVFP4/Qwen3-235B-A22B-Instruct-2507-FP4',
            messages: [
                { role: 'system', content: EXTRACTOR_SYSTEM_PROMPT },
                { role: 'user', content: EXTRACTOR_PROMPT(pageData) }
            ],
            temperature: 0.1,
            top_p: 0.95,
            frequency_penalty: 0,
            presence_penalty: 0,
        })
    });

    const data = await response.json();
    console.log("LLM raw response:", JSON.stringify(data)); // debug

    if (!data.choices || !data.choices[0]) {
        throw new Error("LLM Error: " + (data.error?.message || JSON.stringify(data)));
    }

    const raw = data.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
}

function isInjectableUrl(url) {
    if (!url) return false;
    return url.startsWith('http://') || url.startsWith('https://');
}

// ─── Core Analysis Pipeline ───────────────────────────────────────────────────
// Runs the full pipeline for a tab. Broadcasts step/result messages to any
// connected popup ports, and persists state to session storage so the popup
// can read it when it opens (even after the pipeline completes).

async function runAnalysis(tabId, url) {
    if (activePipelines.has(tabId)) return;
    activePipelines.add(tabId);

    // Sync step updates: fire-and-forget the storage write, broadcast immediately
    const stepUpdate = (step) => {
        setTabState(tabId, { status: 'loading', step, url });
        broadcast(tabId, { step });
    };

    // Check whether navigation has cancelled this pipeline
    const alive = () => activePipelines.has(tabId);

    try {
        stepUpdate('reading');
        const product = await extractProductData(tabId);
        if (!alive()) return;

        stepUpdate('analysing');

        const originalPrice = parseFloat(String(product.price).replace(/[^0-9.]/g, '')) || 0;
        const currency = product.currency || '€';
        const originalSite = new URL(url).hostname.replace('www.', '');

        // Step 1.5: Check vector DB before running expensive inference
        try {
            const lookupRes = await fetch('http://localhost:3000/db/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_name: product.title || '', tags: product.tags || [], image_url: product.main_image || '' }),
            });
            if (lookupRes.ok) {
                const hit = await lookupRes.json();
                if (hit?.cluster_id && alive()) {
                    console.log(`[DB] Cache hit (${Math.round(hit.similarity * 100)}%) — skipping inference`);
                    const matchPriceVal = hit.wholesale_price_min || 0;
                    const markupPercent = (originalPrice && matchPriceVal)
                        ? Math.round(((originalPrice - matchPriceVal) / matchPriceVal) * 100)
                        : Math.round(hit.avg_markup_pct || 0);

                    const resultData = {
                        originalImage:   product.main_image || '',
                        originalPrice:   `${currency}${originalPrice.toFixed(2)}`,
                        originalSite,
                        matchImage:      hit.wholesale_image_url || '',
                        matchPrice:      matchPriceVal ? `${currency}${matchPriceVal.toFixed(2)}` : 'Unknown',
                        matchUrl:        hit.wholesale_url || '#',
                        matchSite:       hit.wholesale_domain || 'source',
                        matchConfidence: hit.similarity,
                        markupPercent,
                        claudeSummary:   `Previously identified wholesale source — seen ${hit.detection_count} time${hit.detection_count === 1 ? '' : 's'} before.`,
                        keyFeatures:     product.tags || [],
                        totalSaved:      (originalPrice - matchPriceVal > 0) ? (originalPrice - matchPriceVal).toFixed(2) : 0,
                        detectionCount:  hit.detection_count + 1,
                    };

                    // Increment detection count in DB
                    try {
                        const dbRes = await fetch('http://localhost:3000/db/record', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                product_name:         product.title || '',
                                tags:                 product.tags || [],
                                retail_url:           url,
                                retail_domain:        originalSite,
                                retail_price:         originalPrice,
                                retail_currency:      currency,
                                retail_image_url:     product.main_image || '',
                                wholesale_url:        hit.wholesale_url || '',
                                wholesale_domain:     hit.wholesale_domain || '',
                                wholesale_price:      matchPriceVal,
                                wholesale_image_url:  hit.wholesale_image_url || '',
                                markup_pct:           markupPercent,
                                visual_match_score:   hit.similarity,
                                synthesis_confidence: hit.avg_confidence || 0,
                                evidence:             [`Cache hit from existing cluster (${Math.round(hit.similarity * 100)}% similarity)`],
                            }),
                        });
                        if (dbRes.ok) {
                            const dbData = await dbRes.json();
                            resultData.detectionCount = dbData.detection_count ?? resultData.detectionCount;
                        }
                    } catch (dbErr) {
                        console.warn('[DB] Failed to record cache hit:', dbErr.message);
                    }

                    await setTabState(tabId, { status: 'done', data: resultData, url });
                    broadcast(tabId, { success: true, data: resultData });
                    return;
                }
            }
        } catch (lookupErr) {
            console.warn('[DB] Lookup failed, continuing with full pipeline:', lookupErr.message);
        }

        const dropshipResult = await detectDropshipping(product, stepUpdate);
        if (!alive()) return;

        // Step 2: Run Reverse Image Pipeline if we found an image
        let aiAnalysis = null;
        if (product.main_image) {
            console.log('Running reverse image search on:', product.main_image);
            aiAnalysis = await analyzeImages(product.main_image, url, dropshipResult.webSearchResults);
            console.log('AI Analysis complete:', aiAnalysis);
        } else {
            throw new Error("Could not detect a main product image to analyze.");
        }
        if (!alive()) return;

        // Step 3: Synthesise image analysis + web search + text signals into a unified verdict
        const synthesis = await synthesiseVerdict({
            product,
            aiAnalysis,
            webSearchResults: dropshipResult.webSearchResults,
            dropshipAnalysis: dropshipResult.dropship_analysis,
        });
        console.log('Synthesis verdict:', synthesis);

        if (synthesis.confidence < MATCH_THRESHOLD) {
            const reason = synthesis.evidence?.[0] || 'No confident match found.';
            throw new Error(`No confident match found (${Math.round(synthesis.confidence * 100)}% confidence). ${reason}`);
        }

        // Step 4: Map synthesis result to the UI
        const topAiCandidate = (aiAnalysis?.candidates || [])
            .slice()
            .sort((a, b) => (b.visual_match_score || 0) - (a.visual_match_score || 0))[0];

        if (!topAiCandidate || topAiCandidate.visual_match_score < MATCH_THRESHOLD) {
            const score = topAiCandidate ? Math.round(topAiCandidate.visual_match_score * 100) : 0;
            const reason = topAiCandidate?.reasoning || 'No close match found.';
            throw new Error(`No confident match found (${score}% similarity). ${reason}`);
        }

        const topIndex = topAiCandidate.index ?? 0;
        const matchDetails = aiAnalysis?.candidateDetails?.[topIndex]?.metadata || {};

        const matchPriceVal = parseFloat(String(matchDetails.detectedPrice || '0').replace(/[^0-9.]/g, '')) || 0;
        const markupPercent = (originalPrice && matchPriceVal)
            ? Math.round(((originalPrice - matchPriceVal) / matchPriceVal) * 100)
            : 0;

        const resultData = {
            originalImage:   product.main_image || '',
            originalPrice:   `${currency}${originalPrice.toFixed(2)}`,
            originalSite,
            matchImage:      matchDetails.imageUrl || '',
            matchPrice:      matchDetails.detectedPrice || 'Unknown',
            matchUrl:        matchDetails.pageUrl || '#',
            matchSite:       matchDetails.domain || 'source',
            matchConfidence: topAiCandidate.visual_match_score,
            markupPercent:   markupPercent,
            claudeSummary:   synthesis.evidence?.join(' • ') || aiAnalysis?.summary_bullets?.join(' • ') || 'Product analyzed successfully.',
            keyFeatures:     product.tags || [],
            totalSaved:      (originalPrice - matchPriceVal > 0) ? (originalPrice - matchPriceVal).toFixed(2) : 0,
            detectionCount:  1,
        };

        // Record in vector DB; include detection count in the result
        try {
            const dbRes = await fetch('http://localhost:3000/db/record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_name:        product.title || '',
                    tags:                product.tags || [],
                    retail_url:          url,
                    retail_domain:       resultData.originalSite,
                    retail_price:        originalPrice,
                    retail_currency:     currency,
                    retail_image_url:    product.main_image || '',
                    wholesale_url:       matchDetails.pageUrl || '',
                    wholesale_domain:    matchDetails.domain || '',
                    wholesale_price:     matchPriceVal,
                    wholesale_image_url: matchDetails.imageUrl || '',
                    markup_pct:          markupPercent,
                    visual_match_score:  topAiCandidate.visual_match_score,
                    synthesis_confidence: synthesis.confidence,
                    evidence:            synthesis.evidence || [],
                }),
            });
            if (dbRes.ok) {
                const dbData = await dbRes.json();
                resultData.detectionCount = dbData.detection_count ?? 1;
            }
        } catch (dbErr) {
            console.warn('[DB] Failed to record detection:', dbErr.message);
        }

        await setTabState(tabId, { status: 'done', data: resultData, url });
        broadcast(tabId, { success: true, data: resultData });

    } catch (err) {
        if (!alive()) return;
        console.error('Extension error:', err);
        await setTabState(tabId, { status: 'error', error: err.message, url });
        broadcast(tabId, { success: false, error: err.message });
    } finally {
        activePipelines.delete(tabId);
    }
}

// ─── Navigation Listener (Preload Trigger) ────────────────────────────────────
// chrome.tabs.onUpdated fires status:'complete' multiple times per page load.
// We guard with session state so only the first fire starts the pipeline;
// subsequent fires for the same URL are no-ops.

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;

    // Already running or finished for this exact URL — don't restart.
    const state = await getTabState(tabId);
    if (state?.url === tab.url && (state.status === 'loading' || state.status === 'done')) return;

    // URL changed (or no prior state) — cancel any stale pipeline and reset.
    activePipelines.delete(tabId);
    await clearTabState(tabId);

    if (shouldPreload(tab.url)) runAnalysis(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    activePipelines.delete(tabId);
    clearTabState(tabId);
    tabPorts.delete(tabId);
});

// ─── Port Handler ─────────────────────────────────────────────────────────────
// Popup connects with name 'analyze' either on CTA click or on open (if a
// preload is in-progress). Background checks session state to decide whether
// to replay a cached result, catch up on a live pipeline, or start fresh.

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'analyze') return;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0];

        if (!tab || !isInjectableUrl(tab.url)) {
            port.postMessage({ success: false, error: "Can't read this page. Open a product page and try again." });
            return;
        }

        const tabId = tab.id;

        // Register port so broadcast() reaches it
        if (!tabPorts.has(tabId)) tabPorts.set(tabId, new Set());
        tabPorts.get(tabId).add(port);
        port.onDisconnect.addListener(() => tabPorts.get(tabId)?.delete(port));

        const state = await getTabState(tabId);

        if (state?.url === tab.url) {
            if (state.status === 'done') {
                port.postMessage({ success: true, data: state.data });
                return;
            }
            if (state.status === 'error') {
                port.postMessage({ success: false, error: state.error });
                return;
            }
            if (state.status === 'loading') {
                // Catch the popup up to the current step; subsequent steps will
                // arrive via broadcast as the running pipeline progresses.
                port.postMessage({ step: state.step });
                // Guard: if the service worker restarted mid-pipeline, resume it.
                if (!activePipelines.has(tabId)) runAnalysis(tabId, tab.url);
                return;
            }
        }

        // No preloaded state — start fresh
        runAnalysis(tabId, tab.url);
    });
});
