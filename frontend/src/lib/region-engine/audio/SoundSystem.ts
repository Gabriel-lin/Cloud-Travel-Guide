/**
 * 声音系统基类。
 *
 * 每种场景音源(鸟、日后的风/水/UI)都是一个可向场景注册/注销的系统。
 * 生命周期:register(host) → update(ctx)* → unregister() → dispose()。
 */

import type { SoundFrameContext, SoundHost } from "./types";

export abstract class SoundSystem {
  abstract readonly id: string;
  abstract readonly label: string;

  #host: SoundHost | null = null;
  #enabled = true;

  get host(): SoundHost | null {
    return this.#host;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get registered(): boolean {
    return this.#host !== null;
  }

  /** 向场景声音主机注册;重复注册同一 host 为幂等。 */
  register(host: SoundHost): this {
    if (this.#host === host) return this;
    this.unregister();
    this.#host = host;
    host.attach(this);
    this.onRegister(host);
    return this;
  }

  /** 从当前场景注销;未注册时为幂等。 */
  unregister(): this {
    const host = this.#host;
    if (!host) return this;
    this.#host = null;
    host.detach(this);
    this.onUnregister(host);
    return this;
  }

  setEnabled(on: boolean): this {
    this.#enabled = on;
    if (!on) this.onDisabled();
    return this;
  }

  update(ctx: SoundFrameContext): void {
    if (!this.#enabled || !this.#host) return;
    this.tick(ctx);
  }

  dispose(): void {
    this.unregister();
    this.onDispose();
  }

  protected abstract tick(ctx: SoundFrameContext): void;

  protected onRegister(_host: SoundHost): void {
    /* 子类按需预加载资产 */
  }

  protected onUnregister(_host: SoundHost): void {
    /* 子类按需停声 */
  }

  protected onDisabled(): void {
    /* 子类按需停声 */
  }

  protected onDispose(): void {
    /* 子类释放私有资源 */
  }
}
