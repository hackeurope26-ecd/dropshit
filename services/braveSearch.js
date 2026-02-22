const PROXY_SEARCH_URL = 'http://localhost:3000/search';

/** Call from extension (e.g. combiner) via importScripts — gives Qwen "internet" via Brave Search. */
async function braveSearch(query, { count = 10 } = {}) {
  const url = new URL(PROXY_SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('count', count);

  console.log(url);

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brave Search error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.web?.results ?? [];
}
