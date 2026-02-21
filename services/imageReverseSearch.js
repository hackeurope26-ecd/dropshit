const SERP_API_KEY = "8f8979006c2d7210bf8e0ebd6093543cbe2b90a9d5bc207375e5a23c288603a5";

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
