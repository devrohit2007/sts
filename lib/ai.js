'use strict';
// NVIDIA sentence refinement. It only ever rewrites keywords the signer actually produced.
// If anything looks wrong the plain keywords are used instead, so captions never break.

const DEFAULT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

function plainSentence(words) {
  const s = words.join(' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

// Accepts one short line. Rejects empty, huge, or chatty answers.
function extractSentence(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
  t = (t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '')
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .trim();
  if (!t || t.length > 200 || /:$/.test(t)) return null;
  return t;
}

function createRefiner({ apiKey, model, url = DEFAULT_URL, fetchFn = globalThis.fetch, timeoutMs = 8000, maxInflight = 4, log = console } = {}) {
  let inflight = 0;

  function request(words, language, withKwargs) {
    const body = {
      model, temperature: 0.2, max_tokens: 120, stream: false,
      messages: [
        {
          role: 'system',
          content: 'You turn a sequence of sign-language keywords from a deaf or non-speaking person into ONE short, natural sentence they most likely mean. ' +
            `Do not add new facts. Reply with the sentence only, in ${language}.`,
        },
        { role: 'user', content: words.join(' ') },
      ],
    };
    if (withKwargs) body.chat_template_kwargs = { enable_thinking: false };
    return fetchFn(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // Never throws. Returns { text, ai, reason? }.
  return async function refine(words, language = 'English') {
    const fallback = { text: plainSentence(words), ai: false };
    if (!apiKey) return { ...fallback, reason: 'no-key' };
    if (inflight >= maxInflight) return { ...fallback, reason: 'busy' };
    inflight++;
    try {
      let res = await request(words, language, true);
      if (res.status === 400) res = await request(words, language, false); // endpoint may not know chat_template_kwargs
      if (!res.ok) { log.warn(`[AI] HTTP ${res.status}`); return { ...fallback, reason: `http-${res.status}` }; }
      const data = await res.json();
      const text = extractSentence(data?.choices?.[0]?.message?.content);
      return text ? { text, ai: true } : { ...fallback, reason: 'invalid-response' };
    } catch (e) {
      log.warn(`[AI] ${e.name}: ${e.message}`);
      return { ...fallback, reason: e.name === 'TimeoutError' ? 'timeout' : 'error' };
    } finally {
      inflight--;
    }
  };
}

module.exports = { createRefiner, extractSentence, plainSentence, DEFAULT_URL };
