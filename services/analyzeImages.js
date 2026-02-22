import { searchImageWithSerpApi } from "./imageReverseSearch.js";
import { prepareCandidateForAI } from "./prepareReverseSearchCandidateForAI.js";
import { analyzeDropshipWithAI } from "./analyzeDropshipWithAI.js";

function isSameListing(candidateLink, pageUrl) {
  if (!pageUrl) return false;
  try {
    const pageNums = pageUrl.match(/\d{6,}/g) || [];
    const candidateNums = candidateLink.match(/\d{6,}/g) || [];
    return pageNums.some(n => candidateNums.includes(n));
  } catch {
    return false;
  }
}

async function selectBestCandidate(usableMatches) {
  const metadata = usableMatches.map((m, i) => {
    let domain = null;
    try { domain = new URL(m.link).hostname; } catch { /* skip */ }
    return { index: i, domain, title: m.title || null, source: m.source || null };
  });

  const response = await fetch("http://localhost:3000/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "NVFP4/Qwen3-235B-A22B-Instruct-2507-FP4",
      messages: [
        {
          role: "system",
          content: "You are a dropshipping detection analyst. Return ONLY valid JSON. No explanations, no markdown, no code blocks."
        },
        {
          role: "user",
          content: `From these reverse image search results, pick the single best candidate that is most likely the original wholesale or supplier source (e.g. AliExpress, Alibaba, Temu, DHgate, Wish, Shein, 1688, or any manufacturer/factory site).\n\nCandidates:\n${JSON.stringify(metadata, null, 2)}\n\nReturn EXACTLY:\n{"best_index": 0, "reason": "one sentence"}`
        }
      ],
      temperature: 0.1,
      max_tokens: 128,
    }),
  });

  if (!response.ok) throw new Error(`Candidate selection failed: ${response.status}`);
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content || "";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const result = JSON.parse(cleaned);
  return Math.max(0, Math.min(result.best_index ?? 0, usableMatches.length - 1));
}

export async function analyzeImages(originalImageUrl, pageUrl) {
  if (!originalImageUrl) throw new Error("originalImageUrl is required");

  // 1. Reverse image search via proxy
  const reverseData = await searchImageWithSerpApi(originalImageUrl);
  const usableMatches = (reverseData?.visual_matches || [])
    .filter(m => m.image && m.link && !isSameListing(m.link, pageUrl));

  if (!usableMatches.length) {
    return {
      overall_verdict: "UNLIKELY_DROPSHIPPED",
      confidence: 0.2,
      candidates: [],
      summary_bullets: ["No reverse image matches found."]
    };
  }

  // 2. Ask the LLM to pick the best wholesale candidate from all results
  const bestIndex = await selectBestCandidate(usableMatches);
  const selectedMatch = usableMatches[bestIndex];

  // 3. Download + encode original image
  const originalResponse = await fetch(originalImageUrl);
  if (!originalResponse.ok) throw new Error("Failed to download original image");

  const originalBuffer = new Uint8Array(await originalResponse.arrayBuffer());
  let originalBinary = '';
  for (let i = 0; i < originalBuffer.byteLength; i++) originalBinary += String.fromCharCode(originalBuffer[i]);
  const originalBase64 = btoa(originalBinary);

  const original = {
    imageBase64: originalBase64,
    imageMimeType: originalResponse.headers.get("content-type") || "image/jpeg",
    metadata: { source: "ORIGINAL_PAGE", url: originalImageUrl }
  };

  // 4. Prepare the selected candidate (download its image + page metadata)
  let candidates = [];
  try {
    candidates.push(await prepareCandidateForAI(selectedMatch));
  } catch (err) {
    console.warn("[analyzeImages] Selected candidate failed, trying fallback:", err.message);
    // Try the first usable match that isn't the failed one
    for (const match of usableMatches) {
      if (match === selectedMatch) continue;
      try {
        candidates.push(await prepareCandidateForAI(match));
        break;
      } catch { /* continue */ }
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

  // 5. Visual AI verdict
  const aiResult = await analyzeDropshipWithAI({ original, candidates });
  return { ...aiResult, candidateDetails: candidates };
}
