export async function analyzeDropshipWithAI({ original, candidates }) {
  if (!original?.imageBase64) throw new Error("Original image is required");
  if (!Array.isArray(candidates) || !candidates.length) throw new Error("At least one candidate is required");

  const candidateSummaries = candidates.map((c, index) => ({
    index,
    domain: c.metadata?.domain || null,
    title: c.metadata?.originalTitle || null,
    pageTitle: c.metadata?.pageTitle || null,
    detectedPrice: c.metadata?.detectedPrice || null,
    source: c.metadata?.source || null,
    imageDimensions: c.metadata?.imageDimensions || null
  }));

  const systemPrompt = `You are an ecommerce product authenticity and dropshipping detection analyst.
Return ONLY valid JSON. No explanations, no markdown, no code blocks.`;

  const textPrompt = `The candidate below was selected as the most likely wholesale or supplier source for the original product. Analyze whether the original is being dropshipped at a markup.

For the candidate:
1. visual_match_score: 0 to 1 (how visually similar to the original. The best way to do this is to describe the two images exactly in great detail, and compare texts)
2. is_duplicate: true if it is the exact same product
3. site_type: WHOLESALE_SUPPLIER | RETAIL_COMPETITOR | MARKETPLACE | INSPIRATION | NON_COMMERCE
4. supplier_signal: HIGH | MEDIUM | LOW
5. reasoning: 1-2 sentences — if the match is weak or not a supplier, explain why

Then provide:
- overall_verdict: LIKELY_DROPSHIPPED | POSSIBLY_DROPSHIPPED | UNLIKELY_DROPSHIPPED
- confidence: 0 to 1
- summary_bullets: 3-5 concise bullet points

Return EXACTLY this JSON:
{
  "overall_verdict": "",
  "confidence": 0,
  "candidates": [
    {
      "index": 0,
      "visual_match_score": 0,
      "is_duplicate": false,
      "site_type": "",
      "supplier_signal": "",
      "reasoning": ""
    }
  ],
  "summary_bullets": []
}

Source metadata:
${JSON.stringify(original.metadata, null, 2)}

Candidate metadata:
${JSON.stringify(candidateSummaries, null, 2)}`;

  // ✅ OpenAI vision format — images inside messages[].content as data URIs
  const userContent = [
    {
      type: "image_url",
      image_url: { url: `data:${original.imageMimeType};base64,${original.imageBase64}`, detail: "low" }
    },
    ...candidates.map(c => ({
      type: "image_url",
      image_url: { url: `data:${c.imageMimeType};base64,${c.imageBase64}`, detail: "low" }
    })),
    { type: "text", text: textPrompt }
  ];

  const response = await fetch("http://localhost:3000/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "NVFP4/Qwen3-235B-A22B-Instruct-2507-FP4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      temperature: 0.1,
      top_p: 0.95,
      max_tokens: 1024
    })
  });

  if (!response.ok) throw new Error(`AI request failed: ${response.status}`);

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content || "";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("[analyzeDropshipWithAI] Raw output:", raw);
    throw new Error("AI returned invalid JSON");
  }
}
