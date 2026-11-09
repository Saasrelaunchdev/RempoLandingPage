// Captions from timed words: phrases that read well (at most two short lines), shown a moment before they are said
// and left up a moment after, never overlapping. Words are { w, s, e }: the word as written (with its punctuation),
// its start and its end in seconds.

const LEAD = 0.08, LINGER = 0.45, MIN = 1.0, MAX_CHARS = 64, MAX_DUR = 3.6;
const ends = (w, re) => re.test(w.w);
const SENTENCE = /[.?!]["”']?$/, CLAUSE = /[,;:]["”']?$/;

// Words a phrase starts with: a cue that must break breaks before one of these, or after punctuation
const STARTS = new Set(["and", "but", "so", "because", "to", "that", "which", "who", "when", "if", "for", "with", "from", "after", "before", "while", "since", "or"]);
const bare = (w) => String(w.w).toLowerCase().replace(/[^a-z']/g, "");

export function buildCues(words, { duration = null } = {}) {
  const ws = words.filter((w) => w && String(w.w).trim());
  const groups = [];
  let cur = [];
  const len = (g) => g.map((w) => w.w).join(" ").length;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], next = ws[i + 1];
    if (cur.length && (len([...cur, w]) > MAX_CHARS || w.e - cur[0].s > MAX_DUR + 1.2)) {
      // the best place to break: after punctuation (3), before a phrase's first word (2); the later the better
      let best = cur.length, score = -1;
      for (let j = 1; j <= cur.length; j++) {
        if (len(cur.slice(0, j)) < 16) continue;
        const at = j < cur.length ? cur[j] : w;
        const s = (ends(cur[j - 1], SENTENCE) || ends(cur[j - 1], CLAUSE) ? 3 : 0) + (STARTS.has(bare(at)) ? 2 : 0);
        if (s >= score) { score = s; best = j; }
      }
      if (score <= 0) best = cur.length;
      groups.push(cur.slice(0, best));
      cur = cur.slice(best);
    }
    cur.push(w);
    const n = len(cur);
    const gap = next ? next.s - w.e : 0;
    if (!next || (ends(w, SENTENCE) && n >= 12) || (ends(w, CLAUSE) && n >= 30) || gap > 0.7 || (w.e - cur[0].s > MAX_DUR && n >= 24)) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  // A short tail ("Thank you so much.") reads better on its own than glued to the cue before it, unless it is a fragment
  const cues = groups.map((g) => ({ start: Math.max(0, g[0].s - LEAD), end: g[g.length - 1].e + LINGER, text: g.map((w) => w.w).join(" ") }));
  for (let k = 0; k < cues.length; k++) {
    if (k) cues[k].start = Math.max(cues[k].start, cues[k - 1].end);
    const nextStart = k + 1 < cues.length ? cues[k + 1].start : (duration ?? cues[k].end);
    cues[k].end = Math.min(cues[k].end, nextStart);
    if (cues[k].end - cues[k].start < MIN) cues[k].end = Math.min(cues[k].start + MIN, nextStart);
  }
  return cues.filter((c) => c.end > c.start);
}

const stamp = (x, sep) => {
  const ms = Math.round(x * 1000), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};
const clean = (t) => String(t).replace(/-->/g, "→").replace(/\s+/g, " ").trim();

export function toVtt(cues, note) {
  return "WEBVTT\n\n" + (note ? `NOTE ${clean(note)}\n\n` : "") + cues.map((c, i) => `${i + 1}\n${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${clean(c.text)}\n`).join("\n");
}
export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${clean(c.text)}\n`).join("\n");
}

// Apply a clean-up: corrected words by index, and indices to drop (false starts, fillers). Timing stays the speaker's own.
export function applyFixes(words, { fixes = [], drop = [] } = {}) {
  const byIndex = new Map(fixes.filter((f) => Number.isInteger(f.i)).map((f) => [f.i, String(f.w || "").trim()]));
  const gone = new Set(drop.filter(Number.isInteger));
  const out = [];
  words.forEach((w, i) => {
    if (gone.has(i)) return;
    const text = byIndex.has(i) ? byIndex.get(i) : w.w;
    if (text) out.push({ ...w, w: text });
  });
  // a sentence that now starts mid-sentence after a drop keeps its capital letter where one was
  return out;
}
export const transcriptOf = (words) => words.map((w) => w.w).join(" ").replace(/\s+([,.?!;:])/g, "$1").trim();
