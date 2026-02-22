import { analyzeImages } from "./services/analyzeImages.js";
import { EXTRACTOR_SYSTEM_PROMPT, EXTRACTOR_PROMPT } from "./pipeline/prompts.js";
import { detectDropshipping } from "./pipeline/combiner.js";
import { synthesiseVerdict } from "./services/synthesiseVerdict.js";

const MATCH_THRESHOLD = 0.90; // minimum visual_match_score to show a result

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
    
    // Safety check: Prevent the undefined '0' crash
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

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'analyze') return;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0];

        if (!tab || !isInjectableUrl(tab.url)) {
            port.postMessage({ success: false, error: "Can't read this page. Open a product page and try again." });
            return;
        }

        try {
            // Step 1: Extract basic product data
            port.postMessage({ step: 'reading' });
            const product = await extractProductData(tab.id);
            port.postMessage({ step: 'analysing' });

            const dropshipResult = await detectDropshipping(product, (step) => port.postMessage({ step }));

            // Step 2: Run Reverse Image Pipeline if we found an image
            let aiAnalysis = null;
            if (product.main_image) {
                console.log('Running reverse image search on:', product.main_image);
                aiAnalysis = await analyzeImages(product.main_image, tab.url);
                console.log('AI Analysis complete:', aiAnalysis);
            } else {
                throw new Error("Could not detect a main product image to analyze.");
            }

            // Step 3: Synthesise image analysis + web search + text signals into a unified verdict
            port.postMessage({ step: 'synthesising' });
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
            const originalPrice = parseFloat(String(product.price).replace(/[^0-9.]/g, '')) || 0;
            const currency = product.currency || '€';

            const matchPriceVal = parseFloat(String(synthesis.best_source_price || '0').replace(/[^0-9.]/g, '')) || 0;
            const markupPercent = (originalPrice && matchPriceVal)
                ? Math.round(((originalPrice - matchPriceVal) / matchPriceVal) * 100)
                : 0;

            port.postMessage({
                success: true,
                data: {
                    originalImage:   product.main_image || '',
                    originalPrice:   `${currency}${originalPrice.toFixed(2)}`,
                    originalSite:    new URL(tab.url).hostname.replace('www.', ''),
                    matchImage:      synthesis.matchImageUrl || '',
                    matchPrice:      synthesis.best_source_price || 'Unknown',
                    matchUrl:        synthesis.best_source_url || '#',
                    matchSite:       synthesis.best_source_domain || 'source',
                    matchConfidence: synthesis.confidence,
                    markupPercent:   markupPercent,
                    claudeSummary:   synthesis.evidence?.join(' • ') || aiAnalysis?.summary_bullets?.join(' • ') || 'Product analyzed successfully.',
                    keyFeatures:     product.tags || [],
                    totalSaved:      (originalPrice - matchPriceVal > 0) ? (originalPrice - matchPriceVal).toFixed(2) : 0,
                }
            });
        } catch (err) {
            console.error('Extension error:', err);
            port.postMessage({ success: false, error: err.message });
        }
    });
});
