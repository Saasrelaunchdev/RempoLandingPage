// Renders the hero video: every frame of src/ in headless Chromium, then the files the landing page serves.
//
//   node tools/render.mjs                 frames (resumes where it stopped), then encode
//   node tools/render.mjs --frames-only   frames only
//   node tools/render.mjs --encode-only   encode from the frames on disk
//   options: --workers 3  --fps 30  --quality 94  --mp4-only  --webm-only
//            --keep-sound   for a change to the picture only: each film keeps its sound and its length (the films
//                           already in ../media/hero-video/), so audio/mix.wav (and the Python tools that make it) are
//                           not needed
//
// Writes ../media/hero-video/: rempo-story.mp4 (H.264 High, AAC), rempo-story.webm (VP9, Opus),
// rempo-story.en.vtt (the captions, from audio/timings.json) and rempo-story-poster.webp.
// The sound is audio/mix.wav: the narration, the music bed and the effects (tools/mix.py makes it).
// Then rendered-from.json records what the film was made from (tools/sources.mjs): the unit tests fail while the scenes,
// the timing or three.js differ from it, as the site would still be playing the film made before the change.
import { createRequire } from 'node:module';
import { mkdir, readdir, writeFile, readFile, access, rename } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { serve } from './serve.mjs';
import { captions } from './captions.mjs';
import { sourcesHash } from './sources.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const HERE = new URL('..', import.meta.url).pathname;
const FRAMES = HERE + 'out/frames/';
const MEDIA = HERE + '../media/hero-video/';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const FPS = +arg('fps', 30), WORKERS = +arg('workers', 3), Q = +arg('quality', 94);

const timings = JSON.parse(await readFile(HERE + 'audio/timings.json', 'utf8'));
const N = Math.ceil(timings.duration * FPS);
const name = (i) => `f_${String(i).padStart(5, '0')}.jpg`;

// Runs in the page after seek(t), before the screenshot. The cards of the 2D layer have layers of their own (will-change,
// ui.css): Chromium draws such a layer once and then only moves that drawing, so a card standing still shows the scale
// and the fraction of a pixel it was drawn at, which depend on the frames that browser drew before. The browsers share
// the frames, so a still card came out up to half a pixel apart from one frame to the next, and its text shimmered.
// Taking the 2D layer out for one frame has it drawn anew: every frame depends on its time only, whichever browser
// draws it, and matches a frame drawn on its own.
const redraw = () => new Promise((done) => {
  const ov = document.getElementById('ov');
  ov.style.display = 'none';
  requestAnimationFrame(() => requestAnimationFrame(() => { ov.style.display = ''; done(); }));
});

async function frames() {
  await mkdir(FRAMES, { recursive: true });
  const have = new Set(await readdir(FRAMES));
  const todo = [];
  for (let i = 0; i < N; i++) if (!have.has(name(i))) todo.push(i);
  console.log(`${N} frames at ${FPS} fps, ${todo.length} to render, ${WORKERS} browsers`);
  if (!todo.length) return;
  const server = await serve(0);
  const url = `http://127.0.0.1:${server.address().port}/src/`;
  let next = 0, done = 0;
  const t0 = Date.now();
  async function worker() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('pageerror:', e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.ready, null, { timeout: 180000 });
    while (next < todo.length) {
      const i = todo[next++];
      await page.evaluate((t) => window.seek(t), i / FPS);
      await page.evaluate(redraw);
      await page.screenshot({ path: FRAMES + name(i), type: 'jpeg', quality: Q });
      if (++done % 60 === 0) {
        const per = (Date.now() - t0) / done;
        console.log(`${done}/${todo.length}  ${(per / 1000).toFixed(2)} s a frame, ${((todo.length - done) * per / 60000).toFixed(1)} min left`);
      }
    }
    await browser.close();
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));
  server.close();
  console.log(`frames done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

// the number of pictures (frames) in a film
const pictures = (film) => new Promise((ok, no) => execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
  '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', film], (e, out) => (e ? no(e) : ok(+out.trim()))));

function ff(args) {
  return new Promise((ok, no) => {
    const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    p.on('exit', (c) => (c ? no(new Error('ffmpeg exited ' + c)) : ok()));
  });
}

async function encode() {
  await mkdir(MEDIA, { recursive: true });
  const keep = flag('keep-sound');
  const audio = HERE + 'audio/mix.wav';
  if (!keep) try { await access(audio); } catch { throw new Error('audio/mix.wav is missing: run .venv/bin/python tools/mix.py first'); }
  // The sound: audio/mix.wav, encoded, and the picture cut where it ends. Or with --keep-sound, the film being replaced
  // keeps its sound and its length: its track is copied, packet for packet, at the times it had (-copyts: otherwise
  // ffmpeg moves the WebM's Opus track, which starts 7 ms before the picture, to start with it), and the picture ends on
  // the frame the film's picture ended on.
  const input = (film) => [...(keep ? ['-copyts'] : []), '-framerate', String(FPS), '-i', FRAMES + 'f_%05d.jpg', '-i', keep ? MEDIA + film : audio];
  const sound = async (film, encode) => (keep ? ['-vf', `trim=end_frame=${await pictures(MEDIA + film)}`, '-c:a', 'copy'] : [...encode, '-shortest']);
  // each file is written in out/ and moved into media/ only once it is whole
  const OUT = HERE + 'out/';
  const place = (f) => rename(OUT + f, MEDIA + f);
  if (!flag('webm-only')) {
    // H.264 High 4.0 at CRF 26: flat, clean shading compresses well, and the film stays near 19 MB (about 1.4 Mbps)
    await ff([...input('rempo-story.mp4'), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '26',
      '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-g', String(FPS * 2), '-movflags', '+faststart',
      ...(await sound('rempo-story.mp4', ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000'])), OUT + 'rempo-story.mp4']);
    await place('rempo-story.mp4');
    console.log('mp4 written');
  }
  if (!flag('mp4-only')) {
    // VP9 for the few browsers without H.264: constrained quality, capped near 900 kbps (about 13 MB)
    await ff([...input('rempo-story.webm'), '-map', '0:v', '-map', '1:a', '-c:v', 'libvpx-vp9', '-crf', '38', '-b:v', '900k', '-maxrate', '1400k',
      '-bufsize', '2800k', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3', '-pix_fmt', 'yuv420p', '-g', String(FPS * 2),
      ...(await sound('rempo-story.webm', ['-c:a', 'libopus', '-b:a', '112k', '-ar', '48000'])), OUT + 'rempo-story.webm']);
    await place('rempo-story.webm');
    console.log('webm written');
  }
  await ff(['-i', FRAMES + name(Math.round(1.2 * FPS)), '-vf', 'scale=1280:-2', '-c:v', 'libwebp', '-quality', '82', MEDIA + 'rempo-story-poster.webp']);
  await writeFile(MEDIA + 'rempo-story.en.vtt', captions(timings));
  console.log('poster and captions written to', MEDIA);
  if (!flag('mp4-only') && !flag('webm-only')) {
    await writeFile(HERE + 'rendered-from.json', JSON.stringify({ sources: sourcesHash(), files: 'tools/sources.mjs' }, null, 2) + '\n');
    console.log('rendered-from.json written');
  }
}

if (!flag('encode-only')) await frames();
if (!flag('frames-only')) await encode();
