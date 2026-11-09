"""Step 0: call sound. Cut the pinned call phrase (a run of four "chip" calls) out of the Xeno-canto
recording, clean it for the web, and derive per-frame bill / throat curves from it so the bill opens on
every chirp.

Inputs : sources/audio/song.json (recording, credit, phrase) + the excerpt WAV it names
Outputs: frontend/public/audio/birds/sparrow/tree-sparrow-call-01.wav   (mono 16-bit, phrase + short pre/post roll)
         build/song_cues.json                                  (envelope curves at FPS + attribution)
         build/debug/song_spectrogram.png
search(folder) re-picks a phrase from other downloaded recordings (candidates.json).
"""
import json
import os
import wave

import numpy as np

import splib as bt

SONG_JSON = os.path.join(bt.AUDIO_SOURCES, "song.json")
OUT_WAV = bt.SONG_WAV
CUES = os.path.join(bt.BUILD, "song_cues.json")
FPS = 30
HOP = 0.010  # envelope hop (s)
BAND = (2800.0, 8500.0)  # tree sparrow 'chip' call energy (the recording has low-frequency noise)
PHRASE = (0.8, 2.6)  # accepted phrase length (s)
PRE, POST = 0.12, 0.30  # roll around the phrase (s)


def decode(path, max_s=150.0):
    """Mono float samples. PCM WAV is read directly; other formats go through Blender's audaspace."""
    if path.lower().endswith(".wav"):
        with wave.open(path, "rb") as w:
            rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
            raw = w.readframes(min(w.getnframes(), int(max_s * rate)))
        if width != 2:
            raise ValueError("%s: only 16-bit PCM WAV is supported" % path)
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32).reshape(-1, ch) / 32768.0
        return data.mean(axis=1), int(rate)
    import aud

    snd = aud.Sound(path)
    rate, _ch = snd.specs
    data = np.asarray(snd.limit(0.0, max_s).data(), dtype=np.float32)
    return data.mean(axis=1) if data.ndim == 2 else data, int(rate)


def bandpass(x, rate, lo, hi, edge=250.0):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1.0 / rate)
    g = np.clip((f - (lo - edge)) / edge, 0, 1) * np.clip(((hi + edge) - f) / edge, 0, 1)
    return np.fft.irfft(X * g, n=len(x)).astype(np.float32)


def denoise(x, win=1024, floor_pct=25, over=1.6, min_gain=0.12):
    """Soft spectral gate: per-bin noise floor from the quieter frames, Wiener-like gain, overlap-add."""
    hop = win // 4
    w = np.hanning(win).astype(np.float32)
    pad = np.pad(x, (win, win + hop))
    n = (len(pad) - win) // hop
    frames = np.stack([pad[k * hop : k * hop + win] * w for k in range(n)])
    S = np.fft.rfft(frames, axis=1)
    mag = np.abs(S)
    noise = np.percentile(mag, floor_pct, axis=0)
    gain = np.clip(1.0 - (over * noise / (mag + 1e-9)) ** 2, min_gain, 1.0)
    gain = np.apply_along_axis(lambda g: np.convolve(g, np.ones(3) / 3, mode="same"), 0, gain)  # no musical noise
    out = np.zeros(len(pad), np.float32)
    norm = np.zeros(len(pad), np.float32)
    rec = np.fft.irfft(S * gain, n=win, axis=1).astype(np.float32)
    for k in range(n):
        out[k * hop : k * hop + win] += rec[k] * w
        norm[k * hop : k * hop + win] += w * w
    return (out / np.maximum(norm, 1e-6))[win : win + len(x)]


def envelope(x, rate, hop=HOP):
    n = int(rate * hop)
    m = len(x) // n
    return np.sqrt((x[: m * n].reshape(m, n) ** 2).mean(1) + 1e-12)


