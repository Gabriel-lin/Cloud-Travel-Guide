import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from "three";

import { readClipMeta, type AudioCue, type ClipMeta } from "./clipMeta";
import type { SceneUpdatable } from "./SceneViewer";

/** 正在播放的一段声音。 */
export interface CueVoice {
  stop(fade?: number): void;
  /** 当前播到文件内第几秒;已播完返回 null。 */
  position(): number | null;
  setRate?(rate: number): void;
}

/** 片段声音的输出端(Web Audio、项目音频运行时或测试替身)。 */
export interface CueAudioSink {
  preload?(src: string): Promise<void>;
  /** 从文件内 offset 秒处开始播;资源未就绪或无法出声时返回 null,播放器下一帧会按新进度重试。 */
  start(cue: AudioCue, offset: number, rate: number): CueVoice | null;
}

export type ClipPlayerEvent =
  | { type: "marker"; clip: string; marker: string; time: number }
  | { type: "cue"; clip: string; cue: AudioCue; offset: number }
  | { type: "loop"; clip: string }
  | { type: "finished"; clip: string };

export type ClipPlayerOptions = {
  /** 声音输出;不传则只放动画。 */
  audio?: CueAudioSink | null;
  /** 切换片段时的交叉淡化(秒),默认 0.35。 */
  fade?: number;
  /** 片段别名,如 { idle: "WalkSing" }。 */
  aliases?: Record<string, string>;
};

export type PlayOptions = {
  fade?: number;
  /** 覆盖片段元数据里的循环设置。 */
  loop?: boolean;
  timeScale?: number;
  /** 起始时间(秒)。 */
  from?: number;
};

const VOICE_FADE = 0.06;
/** 声音与动画进度偏差超过该值(秒)就按动画重新对齐(如标签页切回后)。 */
const RESYNC = 0.12;

/**
 * glTF 动画片段控制器:按名播放 / 暂停 / 切换 / 跳转,并按片段元数据里的音频提示
 * 让声音与动画同进同退(暂停、跳转、循环、切片段、迟到的音频加载都会重新对齐)。
 *
 * 实现 {@link SceneUpdatable},可直接交给 `SceneViewer.addUpdatable`;
 * `command()` 兼容 EntityInspectPanel 的 onPlayClip(片段名播放,"pause" 暂停)。
 */
export class ClipPlayer implements SceneUpdatable {
  readonly mixer: AnimationMixer;

  private readonly clips = new Map<string, AnimationClip>();
  private readonly metas = new Map<string, ClipMeta>();
  private readonly aliases: Record<string, string>;
  private readonly listeners = new Set<(e: ClipPlayerEvent) => void>();
  private readonly voices = new Map<string, CueVoice>();
  /** cue id -> 已在第几轮循环起播过(播完不在同一轮重播)。 */
  private readonly started = new Map<string, number>();
  private audio: CueAudioSink | null;
  private readonly defaultFade: number;
  private action: AnimationAction | null = null;
  private name: string | null = null;
  private fadingOut: AnimationAction | null = null;
  private fadeLeft = 0;
  private loopIndex = 0;
  private looped = false;
  /** 单次片段播完后 three.js 会把动作置为 paused 以停在末帧,此时再请求同一片段应从头播。 */
  private finished = false;
  private rate = 1;
  private disposed = false;

  constructor(
    private readonly root: Object3D,
    clips: readonly AnimationClip[],
    options: ClipPlayerOptions = {},
  ) {
    this.mixer = new AnimationMixer(root);
    for (const clip of clips) {
      this.clips.set(clip.name, clip);
      this.metas.set(clip.name, readClipMeta(clip));
    }
    this.aliases = options.aliases ?? {};
    this.audio = options.audio ?? null;
    this.defaultFade = options.fade ?? 0.35;
    this.mixer.addEventListener("loop", this.onLoop);
    this.mixer.addEventListener("finished", this.onFinished);
  }

