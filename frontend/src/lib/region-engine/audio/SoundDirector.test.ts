import { describe, expect, it } from "vitest";

import { SoundDirector } from "./SoundDirector";
import { SoundSystem } from "./SoundSystem";
import type { SoundFrameContext } from "./types";

class DummySystem extends SoundSystem {
  readonly id: string;
  readonly label: string;
  ticks = 0;
  registeredHost = false;
  unregistered = false;

  constructor(id = "dummy") {
    super();
    this.id = id;
    this.label = id;
  }

  protected override onRegister(): void {
    this.registeredHost = true;
  }

  protected override onUnregister(): void {
    this.unregistered = true;
  }

  protected override tick(_ctx: SoundFrameContext): void {
    this.ticks += 1;
  }
}

function fakeCtx(): SoundFrameContext {
  return {
    camera: {
      position: { x: 0, y: 0, z: 0 },
      updateMatrixWorld: () => undefined,
      matrixWorld: { elements: new Float32Array(16) },
    } as unknown as SoundFrameContext["camera"],
    dt: 1 / 60,
    time: 1,
    nightK: 0,
    wind: 0.3,
    underwater: false,
    waterDepth: 0,
  };
}

describe("SoundDirector register/unregister", () => {
  it("registers a system onto the scene host and ticks it", () => {
    const director = new SoundDirector();
    const sys = new DummySystem();
    director.register(sys);
    expect(director.has("dummy")).toBe(true);
    expect(sys.registered).toBe(true);
    expect(sys.registeredHost).toBe(true);
    director.update(fakeCtx());
    expect(sys.ticks).toBe(1);
    director.dispose();
  });

  it("unregisters by id and by instance", () => {
    const director = new SoundDirector();
    const a = new DummySystem("a");
    const b = new DummySystem("b");
    director.register(a).register(b);
    expect(director.unregister("a")).toBe(true);
    expect(a.unregistered).toBe(true);
    expect(director.has("a")).toBe(false);
    expect(director.unregister(b)).toBe(true);
    expect(director.systems()).toHaveLength(0);
    director.dispose();
  });

  it("disabled systems do not tick", () => {
    const director = new SoundDirector();
    const sys = new DummySystem();
    director.register(sys);
    director.setSystemEnabled("dummy", false);
    director.update(fakeCtx());
    expect(sys.ticks).toBe(0);
    director.dispose();
  });

  it("system.register is idempotent on the same host", () => {
    const director = new SoundDirector();
    const sys = new DummySystem();
    sys.register(director);
    sys.register(director);
    expect(director.systems()).toHaveLength(1);
    director.dispose();
  });
});
