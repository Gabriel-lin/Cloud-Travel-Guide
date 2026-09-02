/**
 * 音频资产库:按 URL 去重解码,失败重试一次,dispose 后全部作废。
 */

export class AssetBank {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly inflight = new Map<string, Promise<AudioBuffer | null>>();
  private disposed = false;

  constructor(private readonly ctx: AudioContext) {}

  get(url: string): AudioBuffer | null {
    return this.buffers.get(url) ?? null;
  }

  has(url: string): boolean {
    return this.buffers.has(url);
  }

  async load(url: string): Promise<AudioBuffer | null> {
    if (this.disposed) return null;
    const hit = this.buffers.get(url);
    if (hit) return hit;
    const pending = this.inflight.get(url);
    if (pending) return pending;
    const job = this.fetchDecode(url);
    this.inflight.set(url, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(url);
    }
  }

  async preload(urls: readonly string[]): Promise<void> {
    const unique = [...new Set(urls)];
    await Promise.all(unique.map((u) => this.load(u)));
  }

  dispose(): void {
    this.disposed = true;
    this.buffers.clear();
    this.inflight.clear();
  }

  private async fetchDecode(url: string): Promise<AudioBuffer | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.disposed) return null;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.arrayBuffer();
        if (this.disposed) return null;
        const buf = await this.ctx.decodeAudioData(raw.slice(0));
        if (this.disposed) return null;
        this.buffers.set(url, buf);
        return buf;
      } catch (err) {
        if (attempt === 1) {
          console.warn(`[audio] decode failed ${url}`, err);
        }
      }
    }
    return null;
  }
}
