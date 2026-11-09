# Case studies and video testimonials

The site's proof: case study cards and video testimonials on the landing page, and a full page for each case study. They are managed at **/admin**: drop in a video or a document, and it is turned into a video testimonial or a case study in the same format as the first ones, checked, and published.

## Set it up (once)

In Vercel, for this project:

1. **Storage**: Storage, Create, Blob. Connect it to the project. This adds `BLOB_READ_WRITE_TOKEN`.
2. **Environment variables** (Settings, Environment Variables), then redeploy:

| Variable | What it is for |
|---|---|
| `ADMIN_PASSWORD` | Signs in to /admin. 12 characters or more. |
| `ANTHROPIC_API_KEY` | Claude writes the case studies, looks at each video (mirrored? where is the face? which frame is the cover?) and tidies the transcript (misheard names, the quote, the intro). |
| `OPENAI_API_KEY` | Whisper transcribes each video, word by word with timings, for the captions. Any OpenAI-compatible transcription service works instead: set `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_MODEL` and `TRANSCRIBE_API_KEY` (for example Groq's `whisper-large-v3`). |
| `ADMIN_SESSION_SECRET` | Optional. Signs the admin's session cookie; without it, a key is derived from the password (changing the password signs everyone out). |

/admin shows what is still missing under "Finish setting up".

The upload function (`api/admin-ingest.mjs`) runs for up to 300 seconds, which needs Fluid compute (on by default for new Vercel projects). Videos of up to about three minutes fit comfortably; the limit is 10 minutes.

## How it works

**A video.** The browser uploads it straight to Blob (private). Then, in one request with each step shown live: ffmpeg reads it and takes six stills; Claude looks at them while Whisper transcribes the sound; ffmpeg makes the web version (H.264, at most 720 on its short side, loudness evened out, location and device metadata dropped, flipped back if the camera mirrored it), the cover and a round face picture; Claude fixes misheard names against what is on the site and what is written in the video, drops fillers, and picks the quote by word numbers (so the quote is always word for word); the captions are cut into phrases on the speaker's own timings (WebVTT for the site, SRT for social). It is saved as a video testimonial and linked to its business's case study when there is one.

**A document.** Word (.docx), PDF, plain text, Markdown, RTF, OpenDocument (.odt) or HTML, with screenshots inside it or dropped in alongside; or paste the text. Older .doc and Pages files get a message on how to save them as .docx. In a first request the files are read in order, every picture is numbered where it sat, and Claude lists the businesses with a story in it. Then one request per business: Claude writes the case study in the exact format of the first two (its prompt holds the brand's writing rules and the first two case studies with the document they were written from, as the example); the before and after screenshots are cut, framed together and ringed around the review count; the profile photo is cut square; the checks run, and if they find problems Claude gets one round to fix them.

**The checks** decide what publishes by itself (`api/_lib/proof/checks.mjs`). Errors keep it a draft: a missing part, a dash used as punctuation, a banned word, a number that is not in the upload (numbers read off a screenshot are listed separately and shown in the editor), a quote that is not what was said, or a scanned PDF whose numbers can't be checked. Warnings are shown and don't block: an exclamation mark, a person called he or she instead of by name. A second case study for the same business, or a second video from the same person, waits as a draft.

With "Publish by itself when every check passes" on (the default), an item that passes goes live at once. Anything can be edited in /admin, with a live preview; "Publish anyway" overrides failing checks.

**What the site shows.** Every save rebuilds `proof/published.json` in Blob. Case study pages are rendered from it (`api/case-study.mjs`, at `/case-studies/<slug>/`), and the landing page swaps its two sections for the published set when it is newer than the page (`assets/proof.js`). Pages are cached at the edge for a minute, so a change is live within about two minutes.

## What is where

| Piece | Files |
|---|---|
| The admin panel | `admin/` (`index.html`, `admin.css`, `admin.js`; `vendor/blob-client.mjs` is `@vercel/blob`'s browser upload client) |
| Admin API | `api/admin.mjs` (sign in, items, save, publish, reorder, delete, preview, upload tokens), `api/admin-ingest.mjs` (the uploads' long work, streamed) |
| Public API and pages | `api/proof.mjs` (the published set), `api/case-study.mjs` (one case study page) |
| The pipelines | `api/_lib/proof/`: `ingest.mjs`, `extract.mjs` (documents), `media.mjs` (ffmpeg), `stt.mjs` (transcription), `captions.mjs`, `claude.mjs` and `prompts.mjs` (Claude), `checks.mjs`, `items.mjs`, `model.mjs`, `store.mjs` (Blob, or a folder in development), `auth.mjs` |
| One renderer for everything | `assets/proof-render.mjs`, used by the server and the browser; `assets/proof-shell.mjs` (the icons and the logo) |
| The first content | `api/_lib/proof/seed.mjs` (the first two case studies and the first video, shown until the admin saves; its files are in `media/`) |
| Styles and motion | `assets/proof.css`, `assets/proof.js`, `assets/site.css` |

Storage layout in Blob: `proof/content.json` (private: every item, drafts included, saved with its ETag so two saves never overwrite each other), `proof/published.json` (public: what the site shows), `proof/uploads/` (private: what was dropped in, deleted once it is processed), `proof/jobs/` (private: a document's text and pictures, for writing its case studies), `proof/media/` (public: the files the pages use).

The first time it writes, the admin checks what the connected store takes. A store that takes public files only works too: what would be private is kept under names nobody can guess and is never linked from the site, and the content document is saved as numbered versions in a folder with a random name (each version written once, the last five kept), because public files are served through the edge and an overwritten one could be read stale. A store that takes private files only can't serve the site's videos and pictures: /admin says so, and a store with public access is needed. `PROOF_BLOB_PRIVATE=1` or `0` skips the check.

The landing page's two sections are rendered into `index.html` from the seed (`npm run render-landing`), so the page shows them before any script runs. `index.html` says it is built from `src/` by `tools/build.mjs`; those sources are not in this repo, so if the page is rebuilt from them, port the two `<section>`s, the "Results" menu link, the icon symbols, the `proof.css` link and the `proof.js` script.

## Claude

Model `claude-opus-5-5`, through the official SDK (`@anthropic-ai/sdk`), with structured outputs (each answer is JSON in a fixed schema) and server-side fallbacks on (`fallbacks: "default"`), so a declined request is re-run on Anthropic's recommended fallback model instead of failing. Effort: low for looking at stills and finding the businesses, medium for the transcript and for writing a case study (`PROOF_CLAUDE_EFFORT=high` raises the writing, for plans with functions longer than 300 seconds). The system prompt and the upload are cached, so the fix round costs little.

## Develop and test

```bash
npm install
```

```bash
npm run dev:fake
```

That serves the site at http://localhost:3000 with a local store (a temporary folder, or `PROOF_STORE_DIR`) and fixed answers in place of Claude and the transcription (`tests/fakes.mjs`), so the whole flow runs with no keys. The admin password is `local-admin-password`. `npm run dev` uses the real services when the keys are set.

```bash
npm test
```

```bash
npm run test:e2e
```

The end-to-end test drives /admin in Chromium (Playwright: `npx playwright install chromium`).

## Claim rules these pages follow

Each number is the business's own, from what was uploaded, and the source sits under it. Every page says results vary and that Rempo never promises a number of reviews. No em or en dashes, none of the banned words (`GTM-BRIEF.md` in the go-to-market repo). People are named, not called he or she.

## The 3D stacks

Built from each case study's numbers by one rule (`buildScene` in `api/_lib/proof/model.mjs`): one column before, one after, the new reviews in blue. Each `.s3d` reads its columns from `data-s3d`: `unit` is pixels per review; each column has a `num` (the label), a `cap` (the caption on the plate), `segs` (`n` reviews of kind `old`, `new` or `later`, an optional `pill`), and `rq: true` to send request cards up it. Lines on the faces mark every ten reviews.