def phrases(env_db, floor_db, hop=HOP, thresh=12.0, gap=0.12, quiet_pre=0.3, quiet_post=0.25):
    """(start_s, end_s, snr_db) of song phrases: active runs joined over short gaps, quiet around."""
    act = env_db > floor_db + thresh
    idx = np.nonzero(act)[0]
    if len(idx) == 0:
        return []
    runs, s, p = [], idx[0], idx[0]
    for i in idx[1:]:
        if (i - p) * hop > gap:
            runs.append((s, p))
            s = i
        p = i
    runs.append((s, p))
    out = []
    for k, (a, b) in enumerate(runs):
        dur = (b - a + 1) * hop
        if not PHRASE[0] <= dur <= PHRASE[1]:
            continue
        prev_end = runs[k - 1][1] if k else -10**9
        next_start = runs[k + 1][0] if k + 1 < len(runs) else 10**9
        if (a - prev_end) * hop < quiet_pre or (next_start - b) * hop < quiet_post:
            continue
        seg = env_db[a : b + 1]
        snr = float(np.percentile(seg, 80) - floor_db)
        out.append((a * hop, (b + 1) * hop, snr))
    return out


def centroid_track(x, rate, t0, t1, fps=FPS):
    """Spectral centroid in the song band per animation frame, normalised to 0..1."""
    win = int(rate / fps)
    f = np.fft.rfftfreq(win, 1.0 / rate)
    band = (f >= BAND[0]) & (f <= BAND[1])
    out = []
    for k in range(int(round((t1 - t0) * fps))):
        a = int((t0 + k / fps) * rate)
        seg = x[a : a + win]
        if len(seg) < win:
            seg = np.pad(seg, (0, win - len(seg)))
        mag = np.abs(np.fft.rfft(seg * np.hanning(win)))[band]
        out.append(float((f[band] * mag).sum() / (mag.sum() + 1e-9)))
    c = np.array(out)
    return np.clip((c - BAND[0]) / (BAND[1] - BAND[0]), 0, 1)


def frame_curves(env, t0, t1, cent, hop=HOP, fps=FPS):
    """Bill opening 0..1 (fast attack, ~70 ms release, opens one frame ahead) and a slow throat puff."""
    n = int(round((t1 - t0) * fps))
    peak = np.percentile(env[int(t0 / hop) : int(t1 / hop)], 97) + 1e-9
    raw = np.zeros(n)
    for k in range(n):
        a, b = int((t0 + k / fps) / hop), int((t0 + (k + 1) / fps) / hop)
        raw[k] = env[a : max(b, a + 1)].max() / peak
    raw = np.clip(raw, 0, 1) ** 0.7 * (0.75 + 0.25 * cent[:n])
    jaw = np.zeros(n)
    rel = np.exp(-1.0 / (0.07 * fps))
    for k in range(n):
        target = raw[min(k + 1, n - 1)]
        jaw[k] = target if target > (jaw[k - 1] if k else 0) else max(target, (jaw[k - 1] if k else 0) * rel)
    slow = np.convolve(raw, np.ones(5) / 5, mode="same")
    return np.round(jaw, 4).tolist(), np.round(slow, 4).tolist()


