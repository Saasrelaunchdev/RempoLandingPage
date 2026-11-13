#!/usr/bin/env python3
"""The hero video's voiceover: one clip per line of ../script.json, then the whole narration on one track.

Uses Kokoro-82M (Apache 2.0) through kokoro-onnx, run on this machine: no account, no API key. The model files are
downloaded once from the kokoro-onnx GitHub release into ../.cache/kokoro/ (not committed).

    python3 -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile numpy
    .venv/bin/python tools/voice.py            # writes audio/narration.flac and audio/timings.json (and audio/lines/*.wav, not committed)
    .venv/bin/python tools/voice.py --check    # also reads every clip back with speech recognition (sherpa-onnx,
                                               # Parakeet TDT 0.6B v2 in ../.cache/asr/) and flags words that differ

timings.json is what tools/render.mjs times the scenes and the captions from, so rerun the render after this.
"""
import json, os, re, sys, urllib.request
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
KOKORO = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
PARAKEET = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2"


def fetch(url, path):
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print(f"downloading {url}")
    urllib.request.urlretrieve(url, path + ".part")
    os.replace(path + ".part", path)
    return path


def trim(audio, sr, floor_db=-45.0, pad=0.03):
    """Cut the silence Kokoro leaves at both ends, keeping a short pad so no consonant is clipped."""
    frame = int(sr * 0.01)
    n = len(audio) // frame
    rms = np.sqrt(np.mean(audio[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    loud = np.where(20 * np.log10(rms) > floor_db)[0]
    if not len(loud):
        return audio
    a = max(0, loud[0] * frame - int(pad * sr))
    b = min(len(audio), (loud[-1] + 1) * frame + int(pad * sr))
    out = audio[a:b].copy()
    fade = int(sr * 0.012)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out


def words(s):
    s = s.lower().replace("’", "'")
    for digit, word in (("5", "five"), ("9", "nine")):
        s = re.sub(rf"\b{digit}\b", word, s)
    return re.findall(r"[a-z']+", s)


def check(lines, clips, timings):
    """Read every clip back with speech recognition. Flags lines whose words differ from the script, and stores when
    each word starts (tokens that begin with a space start a word), so scenes and captions can land on a word."""
    import tarfile, librosa, sherpa_onnx
    d = os.path.join(CACHE, "asr", "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8")
    if not os.path.isdir(d):
        tb = fetch(PARAKEET, os.path.join(CACHE, "asr", "parakeet.tar.bz2"))
        with tarfile.open(tb) as t:
            t.extractall(os.path.join(CACHE, "asr"))
        os.remove(tb)
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=f"{d}/encoder.int8.onnx", decoder=f"{d}/decoder.int8.onnx", joiner=f"{d}/joiner.int8.onnx",
        tokens=f"{d}/tokens.txt", model_type="nemo_transducer", num_threads=4)
    bad = 0
    for line, (audio, sr), tm in zip(lines, clips, timings):
        y = librosa.resample(audio, orig_sr=sr, target_sr=16000)
        s = rec.create_stream()
        s.accept_waveform(16000, y)
        rec.decode_stream(s)
        heard = s.result.text.strip()
        ok = words(heard) == words(line["text"])
        bad += not ok
        print(f"{'ok ' if ok else 'DIFF'} {line['id']}: {heard}")
        starts = [t for tok, t in zip(s.result.tokens, s.result.timestamps) if tok.startswith(" ")]
        said = line["text"].split()
        # the recogniser hears "thank-you" as two words: a hyphenated word starts where its first piece does
        pieces = [len([x for x in w.split("-") if x]) for w in said]
        if ok and len(starts) == sum(pieces):
            firsts, i = [], 0
            for n in pieces:
                firsts.append(starts[i])
                i += n
            tm["words"] = [{"w": w, "t": round(tm["start"] + t, 3)} for w, t in zip(said, firsts)]
    return bad


def main():
    script = json.load(open(os.path.join(ROOT, "script.json")))
    v = script["voice"]
    from kokoro_onnx import Kokoro
    k = Kokoro(fetch(KOKORO + "kokoro-v1.0.onnx", os.path.join(CACHE, "kokoro", "kokoro-v1.0.onnx")),
               fetch(KOKORO + "voices-v1.0.bin", os.path.join(CACHE, "kokoro", "voices-v1.0.bin")))
    out = os.path.join(ROOT, "audio")
    os.makedirs(os.path.join(out, "lines"), exist_ok=True)

    clips, timings = [], []
    t = script["leadIn"]
    for line in script["lines"]:
        said = line["text"]
        for word, respelled in v.get("say", {}).items():
            said = re.sub(rf"\b{re.escape(word)}\b", respelled, said)
        audio, sr = k.create(said, voice=v["voice"], speed=v["speed"], lang=v["lang"],
                             sentence_pause=v.get("sentencePause", 0.25), clause_pause=v.get("clausePause", 0.1))
        audio = trim(np.asarray(audio, dtype=np.float32), sr)
        sf.write(os.path.join(out, "lines", line["id"] + ".wav"), audio, sr, subtype="PCM_16")
        dur = len(audio) / sr
        timings.append({"id": line["id"], "scene": line["scene"], "start": round(t, 3), "end": round(t + dur, 3),
                        "text": line["text"]})
        clips.append((audio, sr))
        print(f"{line['id']}: {dur:5.2f}s at {t:6.2f}s  {line['text']}")
        t += dur + line["pause"]
    total = t + script["tail"]

    sr = clips[0][1]
    track = np.zeros(int(total * sr) + 1, dtype=np.float32)
    for (audio, _), tm in zip(clips, timings):
        a = int(tm["start"] * sr)
        track[a:a + len(audio)] += audio
    track *= 0.89 / max(1e-6, float(np.max(np.abs(track))))  # peak at -1 dBFS; loudness is set in the final mix
    sf.write(os.path.join(out, "narration.flac"), track, sr, subtype="PCM_16")
    print(f"narration: {total:.2f}s, {sum(len(l['text'].split()) for l in script['lines'])} words")

    bad = 0
    if "--check" in sys.argv:
        bad = check(script["lines"], clips, timings)
        print("speech check:", "every line reads back as written" if not bad else f"{bad} line(s) differ, listen to them")
    json.dump({"voice": v, "sampleRate": sr, "duration": round(total, 3), "lines": timings},
              open(os.path.join(out, "timings.json"), "w"), indent=1)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
