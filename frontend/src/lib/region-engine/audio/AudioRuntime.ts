/**
 * Web Audio 运行时:上下文解锁、总线、听者、水下低通、空间声部池。
 *
 * 浏览器自动播放策略下 context 初始为 suspended,必须在指针/键盘手势里 resume。
 */

import type { PerspectiveCamera } from "three";

import { AssetBank } from "./AssetBank";
import type { AudioBusId, SpatialPlayRequest } from "./types";
import { VoicePool } from "./VoicePool";

export function createAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

export class AudioRuntime {
  readonly ctx: AudioContext | null;
  readonly assets: AssetBank | null;

  private master: GainNode | null = null;
  private underwater: BiquadFilterNode | null = null;
  private birds: GainNode | null = null;
  private ambience: GainNode | null = null;
  private ui: GainNode | null = null;
  private pool: VoicePool | null = null;
  private unlocked = false;
  private disposed = false;
  private visibilityBound = false;
  private readonly fwd = { x: 0, y: 0, z: -1 };
  private readonly up = { x: 0, y: 1, z: 0 };

  constructor(ctx: AudioContext | null = createAudioContext()) {
    this.ctx = ctx;
    this.assets = ctx ? new AssetBank(ctx) : null;
    if (!ctx) return;

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.underwater = ctx.createBiquadFilter();
    this.underwater.type = "lowpass";
    this.underwater.frequency.value = 18000;
    this.underwater.Q.value = 0.7;
    this.underwater.connect(this.master);
    this.master.connect(ctx.destination);

    this.birds = ctx.createGain();
    this.birds.gain.value = 0.88;
    this.birds.connect(this.underwater);
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.7;
    this.ambience.connect(this.underwater);
    this.ui = ctx.createGain();
    this.ui.gain.value = 1;
    this.ui.connect(this.master);

    this.pool = new VoicePool(ctx, {
      birds: this.birds,
      ambience: this.ambience,
      ui: this.ui,
    });

    this.bindVisibility();
  }

  get available(): boolean {
    return this.ctx !== null && !this.disposed;
  }

  /** 已解锁且正在跑,系统才真正出声。 */
  get active(): boolean {
    return this.available && this.unlocked && this.ctx?.state === "running";
  }

  setMasterGain(value: number): void {
    if (!this.master || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(Math.min(Math.max(value, 0), 1), now + 0.05);
  }

  setBusGain(bus: Exclude<AudioBusId, "master">, value: number): void {
    const node =
      bus === "birds" ? this.birds : bus === "ambience" ? this.ambience : this.ui;
    if (!node || !this.ctx) return;
    const now = this.ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.linearRampToValueAtTime(Math.min(Math.max(value, 0), 1.5), now + 0.05);
  }

  setUnderwater(on: boolean, depth = 0): void {
    if (!this.underwater || !this.ctx) return;
    const hz = on ? Math.max(380, 920 - Math.min(depth, 12) * 40) : 18000;
    const now = this.ctx.currentTime;
    this.underwater.frequency.cancelScheduledValues(now);
    this.underwater.frequency.exponentialRampToValueAtTime(Math.max(hz, 80), now + 0.18);
  }

  async resume(): Promise<void> {
    if (!this.ctx || this.disposed) return;
    try {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      if (this.ctx.state === "running") this.unlocked = true;
    } catch (err) {
      console.warn("[audio] resume failed", err);
    }
  }

  /**
   * 在画布/窗口上安装解锁手势。返回卸载函数。
   * pointerdown + keydown 覆盖 R3F 画布与键盘切换视角。
   */
  installUnlock(target: EventTarget): () => void {
    const onGesture = () => {
      void this.resume();
    };
    target.addEventListener("pointerdown", onGesture);
    target.addEventListener("keydown", onGesture);
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      target.removeEventListener("pointerdown", onGesture);
      target.removeEventListener("keydown", onGesture);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }

  syncListenerFromCamera(camera: PerspectiveCamera): void {
    if (!this.ctx || !this.active) return;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const lx = e[12];
    const ly = e[13];
    const lz = e[14];
    this.fwd.x = -e[8];
    this.fwd.y = -e[9];
    this.fwd.z = -e[10];
    this.up.x = e[4];
    this.up.y = e[5];
    this.up.z = e[6];
    this.setListener(lx, ly, lz, this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
  }

  playSpatial(req: SpatialPlayRequest): boolean {
    if (!this.active || !this.pool) return false;
    return this.pool.play(req);
  }

  stopAll(): void {
    this.pool?.stopAll();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unlocked = false;
    this.pool?.dispose();
    this.pool = null;
    this.assets?.dispose();
    try {
      this.birds?.disconnect();
      this.ambience?.disconnect();
      this.ui?.disconnect();
      this.underwater?.disconnect();
      this.master?.disconnect();
    } catch {
      /* graph already torn */
    }
    if (this.visibilityBound && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.visibilityBound = false;
    }
    const ctx = this.ctx;
    if (ctx && ctx.state !== "closed") {
      void ctx.close().catch(() => undefined);
    }
  }

  private setListener(
    x: number,
    y: number,
    z: number,
    fx: number,
    fy: number,
    fz: number,
    ux: number,
    uy: number,
    uz: number,
  ): void {
    const listener = this.ctx?.listener;
    if (!listener) return;
    if (listener.positionX) {
      listener.positionX.value = x;
      listener.positionY.value = y;
      listener.positionZ.value = z;
      listener.forwardX.value = fx;
      listener.forwardY.value = fy;
      listener.forwardZ.value = fz;
      listener.upX.value = ux;
      listener.upY.value = uy;
      listener.upZ.value = uz;
      return;
    }
    listener.setPosition(x, y, z);
    listener.setOrientation(fx, fy, fz, ux, uy, uz);
  }

  private bindVisibility(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.visibilityBound = true;
  }

  private readonly onVisibility = (): void => {
    if (!this.ctx || this.disposed || !this.unlocked) return;
    if (document.hidden) {
      void this.ctx.suspend().catch(() => undefined);
      return;
    }
    void this.ctx.resume().catch(() => undefined);
  };
}
