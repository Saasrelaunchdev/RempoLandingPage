# The hero's story film

A 1:53 animated film behind the landing page's hero picture: **"Your reputation, as good as your work."** A click on
the hero picture (or, on a phone, the "Watch the story" link) opens it with sound and captions in the page's video
dialog (`assets/proof.js`, the same player as the video testimonials). Nothing loads before that click.

The story, for an HVAC or plumbing owner:

1. **The work.** Your crew does great work: furnaces fixed the same day, leaks found on the first visit, customers who
   would recommend you to anyone.
2. **The quiet.** A happy customer is a quiet one. They mean to leave a review, then life happens, and the shop is on
   to the next call. The reviews that never get written hang over the houses as empty outlines.
3. **The night search.** Across town, water on a basement floor at 9 pm. She searches for a plumber. Your shop has the
   better rating, but its newest review is five months old with no reply. The shop down the road got one two days ago
   and answered every review. She calls them.
4. **The cost.** Three in four people look for reviews from the last three months; four in five lean toward a business
   that replies to all its reviews (BrightLocal, Local Consumer Review Survey 2026, on screen). Every great job that
   never becomes a review is proof you earned and never got to use. You did the better work; they just had the proof.
5. **Rempo.** Connected to the job software you already use: a job marked complete, a thank-you with your crew's photo
   and the customer's first name, one reminder, a reply written for every review. The same honest ask to every
   customer, and nothing for you to run.
6. **The after.** Every customer asked, every review answered. The next search at nine at night shows your recent
   reviews and replies, and the call comes to you. It closes on the hero's own picture and its headline.

The words keep to the go-to-market brain's claim rules (`Saasrelaunchdev/rempogtmbuild`, `GTM-BRIEF.md` section 5 and
dashboards 03 and 06): no promised reviews, ratings, rankings, calls or jobs; a source on screen for every statistic;
the same honest ask to every customer (no filtering, no incentives, no staff names, no suggested wording); nothing
blames staff; no em dashes. `tests/unit/hero-video.test.mjs` checks the narration, the words on screen and the
captions. The names are the page's own sample (Maple Street Plumbing, Dana); the competitor is "Down the Road
Plumbing". The job software is never named.

## What is where

| Path | What it is |
|---|---|
| `script.json` | The narration, one line per entry, with the voice settings and each statistic's source. The one place the words live |
| `audio/narration.flac`, `audio/timings.json` | The voiceover as one track, and when each line and word is spoken (everything on screen is timed from this) |
| `audio/mix.wav` (not committed: `tools/mix.py` makes it) | The finished sound: the narration, a quiet music bed and a few effects, at -16.5 LUFS like the testimonial |
| `src/` | The film itself: a page that draws any moment of it. `kit.js` (the 3D pieces in the style of the page's art), `town.js` (the town, the basement, the crew photo), `stage.js` (renderer, light, day and night), `story.js` (the shots), `ui.css` (the cards, the phone, the statistics, in the page's fonts and colours) |
| `tools/voice.py` | Makes the voiceover with Kokoro |
| `tools/mix.py` | Makes the music bed and the effects (synthesised, so nothing to license) and mixes them under the voice |
| `tools/render.mjs` | Renders every frame in headless Chromium, then encodes `../media/hero-video/` |
| `rendered-from.json`, `tools/sources.mjs` | What the film in `../media/hero-video/` was rendered from (a hash of `src/`, `audio/timings.json` and `package-lock.json`). `npm test` fails while they differ, because the site would still be playing the film made before the change |
| `tools/preview.mjs` | Single frames at chosen moments, for checking a change without rendering it all |
| `tools/captions.mjs` | The WebVTT captions, from the voiceover's timing |

## The voice

A male narrator, for an audience of trade owners: Kokoro-82M (Apache 2.0, voice `am_michael`, a little slower than its
default), run on this machine through `kokoro-onnx`. No account and no API key; the model files come from the
`kokoro-onnx` GitHub release. "Rempo" is respelled for the voice only (`voice.say` in `script.json`) so it is said
REM-po. `--check` reads every clip back with speech recognition (Parakeet TDT 0.6B v2 through `sherpa-onnx`), fails if
a word differs from the script, and stores when each word starts.

To use another voice later (for example a voice actor or ElevenLabs), record the same lines, put them on one track as
`audio/narration.flac` with each line's start and end (and, ideally, each word's) in `audio/timings.json` (the format
`tools/voice.py` writes), then rerun the mix and the render: the scenes and the captions follow the new timing.

## Rebuild it

```bash
cd hero-video
npm install                                   # three
python3 -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile numpy scipy librosa sherpa-onnx
.venv/bin/python tools/voice.py --check       # only when the words or the voice change
.venv/bin/python tools/mix.py                 # the sound
node tools/render.mjs                         # every frame (about an hour on 4 CPU cores), then ../media/hero-video/
```

For a change to the picture only (the scenes, not the words or the voice), `node tools/render.mjs --keep-sound` keeps
each film's sound and length: the sound is copied, packet for packet, from the films already in `../media/hero-video/`,
and the picture ends on the frame theirs did. No Python and no `audio/mix.wav` needed.

Every frame depends on its time only, whichever of the browsers draws it. Before each screenshot the renderer takes the
2D layer out for one frame, so the browser draws the cards anew. Chromium otherwise keeps a card as it drew it in an
earlier frame, up to half a pixel off, and frames from different browsers made still text shimmer.

`node tools/preview.mjs 12 34.5 80` saves the frames at those seconds to `out/` (a few seconds each), and
`node tools/serve.mjs` serves `http://127.0.0.1:8790/src/?t=34.5` (any moment) or `?play` to watch it run.
The render skips frames already in `out/frames/`: after a change, delete the frames of the seconds it touches
(frame number = seconds x 30) and run it again.
