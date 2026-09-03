import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { FetchResult, Post, Platform, SourceRef } from "../../types.js";
import { splitPostBlocks } from "../../util/text.js";

interface ManualPostJson {
  text?: string;
  content?: string;
  caption?: string;
  url?: string;
  platform?: string;
  createdAt?: string;
  date?: string;
  title?: string;
  author?: string;
  likes?: number;
}

const asPlatform = (v: string | undefined, fallback: Platform): Platform => {
  const p = (v ?? "").toLowerCase();
  if (p === "x" || p === "twitter") return "x";
  if (p === "instagram" || p === "ig") return "instagram";
  if (p === "threads") return "threads";
  if (p === "blog") return "blog";
  return fallback;
};

/**
 * 수동 입력 파서.
 * - `.json`: 배열 또는 {posts: []}. 각 항목은 text/content/caption 중 하나를 가진다.
 * - `.md`/`.txt`: 빈 줄 2개 또는 `---` 로 구분된 블록을 각각 하나의 글로 본다.
 *   `--- @2024-01-01 ---` 처럼 구분선에 날짜를 적으면 게시일로 인식한다.
 */
export function parseManualText(raw: string, platform: Platform, sourceLabel: string): Post[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const items: ManualPostJson[] = Array.isArray(parsed)
        ? (parsed as ManualPostJson[])
        : ((parsed as { posts?: ManualPostJson[] }).posts ?? []);
      const posts: Post[] = [];
      items.forEach((it, idx) => {
        const text = (it.text ?? it.content ?? it.caption ?? "").trim();
        if (!text) return;
        const created = it.createdAt ?? it.date;
        const iso = created && !Number.isNaN(new Date(created).getTime()) ? new Date(created).toISOString() : undefined;
        posts.push({
          id: `${sourceLabel}-${idx}`,
          platform: asPlatform(it.platform, platform),
          text,
          ...(it.url ? { url: it.url } : {}),
          ...(it.title ? { title: it.title } : {}),
          ...(it.author ? { author: it.author } : {}),
          ...(iso ? { createdAt: iso } : {}),
          ...(typeof it.likes === "number" ? { metrics: { likes: it.likes } } : {}),
          strategy: "manual:json",
        });
      });
      if (posts.length > 0) return posts;
    } catch {
      /* JSON 아니면 텍스트로 처리 */
    }
  }

  // 명시적 구분선(`---`)이 있으면 그것만 경계로 쓴다.
  // 없으면 빈 줄 2개를 경계로 본다.
  const hasExplicitSeparator = /\n\s*-{3,}[^\n]*\n/.test(`${trimmed}\n`);
  const separatorRe = /\n\s*-{3,}\s*(?:@\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9:]+)?))?\s*-*\s*\n/;
  const posts: Post[] = [];

  const pushBlock = (block: string, dateHint?: string): void => {
    const body = block.trim();
    // 여기서는 공백·잡음만 걸러낸다. 분석에 쓸 최소 길이는 수집 파이프라인이 판단한다.
    if (body.length < 4) return;
    const iso =
      dateHint && !Number.isNaN(new Date(dateHint).getTime()) ? new Date(dateHint).toISOString() : undefined;
    posts.push({
      id: `${sourceLabel}-${posts.length}`,
      platform,
      text: body,
      ...(iso ? { createdAt: iso } : {}),
      strategy: "manual:text",
    });
  };

  if (hasExplicitSeparator) {
    const sections = trimmed.split(separatorRe);
    let pendingDate: string | undefined;
    for (let i = 0; i < sections.length; i += 1) {
      const chunk = sections[i];
      if (chunk === undefined) continue;
      // split의 캡처 그룹 자리(홀수 인덱스)는 날짜 힌트
      if (i % 2 === 1) {
        pendingDate = chunk.trim() || undefined;
        continue;
      }
      pushBlock(chunk, pendingDate);
      pendingDate = undefined;
    }
  } else {
    for (const block of splitPostBlocks(trimmed)) pushBlock(block);
  }
  return posts;
}

export async function fetchManualFile(path: string, ref: SourceRef, limit: number): Promise<FetchResult> {
  try {
    const raw = await readFile(path, "utf8");
    const posts = parseManualText(raw, ref.platform === "manual" ? "manual" : ref.platform, basename(path));
    if (posts.length === 0) {
      return { source: ref, posts: [], ok: false, strategy: "manual", notes: [`${path}: 게시글을 찾지 못했습니다.`] };
    }
    return {
      source: ref,
      posts: posts.slice(0, limit),
      ok: true,
      strategy: posts[0]?.strategy ?? "manual",
      notes: [`${path}에서 ${posts.length}건 로드`],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { source: ref, posts: [], ok: false, strategy: "manual", notes: [`${path} 읽기 실패: ${msg}`] };
  }
}

export function fetchManualInline(text: string, ref: SourceRef, limit: number): FetchResult {
  const posts = parseManualText(text, "manual", "inline");
  return {
    source: ref,
    posts: posts.slice(0, limit),
    ok: posts.length > 0,
    strategy: "manual:inline",
    notes: [`인라인 텍스트에서 ${posts.length}건 로드`],
  };
}
