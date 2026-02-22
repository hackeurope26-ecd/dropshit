// prompts.js

export const SYSTEM_PROMPT = `You are an expert at identifying dropshipped products being sold at a markup.
You have deep knowledge of AliExpress, Alibaba, Temu, and other wholesale platforms.
Always respond with valid JSON only. No explanation, no markdown, no code blocks — just raw JSON.`;

export const DROPSHIP_PROMPT = (extractedProduct, signals, webSearchResults = null) => {
  const searchBlock = webSearchResults && webSearchResults.length > 0
    ? `
Live web search results (use these to inform your answer — e.g. similar products, prices, sources):
${webSearchResults.map(r => `- ${r.title || 'No title'}\n  URL: ${r.url || ''}\n  ${(r.description || '').slice(0, 200)}`).join('\n')}
`
    : '';
  return `Analyse this product and determine if it is likely being dropshipped at a markup.

Product details:
${JSON.stringify(extractedProduct, null, 2)}

Pre-computed signals:
${JSON.stringify(signals, null, 2)}
${searchBlock}

Your job:
1. Determine if this is likely a dropshipped product
2. Based on the title, description, tags and brand — generate direct search URLs where someone could find the original cheaper product.

Generate search URLs for these platforms:
- AliExpress: https://www.aliexpress.com/wholesale?SearchText={search_terms}
- Amazon: https://www.amazon.co.uk/s?k={search_terms}
- Temu: https://www.temu.com/search_result.html?search_key={search_terms}
- Google Shopping: https://www.google.com/search?tbm=shop&q={search_terms}

Use the most identifying keywords from the product title and description as search terms.
Replace spaces with + in URLs.

Only say is_dropshipped: true if there are at least 2 strong indicators:
- Generic or made-up brand with no web presence
- Buzzword heavy description with no real technical detail
- No identifiers at all (SKU, GTIN, MPN)
- Title is keyword stuffed
- Price seems inflated for a generic product

Be conservative — do not flag legitimate branded products as dropshipped.

Return only this JSON:
{
  "is_dropshipped": true,
  "confidence": 0.0,
  "strong_indicators": [],
  "weak_indicators": [],
  "buzzwords_found": [],
  "brand_legitimacy": "unknown | legitimate | generic | suspicious",
  "title_keyword_stuffed": false,
  "markup_estimate": null,
  "likely_source": "AliExpress | Temu | Alibaba | unknown",
  "original_price_estimate": null,
  "original_currency": null,
  "search_urls": {
    "aliexpress": "https://www.aliexpress.com/wholesale?SearchText=search+terms+here",
    "amazon": "https://www.amazon.co.uk/s?k=search+terms+here",
    "temu": "https://www.temu.com/search_result.html?search_key=search+terms+here",
    "google_shopping": "https://www.google.com/search?tbm=shop&q=search+terms+here"
  },
  "search_terms_used": "the keywords used to generate the search URLs"
}`;
};

export const EXTRACTOR_SYSTEM_PROMPT = `You are a product data extraction assistant. Extract only what is explicitly present or directly inferable from the page. Do not fabricate or guess values.

Field rules:
- title: the full product name as listed on the page
- description: the most detailed factual product description available; prefer spec sheets or feature lists over marketing copy; if only marketing copy exists, use it but trim superlatives
- price: the numeric sale/current price only (not RRP/was-price); return as a string with no currency symbol e.g. "19.99"
- currency: ISO 4217 code inferred from the currency symbol or page locale e.g. "GBP", "USD", "EUR"
- brand: explicit brand name if present; otherwise infer from the domain name (e.g. "nike.com" → "Nike") or a brand-like token in the product title; null if none of these apply
- tags: if explicit tags/categories exist on the page, use those; otherwise generate 3–8 short descriptive keywords from the title and description — label these as inferred by returning them normally (the caller knows the source)
- main_image: the single URL of the primary product photo; prefer the largest image that is not a logo, icon, or banner; use the image candidates list sorted largest-first as a guide
- identifiers: return as an object; search the full page text for any of the following patterns and include only what you find: { "sku": null, "gtin": null, "mpn": null, "asin": null }

Confidence rules:
- Use null for any field that is genuinely absent. A plausible-sounding invented value is worse than null.
- Do not combine multiple prices — if a sale price and RRP are both present, use the sale price.
- Do not invent identifiers. SKUs and GTINs must be verbatim from the page text.

Always respond with valid JSON only. No explanation, no markdown, no code blocks — just raw JSON.`;


