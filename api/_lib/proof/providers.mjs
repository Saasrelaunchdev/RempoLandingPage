// The two outside services the uploads use, behind one seam: Claude (writing, looking) and the transcription. Tests and
// `PROOF_FAKE_AI=1 npm run dev` swap in fixed answers (tests/fakes.mjs), so the whole flow runs without keys.
import * as claude from "./claude.mjs";
import * as stt from "./stt.mjs";

const real = { claude, stt };
let current = real;
export const providers = () => current;
export function setProviders(p) {
  current = { claude: { ...real.claude, ...(p.claude || {}) }, stt: { ...real.stt, ...(p.stt || {}) } };
}
