// Speech to text, with the time of every word (Claude reads text and pictures, not audio). OpenAI's whisper-1 by
// default (OPENAI_API_KEY); any OpenAI-compatible transcription endpoint works with TRANSCRIBE_BASE_URL,
// TRANSCRIBE_MODEL and TRANSCRIBE_API_KEY (Groq's whisper-large-v3, for one).
const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");
export const sttConfigured = () => Boolean(env("TRANSCRIBE_API_KEY") || env("OPENAI_API_KEY"));

// whisper-1 returns its words bare ("Hello", "everybody") and its punctuation in the text ("Hello everybody,"): put
// them back together, so the captions keep the commas and periods. A hyphenated word covers several timed words.
export function alignWords(text, words) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const ws = (words || []).filter((w) => norm(w.word));
  const toks = String(text || "").split(/\s+/).filter(Boolean);
  const out = [];
  let j = 0;
  let pending = "";
  const attach = (tok) => { if (out.length) out[out.length - 1].w += " " + tok; else pending += tok + " "; };
  toks.forEach((tok, t) => {
    const target = norm(tok);
    if (!target || j >= ws.length) return attach(tok);
    // where this token starts: the next word, or one of the two after it (a word the text left out)
    let k = j;
    const reach = Math.min(ws.length, j + 3);
    while (k < reach && !target.startsWith(norm(ws[k].word))) k++;
    if (k >= reach) {
      // a word the timings left out (a filler): the next word belongs to the next token, so this one rides along
      const nextTok = toks[t + 1] && norm(toks[t + 1]);
      if (nextTok && nextTok.startsWith(norm(ws[j].word))) return attach(tok);
      k = j;   // no match close by ("10" written, "ten" timed): the next word stands for it
    }
    let last = k, acc = norm(ws[k].word);
    while (last + 1 < ws.length && acc.length < target.length && target.startsWith(acc + norm(ws[last + 1].word))) { last++; acc += norm(ws[last].word); }
    out.push({ w: pending + tok, s: ws[k].start, e: ws[last].end });
    pending = "";
    j = last + 1;
  });
  // nothing lined up (a different text): the words as they came, unpunctuated
  return out.length >= ws.length * 0.6 ? out : ws.map((w) => ({ w: String(w.word).trim(), s: w.start, e: w.end }));
}

export async function transcribe(audio, { prompt = "", language = "en", filename = "speech.mp3" } = {}) {
  const key = env("TRANSCRIBE_API_KEY") || env("OPENAI_API_KEY");
  if (!key) throw Object.assign(new Error("Transcription is not set up: set OPENAI_API_KEY."), { status: 503, code: "not-configured" });
  const base = (env("TRANSCRIBE_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, "");
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), filename);
  form.append("model", env("TRANSCRIBE_MODEL") || "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  if (language) form.append("language", language);
  if (prompt) form.append("prompt", prompt.slice(0, 800));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(`${base}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: ctrl.signal });
    const body = await r.text();
    if (!r.ok) throw Object.assign(new Error(`Transcription failed (HTTP ${r.status}): ${body.slice(0, 300)}`), { status: 502 });
    const data = JSON.parse(body);
    const words = Array.isArray(data.words) ? data.words : [];
    if (!words.length) throw Object.assign(new Error("The transcription came back without word timings."), { status: 502 });
    return { text: data.text || "", words: alignWords(data.text, words), language: data.language || language };
  } finally {
    clearTimeout(timer);
  }
}
