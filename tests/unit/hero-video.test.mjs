// The hero's story film (hero-video/, built into media/hero-video/): its words keep to the go-to-market claim rules,
// every statistic carries its source, and the captions say exactly what the narration says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const script = JSON.parse(read("hero-video/script.json"));

// The GTM brain's banned words and claims (Phase 3 and 6): no promised reviews, rankings or jobs, no dashes
const BANNED = [/\bleverage/i, /\bunlock/i, /\bseamless/i, /\brobust\b/i, /\bstreamline/i, /cutting-edge/i, /\bempower/i, /[–—]/,
  /get more reviews/i, /more reviews/i, /rank(s|ing)? higher/i, /more (jobs|calls|customers)/i, /guarantee/i, /\b\d+ (new )?reviews a/i];

test("the narration keeps to the claim rules", () => {
  for (const l of script.lines) for (const re of BANNED) assert.ok(!re.test(l.text), `${l.id}: "${l.text}" breaks ${re}`);
});

test("the words on screen keep to the claim rules", () => {
  const src = read("hero-video/src/story.js");
  const shown = [...src.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g)].map((m) => m[2]).filter((x) => /[a-z]{3,} [a-z]{3,}/i.test(x));
  for (const s of shown) for (const re of BANNED) assert.ok(!re.test(s), `story.js shows "${s.slice(0, 80)}", which breaks ${re}`);
});

test("every statistic in the narration carries its source", () => {
  for (const l of script.lines) {
    if (/\d+%|out of (two|three|four|five|ten)|in (two|three|four|five|ten)\b/i.test(l.text)) {
      assert.ok(l.source && /BrightLocal|ACHR|Clear Seas|Census|IBISWorld/.test(l.source), `${l.id} states a number without its source`);
    }
  }
  const story = read("hero-video/src/story.js");
  assert.ok((story.match(/Source: BrightLocal, Local Consumer Review Survey 2026/g) || []).length >= 2, "the statistics on screen lost their source line");
});

test("the captions are the narration, word for word, in order", () => {
  const vtt = read("media/hero-video/rempo-story.en.vtt");
  const cues = vtt.replace(/\r/g, "").split(/\n{2,}/).filter((b) => b.includes("-->")).map((b) => b.split("\n").slice(2).join(" ").trim());
  const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
  assert.deepEqual(words(cues.join(" ")), words(script.lines.map((l) => l.text).join(" ")));
  const times = [...vtt.matchAll(/(\d\d):(\d\d):(\d\d\.\d{3}) --> (\d\d):(\d\d):(\d\d\.\d{3})/g)].map((m) => [+m[1] * 3600 + +m[2] * 60 + +m[3], +m[4] * 3600 + +m[5] * 60 + +m[6]]);
  times.forEach(([a, b], i) => {
    assert.ok(b > a, `cue ${i + 1} ends before it starts`);
    if (i) assert.ok(a >= times[i - 1][1] - 1e-6, `cue ${i + 1} overlaps the one before it`);
  });
});

test("the film's timing, voice and sound come from the committed narration", () => {
  const t = JSON.parse(read("hero-video/audio/timings.json"));
  assert.equal(t.lines.length, script.lines.length, "audio/timings.json is out of date: run hero-video/tools/voice.py");
  t.lines.forEach((l, i) => assert.equal(l.text, script.lines[i].text, `audio/timings.json: line ${l.id} differs from script.json`));
  assert.match(t.voice.voice, /^am_/, "the narrator is no longer one of Kokoro's American male voices");
  assert.ok(existsSync(ROOT + "hero-video/audio/narration.flac"), "hero-video/audio/narration.flac (the voiceover) is missing");
});
