// prompts.js

const SYSTEM_PROMPT = `You are an expert at identifying dropshipped products being sold at a markup.
You have deep knowledge of AliExpress, Alibaba, Temu, and other wholesale platforms.
Always respond with valid JSON only. No explanation, no markdown, no code blocks — just raw JSON.`;

const DROPSHIP_PROMPT = (extractedProduct, signals, webSearchResults = null) => {
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

const EXTRACTOR_SYSTEM_PROMPT = `You are a product data extraction assistant. 
You must try extremely hard to find values for every field before giving up.
- For brand: if no explicit brand, infer from the domain name or product title
- For price: look for any number with a currency symbol anywhere on the page
- For tags: generate relevant tags from the title and description if none are explicit
- For identifiers: search the entire page text for any SKU, barcode, GTIN, MPN, or ASIN patterns
- For description: use the most detailed product description you can find, not marketing copy
Only use null as an absolute last resort if the information is completely absent.
Always respond with valid JSON only. No explanation, no markdown, no code blocks — just raw JSON.`;

const EXTRACTOR_PROMPT = (pageData) => `Extract product information from this webpage. Return ONLY this exact JSON structure with no extra fields:

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
- only use null if the field is truly absent from the page

Webpage text:
${pageData.text}

Image candidates (sorted largest first):
${pageData.images.map(img => `${img.src} (${img.width}x${img.height})`).join('\n')}`;