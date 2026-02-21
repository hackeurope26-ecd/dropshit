// combiner.js
async function detectDropshipping(extractedProduct) {

  // Build a confidence score from concrete signals BEFORE calling the LLM
  const signals = computeSignals(extractedProduct);

  const response = await fetch('http://localhost:3000/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'NVFP4/Qwen3-235B-A22B-Instruct-2507-FP4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at identifying dropshipped products. Always respond with valid JSON only. No explanation, no markdown, no code blocks — just raw JSON.'
        },
        {
          role: 'user',
          content: `Analyse this product and determine if it is likely being dropshipped.

Product details:
${JSON.stringify(extractedProduct, null, 2)}

Pre-computed signals:
${JSON.stringify(signals, null, 2)}

Use these CONCRETE criteria to evaluate — do not guess, only flag if there is real evidence:

STRONG indicators of dropshipping:
- Brand name is completely generic, made-up, or matches no known manufacturer
- Zero identifiers (no SKU, GTIN, MPN, ASIN) — real brands always have these
- Description contains phrases like "perfect gift", "high quality", "premium product", "worldwide shipping", "limited time offer"
- Price is suspiciously round or ends in .99 with no sale history
- Title stuffed with keywords (e.g. "LED Portable Fan Neck Wearable Cooling Summer Hands Free")
- No mention of warranty, returns policy, or manufacturer contact

WEAK indicators (alone not enough):
- Sold by a marketplace third party
- Generic product category

Be conservative — only say is_dropshipped: true if there are at least 2 strong indicators.
Confidence should reflect actual evidence, not a default value.

Return only this JSON:
{
  "is_dropshipped": true,
  "confidence": 0.0,
  "strong_indicators": [],
  "weak_indicators": [],
  "buzwords_found": [],
  "missing_identifiers": true,
  "brand_legitimacy": "unknown | legitimate | generic | suspicious",
  "title_keyword_stuffed": false,
  "original_price_estimate": null,
  "original_currency": null,
  "likely_source": null,
  "markup_estimate": null,
  "search_terms": []
}`
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
  const llmAnalysis = JSON.parse(cleaned);

  // Merge LLM analysis with pre-computed signals
  return {
    product: extractedProduct,
    signals,
    dropship_analysis: {
      ...llmAnalysis,
      // Override confidence with our computed one if LLM defaulted to 0.85
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