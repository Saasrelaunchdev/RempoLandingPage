# Rules for working on this repository

These rules come from the owner. They apply to every session and every task, and they override any habit or
default that conflicts with them.

## Why these rules exist

On Nov 7 and 8, 2026, three sessions worked at the same time on three branches (`claude/busy-faraday-urxwws`,
`claude/compassionate-newton-8h79kb`, `claude/keen-mendel-uu2qxa`). None of them was merged into `main`, so each one
started from an old `main` and had no idea about the others. Each branch's Vercel preview was then promoted to
production on its own, so each promotion replaced the live site with that one branch's copy:

- Promoting /admin brought the "Illustration · ..." caption notes back and dropped the phone layout and /customers.
- Promoting the legal pages then dropped /admin, the case studies and the video testimonial.

Nothing was lost in git. The work was spread across branches, and production showed whichever branch was promoted
last. The rules below make sure that cannot happen again.

## Rule 1. One branch: `main`

- `main` is the only source of truth, and the only branch that deploys to production (Vercel's production branch).
- A session's own branch (`claude/...`) only carries work to `main`. It starts from the latest `main` and is merged
  back into `main` at the end of the same task. Work that is not on `main` is not done.
- Never promote or redeploy a branch's preview to production in Vercel, and never advise the owner to. Production
  is whatever `main` holds. If something has to go live, merge it into `main`.

### Start of every session

1. `.claude/hooks/session-start.sh` runs automatically. It brings your branch up to date with `origin/main` and lists
   any branch on GitHub that holds work `main` does not have. If its "Branch sync" report is not in your context (for
   example, in a session with several repositories), run it yourself first: `.claude/hooks/session-start.sh`.
2. If it says **STOP** about branches holding work that is not on `main`, tell the owner which branches and what they
   contain. Then merge them into `main` (Rule 2 applies) before any new work, unless the owner says to drop one. If
   the owner says to drop one, delete that branch on GitHub so it stops being flagged.
   The one branch not to merge: `claude/dreamy-cray-95z5j1`, the Review Race. The owner tests it in its own Vercel
   project and keeps it off `main` until they confirm the merge (see "Owner decisions"). If it is flagged, tell the
   owner and leave it. When the owner confirms, first revert `6f358ac`, the commit that took the race's folder off
   `main`: the branch's commits up to `33481ff` are already in `main`'s history, so a plain merge would bring in only
   the commits after it.
3. If it says **STOP** because merging `main` into your branch conflicts, resolve that merge first (Rule 2).

### End of every task

1. Bring in anything merged meanwhile: `git fetch origin main && git merge origin/main`.
2. Rebuild whatever is generated (see "Generated files" below) and run every check (see "Checks"). All must pass.
3. Push your branch, open a pull request into `main`, and merge it with **"Create a merge commit"**. Never squash or
   rebase: those copy the commits, so the branch would still show as not merged and the next session would be told
   to merge it again. The owner has asked for every task to end merged into `main`. You do not need to ask again
   before opening and merging the pull request.
4. Check that `git rev-list --count origin/main..HEAD` prints `0` after the merge, and tell the owner the work is on
   `main` and deploying to production.

The only exception: if the owner says this task is a preview only, or not to ship it yet, leave the pull request
open and say so plainly. The start-of-session hook will keep flagging it until it is merged or dropped.

## Rule 2. No update undoes an earlier update unless the owner explicitly asks

- Each change the owner asked for stays in place until the owner explicitly asks to undo that specific change. A new
  task, a redesign, a merge or a "cleanup" is not permission to remove, revert or reword earlier work.
- Before you change a file, look at its recent history (`git log --oneline -10 -- <file>`) and at "Owner decisions"
  below. If your change would undo or contradict one of them, do not make it. Ask the owner.
- When you merge, keep both sides. Never resolve a conflict by taking one whole side (`-X ours`, `-X theirs`,
  `git checkout --ours/--theirs`) on a source file. Combine the two intents. If they truly contradict each other,
  ask the owner.
- Never rebuild a generated file by hand during a merge. Merge its sources, then run its build (see below).
- Never force-push `main`, rewrite its history, or reset it.
- `tests/unit/owner-decisions.test.mjs` pins the owner's decisions and runs with `npm test`. If it fails, an earlier
  update has been undone: restore it. Only when the owner explicitly asks to undo a decision, change its test in the
  same commit, update the list below, and name the decision in the commit message.
- Add each new owner-requested change to the list below, and give it a test in that file when it can be checked
  mechanically.

## Owner decisions (do not undo unless the owner explicitly asks)

| Date | Decision | Where |
|---|---|---|
| 2026-11-06 | Lead capture: the Get started form, the scorecard and the call form store leads in Supabase and announce them | `api/lead.mjs`, `index.html` |
| 2026-11-07 | The Meta ads landing page lives at `/customers`, served by this project | `meta/` builds into `customers/` |
| 2026-11-07 | Both landing pages are optimized for phones; the PC version stays as it was | `index.html`, `meta/` |
| 2026-11-07 | No caption notes under pictures ("Illustration · ...", "sample ... demo data") on any page, phone or PC | `index.html`, `meta/` |
| 2026-11-07 | Case studies (Junkaway & Movers, Ranchero Plumbing) and German Aquino's video testimonial | `index.html#results`, `/case-studies/*` |
| 2026-11-08 | `/admin` publishes proof (videos, case studies) behind `ADMIN_PASSWORD` | `admin/`, `api/admin*.mjs`, `PROOF.md` |
| 2026-11-08 | Legal pages at `/legal`, linked from every footer; consent and a notice at collection on every form | `legal-src/` builds into `legal/` |
| 2026-11-10 | Self-serve checkout at `/start` (Stripe); every paid buyer is handed to the founder's GoHighLevel automatically, and the thank-you page shows the onboarding link at once. Delivery after that is the founder's, in GoHighLevel | `start/`, `api/checkout.mjs`, `api/stripe-webhook.mjs`, `checkout/` |
| 2026-11-12 | The Meta ads page (`/customers`) shows the real case studies and German Aquino's video testimonial, the same set as the landing page (what `/admin` publishes shows on both) | `meta/tools/build.mjs`, `customers/` |
| 2026-11-13 | The hero picture is the poster of a story film with a male voiceover (great work and no reviews, losing the night call to a shop with fresher reviews, then Rempo's process and the after). A click opens it with sound and captions in the page's video dialog; phones get a "Watch the story" link | `index.html#hero`, `hero-video/` builds into `media/hero-video/` |
| 2026-11-13 | The story film does not flicker: each flat ground layer has a height of its own above the grass (the sidewalks), and every frame is drawn anew, whichever browser draws it (the cards' text). The site plays the film rendered from the scenes as they are (`hero-video/rendered-from.json`; `npm test` fails while they differ) | `hero-video/src/town.js`, `hero-video/tools/render.mjs`, `media/hero-video/` |
| 2026-11-14 | Every frame of the story film depends on its time alone: it starts from the 3D world and the 2D layer as built, so a frame drawn in any browser, after any other frames, matches its neighbours (the parked van's wheels, the drops behind the search). Before encoding, the render has a fresh browser draw a shuffled sample of frames again, and each must match the frame on disk byte for byte | `hero-video/src/story.js`, `hero-video/tools/render.mjs` |
| 2026-11-14 | The Review Race is tested on its own, in a separate Vercel project built from its branch `claude/dreamy-cray-95z5j1` as it was first built. It stays off `main` until the owner confirms the merge, so the landing page and `/customers` (the Gap Check and its Gap Report) stay as they were. The decision of the same day to run a changed copy of the race on `/customers` in place of the Gap Check was undone at the owner's request | `claude/dreamy-cray-95z5j1`, `customers/`, `meta/`, `api/meta-lead.mjs` |

## Generated files: rebuild them, never merge them by hand

| Output | Source | Build |
|---|---|---|
| `customers/` | `meta/` | `node meta/tools/build.mjs` |
| `legal/` | `legal-src/` | `node legal-src/tools/build.mjs` |
| The case studies section of `index.html` | the published proof seed | `node tools/render-landing.mjs` |
| `media/hero-video/` (the story film, its captions and poster) | `hero-video/` (the script, the voiceover, the 3D scenes) | `node hero-video/tools/render.mjs` (about an hour; see `hero-video/README.md` for the voice and the sound; `--keep-sound` for a change to the picture only) |

The built files are committed: Vercel serves them as they are and runs no build for them.

## Checks (all must pass before merging into `main`)

```bash
npm install
npm test                                   # unit tests + the owner decisions
npm run test:e2e                           # /admin end to end, in Chromium
node meta/tests/run.mjs                    # the /customers pages
node legal-src/tests/check-legal.mjs       # the legal pages and consent
node lead-capture/tests/check-forms.mjs    # the landing page's forms
node lead-capture/tests/check-api.mjs      # the lead endpoint
node checkout/tests/check-sql.mjs          # the purchases SQL in a local Postgres (the checkout's own tests run in npm test)
```

## Other repositories

`Saasrelaunchdev/rempogtmbuild` (the go-to-market build) is read-only reference and the source of truth for
positioning, ICPs and copy rules. Read it for context. Never commit to it from work on this repository.
