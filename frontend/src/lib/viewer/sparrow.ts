import type { ModelLoadOptions, ModelLoadResult, ModelSource } from "../loaders";

import { AnimationClip, LoopOnce, type AnimationAction } from "three";

import { ClipPlayer, type ClipPlayerOptions, type CueAudioSink, type CueVoice } from "./ClipPlayer";

/**
 * 树麻雀 glTF,由 frontend/art/sparrow 管线从 sources/ 生成(`npm run art:sparrow` 重建并校验)。
 *
 * - Call(约 3.1 s,循环):警觉环顾、吸气鼓喉,随录音连叫四声 "chip",每声翘尾;
 *   片段 extras 带叫声的音频提示,ClipPlayer 会让叫声与张嘴同步。
 * - HopForage(3.2 s,循环):双脚并跳转向、低头啄食两次,跳回原位再啄一次。
 * - Fly(2.63 s,循环):原地振翅-收翅滑翔的波状飞行,双脚收在腹下,两次偏头。
 */
export const SPARROW_MODEL = {
  src: "/models/sparrow.glb",
  clips: ["Call", "HopForage", "Fly"] as const,
  /** Bones the call moves; Fly / HopForage never key them, so Call's mouth tracks layer over them. */
  mouthBones: ["jaw", "bill_upper", "throat"] as const,
  /** EntityInspectPanel 未指定片段时会请求 "idle",映射到这里。 */
  defaultClip: "HopForage",
} as const;

export type SparrowClip = (typeof SPARROW_MODEL.clips)[number];

/** Call 里的叫声录音(与 GLB extras 一致),署名展示用。 */
export const SPARROW_CALL = {
  src: "/audio/birds/sparrow/tree-sparrow-call-01.wav",
  xcId: "XC776834",
  recordist: "Sonothèque ADVL",
  license: "http://creativecommons.org/publicdomain/zero/1.0/",
  sourceUrl: "https://data.biodiversitydata.nl/xeno-canto/observation/XC776834",
  scientific: "Passer montanus",
} as const;

type ModelLoaderLike = {
  load(source: ModelSource, options?: ModelLoadOptions): Promise<ModelLoadResult>;
};

export type LoadSparrowOptions = ClipPlayerOptions & {
  /** 默认 SPARROW_MODEL.src;也可传已下载的二进制(需同时给 load.format = "glb")。 */
  src?: ModelSource;
  load?: ModelLoadOptions;
};

/**
 * 用项目的模型加载器(SceneViewer.loaders / GltfModelLoader)加载树麻雀并创建片段控制器。
 *
 * @example
 * ```ts
 * const sink = WebAudioCueSink.fromRuntime(audioRuntime);
 * const { model, player } = await loadSparrow(viewer.loaders, { audio: sink });
 * viewer.add(model.object);
 * viewer.addUpdatable(player);
 * player.play("Call");              // 鸣叫,叫声随片段自动起止
 * player.play("HopForage");         // 地面跳跃觅食
 * player.play("Fly", { fade: 0.4 }); // 切到飞行
 * player.command("pause");          // 与 EntityInspectPanel.onPlayClip 约定一致
 * ```
 */
export async function loadSparrow(
  loader: ModelLoaderLike,
  options: LoadSparrowOptions = {},
): Promise<{ model: ModelLoadResult; player: ClipPlayer; call: SparrowCallLayer }> {
  const { src, load, ...playerOptions } = options;
  const model = await loader.load(src ?? SPARROW_MODEL.src, load);
  const player = new ClipPlayer(model.object, model.animations, {
    ...playerOptions,
    aliases: { idle: SPARROW_MODEL.defaultClip, ...playerOptions.aliases },
  });
  const missing = SPARROW_MODEL.clips.filter((c) => !player.has(c));
  if (missing.length > 0) {
    player.dispose();
    model.dispose();
    throw new Error(`[sparrow] ${model.source} 缺少动画片段: ${missing.join(", ")}`);
  }
  const call = new SparrowCallLayer(player, model.animations, playerOptions.audio ?? null);
  return { model, player, call };
}

/**
 * Plays the call over whatever body clip is running (HopForage, Fly, idle): a mouth layer is built at
 * runtime from the Call clip's bill, jaw and throat tracks (Fly / HopForage never key those bones), so it
 * mixes on the same mixer without overriding the body, and the
 * call recording starts at the Call clip's cue time, synced to the mouth. When the body clip is Call itself
 * the full clip already carries the mouth and the sound, so call() does nothing.
 *
 * Add it to the viewer after the player: `viewer.addUpdatable(player); viewer.addUpdatable(call);`
 */
export class SparrowCallLayer {
  private readonly clip: AnimationClip | null;
  private action: AnimationAction | null = null;
  private voice: CueVoice | null = null;
  private started = false;

  constructor(
    private readonly player: ClipPlayer,
    animations: AnimationClip[],
    private readonly audio: CueAudioSink | null,
  ) {
    this.clip = mouthLayer(animations);
  }

  get available(): boolean {
    return this.clip !== null;
  }

  get active(): boolean {
    return this.action !== null && this.action.isRunning();
  }

  /** Time inside the mouth clip (s), or null when idle. */
  get time(): number | null {
    return this.active ? this.action!.time : null;
  }

  call(): boolean {
    if (!this.clip || this.player.current === "Call") return false;
    this.stop();
    const a = this.player.mixer.clipAction(this.clip);
    a.reset();
    a.setLoop(LoopOnce, 1);
    a.clampWhenFinished = false;
    a.setEffectiveWeight(1);
    a.play();
    this.action = a;
    this.started = false;
    return true;
  }

  stop(): void {
    this.voice?.stop();
    this.voice = null;
    this.action?.stop();
    this.action = null;
  }

  /** Call after player.update(): the mixer has already advanced the mouth clip. */
  update(_delta: number): void {
    const a = this.action;
    if (!a) return;
    if (!a.isRunning()) {
      this.action = null;
      return;
    }
    const cue = this.player.meta("Call")?.cues[0];
    if (!this.started && cue && this.audio && a.time >= cue.at) {
      this.voice = this.audio.start(cue, a.time - cue.at, 1);
      this.started = this.voice !== null;
    }
  }

  dispose(): void {
    this.stop();
  }
}

/** Call's tracks for the mouth bones only, as its own clip (same timeline as Call). */
export function mouthLayer(animations: AnimationClip[]): AnimationClip | null {
  const call = animations.find((c) => c.name === "Call");
  if (!call) return null;
  const bones: readonly string[] = SPARROW_MODEL.mouthBones;
  const tracks = call.tracks.filter((t) => bones.includes(t.name.split(".")[0]!)).map((t) => t.clone());
  return tracks.length ? new AnimationClip("Call:mouth", call.duration, tracks) : null;
}
