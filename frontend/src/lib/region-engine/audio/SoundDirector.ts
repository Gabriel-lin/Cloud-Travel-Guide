/**
 * 场景声音导演:声音系统的注册表 + 每帧推进。
 *
 * RegionWorld 持有一个实例;子系统通过 {@link SoundSystem.register} 挂上,
 * 或经本类的 register/unregister 代为完成。
 */

import { AudioRuntime } from "./AudioRuntime";
import type { SoundSystem } from "./SoundSystem";
import type { SoundFrameContext, SoundHost } from "./types";

export class SoundDirector implements SoundHost {
  readonly runtime: AudioRuntime;
  private readonly byId = new Map<string, SoundSystem>();
  private disposed = false;

  constructor(runtime: AudioRuntime = new AudioRuntime()) {
    this.runtime = runtime;
  }

  attach(system: SoundSystem): void {
    const prev = this.byId.get(system.id);
    if (prev && prev !== system) prev.unregister();
    this.byId.set(system.id, system);
  }

  detach(system: SoundSystem): void {
    if (this.byId.get(system.id) === system) this.byId.delete(system.id);
  }

  /** 向本场景注册一套声音系统(内部转调 system.register)。 */
  register(system: SoundSystem): this {
    if (this.disposed) {
      throw new Error("SoundDirector is disposed");
    }
    system.register(this);
    return this;
  }

  /** 按 id 或实例取消注册。 */
  unregister(idOrSystem: string | SoundSystem): boolean {
    const id = typeof idOrSystem === "string" ? idOrSystem : idOrSystem.id;
    const sys = this.byId.get(id);
    if (!sys) return false;
    sys.unregister();
    return true;
  }

  unregisterAll(): void {
    for (const sys of [...this.byId.values()]) sys.unregister();
  }

  get(id: string): SoundSystem | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  systems(): readonly SoundSystem[] {
    return [...this.byId.values()];
  }

  setSystemEnabled(id: string, on: boolean): boolean {
    const sys = this.byId.get(id);
    if (!sys) return false;
    sys.setEnabled(on);
    return true;
  }

  update(ctx: SoundFrameContext): void {
    if (this.runtime.available) {
      this.runtime.syncListenerFromCamera(ctx.camera);
      this.runtime.setUnderwater(ctx.underwater, ctx.waterDepth);
    }
    for (const sys of this.byId.values()) sys.update(ctx);
  }

  installUnlock(target: EventTarget): () => void {
    return this.runtime.installUnlock(target);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterAll();
    this.runtime.dispose();
  }
}
