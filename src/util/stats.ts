import type { Counted, LengthStats } from "../types.js";

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx] ?? 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function round(n: number, digits = 2): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function lengthStats(xs: number[]): LengthStats {
  if (xs.length === 0) return { mean: 0, median: 0, p90: 0, min: 0, max: 0 };
  return {
    mean: round(mean(xs), 1),
    median: round(median(xs), 1),
    p90: round(percentile(xs, 90), 1),
    min: Math.min(...xs),
    max: Math.max(...xs),
  };
}

/** 빈도 맵을 상위 N개 Counted[]로. total을 주면 ratio도 채운다. */
export function topN<T extends string>(counts: Map<T, number>, n: number, total?: number): Counted<T>[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, n)
    .map(([value, count]) => ({
      value,
      count,
      ...(total && total > 0 ? { ratio: round(count / total, 4) } : {}),
    }));
}

export function increment<T>(map: Map<T, number>, key: T, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

export function safeRatio(numerator: number, denominator: number, digits = 3): number {
  if (denominator === 0) return 0;
  return round(numerator / denominator, digits);
}

/**
 * 비율 목록을 합이 정확히 100이 되는 정수 퍼센트로 바꾼다 (최대 잉여법).
 * 반올림 때문에 표의 합이 101%가 되는 것을 막는다.
 */
export function percentDistribution(ratios: number[]): number[] {
  const total = ratios.reduce((a, b) => a + b, 0);
  if (total <= 0) return ratios.map(() => 0);
  const scaled = ratios.map((r) => (r / total) * 100);
  const floors = scaled.map((v) => Math.floor(v));
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    remainder -= 1;
  }
  return out;
}
