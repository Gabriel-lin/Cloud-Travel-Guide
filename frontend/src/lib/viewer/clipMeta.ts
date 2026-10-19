import type { AnimationClip } from "three";

/**
 * glTF 动画片段的附加信息(写在 `animations[i].extras`,GLTFLoader 会放进 `clip.userData`)。
 * 由美术管线(frontend/art/bluethroat/pipeline/s10_export.py)注入。
 */

/** 片段内某一时刻起播的一段声音(片段本地时间,秒)。 */
export type AudioCue = {
  type: "audio";
  id: string;
  src: string;
  at: number;
  /** 声音文件时长(秒);缺省时按播放到文件结束处理。 */
  duration?: number;
  gain?: number;
};

/** 录音出处,供署名展示。 */
export type ClipAudioCredit = {
  recordist: string;
  license: string;
  sourceUrl: string;
  xcId?: string;
};

export type ClipMeta = {
  loop: boolean;
  cues: AudioCue[];
  /** 具名时间点(秒),如 songStart / walkBack。 */
  markers: Record<string, number>;
  audio?: ClipAudioCredit;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function readCue(v: unknown): AudioCue | null {
  if (!isRecord(v) || v.type !== "audio") return null;
  if (typeof v.src !== "string" || !v.src || !finite(v.at)) return null;
  return {
    type: "audio",
    id: typeof v.id === "string" && v.id ? v.id : v.src,
    src: v.src,
    at: Math.max(0, v.at),
    duration: finite(v.duration) && v.duration > 0 ? v.duration : undefined,
    gain: finite(v.gain) ? v.gain : undefined,
  };
}

/** 读取片段元数据;字段缺失或格式不对时回退到"循环、无声、无标记"。 */
export function readClipMeta(clip: AnimationClip): ClipMeta {
  const data: unknown = clip.userData;
  const extras = isRecord(data) ? data : {};
  const cues = Array.isArray(extras.cues)
    ? extras.cues.map(readCue).filter((c): c is AudioCue => c !== null)
    : [];
  const markers: Record<string, number> = {};
  if (isRecord(extras.markers)) {
    for (const [name, t] of Object.entries(extras.markers)) {
      if (finite(t)) markers[name] = t;
    }
  }
  const credit = extras.audio;
  const audio =
    isRecord(credit) &&
    typeof credit.recordist === "string" &&
    typeof credit.license === "string" &&
    typeof credit.sourceUrl === "string"
      ? {
          recordist: credit.recordist,
          license: credit.license,
          sourceUrl: credit.sourceUrl,
          xcId: typeof credit.xcId === "string" ? credit.xcId : undefined,
        }
      : undefined;
  return { loop: extras.loop !== false, cues, markers, audio };
}