export const SYNTHESIS_SYSTEM_PROMPT = `You are a dropshipping detection analyst. You receive three independent sources of evidence and must synthesise them into a single verdict.
Always respond with valid JSON only. No explanation, no markdown, no code blocks — just raw JSON.`;

export const SYNTHESIS_PROMPT = ({ product, imageCandidate, candidateMeta, webSearchResults, dropshipAnalysis }) => {
  const searchBlock = webSearchResults?.length
    ? webSearchResults.map(r => `- ${r.title || 'No title'}\n  ${r.url || ''}\n  ${(r.description || '').slice(0, 150)}`).join('\n')
    : 'No results returned.';

  return `Synthesise the following three evidence sources to determine whether the identical wholesale product was found.

## Product Under Analysis
- Title: ${product.title}
- Listed price: ${product.price} ${product.currency || ''}
- Description: ${(product.description || '').slice(0, 300)}

## Evidence 1 — Image Comparison
- Visual match score: ${imageCandidate.visual_match_score}
- Identified as duplicate: ${imageCandidate.is_duplicate}
- Site type of match: ${imageCandidate.site_type}
- Supplier signal: ${imageCandidate.supplier_signal}
- Image analysis reasoning: ${imageCandidate.reasoning}
- Candidate found at: ${candidateMeta.domain} (${candidateMeta.pageUrl})
- Candidate listed price: ${candidateMeta.detectedPrice || 'unknown'}

## Evidence 2 — Web Search Results (queries generated from product title/description)
${searchBlock}

## Evidence 3 — Text-based Dropship Signals
- Likely dropshipped (text analysis): ${dropshipAnalysis.is_dropshipped}
- Strong indicators: ${(dropshipAnalysis.strong_indicators || []).join(', ') || 'none'}
- Likely wholesale source: ${dropshipAnalysis.likely_source || 'unknown'}
- Search terms used: ${dropshipAnalysis.search_terms_used || 'n/a'}

Synthesise ALL evidence and return EXACTLY this JSON:
{
  "is_identical_product": true,
  "verdict": "IDENTICAL | LIKELY_SAME | POSSIBLE_VARIANT | UNRELATED",
  "confidence": 0.0,
  "best_source_url": "the most authoritative source URL found across image match and web results",
  "best_source_price": "price string or null",
  "best_source_domain": "domain of best source",
  "evidence": ["key finding 1", "key finding 2", "key finding 3"],
  "image_evidence": "one sentence describing what the image comparison found",
  "web_evidence": "one sentence describing what web search results found"
}`;
};

export const SEARCH_QUERY_SYSTEM_PROMPT = `You are an expert at identifying the generic, sourceable form of a retail product.
Your job is to extract 2-3 precise search queries that would find the original wholesale version of a product on platforms like AliExpress, Temu, or Alibaba.
Always respond with valid JSON only. No explanation, no markdown, no code blocks — just raw JSON.`;

export const SEARCH_QUERY_INITIAL_PROMPT = (title, description) => `Analyse this product and reason about what search queries would find its original wholesale source.

Product title: ${title}
Product description: ${description}

Think step by step:
1. What is the core product type (ignore brand names, marketing words)?
2. What are its most identifying physical attributes (material, dimensions, mechanism, spec)?
3. What 2-3 short search phrases would a buyer type into AliExpress to find this exact item?

Respond with JSON:
{
  "reasoning": "brief explanation of what you identified",
  "queries": ["phrase one", "phrase two", "phrase three"],
  "done": false
}

Set "done": true only when you are confident the queries are specific and searchable.`;

export const SEARCH_QUERY_REFINE_PROMPT = `Review your queries. Are they specific enough to find the generic wholesale version?
- Remove any brand names or marketing language
- Prefer product-type + material/spec over vague descriptors
- If satisfied, set "done": true. If not, revise and keep "done": false.

Respond with the same JSON shape:
{
  "reasoning": "what you changed and why",
  "queries": ["revised phrase one", "revised phrase two"],
  "done": true
}`;

export const EXTRACTOR_PROMPT = (pageData) => `Extract product information from the webpage content below.

Return ONLY this exact JSON structure with no extra fields:

{
  "title": "full product name as listed (usually in a span with id productTitle)",
  "description": "detailed product description",
  "price": "19.99",
  "currency": "GBP",
  "brand": "brand or manufacturer name",
  "tags": ["relevant", "product", "tags"],
  "main_image": "https://example.com/image.jpg",
}

---
PAGE TEXT:
${pageData.text}

---
IMAGE CANDIDATES (sorted largest first):
${pageData.images.map(img => `${img.src} (${img.width}x${img.height})`).join('\n')}`;