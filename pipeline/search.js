import { loadEnv } from '../util/loadEnv.js';

const { BRAVE_SEARCH_KEY } = loadEnv();
const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

export async function search(query, { count = 10 } = {}) {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('count', count);

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': BRAVE_SEARCH_KEY,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brave Search error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.web?.results ?? [];
}
