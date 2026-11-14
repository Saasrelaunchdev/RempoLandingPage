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

// Two flat surfaces at one height fight for the same pixels, and the film shows them flickering between their colours.
// The sidewalks sat exactly on the grass top and flickered white and green in every street shot (Nov 13, 2026).
test("no flat layer of the town shares a height with the grass or with the layer under it", () => {
  const town = read("hero-video/src/town.js"), kit = read("hero-video/src/kit.js");
  const find = (re, src, what) => { const m = src.match(re); assert.ok(m, `town.js: ${what} not found`); return m; };
  const [, gy, gh] = find(/export const GRASS = \{ y: (-?[\d.]+), h: ([\d.]+) \}/, town, "GRASS");
  find(/rbox\(W - 0\.5, GRASS\.h, DEP - 0\.5, [\d.]+, C\.grass, \{ y: GRASS\.y\b/, town, "the grass box built from GRASS");
  const GROUND = +gy + +gh;
  const LAYER = Object.fromEntries([...find(/export const LAYER = \{([^}]*)\}/, town, "LAYER")[1].matchAll(/(\w+): GROUND \+ ([\d.]+)/g)]
    .map(([, k, v]) => [k, GROUND + +v]));
  const pool = +find(/pool\.position\.set\([^,]+, ([\d.]+),/, kit, "the lamps' light pool")[1];
  // each flat() call's height is its last argument
  const flats = town.split("\n").filter((l) => l.includes("flat(") && !l.includes("const flat")).map((l) => {
    const args = [""];
    for (let i = l.indexOf("flat(") + 5, depth = 0; i < l.length; i++) {
      const c = l[i];
      if (c === ")" && !depth) break;
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (c === "," && !depth) args.push(""); else args[args.length - 1] += c;
    }
    const y = args.at(-1).trim();
    return { line: l.trim(), y: y.startsWith("LAYER.") ? LAYER[y.slice(6)] : Number(y) };
  });
  assert.ok(flats.length >= 5, "town.js: the flat() calls were not found");
  for (const f of flats) {
    assert.ok(Number.isFinite(f.y), `town.js: no height for ${f.line}`);
    assert.ok(Math.abs(f.y - GROUND) >= 0.002 - 1e-9, `town.js: ${f.line} sits on the grass top (y ${GROUND}) and flickers`);
  }
  const shown = [...new Set(flats.map((f) => f.y).filter((y) => y > GROUND))].sort((a, b) => a - b);
  [GROUND, ...shown, pool].reduce((below, y) => {
    assert.ok(y - below >= 0.004 - 1e-9, `town.js: layers at y ${below} and ${y} are too close, so they flicker`);
    return y;
  });
});

test("every frame is drawn anew, whichever browser draws it, so still cards do not shimmer", () => {
  // Chromium keeps a card on a layer of its own as it drew it in an earlier frame (up to half a pixel off), so frames
  // drawn by different browsers alternated and the text shimmered, until the renderer redrew the 2D layer each frame.
  const render = read("hero-video/tools/render.mjs");
  const seek = render.indexOf("window.seek(t)"), shot = render.indexOf("page.screenshot(", seek);
  assert.ok(seek > 0 && shot > seek, "hero-video/tools/render.mjs: no longer seeks and then takes the screenshot");
  assert.match(render.slice(seek, shot), /await page\.evaluate\(redraw\)/,
    "hero-video/tools/render.mjs: the frames are taken without redrawing the 2D layer first, so still cards can shimmer");
  assert.match(render, /const redraw = \(\) => new Promise\([\s\S]*?getElementById\('ov'\)[\s\S]*?display = 'none'[\s\S]*?requestAnimationFrame\(\(\) => requestAnimationFrame\(/,
    "hero-video/tools/render.mjs: redraw no longer takes the 2D layer (#ov) out for a frame");
});

test("every frame depends on its time alone, whatever frames the browser drew before", () => {
  // A parked van kept the wheel angle of the last drive its browser had drawn, and the drops behind the search hung
  // wherever that browser's last basement frame left them: a frame drawn again in a fresh browser could differ from
  // its neighbours (Nov 14, 2026). Every frame now starts from the 3D world and the 2D layer as built.
  const story = read("hero-video/src/story.js");
  assert.match(story, /function update\(t\) \{[^}]*?asBuilt\(\);[^}]*?rest\(\);[^}]*?cur\.fn\(t\);/,
    "hero-video/src/story.js: update(t) no longer starts the frame from the world and the 2D layer as built (asBuilt, then rest, then the shot)");
  assert.match(story, /const asBuilt = \(\(\) => \{[\s\S]*?S\.scene\.traverse\([\s\S]*?\}\)\(ov\);/,
    "hero-video/src/story.js: asBuilt no longer keeps both the 3D world and the 2D layer as built");
  // the pools of beams, glows and rings are made once, so their pieces stand in one order in every browser
  assert.doesNotMatch(story, /Pool\[\w+\] \|\| \(/, "hero-video/src/story.js: a pool grows as frames need it again, so its order depends on the frames drawn before");
  const render = read("hero-video/tools/render.mjs");
  assert.match(render, /async function check\(\)[\s\S]*?window\.seek\(t\), i \/ FPS\);\s*await page\.evaluate\(redraw\);[\s\S]*?shot\.equals\(await readFile\(FRAMES \+ name\(i\)\)\)/,
    "hero-video/tools/render.mjs: check() no longer compares frames drawn again in a fresh browser with the frames on disk");
  assert.match(render, /if \(!flag\('no-check'\)\) await check\(\);\s*if \(!flag\('frames-only'\)\) await encode\(\);/,
    "hero-video/tools/render.mjs: the film is encoded without first checking that a fresh browser draws its frames the same");
});

test("the film the site plays was rendered from the scenes, timing and three.js as they are", async () => {
  const { sourcesHash } = await import("../../hero-video/tools/sources.mjs");
  assert.ok(existsSync(ROOT + "hero-video/rendered-from.json"), "hero-video/rendered-from.json is missing: run node hero-video/tools/render.mjs");
  assert.equal(JSON.parse(read("hero-video/rendered-from.json")).sources, sourcesHash(),
    "hero-video/ changed since media/hero-video/ was rendered, so the site still plays the old film: run node hero-video/tools/render.mjs");
});