  /** 全部片段名(导出顺序)。 */
  get names(): string[] {
    return [...this.clips.keys()];
  }

  get current(): string | null {
    return this.name;
  }

  get playing(): boolean {
    return Boolean(this.action && !this.action.paused && this.action.isRunning());
  }

  get paused(): boolean {
    return Boolean(this.action?.paused);
  }

  /** 当前片段内时间(秒)。 */
  get time(): number {
    return this.action?.time ?? 0;
  }

  has(clip: string): boolean {
    return this.resolve(clip) !== null;
  }

  meta(clip: string): ClipMeta | null {
    const name = this.resolve(clip);
    return name ? (this.metas.get(name) ?? null) : null;
  }

  duration(clip: string): number {
    const name = this.resolve(clip);
    return name ? (this.clips.get(name)?.duration ?? 0) : 0;
  }

  setAudio(audio: CueAudioSink | null): void {
    this.stopVoices();
    this.audio = audio;
  }

  /** 预加载全部片段用到的声音。 */
  async preloadAudio(): Promise<void> {
    const sink = this.audio;
    if (!sink?.preload) return;
    const srcs = new Set<string>();
    for (const meta of this.metas.values()) for (const cue of meta.cues) srcs.add(cue.src);
    await Promise.all([...srcs].map((s) => sink.preload?.(s)));
  }

  /** 从头(或 from)播放片段;与当前片段交叉淡化。找不到片段返回 false。 */
  play(clip: string, opts: PlayOptions = {}): boolean {
    if (this.disposed) return false;
    const name = this.resolve(clip);
    const source = name ? this.clips.get(name) : undefined;
    if (!name || !source) return false;
    const meta = this.metas.get(name);
    const prev = this.action;
    const next = this.mixer.clipAction(source);
    this.stopVoices();
    this.started.clear();
    next.reset();
    const loop = opts.loop ?? meta?.loop ?? true;
    next.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    this.rate = opts.timeScale ?? 1;
    next.setEffectiveTimeScale(this.rate);
    next.time = Math.min(Math.max(opts.from ?? 0, 0), source.duration);
    next.play();
    const fade = opts.fade ?? this.defaultFade;
    if (prev && prev !== next && fade > 0) {
      next.crossFadeFrom(prev, fade, false);
      this.finishFadeOut();
      this.fadingOut = prev;
      this.fadeLeft = fade;
    } else if (prev && prev !== next) {
      prev.stop();
    }
    this.action = next;
    this.name = name;
    this.loopIndex = 0;
    this.finished = false;
    this.mixer.update(0);
    this.syncAudio(next.time);
    return true;
  }

  pause(): void {
    if (!this.action || this.action.paused) return;
    this.action.paused = true;
    this.stopVoices();
  }

  resume(): void {
    if (!this.action || !this.action.paused) return;
    this.action.paused = false;
    this.started.clear();
    this.syncAudio(this.action.time);
  }

  stop(): void {
    this.stopVoices();
    this.finishFadeOut();
    this.action?.stop();
    this.action = null;
    this.name = null;
  }

  /** 跳到片段内某一时刻(秒);暂停状态下也会刷新姿态。 */
  seek(time: number): void {
    const action = this.action;
    if (!action) return;
    action.time = Math.min(Math.max(time, 0), action.getClip().duration);
    this.stopVoices();
    this.started.clear();
    this.mixer.update(0);
    if (!action.paused) this.syncAudio(action.time);
  }

  setTimeScale(scale: number): void {
    this.rate = scale;
    this.action?.setEffectiveTimeScale(scale);
    for (const v of this.voices.values()) v.setRate?.(scale);
  }

  /** EntityInspectPanel.onPlayClip 约定:片段名 → 播放(暂停中的同一片段则继续),"pause" → 暂停,"stop" → 停止。 */
  command(clip: string): boolean {
    if (clip === "pause") {
      this.pause();
      return true;
    }
    if (clip === "stop") {
      this.stop();
      return true;
    }
    const name = this.resolve(clip);
    if (name && name === this.name && this.action?.paused && !this.finished) {
      this.resume();
      return true;
    }
    return this.play(clip);
  }

