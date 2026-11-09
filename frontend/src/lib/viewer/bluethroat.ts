import type { ModelLoadOptions, ModelLoadResult, ModelSource } from "../loaders";

import { ClipPlayer, type ClipPlayerOptions } from "./ClipPlayer";

/**
 * 蓝喉歌鸲 glTF,由 frontend/art/bluethroat 管线从 sources/ 生成(`npm run art:bluethroat` 重建并校验)。
 *
 * - WalkSing(7 s,循环):枝上走三步、停下歪头、仰头鸣唱,再走回原位;
 *   片段 extras 带鸣唱的音频提示,ClipPlayer 会让歌声与张嘴同步。
 * - Fly(2.63 s,循环):原地振翅-收翅滑翔的波状飞行,双脚向后收在腹下,两次偏头。
 */
export const BLUETHROAT_MODEL = {
  src: "/models/bluethroat.glb",
  clips: ["WalkSing", "Fly"] as const,
  /** EntityInspectPanel 未指定片段时会请求 "idle",映射到这里。 */
  defaultClip: "WalkSing",
} as const;

export type BluethroatClip = (typeof BLUETHROAT_MODEL.clips)[number];

/** WalkSing 里的鸣唱录音(与 GLB extras 一致),署名展示用。 */
export const BLUETHROAT_SONG = {
  src: "/audio/birds/bluethroat/song-01.wav",
  xcId: "XC1168600",
  recordist: "Stanislas Wroza",
  license: "http://creativecommons.org/licenses/by-nc/4.0/",
  sourceUrl: "https://data.biodiversitydata.nl/xeno-canto/observation/XC1168600",
  scientific: "Luscinia svecica svecica",
} as const;

type ModelLoaderLike = {
  load(source: ModelSource, options?: ModelLoadOptions): Promise<ModelLoadResult>;
};

export type LoadBluethroatOptions = ClipPlayerOptions & {
  /** 默认 BLUETHROAT_MODEL.src;也可传已下载的二进制(需同时给 load.format = "glb")。 */
  src?: ModelSource;
  load?: ModelLoadOptions;
};

/**
 * 用项目的模型加载器(SceneViewer.loaders / GltfModelLoader)加载蓝喉歌鸲并创建片段控制器。
 *
 * @example
 * ```ts
 * const sink = WebAudioCueSink.fromRuntime(audioRuntime);
 * const { model, player } = await loadBluethroat(viewer.loaders, { audio: sink });
 * viewer.add(model.object);
 * viewer.addUpdatable(player);
 * player.play("WalkSing");          // 走几步后鸣唱,歌声随片段自动起止
 * player.play("Fly", { fade: 0.4 }); // 切到飞行
 * player.command("pause");          // 与 EntityInspectPanel.onPlayClip 约定一致
 * ```
 */
export async function loadBluethroat(
  loader: ModelLoaderLike,
  options: LoadBluethroatOptions = {},
): Promise<{ model: ModelLoadResult; player: ClipPlayer }> {
  const { src, load, ...playerOptions } = options;
  const model = await loader.load(src ?? BLUETHROAT_MODEL.src, load);
  const player = new ClipPlayer(model.object, model.animations, {
    ...playerOptions,
    aliases: { idle: BLUETHROAT_MODEL.defaultClip, ...playerOptions.aliases },
  });
  const missing = BLUETHROAT_MODEL.clips.filter((c) => !player.has(c));
  if (missing.length > 0) {
    player.dispose();
    model.dispose();
    throw new Error(`[bluethroat] ${model.source} 缺少动画片段: ${missing.join(", ")}`);
  }
  return { model, player };
}
