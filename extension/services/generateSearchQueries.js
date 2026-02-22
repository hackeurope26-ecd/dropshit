import {
    SEARCH_QUERY_SYSTEM_PROMPT,
    SEARCH_QUERY_INITIAL_PROMPT,
    SEARCH_QUERY_REFINE_PROMPT,
} from '../pipeline/prompts.js';

const LLM_URL = 'http://localhost:3000/chat';
const MAX_TURNS = 3;

async function callLLM(messages) {
    const response = await fetch(LLM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'NVFP4/Qwen3-235B-A22B-Instruct-2507-FP4',
            messages,
            temperature: 0.1,
            top_p: 0.95,
            frequency_penalty: 0,
            presence_penalty: 0,
        }),
    });

    const data = await response.json();
    if (!data.choices?.[0]) throw new Error('LLM error: ' + JSON.stringify(data));
    return data.choices[0].message.content.trim();
}

function parseResponse(raw) {
    const cleaned = raw
        .replace(/^```json\n?/, '')
        .replace(/^```\n?/, '')
        .replace(/```$/, '')
        .trim();
    return JSON.parse(cleaned);
}

export async function generateSearchQueries(title, description) {
    const messages = [
        { role: 'system', content: SEARCH_QUERY_SYSTEM_PROMPT },
        { role: 'user', content: SEARCH_QUERY_INITIAL_PROMPT(title, description) },
    ];

    let lastParsed = null;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const raw = await callLLM(messages);
        messages.push({ role: 'assistant', content: raw });

        try {
            const parsed = parseResponse(raw);
            lastParsed = parsed;
            console.log(`[generateSearchQueries] turn ${turn + 1}:`, parsed.reasoning);

            if (parsed.done) {
                return parsed.queries ?? [];
            }
        } catch {
            // model didn't return valid JSON yet — nudge it on the next turn
        }

        if (turn < MAX_TURNS - 1) {
            messages.push({ role: 'user', content: SEARCH_QUERY_REFINE_PROMPT });
        }
    }

    return lastParsed?.queries ?? [];
}
