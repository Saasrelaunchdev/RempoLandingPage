# Case studies and video testimonials

What was added to the site, and how to add the next one.

## What is where

| Piece | Files |
|---|---|
| Landing page sections `#results` (case study cards) and `#testimonials` (video) | `index.html`, between the journey and the comparison; "Results" in the menu |
| Full case studies | `case-studies/junkaway-movers/index.html`, `case-studies/ranchero-plumbing/index.html` (plain static HTML) |
| Shared styles and behaviour | `assets/proof.css`, `assets/proof.js` (used by every page); `assets/site.css` (the case study pages' base: tokens, type, header and footer copied from `index.html`) |
| Fonts for the case study pages | `assets/fonts/` (the same files `index.html` inlines) |
| The video | `media/testimonials/german-aquino.mp4` (H.264), `.webm` (VP9, fallback), `.en.vtt` (captions), `.en.srt` (the same captions for social uploads), `-poster.webp`, `-avatar.webp` |
| Proof screenshots | `media/case-studies/*-before.webp`, `*-after.webp` (each business's Google profile), `*-truck.webp`, `*-van.webp` (their profile photo) |

`index.html` says it is built from `src/` by `tools/build.mjs`. Those sources are not in this repo, so the two sections were added to `index.html` directly. If the page is rebuilt from `src/`, port the two `<section>`s, the "Results" menu link, the new icon symbols (`i-play` to `i-info`), the `proof.css` link and the `proof.js` script.

## Claim rules these pages follow

Each number is the business's own, read from its Google Business Profile, and the source sits under it. Every page says results vary and that Rempo never promises a number of reviews. No em or en dashes, none of the banned words (`GTM-BRIEF.md` in the go-to-market repo).

## The video

The source was recorded on a mirrored front camera (the board and the hoodie read backwards), so the published file is flipped back. Audio is normalized to about -16 LUFS; location and device metadata are stripped. To publish another one:

```bash
ffmpeg -i in.mp4 -map 0:v:0 -map 0:a:0 -map_metadata -1 -vf "scale=720:-2:flags=lanczos,format=yuv420p" -r 30 -c:v libx264 -profile:v high -preset slower -crf 26 -g 60 -c:a aac -b:a 96k -ac 1 -af loudnorm=I=-16:TP=-2.5 -movflags +faststart out.mp4
```

```bash
ffmpeg -i in.mp4 -map 0:v:0 -map 0:a:0 -map_metadata -1 -vf "scale=720:-2:flags=lanczos,format=yuv420p" -r 30 -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -c:a libopus -b:a 64k -ac 1 -af loudnorm=I=-16:TP=-2.5 out.webm
```

Add `hflip,` at the start of `-vf` if the clip is mirrored. The captions were transcribed locally with four speech models (NVIDIA Parakeet TDT and Canary, Whisper medium.en and turbo, through sherpa-onnx), cross-checked word by word, then cut into phrases on the speaker's own word timings. They are clean verbatim: one false start removed, nothing reworded.

To add a card, copy a `<figure class="vt-card" data-vt ...>` block into `.vt-list` and change its `data-name`, `data-role`, `data-avatar`, poster, sources and track. Each card plays on hover (muted, captions on screen), plays while on screen on a phone, and opens full screen with sound on a click or a tap.

## The 3D stacks

Each `.s3d` reads its columns from `data-s3d`: `unit` is pixels per review; each column has a `num` (the label), a `cap` (the caption on the plate), `segs` (`n` reviews of kind `old`, `new` or `later`, an optional `pill`), and `rq: true` to send request cards up it. Lines on the faces mark every ten reviews.
