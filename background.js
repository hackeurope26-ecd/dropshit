// background.js
importScripts("./pipeline/combiner.js");

async function extractProductData(tabId) {
    // 1. Get page HTML from content script
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

            return {
                text: clone.innerText.slice(0, 15000),
                images
            };
        }
    });

    // 2. Call LLM
    const response = await fetch('http://localhost:3000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'NVFP4/Qwen3-235B-A22B-Instruct-2507-FP4',
            messages: [
                {
                    role: 'system',
                    content: `You are a product data extraction assistant. 
You must try extremely hard to find values for every field before giving up.
- For brand: if no explicit brand, infer from the domain name or product title
- For price: look for any number with a currency symbol anywhere on the page
- For tags: generate relevant tags from the title and description if none are explicit
- For identifiers: search the entire page text for any SKU, barcode, GTIN, MPN, or ASIN patterns
- For description: use the most detailed product description you can find, not marketing copy
Only use null as an absolute last resort if the information is completely absent.
Always respond with valid JSON only. No explanation, no markdown, no code blocks — just raw JSON.`
                },
                {
                    role: 'user',
                    content: `Extract product information from this webpage. Return ONLY this exact JSON structure with no extra fields:

{
  "title": "full product name as listed",
  "description": "detailed product description, not marketing fluff",
  "price": "19.99",
  "currency": "GBP",
  "brand": "brand or manufacturer name",
  "tags": ["relevant", "product", "tags"],
  "identifiers": {
    "sku": "stock keeping unit if found",
    "gtin": "barcode or gtin if found",
    "mpn": "manufacturer part number if found",
    "asin": "amazon asin if found"
  },
  "main_image": "single URL of the main product image"
}

Rules:
- price must be a string of just the number e.g. "19.99" not "£19.99"
- currency must be a 3 letter code e.g. "GBP" "USD" "EUR"
- tags should be an array of 3-8 short relevant keywords
- main_image must be a single URL — pick the largest image that is clearly the main product photo, not a logo, banner, or icon
- for identifiers, search thoroughly through the full page text for any codes, barcodes, or reference numbers
- only use null if the field is truly absent from the page

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
    const raw = data.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
}

// Trigger on icon click
chrome.action.onClicked.addListener(async (tab) => {
    console.log('clicked');

    try {
        // Step 1: Extract product data
        const product = await extractProductData(tab.id);
        console.log('Extracted product:', product);

        // Step 2: Run dropship detection
        const combined = await detectDropshipping(product);
        console.log('Combined result:', combined);

        // Step 3: Send to content script to show UI
        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_RESULTS', data: combined });

    } catch (err) {
        console.error('Error:', err);
    }
});