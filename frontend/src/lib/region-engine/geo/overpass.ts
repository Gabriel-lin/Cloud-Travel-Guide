/**
 * OSM Overpass 查询:建筑 footprint、水系(河/溪/渠 + 水体多边形)、土地利用。
 *
 * 使用 `out geom` 直接携带几何,免去 node 解析;结果投影为局部米坐标并缓存。
 */

import { OVERPASS_ENDPOINTS } from "../const";
import type {
  BuildingFoot,
  Coords,
  LandKind,
  LandPoly,
  OsmData,
  RiverKind,
  RiverLine,
} from "../types";
import { cacheGet, cacheSet } from "./cache";
import type { Projector } from "./project";

type OsmGeomPt = { lat: number; lon: number };
type OsmElement = {
  type: "way" | "relation" | "node";
  id: number;
  tags?: Record<string, string>;
  geometry?: OsmGeomPt[];
  members?: { type: string; role: string; geometry?: OsmGeomPt[] }[];
};

const MAX_BUILDINGS = 24000;

function buildQuery(bbox: [number, number, number, number]): string {
  const bb = bbox.join(",");
  return `[out:json][timeout:90];(
way["building"](${bb});
way["waterway"~"^(river|stream|canal)$"](${bb});
way["natural"="water"](${bb});
way["water"](${bb});
relation["natural"="water"](${bb});
way["landuse"~"^(farmland|farmyard|orchard|paddy|forest|residential|commercial|industrial|retail|meadow|grass|vineyard|greenhouse_horticulture)$"](${bb});
way["natural"~"^(wood|sand|scrub|grassland|wetland|beach|desert)$"](${bb});
);out geom qt;`;
}

/** pcg 风格整数哈希 → 0..1(逐 OSM id 稳定) */
export function hash01(n: number): number {
  let h = n >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function projectPts(proj: Projector, pts: OsmGeomPt[]): Coords {
  const out = new Float64Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as OsmGeomPt;
    const [x, z] = proj.toLocal(p.lat, p.lon);
    out[i * 2] = x;
    out[i * 2 + 1] = z;
  }
  return out;
}

function parseHeight(tags: Record<string, string>, id: number): number {
  const h = parseFloat(tags["height"] ?? "");
  if (Number.isFinite(h) && h > 0) return Math.min(h, 240);
  const levels = parseFloat(tags["building:levels"] ?? "");
  if (Number.isFinite(levels) && levels > 0) return Math.min(levels, 60) * 3.1;
  // 缺省:按 id 哈希 6~24 m(城中村/多层住宅量级)
  return 6 + hash01(id) * 18;
}

function riverKindOf(tag: string): RiverKind | null {
  if (tag === "river" || tag === "stream" || tag === "canal") return tag;
  return null;
}

function riverWidth(tags: Record<string, string>, kind: RiverKind, id: number): number {
  const tagW = parseFloat(tags["width"] ?? "");
  const base = Number.isFinite(tagW) && tagW > 0
    ? Math.min(tagW, 220)
    : kind === "river"
      ? 34
      : kind === "canal"
        ? 14
        : 6;
  // 逐河哈希扰动 ±25% —— 每条河宽度都不一样
  return base * (0.75 + hash01(id) * 0.5);
}

function landKindOf(tags: Record<string, string>): LandKind | null {
  const landuse = tags["landuse"];
  const natural = tags["natural"];
  if (natural === "water" || tags["water"]) return "water";
  if (natural === "wood" || landuse === "forest") return "forest";
  if (natural === "wetland") return "wetland";
  if (natural === "sand" || natural === "beach" || natural === "desert") return "sand";
  if (natural === "scrub") return "scrub";
  if (natural === "grassland" || landuse === "meadow" || landuse === "grass") return "grass";
  if (
    landuse === "farmland" ||
    landuse === "farmyard" ||
    landuse === "orchard" ||
    landuse === "paddy" ||
    landuse === "vineyard" ||
    landuse === "greenhouse_horticulture"
  ) {
    return "farmland";
  }
  if (
    landuse === "residential" ||
    landuse === "commercial" ||
    landuse === "industrial" ||
    landuse === "retail"
  ) {
    return "urban";
  }
  return null;
}

function ringArea(ring: Coords): number {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a +=
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number) -
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number);
  }
  return Math.abs(a) / 2;
}

function parse(proj: Projector, elements: OsmElement[]): OsmData {
  const buildings: BuildingFoot[] = [];
  const rivers: RiverLine[] = [];
  const land: LandPoly[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    if (el.type === "relation" && el.members) {
      // 水体 multipolygon:只取 outer 环(近似)
      const kind = landKindOf(tags);
      if (kind) {
        for (const m of el.members) {
          if (m.role === "outer" && m.geometry && m.geometry.length >= 3) {
            land.push({ ring: projectPts(proj, m.geometry), kind });
          }
        }
      }
      continue;
    }
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;

    if (tags["building"] !== undefined && el.geometry.length >= 3) {
      buildings.push({
        ring: projectPts(proj, el.geometry),
        height: parseHeight(tags, el.id),
      });
      continue;
    }
    const wk = riverKindOf(tags["waterway"] ?? "");
    if (wk) {
      rivers.push({
        pts: projectPts(proj, el.geometry),
        width: riverWidth(tags, wk, el.id),
        id: el.id,
        kind: wk,
      });
      continue;
    }
    const lk = landKindOf(tags);
    if (lk && el.geometry.length >= 3) {
      land.push({ ring: projectPts(proj, el.geometry), kind: lk });
    }
  }

  // 建筑过多时优先保留大 footprint(渲染预算)
  if (buildings.length > MAX_BUILDINGS) {
    buildings.sort((a, b) => ringArea(b.ring) - ringArea(a.ring));
    buildings.length = MAX_BUILDINGS;
  }
  return { buildings, rivers, land };
}

export async function fetchOsm(
  proj: Projector,
  sizeM: number,
  onProgress?: (v: number) => void,
): Promise<OsmData> {
  const cacheKey = `osm:${proj.lat0.toFixed(4)},${proj.lon0.toFixed(4)},${sizeM}`;
  const cached = await cacheGet<OsmData>(cacheKey);
  if (cached) {
    onProgress?.(1);
    return cached;
  }

  const query = buildQuery(proj.bbox(sizeM));
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      onProgress?.(0.15);
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!resp.ok) {
        lastError = new Error(`Overpass HTTP ${resp.status}`);
        continue;
      }
      onProgress?.(0.6);
      const json = (await resp.json()) as { elements: OsmElement[] };
      const data = parse(proj, json.elements ?? []);
      onProgress?.(1);
      await cacheSet(cacheKey, data);
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  // 数据源全部失败:返回空集(场景退化为纯地形),不阻塞渲染
  console.warn("[region-engine] Overpass unavailable, rendering terrain only", lastError);
  const empty: OsmData = { buildings: [], rivers: [], land: [] };
  onProgress?.(1);
  return empty;
}
