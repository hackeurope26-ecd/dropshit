import { analyzeImages } from "./services/analyzeImages.js";
self.analyzeImages = analyzeImages;

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
                {
                    role: 'system',
                    content: 'You are a product data extraction assistant. Always respond with valid JSON only. No explanation, no markdown, no code blocks — just raw JSON.'
                },
                {
                    role: 'user',
                    content: `Extract product info from this webpage. Return only this JSON:
{
  "title": null,
  "description": null,
  "price": null,
  "currency": null,
  "brand": null,
  "tags": [],
  "identifiers": { "sku": null, "gtin": null, "mpn": null, "asin": null },
  "main_image": null
}

Use null for any field you cannot find. For main_image pick the single most likely main product image — not a logo or banner.

Webpage text:
${pageData.text}

Image candidates (sorted largest first):
${pageData.images.map(img => `${img.src} (${img.width}x${img.height})`).join('\n')}`
                }
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'analyze') return;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0];

        if (!tab || !isInjectableUrl(tab.url)) {
            sendResponse({ success: false, error: "Can't read this page. Open a product page and try again." });
            return;
        }

        try {
            // Step 1: Extract basic product data
            const product = await extractProductData(tab.id);
            console.log('Extracted product:', product);

            // Step 2: Run Reverse Image Pipeline if we found an image
            let aiAnalysis = null;
            if (product.main_image) {
                console.log('Running reverse image search on:', product.main_image);
                aiAnalysis = await analyzeImages(product.main_image);
                console.log('AI Analysis complete:', aiAnalysis);
            } else {
                throw new Error("Could not detect a main product image to analyze.");
            }

            // Step 3: Map AI results to the UI
            const originalPrice = parseFloat(String(product.price).replace(/[^0-9.]/g, '')) || 0;
            const currency = product.currency || '€';
            
            // Get the best candidate's details (we will update analyzeImages to pass this back)
            const topCandidateIndex = aiAnalysis?.candidates?.[0]?.index || 0;
            const matchDetails = aiAnalysis?.candidateDetails?.[topCandidateIndex]?.metadata || {};
            
            // Calculate Markup
            const matchPriceVal = parseFloat(String(matchDetails.detectedPrice || '0').replace(/[^0-9.]/g, '')) || 0;
            const markupPercent = (originalPrice && matchPriceVal) 
                ? Math.round(((originalPrice - matchPriceVal) / matchPriceVal) * 100) 
                : 0;

            sendResponse({
                success: true,
                data: {
                    originalImage:   product.main_image || '',
                    originalPrice:   `${currency}${originalPrice.toFixed(2)}`,
                    originalSite:    new URL(tab.url).hostname.replace('www.', ''),
                    matchImage:      matchDetails.imageUrl || '',
                    matchPrice:      matchDetails.detectedPrice || 'Unknown',
                    matchUrl:        matchDetails.pageUrl || '#',
                    matchConfidence: aiAnalysis?.confidence || 0,
                    markupPercent:   markupPercent,
                    claudeSummary:   aiAnalysis?.summary_bullets?.join(' • ') || 'Product analyzed successfully.',
                    keyFeatures:     product.tags || [],
                    totalSaved:      (originalPrice - matchPriceVal > 0) ? (originalPrice - matchPriceVal).toFixed(2) : 0,
                }
            });
        } catch (err) {
            console.error('Extension error:', err);
            sendResponse({ success: false, error: err.message });
        }
    });

    return true;
});
