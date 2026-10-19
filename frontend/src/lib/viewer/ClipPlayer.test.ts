import { AnimationClip, Object3D, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";

import { ClipPlayer, type ClipPlayerEvent, type CueAudioSink, type CueVoice } from "./ClipPlayer";
import type { AudioCue } from "./clipMeta";

const DT = 1 / 30;

class FakeVoice implements CueVoice {
  stopped = false;

  constructor(
    public pos: number,
    private readonly length: number,
  ) {}

  advance(dt: number): void {
    if (!this.stopped) this.pos += dt;
  }

  position(): number | null {
    return this.stopped || this.pos >= this.length ? null : this.pos;
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeSink implements CueAudioSink {
  ready = true;
  readonly starts: { cue: AudioCue; offset: number; rate: number }[] = [];
  readonly voices: FakeVoice[] = [];

  start(cue: AudioCue, offset: number, rate: number): CueVoice | null {
    if (!this.ready) return null;
    const voice = new FakeVoice(offset, cue.duration ?? 10);
    this.starts.push({ cue, offset, rate });
    this.voices.push(voice);
    return voice;
  }

  tick(dt: number): void {
    for (const v of this.voices) v.advance(dt);
  }

  get live(): FakeVoice[] {
    return this.voices.filter((v) => v.position() !== null);
  }
}

function setup(sink: CueAudioSink | null = new FakeSink()) {
  const root = new Object3D();
  const bone = new Object3D();
  bone.name = "b";
  root.add(bone);
  const sing = new AnimationClip("Sing", 4, [new VectorKeyframeTrack("b.position", [0, 4], [0, 0, 0, 4, 0, 0])]);
  sing.userData = {
    loop: true,
    cues: [{ type: "audio", id: "song", src: "/song.wav", at: 1, duration: 2 }],
    markers: { mid: 2 },
  };
  const fly = new AnimationClip("Fly", 2, [new VectorKeyframeTrack("b.position", [0, 2], [0, 0, 0, 0, 2, 0])]);
  fly.userData = { loop: true, cues: [], markers: {} };
  const player = new ClipPlayer(root, [sing, fly], { audio: sink, aliases: { idle: "Sing" }, fade: 0 });
  return { player, bone };
}

function run(player: ClipPlayer, sink: FakeSink | null, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    player.update(DT);
    sink?.tick(DT);
  }
}

describe("ClipPlayer", () => {
  it("starts the song when the playhead reaches its cue, offset by the frame overshoot", () => {
    const sink = new FakeSink();
    const { player } = setup(sink);
    expect(player.play("Sing")).toBe(true);
    run(player, sink, 0.9);
    expect(sink.starts).toHaveLength(0);
    run(player, sink, 0.2);
    expect(sink.starts).toHaveLength(1);
    expect(sink.starts[0]!.offset).toBeGreaterThanOrEqual(0);
    expect(sink.starts[0]!.offset).toBeLessThan(DT + 1e-6);
  });

  it("pause stops the song; resume restarts it from the paused playhead", () => {
    const sink = new FakeSink();
    const { player } = setup(sink);
    player.play("Sing");
    run(player, sink, 1.5);
    player.pause();
    expect(sink.live).toHaveLength(0);
    const t = player.time;
    run(player, sink, 1);
    expect(player.time).toBeCloseTo(t, 6);
    player.resume();
    expect(sink.starts).toHaveLength(2);
    expect(sink.starts[1]!.offset).toBeCloseTo(t - 1, 6);
  });

  it("replays the cue once per loop", () => {
    const sink = new FakeSink();
    const { player } = setup(sink);
    player.play("Sing");
    run(player, sink, 9.5);
    expect(sink.starts).toHaveLength(3);
  });

  it("switching clips stops the song; 'idle' maps to the default clip", () => {
    const sink = new FakeSink();
    const { player } = setup(sink);
    player.command("Sing");
    run(player, sink, 1.5);
    expect(sink.live).toHaveLength(1);
    player.command("Fly");
    expect(player.current).toBe("Fly");
    expect(sink.live).toHaveLength(0);
    player.command("idle");
    expect(player.current).toBe("Sing");
  });

  it("follows the inspect panel contract: clip name plays, 'pause' pauses, the same name resumes", () => {
    const sink = new FakeSink();
    const { player, bone } = setup(sink);
    player.command("Sing");
    run(player, sink, 1.2);
    player.command("pause");
    expect(player.paused).toBe(true);
    const x = bone.position.x;
    run(player, sink, 0.5);
    expect(bone.position.x).toBeCloseTo(x, 6);
    player.command("Sing");
    expect(player.paused).toBe(false);
    run(player, sink, 0.5);
    expect(bone.position.x).toBeGreaterThan(x);
  });

  it("joins late-loading audio at the current playhead", () => {
    const sink = new FakeSink();
    sink.ready = false;
    const { player } = setup(sink);
    player.play("Sing");
    run(player, sink, 1.5);
    expect(sink.starts).toHaveLength(0);
    sink.ready = true;
    run(player, sink, DT);
    expect(sink.starts).toHaveLength(1);
    expect(sink.starts[0]!.offset).toBeCloseTo(player.time - 1, 6);
  });

  it("seeking into the cue starts the song at the matching offset", () => {
    const sink = new FakeSink();
    const { player } = setup(sink);
    player.play("Sing");
    player.seek(2.5);
    expect(sink.starts).toHaveLength(1);
    expect(sink.starts[0]!.offset).toBeCloseTo(1.5, 6);
  });

  it("re-aligns the song when it drifts from the animation", () => {
    const sink = new FakeSink();
    const { player } = setup(sink);
    player.play("Sing");
    run(player, sink, 1.5);
    sink.voices[0]!.pos += 0.5;
    run(player, sink, DT);
    expect(sink.voices[0]!.stopped).toBe(true);
    expect(sink.starts).toHaveLength(2);
    expect(sink.starts[1]!.offset).toBeCloseTo(player.time - 1, 6);
  });

  it("emits markers when crossed, including across the loop wrap", () => {
    const sink = new FakeSink();
    const { player } = setup(sink);
    const markers: ClipPlayerEvent[] = [];
    player.on((e) => {
      if (e.type === "marker") markers.push(e);
    });
    player.play("Sing");
    run(player, sink, 4.5);
    expect(markers).toHaveLength(1);
    run(player, sink, 1.7);
    expect(markers).toHaveLength(2);
  });

  it("plays silently without an audio sink", () => {
    const { player, bone } = setup(null);
    player.play("Fly");
    run(player, null, 1);
    expect(bone.position.y).toBeCloseTo(1, 1);
    player.dispose();
    expect(player.current).toBeNull();
  });
});
