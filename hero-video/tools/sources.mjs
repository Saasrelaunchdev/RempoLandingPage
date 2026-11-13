// What the film is made from: the scenes (src/), the voiceover's timing (audio/timings.json, which also makes the
// captions) and the three.js version (package-lock.json). A change to any of them changes the film, and the site only
// plays what tools/render.mjs last wrote to ../media/hero-video/. So render.mjs records their hash in
// rendered-from.json, and tests/unit/hero-video.test.mjs fails while the two differ.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const HERE = new URL('..', import.meta.url).pathname;

export function sourceFiles() {
  const src = readdirSync(HERE + 'src', { recursive: true }).map((p) => 'src/' + p.split('\\').join('/'));
  return [...src.filter((p) => statSync(HERE + p).isFile()), 'audio/timings.json', 'package-lock.json'].sort();
}

export function sourcesHash() {
  const h = createHash('sha256');
  // line endings normalised, so a checkout on Windows hashes the same
  for (const p of sourceFiles()) h.update(p + '\0' + readFileSync(HERE + p, 'utf8').replace(/\r\n/g, '\n') + '\0');
  return h.digest('hex');
}
