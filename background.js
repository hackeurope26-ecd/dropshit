// background.js
importScripts("./pipeline/combiner.js");
importScripts('./pipeline/prompts.js');

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