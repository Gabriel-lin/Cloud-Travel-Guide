import type { AudioCue } from "./clipMeta";
import type { CueAudioSink, CueVoice } from "./ClipPlayer";

export type WebAudioCueSinkOptions = {
  /** 输出节点,默认 ctx.destination(可接项目音频运行时的鸟鸣总线)。 */
  destination?: AudioNode | null;
  gain?: number;
  /** 自定义加载解码(如复用 AssetBank.load 的缓存)。 */
  load?: (url: string) => Promise<AudioBuffer | null>;
};

/** 结构类型:项目的 AudioRuntime 满足它,这里不直接依赖 region-engine。 */
export type CueAudioRuntimeLike = {
  readonly ctx: AudioContext | null;
  readonly assets: { load(url: string): Promise<AudioBuffer | null> } | null;
  busNode?(bus: "birds" | "ambience" | "ui"): AudioNode | null;
};

/**
 * 用 Web Audio 播放片段声音。缓冲未解码完或 AudioContext 仍被自动播放策略挂起时
 * start() 返回 null,ClipPlayer 会在下一帧按当时进度重试,所以解锁后声音从正确位置接上。
 */
export class WebAudioCueSink implements CueAudioSink {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>();
  /** 加载失败的地址不再每帧重试。 */
  private readonly failed = new Set<string>();

  constructor(
    readonly ctx: AudioContext,
    private readonly options: WebAudioCueSinkOptions = {},
  ) {}

  /** 接到项目音频运行时的某条总线(默认鸟鸣),无音频上下文时返回 null。 */
  static fromRuntime(
    runtime: CueAudioRuntimeLike,
    bus: "birds" | "ambience" | "ui" = "birds",
    gain?: number,
  ): WebAudioCueSink | null {
    if (!runtime.ctx) return null;
    const assets = runtime.assets;
    return new WebAudioCueSink(runtime.ctx, {
      destination: runtime.busNode?.(bus) ?? null,
      load: assets ? (url) => assets.load(url) : undefined,
      gain,
    });
  }

  async preload(src: string): Promise<void> {
    await this.fetch(src);
  }

  start(cue: AudioCue, offset: number, rate: number): CueVoice | null {
    const ctx = this.ctx;
    if (ctx.state !== "running") return null;
    const buffer = this.buffers.get(cue.src);
    if (!buffer) {
      void this.fetch(cue.src);
      return null;
    }
    if (offset >= buffer.duration) return null;

    const gain = ctx.createGain();
    gain.gain.value = (this.options.gain ?? 1) * (cue.gain ?? 1);
    gain.connect(this.options.destination ?? ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(gain);
    source.start(ctx.currentTime, offset);

    let ended = false;
    let base = offset;
    let baseAt = ctx.currentTime;
    let speed = rate;
    source.onended = () => {
      ended = true;
      try {
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    const position = (): number | null => {
      if (ended) return null;
      const p = base + (ctx.currentTime - baseAt) * speed;
      return p >= buffer.duration ? null : p;
    };
    return {
      position,
      stop: (fade = 0.05) => {
        if (ended) return;
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + Math.max(fade, 0.005));
        try {
          source.stop(now + Math.max(fade, 0.005) + 0.01);
        } catch {
          /* already stopped */
        }
      },
      setRate: (next) => {
        const p = position();
        if (p === null) return;
        base = p;
        baseAt = ctx.currentTime;
        speed = next;
        source.playbackRate.setValueAtTime(next, ctx.currentTime);
      },
    };
  }

  private fetch(src: string): Promise<AudioBuffer | null> {
    const hit = this.buffers.get(src);
    if (hit) return Promise.resolve(hit);
    if (this.failed.has(src)) return Promise.resolve(null);
    const inflight = this.pending.get(src);
    if (inflight) return inflight;
    const job = (this.options.load ? this.options.load(src) : this.decode(src))
      .then((buf) => {
        if (buf) this.buffers.set(src, buf);
        else this.failed.add(src);
        return buf;
      })
      .catch((err: unknown) => {
        console.warn(`[clip-audio] load failed ${src}`, err);
        this.failed.add(src);
        return null;
      })
      .finally(() => this.pending.delete(src));
    this.pending.set(src, job);
    return job;
  }

  private async decode(src: string): Promise<AudioBuffer | null> {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return this.ctx.decodeAudioData(await res.arrayBuffer());
  }
}
