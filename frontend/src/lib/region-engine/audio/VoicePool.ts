import type { AudioBusId, SpatialPlayRequest } from "./types";

type BusMap = Record<Exclude<AudioBusId, "master">, GainNode>;

type Voice = {
  gain: GainNode;
  panner: PannerNode;
  source: AudioBufferSourceNode | null;
  playing: boolean;
  priority: number;
  startAt: number;
  stopTimer: number;
};

const VOICE_CAP = 18;

/**
 * 空间声部池:预连 Panner+Gain,播放时只新建 BufferSource。
 * 超额时按优先级/开声时间抢占,避免鸟群把声卡打满。
 */
export class VoicePool {
  private readonly voices: Voice[] = [];
  private disposed = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly buses: BusMap,
  ) {
    for (let i = 0; i < VOICE_CAP; i++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 360;
      panner.coneOuterGain = 1;
      panner.connect(gain);
      this.voices.push({
        gain,
        panner,
        source: null,
        playing: false,
        priority: 0,
        startAt: 0,
        stopTimer: 0,
      });
    }
  }

  play(req: SpatialPlayRequest): boolean {
    if (this.disposed) return false;
    const voice = this.acquire(req.priority ?? 0);
    if (!voice) return false;
    this.stopVoice(voice, 0.012);

    const now = this.ctx.currentTime;
    const offset = Math.max(0, req.offset ?? 0);
    const maxDur = Math.max(0.05, req.buffer.duration - offset);
    const dur = Math.min(req.duration ?? maxDur, maxDur);
    const bus = this.buses[req.bus === "master" ? "birds" : req.bus];

    voice.gain.disconnect();
    voice.gain.connect(bus);

    const p = voice.panner;
    p.refDistance = req.refDistance;
    p.maxDistance = req.maxDistance;
    p.rolloffFactor = req.rolloff;
    this.setPannerPos(p, req.x, req.y, req.z);

    const g = voice.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(req.gain, now + 0.016);
    const fadeOut = Math.min(0.09, dur * 0.22);
    g.setValueAtTime(req.gain, now + Math.max(0.02, dur - fadeOut));
    g.linearRampToValueAtTime(0, now + dur);

    const src = this.ctx.createBufferSource();
    src.buffer = req.buffer;
    src.connect(voice.panner);
    src.start(now, offset, dur);
    src.stop(now + dur + 0.03);
    src.onended = () => {
      if (voice.source === src) this.release(voice);
    };

    voice.source = src;
    voice.playing = true;
    voice.priority = req.priority ?? 0;
    voice.startAt = now;
    voice.stopTimer = window.setTimeout(() => this.release(voice), (dur + 0.08) * 1000);
    return true;
  }

  stopAll(fade = 0.04): void {
    for (const v of this.voices) this.stopVoice(v, fade);
  }

  dispose(): void {
    this.disposed = true;
    for (const v of this.voices) {
      this.stopVoice(v, 0);
      v.gain.disconnect();
      v.panner.disconnect();
    }
    this.voices.length = 0;
  }

  private acquire(priority: number): Voice | null {
    for (const v of this.voices) {
      if (!v.playing) return v;
    }
    let worst: Voice | null = null;
    for (const v of this.voices) {
      if (!worst) {
        worst = v;
        continue;
      }
      if (v.priority < worst.priority) worst = v;
      else if (v.priority === worst.priority && v.startAt < worst.startAt) worst = v;
    }
    if (!worst || worst.priority > priority) return null;
    return worst;
  }

  private release(voice: Voice): void {
    if (voice.stopTimer) {
      clearTimeout(voice.stopTimer);
      voice.stopTimer = 0;
    }
    if (voice.source) {
      try {
        voice.source.onended = null;
        voice.source.disconnect();
      } catch {
        /* already disconnected */
      }
      voice.source = null;
    }
    voice.playing = false;
    voice.priority = 0;
  }

  private stopVoice(voice: Voice, fade: number): void {
    if (!voice.playing && !voice.source) return;
    const now = this.ctx.currentTime;
    if (fade > 0) {
      const g = voice.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + fade);
    }
    if (voice.source) {
      try {
        voice.source.stop(now + Math.max(fade, 0.001));
      } catch {
        /* already stopped */
      }
    }
    this.release(voice);
  }

  private setPannerPos(panner: PannerNode, x: number, y: number, z: number): void {
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
      return;
    }
    panner.setPosition(x, y, z);
  }
}