  on(listener: (e: ClipPlayerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(delta: number): void {
    if (this.disposed) return;
    const action = this.action;
    const before = action ? action.time : 0;
    this.looped = false;
    this.mixer.update(delta);
    if (this.fadingOut) {
      this.fadeLeft -= delta;
      if (this.fadeLeft <= 0) this.finishFadeOut();
    }
    if (!action || action !== this.action || !this.name) return;
    const after = action.time;
    this.emitMarkers(before, after, action.getClip().duration);
    this.syncAudio(after);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.mixer.removeEventListener("loop", this.onLoop);
    this.mixer.removeEventListener("finished", this.onFinished);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.listeners.clear();
  }

  private resolve(clip: string): string | null {
    if (this.clips.has(clip)) return clip;
    const alias = this.aliases[clip];
    if (alias && this.clips.has(alias)) return alias;
    const lower = clip.toLowerCase();
    for (const name of this.clips.keys()) if (name.toLowerCase() === lower) return name;
    return null;
  }

  private syncAudio(t: number): void {
    const action = this.action;
    const meta = this.name ? this.metas.get(this.name) : undefined;
    if (!action || !meta || meta.cues.length === 0) return;
    if (!this.audio || action.paused || !action.isRunning()) {
      this.stopVoices();
      return;
    }
    const clipEnd = action.getClip().duration;
    for (const cue of meta.cues) {
      const end = cue.duration !== undefined ? cue.at + cue.duration : clipEnd;
      const live = this.voices.get(cue.id);
      if (t < cue.at || t >= end) {
        if (live) {
          live.stop(VOICE_FADE);
          this.voices.delete(cue.id);
        }
        continue;
      }
      const offset = t - cue.at;
      if (live) {
        const pos = live.position();
        if (pos === null) {
          this.voices.delete(cue.id);
          continue;
        }
        if (Math.abs(pos - offset) <= RESYNC) continue;
        live.stop(0.02);
        this.voices.delete(cue.id);
        this.started.delete(cue.id);
      }
      if (this.started.get(cue.id) === this.loopIndex) continue;
      const voice = this.audio.start(cue, offset, this.rate);
      if (!voice) continue;
      this.voices.set(cue.id, voice);
      this.started.set(cue.id, this.loopIndex);
      this.emit({ type: "cue", clip: this.name ?? "", cue, offset });
    }
  }

  private emitMarkers(before: number, after: number, duration: number): void {
    const meta = this.name ? this.metas.get(this.name) : undefined;
    if (!meta || !this.name) return;
    const wrapped = this.looped || after < before;
    for (const [marker, time] of Object.entries(meta.markers)) {
      const crossed = wrapped
        ? (time > before && time <= duration) || time <= after
        : time > before && time <= after;
      if (crossed) this.emit({ type: "marker", clip: this.name, marker, time });
    }
  }

  private stopVoices(fade = VOICE_FADE): void {
    for (const v of this.voices.values()) v.stop(fade);
    this.voices.clear();
  }

  private finishFadeOut(): void {
    if (!this.fadingOut) return;
    if (this.fadingOut !== this.action) this.fadingOut.stop();
    this.fadingOut = null;
    this.fadeLeft = 0;
  }

  private emit(e: ClipPlayerEvent): void {
    for (const l of this.listeners) l(e);
  }

  private readonly onLoop = (e: { action: AnimationAction }): void => {
    if (e.action !== this.action || !this.name) return;
    this.loopIndex += 1;
    this.looped = true;
    this.emit({ type: "loop", clip: this.name });
  };

  private readonly onFinished = (e: { action: AnimationAction }): void => {
    if (e.action !== this.action || !this.name) return;
    this.finished = true;
    this.stopVoices();
    this.emit({ type: "finished", clip: this.name });
  };
}
