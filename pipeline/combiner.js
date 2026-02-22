// combiner.js
import { braveSearch } from '../services/braveSearch.js';
import { SYSTEM_PROMPT, DROPSHIP_PROMPT } from './prompts.js';

export async function detectDropshipping(extractedProduct, onProgress) {
    const signals = computeSignals(extractedProduct);

    // Give Qwen "internet access" via Brave Search: run web search and inject results into the prompt
    let webSearchResults = [];
    try {
        const query = [extractedProduct.title, 'AliExpress', 'price'].filter(Boolean).join(' ');
        webSearchResults = await braveSearch(query, { count: 8 });
    } catch (e) {
        console.warn('Brave Search unavailable, Qwen will answer without live web data:', e.message);
    }

    onProgress?.('searching');
    console.log(webSearchResults);

    const response = await fetch('http://localhost:3000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'NVFP4/Qwen3-235B-A22B-Instruct-2507-FP4',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: DROPSHIP_PROMPT(extractedProduct, signals, webSearchResults) }
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
    const llmAnalysis = JSON.parse(cleaned);

    return {
        product: extractedProduct,
        signals,
        dropship_analysis: {
            ...llmAnalysis,
            confidence: computeConfidence(signals, llmAnalysis)
        }
    };
}

// Compute concrete signals from the product data directly — no LLM needed
function computeSignals(product) {
    const buzzwords = [
        'perfect gift', 'high quality', 'premium', 'worldwide shipping',
        'limited time', 'best price', 'top quality', 'fast shipping',
        'satisfaction guaranteed', 'order now', 'free shipping', 'hot sale',
        'great value', 'must have', 'innovative'
    ];

    const text = `${product.title || ''} ${product.description || ''}`.toLowerCase();

    const buzzwordsFound = buzzwords.filter(word => text.includes(word));

    const identifierCount = Object.values(product.identifiers || {})
        .filter(v => v !== null).length;

    const titleWordCount = product.title?.split(' ').length || 0;

    return {
        has_no_identifiers: identifierCount === 0,
        identifier_count: identifierCount,
        buzzwords_found: buzzwordsFound,
        buzzword_count: buzzwordsFound.length,
        title_word_count: titleWordCount,
        title_possibly_keyword_stuffed: titleWordCount > 8,
        has_brand: !!product.brand,
        brand_is_generic: isBrandGeneric(product.brand),
        price_ends_in_99: product.price?.toString().endsWith('.99'),
        missing_description: !product.description || product.description.length < 50,
    };
}

function isBrandGeneric(brand) {
    if (!brand) return true;
    const genericBrands = [
        'generic', 'unbranded', 'no brand', 'n/a', 'various',
        'unknown', 'other', 'home', 'shop', 'store'
    ];
    return genericBrands.includes(brand.toLowerCase());
}

// Compute a confidence score from hard signals rather than relying on LLM
function computeConfidence(signals, llmAnalysis) {
    let score = 0;

    if (signals.has_no_identifiers) score += 0.25;
    if (signals.buzzword_count >= 2) score += 0.20;
    if (signals.buzzword_count >= 4) score += 0.10; // extra if lots of buzzwords
    if (signals.title_possibly_keyword_stuffed) score += 0.15;
    if (signals.brand_is_generic) score += 0.15;
    if (signals.missing_description) score += 0.10;
    if (llmAnalysis.strong_indicators?.length >= 2) score += 0.15;

    return Math.min(parseFloat(score.toFixed(2)), 1.0);
}