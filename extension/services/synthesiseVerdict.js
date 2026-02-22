import { SYNTHESIS_SYSTEM_PROMPT, SYNTHESIS_PROMPT } from '../pipeline/prompts.js';

const LLM_URL = 'http://localhost:3000/chat';

export async function synthesiseVerdict({ product, aiAnalysis, webSearchResults, dropshipAnalysis }) {
    // Pick the top image candidate (highest visual_match_score)
    const topCandidate = (aiAnalysis?.candidates ?? [])
        .slice()
        .sort((a, b) => (b.visual_match_score ?? 0) - (a.visual_match_score ?? 0))[0];

    const topIndex = topCandidate?.index ?? 0;
    const candidateMeta = aiAnalysis?.candidateDetails?.[topIndex]?.metadata ?? {};

    if (!topCandidate) {
        return {
            is_identical_product: false,
            verdict: 'UNRELATED',
            confidence: 0,
            best_source_url: null,
            best_source_price: null,
            best_source_domain: null,
            evidence: ['No image candidates were found.'],
            image_evidence: 'No image match found.',
            web_evidence: webSearchResults?.length ? `${webSearchResults.length} web results were found but could not be corroborated with an image match.` : 'No web results found.',
        };
    }

    const prompt = SYNTHESIS_PROMPT({
        product,
        imageCandidate: topCandidate,
        candidateMeta,
        webSearchResults: webSearchResults ?? [],
        dropshipAnalysis,
    });

    const response = await fetch(LLM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'NVFP4/Qwen3-235B-A22B-Instruct-2507-FP4',
            messages: [
                { role: 'system', content: SYNTHESIS_SYSTEM_PROMPT },
                { role: 'user', content: prompt },
            ],
            temperature: 0.1,
            top_p: 0.95,
            frequency_penalty: 0,
            presence_penalty: 0,
        }),
    });

    const data = await response.json();
    if (!data.choices?.[0]) throw new Error('Synthesis LLM error: ' + JSON.stringify(data));

    const raw = data.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/```$/, '').trim();

    const result = JSON.parse(cleaned);

    // Always attach the image URL from the candidate — web search results don't carry images
    result.matchImageUrl = candidateMeta.imageUrl ?? null;

    return result;
}
