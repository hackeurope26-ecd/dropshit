import { searchImageWithSerpApi } from "./imageReverseSearch.js";
import { prepareCandidateForAI } from "./prepareReverseSearchCandidateForAI.js";
import { analyzeDropshipWithAI } from "./analyzeDropshipWithAI.js";

export async function analyzeImages(originalImageUrl) {
  if (!originalImageUrl) throw new Error("originalImageUrl is required");

  // 1. Reverse image search via proxy
  const reverseData = await searchImageWithSerpApi(originalImageUrl);
  const visualMatches = reverseData?.visual_matches || [];

  if (!visualMatches.length) {
    return {
      overall_verdict: "UNLIKELY_DROPSHIPPED",
      confidence: 0.2,
      candidates: [],
      summary_bullets: ["No reverse image matches found."]
    };
  }

  // 2. Top 3 usable matches
  const topCandidates = visualMatches
    .filter(m => m.image && m.link)
    .slice(0, 3);

  // 3. Download + encode original image — ✅ browser-safe btoa()
  const originalResponse = await fetch(originalImageUrl);
  if (!originalResponse.ok) throw new Error("Failed to download original image");

  const originalBuffer = await originalResponse.arrayBuffer();
  const originalBase64 = btoa(String.fromCharCode(...new Uint8Array(originalBuffer)));

  const original = {
    imageBase64: originalBase64,
    imageMimeType: originalResponse.headers.get("content-type") || "image/jpeg",
    metadata: { source: "ORIGINAL_PAGE", url: originalImageUrl }
  };

  // 4. Prepare candidates
  const candidates = [];
  for (const candidate of topCandidates) {
    try {
      candidates.push(await prepareCandidateForAI(candidate));
    } catch (err) {
      console.warn("[analyzeImages] Skipping candidate:", err.message);
    }
  }

  if (!candidates.length) {
    return {
      overall_verdict: "UNLIKELY_DROPSHIPPED",
      confidence: 0.3,
      candidates: [],
      summary_bullets: ["Matches found but none were usable for analysis."]
    };
  }

  // 5. AI verdict
  return analyzeDropshipWithAI({ original, candidates });
}
