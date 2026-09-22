import { describe, expect, it } from "vitest";

import { CHUNK_SIZE } from "../const";
import { INSTANCE_STRIDE, type ScatterLayer } from "../veg/scatter";
import { catalogForFish } from "./catalog";
import { projectLandmarks } from "./landmarks";
import { clearsInspectOnEscape, resolvePointerClick } from "./pointerPolicy";
import { nearestInLayer } from "./vegetationQuery";

function oneTree(x: number, z: number, size: number): ScatterLayer {
  const chunksX = Math.ceil(size / CHUNK_SIZE);
  const cx = Math.floor((x + size / 2) / CHUNK_SIZE);
  const cz = Math.floor((z + size / 2) / CHUNK_SIZE);
  const data = new Float32Array(INSTANCE_STRIDE);
  data[0] = x;
  data[1] = 2;
  data[2] = z;
  data[3] = 1;
  return {
    data,
    count: 1,
    chunkIndex: new Map([[cz * chunksX + cx, [0, 1]]]),
  };
}

describe("resolvePointerClick", () => {
  const hit = {
    catalogId: "shrub",
    kind: "shrub" as const,
    titleKey: "routes.pickables.shrub",
    instanceKey: "veg:shrub:0",
  };

  it("inspects a cursor hit and ignores a locked or dragged click", () => {
    expect(
      resolvePointerClick({
        pointerTool: "cursor",
        viewMode: "first-person",
        locked: false,
        dragged: false,
        hit,
      }),
    ).toEqual({ kind: "pick", entity: hit });
    expect(
      resolvePointerClick({
        pointerTool: "cursor",
        viewMode: "first-person",
        locked: true,
        dragged: false,
        hit,
      }).kind,
    ).toBe("ignore");
    expect(
      resolvePointerClick({
        pointerTool: "cursor",
        viewMode: "third-person",
        locked: false,
        dragged: true,
        hit,
      }).kind,
    ).toBe("ignore");
  });

  it("locks first person on an empty cursor click and clears the selection", () => {
    expect(
      resolvePointerClick({
        pointerTool: "cursor",
        viewMode: "first-person",
        locked: false,
        dragged: false,
        hit: null,
      }),
    ).toEqual({ kind: "lock", clearPick: true });
  });

  it("clears third-person misses without locking, and locks the hand tool without clearing", () => {
    expect(
      resolvePointerClick({
        pointerTool: "cursor",
        viewMode: "third-person",
        locked: false,
        dragged: false,
        hit: null,
      }),
    ).toEqual({ kind: "pick", entity: null });
    expect(
      resolvePointerClick({
        pointerTool: "hand",
        viewMode: "first-person",
        locked: false,
        dragged: false,
        hit: null,
      }),
    ).toEqual({ kind: "lock", clearPick: false });
    expect(
      resolvePointerClick({
        pointerTool: "hand",
        viewMode: "third-person",
        locked: false,
        dragged: false,
        hit,
      }).kind,
    ).toBe("ignore");
  });

  it("treats Escape as leaving inspect", () => {
    expect(clearsInspectOnEscape({ key: "Escape", code: "Escape" })).toBe(true);
    expect(clearsInspectOnEscape({ key: "Esc", code: "Escape" })).toBe(true);
    expect(clearsInspectOnEscape({ key: "v", code: "KeyV" })).toBe(false);
  });
});

describe("catalogForFish", () => {
  it("matches a stable species id instead of a display name", () => {
    expect(catalogForFish("grass-carp")?.id).toBe("fish:grass-carp");
    expect(catalogForFish("yellow-catfish")?.kind).toBe("fish");
  });
});

describe("projectLandmarks", () => {
  it("projects lat/lon once into world xz", () => {
    const [lm] = projectLandmarks(
      [
        {
          id: "bell",
          titleKey: "routes.pickables.landmarks.bellTower",
          coord: { lat: 1, lon: 2 },
        },
      ],
      (lat, lon) => [lat * 10, lon * -5],
    );
    expect(lm).toMatchObject({ id: "bell", x: 10, z: -10 });
  });
});

describe("nearestInLayer", () => {
  it("returns the instance inside the chunk radius and misses far clicks", () => {
    const size = 256;
    const layer = oneTree(10, 20, size);
    expect(nearestInLayer(layer, size, 12, 21, 25)?.index).toBe(0);
    expect(nearestInLayer(layer, size, 80, 80, 16)).toBeNull();
  });
});