def spectrogram_png(x, rate, path, fmax=11000.0, width=900, height=260):
    win = 1024
    hop = max(1, (len(x) - win) // width)
    f = np.fft.rfftfreq(win, 1.0 / rate)
    keep = f <= fmax
    cols = []
    for k in range(width):
        seg = x[k * hop : k * hop + win]
        if len(seg) < win:
            seg = np.pad(seg, (0, win - len(seg)))
        cols.append(20 * np.log10(np.abs(np.fft.rfft(seg * np.hanning(win)))[keep] + 1e-6))
    S = np.array(cols).T
    S = np.clip((S - (S.max() - 70)) / 70, 0, 1)
    rows = np.linspace(0, S.shape[0] - 1, height).astype(int)
    img = np.repeat(S[rows][..., None], 3, -1) ** 0.8
    bt.np_image(img, "dbg_song_spec", path=path)


def search(folder, candidates_json=os.path.join(bt.AUDIO_SOURCES, "candidates.json")):
    """Re-pick a phrase: scan downloaded recordings (XC*.mp3 / .wav named by xeno-canto id, e.g. fetched
    from candidates.json urls) and report the cleanest phrase. Copy its excerpt into sources/audio and
    pin it in song.json to use it."""
    meta = {m["xc"]: m for m in json.load(open(candidates_json, encoding="utf-8-sig"))}
    best, report = None, []
    for name in sorted(os.listdir(folder)):
        stem, ext = os.path.splitext(name)
        if ext.lower() not in (".mp3", ".wav", ".flac", ".ogg"):
            continue
        x, rate = decode(os.path.join(folder, name))
        env_db = 20 * np.log10(envelope(bandpass(x, rate, *BAND), rate))
        clip = float(np.mean(np.abs(x) > 0.985))
        ph = phrases(env_db, float(np.percentile(env_db, 20)))
        report.append("%s %4.0fs %dHz phrases %d best snr %.1f clip %.4f" % (
            stem, len(x) / rate, rate, len(ph), max([p[2] for p in ph], default=0), clip))
        for t0, t1, snr in ph:
            score = snr - 4.0 * abs((t1 - t0) - 1.7) - 400 * clip
            if best is None or score > best[0]:
                best = (score, stem, t0, t1, snr)
    if best is None:
        return "no clean phrase found:\n" + "\n".join(report)
    _s, xc, t0, t1, snr = best
    who = meta.get(xc, {}).get("who", "?")
    return "\n".join(report) + "\nbest: %s (%s) %.2f-%.2fs, snr %.1f dB" % (xc, who, t0, t1, snr)


def run():
    with open(SONG_JSON, encoding="utf-8") as f:
        cfg = json.load(f)
    x, rate = decode(os.path.join(bt.AUDIO_SOURCES, cfg["file"]))
    xb = bandpass(x, rate, *BAND)
    env = envelope(xb, rate)
    if cfg.get("phrase"):
        t0, t1 = (float(t) for t in cfg["phrase"])
        snr = float("nan")
    else:
        env_db = 20 * np.log10(env)
        found = phrases(env_db, float(np.percentile(env_db, 20)))
        if not found:
            raise RuntimeError("no clean call phrase in %s; pin one in song.json" % cfg["file"])
        t0, t1, snr = max(found, key=lambda p: p[2] - 4.0 * abs((p[1] - p[0]) - 1.7))
    xc = cfg["xcId"]
    a, b = max(0.0, t0 - PRE), min(len(x) / rate, t1 + POST)
    clip_x = denoise(bandpass(x, rate, 2300.0, 14000.0)[int(a * rate) : int(b * rate)].copy())
    n_in, n_out = int(0.04 * rate), int(0.12 * rate)
    clip_x[:n_in] *= np.linspace(0, 1, n_in)
    clip_x[-n_out:] *= np.linspace(1, 0, n_out)
    clip_x *= 0.84 / (np.abs(clip_x).max() + 1e-9)
    os.makedirs(os.path.dirname(OUT_WAV), exist_ok=True)
    with wave.open(OUT_WAV, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(clip_x, -1, 1) * 32767).astype("<i2").tobytes())
    cent = centroid_track(xb, rate, t0, t1)
    jaw, throat = frame_curves(env, t0, t1, cent)
    cues = {
        "src": cfg["web"],
        "duration": round(len(clip_x) / rate, 4),
        "onset": round(t0 - a, 4),  # first note, seconds into the file
        "singing": round(t1 - t0, 4),
        "rate": rate,
        "fps": FPS,
        "jaw": jaw,
        "throat": throat,
        "xcId": xc,
        "recordist": cfg["recordist"],
        "license": cfg["license"],
        "sourceUrl": cfg["sourceUrl"],
        "scientific": cfg["scientific"],
        "sourceStart": round(cfg.get("fileStart", 0.0) + a, 3),  # in the original recording
    }
    with open(CUES, "w", encoding="utf-8") as f:
        json.dump(cues, f, ensure_ascii=False)
    spectrogram_png(clip_x, rate, os.path.join(bt.DEBUG, "song_spectrogram.png"))
    return "%s %.2f-%.2fs of %s -> %.2fs file, %d frames of calling" % (
        xc, t0, t1, cfg["file"], cues["duration"], len(jaw))
