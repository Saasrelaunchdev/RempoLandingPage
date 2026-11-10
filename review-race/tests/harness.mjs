// A tiny test harness: ok(name, condition), then report() at the end. Each test file runs on its own (node <file>).
let pass = 0, failed = 0;
const names = [];
export function ok(name, cond, detail) {
  if (cond) { pass += 1; return; }
  failed += 1;
  names.push(name);
  console.log(`  FAIL ${name}${detail !== undefined ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}
export async function section(title, fn) { console.log(`- ${title}`); await fn(); }
export function report(file) {
  console.log(`${file}: ${pass} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
  return { pass, failed, names };
}
// Replaces global fetch for one block: handler(url, init) returns { status, body } or a Response
export async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = await handler(String(url), init);
    if (r instanceof Response) return r;
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), { status: r.status || 200, headers: { "content-type": "application/json", ...(r.headers || {}) } });
  };
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}
