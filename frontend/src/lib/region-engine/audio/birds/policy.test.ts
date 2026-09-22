import { describe, expect, it } from "vitest";

import { BIRD_SPECIES_IDS } from "../../world/birdSpecies";
import { evalFlockCenter, type BirdFlockKinematics } from "../../world/birdKinematics";
import { BIRD_CLIPS } from "./manifest";
import { flockActivity, pickVocalKind, vocalWeights } from "./policy";
import { BIRD_PROFILES } from "./profiles";

const ellipse: BirdFlockKinematics = {
  ox: 10,
  oy: 20,
  oz: 30,
  rx: 8,
  rz: 4,
  angSpeed: 0.5,
  phase: 0,
  behavior: 0,
  aux0: 0.5,
  aux1: 3,
  bobAmp: 0,
  rotC: 1,
  rotS: 0,
};

describe("evalFlockCenter", () => {
  it("samples the ellipse at t=0 on the +x radius", () => {
    const out = { x: 0, y: 0, z: 0 };
    evalFlockCenter(ellipse, 0, out);
    expect(out.x).toBeCloseTo(18, 5);
    expect(out.y).toBeCloseTo(20, 5);
    expect(out.z).toBeCloseTo(30, 5);
  });
});

describe("vocalWeights", () => {
  it("silences diurnal song at night and keeps owl hoots", () => {
    const sparrowNight = vocalWeights(BIRD_PROFILES.sparrow, "urban", {
      nightK: 1,
      wind: 0.2,
      underwater: false,
    });
    const owlNight = vocalWeights(BIRD_PROFILES["eagle-owl"], "forest", {
      nightK: 1,
      wind: 0.2,
      underwater: false,
    });
    const sparrowDay = vocalWeights(BIRD_PROFILES.sparrow, "urban", {
      nightK: 0,
      wind: 0.2,
      underwater: false,
    });
    expect(sparrowNight.song).toBeLessThan(sparrowDay.song * 0.2);
    expect(owlNight.nocturnal).toBeGreaterThan(0.5);
  });

  it("mutes all vocals underwater", () => {
    const w = vocalWeights(BIRD_PROFILES.mallard, "water", {
      nightK: 0,
      wind: 0,
      underwater: true,
    });
    expect(Object.values(w).every((v) => v === 0)).toBe(true);
  });

  it("picks a kind from positive weights", () => {
    const kind = pickVocalKind(
      { song: 0, call: 1, flight: 0, alarm: 0, nocturnal: 0 },
      () => 0.1,
    );
    expect(kind).toBe("call");
  });
});

describe("BIRD_CLIPS", () => {
  it("ships multiple environment-specific vocalizations for every species", () => {
    for (const id of BIRD_SPECIES_IDS) {
      const clips = BIRD_CLIPS.filter((c) => c.speciesId === id);
      expect(clips.length, id).toBeGreaterThanOrEqual(4);
      const kinds = new Set(clips.map((c) => c.kind));
      expect(kinds.size, id).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("BIRD_PROFILES", () => {
  it("covers every scene bird species with multiple vocal kinds", () => {
    for (const id of BIRD_SPECIES_IDS) {
      const p = BIRD_PROFILES[id];
      expect(p.id).toBe(id);
      const active = Object.values(p.vocals).filter((v) => v > 0);
      expect(active.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("flockActivity", () => {
  it("drops to zero beyond maxDistance", () => {
    const p = BIRD_PROFILES.sparrow;
    expect(flockActivity(p, 20, p.maxDistance + 1, 0, false)).toBe(0);
    expect(flockActivity(p, 20, 8, 0, false)).toBeGreaterThan(0.2);
    expect(flockActivity(p, 20, 8, 0, true)).toBe(0);
  });
});
