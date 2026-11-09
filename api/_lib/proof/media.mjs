// ffmpeg for the uploads (ffmpeg-static; vercel.json bundles the binary with api/admin-ingest.mjs): read a video, take
// stills for Claude to look at, make the web version (H.264, at most 720 on its short side, loudness evened out,
// location and device metadata dropped, flipped back if the camera mirrored it), its poster, a round avatar, and the
// audio for the transcription. Also turns document images into WebP.
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";

let bin = null;
function ffmpegBin() {
  if (bin) return bin;
  const p = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!p || !existsSync(p)) throw Object.assign(new Error("ffmpeg is missing from this deployment"), { status: 500 });
  try { if (!(statSync(p).mode & 0o111)) throw new Error("not executable"); bin = p; }
  catch { const tmp = "/tmp/ffmpeg"; if (!existsSync(tmp)) { copyFileSync(p, tmp); chmodSync(tmp, 0o755); } bin = tmp; }
  return bin;
}

export function ffmpeg(args, { timeoutMs = 270000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; if (stderr.length > 200000) stderr = stderr.slice(-100000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(Object.assign(new Error("ffmpeg took too long"), { status: 504 })); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}
const must = async (args, what) => {
  const r = await ffmpeg(args);
  if (r.code !== 0) throw Object.assign(new Error(`${what} failed: ${r.stderr.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400)}`), { status: 422 });
  return r;
};

// Duration, display size (after the phone's rotation flag), frame rate, whether there is sound
export async function probe(file) {
  const { stderr } = await ffmpeg(["-i", file]);
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const video = /Stream #\d+:\d+[^\n]*: Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})[^\n]*/.exec(stderr);
  if (!video) throw Object.assign(new Error("This file has no video in it that ffmpeg can read."), { status: 422 });
  const fps = /, (\d+(?:\.\d+)?) fps/.exec(video[0]);
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(stderr) || /rotate\s*:\s*(-?\d+)/.exec(stderr);
  let width = Number(video[2]), height = Number(video[3]);
  if (rot && Math.abs(Math.round(Number(rot[1]))) % 180 === 90) [width, height] = [height, width];
  return {
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    width, height, codec: video[1], fps: fps ? Number(fps[1]) : 30,
    hasAudio: /Stream #\d+:\d+[^\n]*: Audio:/.test(stderr)
  };
}

const fitShort = (max) => `scale='trunc(min(1,${max}/min(iw,ih))*iw/2)*2':'trunc(min(1,${max}/min(iw,ih))*ih/2)*2'`;

// Stills for Claude: as recorded (not flipped), 640 on the long side, JPEG
export async function stills(file, times, dir) {
  const out = [];
  for (const [i, t] of times.entries()) {
    const f = join(dir, `still-${i}.jpg`);
    await must(["-y", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)'", "-q:v", "4", f], "taking a still");
    out.push(readFileSync(f));
  }
  return out;
}

export async function webVideo(file, out, { flip = false, hasAudio = true, fps = 30 } = {}) {
  const vf = [flip ? "hflip" : null, fitShort(720), fps > 31 ? "fps=30" : null, "format=yuv420p"].filter(Boolean).join(",");
  const audio = hasAudio ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "96k", "-ac", "1", "-ar", "48000", "-af", "loudnorm=I=-16:TP=-2:LRA=11"] : ["-an"];
  await must(["-y", "-i", file, "-map", "0:v:0", ...audio, "-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn", "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-profile:v", "high", "-g", "60", "-keyint_min", "30", "-sc_threshold", "0",
    "-movflags", "+faststart", out], "making the web video");
  return statSync(out).size;
}

export async function poster(file, t, out, { flip = false } = {}) {
  await must(["-y", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", [flip ? "hflip" : null, fitShort(720)].filter(Boolean).join(","), "-c:v", "libwebp", "-quality", "80", out], "making the poster");
}

// A square around the face (box: fractions of the frame as recorded), with room around it, then flipped like the video
export async function avatar(file, t, box, size, out, { flip = false } = {}) {
  const { width: W, height: H } = size;
  const b = box && box.w > 0 && box.h > 0 ? box : { x: 0.3, y: 0.18, w: 0.4, h: 0.3 };
  const side = Math.round(Math.min(W, H, Math.max(b.w * W, b.h * H) * 1.7));
  const cx = (b.x + b.w / 2) * W, cy = (b.y + b.h / 2) * H;
  const x = Math.round(Math.max(0, Math.min(W - side, cx - side / 2))), y = Math.round(Math.max(0, Math.min(H - side, cy - side * 0.48)));
  await must(["-y", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", [`crop=${side}:${side}:${x}:${y}`, flip ? "hflip" : null, "scale=240:240:flags=lanczos"].filter(Boolean).join(","), "-c:v", "libwebp", "-quality", "85", out], "making the avatar");
}

// What the transcription hears: mono, 16 kHz, small
export async function speech(file, out) {
  await must(["-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", out], "taking the audio");
  return statSync(out).size;
}

// A picture as WebP: at most maxWidth wide (or maxSide on its long side), optionally cut to `crop` (fractions of the
// picture). Returns the WebP and its size in pixels, and the source's.
export async function toWebp(buffer, dir, name, { maxWidth = 1600, maxSide = 0, crop = null, quality = 84 } = {}) {
  const src = join(dir, `${name}.src`), out = join(dir, `${name}.webp`);
  writeFileSync(src, buffer);
  const info = await probe(src).catch(() => null);
  if (!info) throw Object.assign(new Error("That picture could not be read."), { status: 422 });
  const filters = [];
  if (crop) filters.push(cropFilter(crop, info.width, info.height));
  filters.push(maxSide
    ? `scale='if(gte(iw,ih),min(${maxSide},iw),-2)':'if(gte(iw,ih),-2,min(${maxSide},ih))':flags=lanczos`
    : `scale='min(${maxWidth},iw)':-2:flags=lanczos`);
  await must(["-y", "-i", src, "-frames:v", "1", "-vf", filters.join(","), "-c:v", "libwebp", "-quality", String(quality), out], "converting a picture");
  const res = await probe(out);
  return { buffer: readFileSync(out), width: res.width, height: res.height, sourceWidth: info.width, sourceHeight: info.height };
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
// A box in fractions, kept inside the picture and at least a little bigger than nothing
export function fitBox(box, W, H, min = 8) {
  const b = box && box.w > 0 && box.h > 0 ? box : { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.round(clamp01(b.x) * W), y = Math.round(clamp01(b.y) * H);
  const w = Math.max(min, Math.min(W - x, Math.round(clamp01(b.w) * W))), h = Math.max(min, Math.min(H - y, Math.round(clamp01(b.h) * H)));
  return { x: Math.min(x, W - w), y: Math.min(y, H - h), w, h };
}
const cropFilter = (box, W, H) => { const c = fitBox(box, W, H); return `crop=${c.w}:${c.h}:${c.x}:${c.y}`; };

// The before and after screenshots for the case study: each cut to its crop, both scaled to the same width and padded
// with white at the bottom to the same height, so they swap in one frame. Returns both WebPs and the frame's size.
export async function screenshotPair(files, crops, dir, { width = 1200 } = {}) {
  const infos = await Promise.all(files.map((f) => probe(f)));
  const cuts = infos.map((info, i) => fitBox(crops[i], info.width, info.height));
  const heights = cuts.map((c) => Math.round((c.h * width) / c.w / 2) * 2);
  const H = Math.max(...heights);
  const outs = [];
  for (const [i, f] of files.entries()) {
    const out = join(dir, `shot-${i}.webp`);
    const c = cuts[i];
    await must(["-y", "-i", f, "-frames:v", "1", "-vf", `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${width}:${heights[i]}:flags=lanczos,pad=${width}:${H}:0:0:white`, "-c:v", "libwebp", "-quality", "84", out], "making a screenshot");
    outs.push(readFileSync(out));
  }
  return { buffers: outs, width, height: H, cuts, heights };
}

// The ring around the review count, as CSS percentages of the frame: the count's box (fractions of the source picture)
// moved into the crop, scaled like the screenshot, with room around it
export function ringFor(countBox, cut, source, frame) {
  if (!countBox || !(countBox.w > 0) || !(countBox.h > 0)) return null;
  const k = frame.width / cut.w;
  const x0 = (countBox.x * source.width - cut.x) * k, y0 = (countBox.y * source.height - cut.y) * k;
  const w0 = countBox.w * source.width * k, h0 = countBox.h * source.height * k;
  const padX = 0.022 * frame.width, padY = 0.02 * frame.height;
  const x = Math.max(0, x0 - padX), y = Math.max(0, y0 - padY);
  const w = Math.min(frame.width - x, w0 + 2 * padX), h = Math.min(frame.height - y, h0 + 2 * padY);
  if (w < 12 || h < 8 || x >= frame.width || y >= frame.height) return null;
  const pct = (v, of) => `${Math.round((v / of) * 1000) / 10}%`;
  return { x: pct(x, frame.width), y: pct(y, frame.height), w: pct(w, frame.width), h: pct(h, frame.height) };
}

// The business's photo for its profile picture: the biggest square inside the box, 360 px
export async function squarePicture(file, box, out, { size = 360 } = {}) {
  const info = await probe(file);
  const b = fitBox(box, info.width, info.height);
  const side = Math.min(b.w, b.h);
  const x = Math.round(b.x + (b.w - side) / 2), y = Math.round(b.y + (b.h - side) / 2);
  await must(["-y", "-i", file, "-frames:v", "1", "-vf", `crop=${side}:${side}:${x}:${y},scale=${size}:${size}:flags=lanczos`, "-c:v", "libwebp", "-quality", "84", out], "making the photo");
  return readFileSync(out);
}

// Raw pixels (what a PDF's pictures decode to) as a PNG
export async function rawToImage(data, width, height, channels) {
  const fmt = { 1: "gray", 3: "rgb24", 4: "rgba" }[channels];
  if (!fmt) throw new Error("unknown pixel format");
  const dir = mkdtempSync(join(tmpdir(), "raw-"));
  try {
    const src = join(dir, "in.raw"), out = join(dir, "out.png");
    writeFileSync(src, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    await must(["-y", "-f", "rawvideo", "-pix_fmt", fmt, "-s", `${width}x${height}`, "-i", src, "-frames:v", "1", out], "reading a PDF picture");
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
