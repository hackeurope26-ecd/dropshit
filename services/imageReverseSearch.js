import { loadEnv } from '../util/loadEnv.js';

const env = loadEnv();
const SERP_API_KEY = env.SERP_API_KEY;

export async function searchImageWithSerpApi(imageUrl) {
  if (!imageUrl) {
    throw new Error("imageUrl is required");
  }

  const endpoint = new URL("https://serpapi.com/search");

  endpoint.searchParams.set("engine", "google_lens");
  endpoint.searchParams.set("url", imageUrl);
  endpoint.searchParams.set("api_key", SERP_API_KEY);

  try {
    const response = await fetch(endpoint.toString());

    if (!response.ok) {
      throw new Error(`SerpAPI request failed:\n${response.status}`);
    }

    const data = await response.json();

    console.log("SerpAPI result:\n", data);

    return data;
  } catch (error) {
    console.error("Error calling SerpAPI:\n", error);
    throw error;
  }
}
