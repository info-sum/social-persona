import type { FetchResult, Post, SourceRef } from "../types.js";
import { fetchBlog } from "./adapters/blog.js";
import { fetchInstagram, fetchThreads } from "./adapters/meta.js";
import { fetchManualFile } from "./adapters/manual.js";
import { fetchX } from "./adapters/x.js";
import { detectSource } from "./detect.js";
import { isBoilerplate } from "./reader-timeline.js";
import { debug, warn } from "../util/log.js";
import { dedupe } from "../util/text.js";

export interface CollectOptions {
  /** 소스별 수집 상한 */
  limitPerSource: number;
  /** 추가 수동 입력 파일 */
  inputFiles?: string[];
  /** 헤드리스 브라우저 전략 사용 여부 */
  useBrowser?: boolean;
  /** TLS 지문 위장 전략 사용 여부 */
  useImpersonate?: boolean;
}

export interface CollectResult {
  posts: Post[];
  results: FetchResult[];
  notes: string[];
}

async function fetchOne(ref: SourceRef, limit: number, opts: CollectOptions): Promise<FetchResult> {
  const meta = { useBrowser: opts.useBrowser !== false, useImpersonate: opts.useImpersonate !== false };
  switch (ref.platform) {
    case "x":
      return fetchX(ref, limit);
    case "threads":
      return fetchThreads(ref, limit, meta);
    case "instagram":
      return fetchInstagram(ref, limit, meta);
    case "blog":
      return fetchBlog(ref, limit);
    case "manual":
      if (ref.kind === "file") return fetchManualFile(ref.raw, ref, limit);
      return {
        source: ref,
        posts: [],
        ok: false,
        strategy: "none",
        notes: ["텍스트 입력은 --input 파일로 넘겨주세요."],
      };
    case "unknown":
    default:
      if (ref.url) return fetchBlog({ ...ref, platform: "blog" }, limit);
      return {
        source: ref,
        posts: [],
        ok: false,
        strategy: "none",
        notes: [
          `플랫폼을 알 수 없습니다: ${ref.raw}. \`x:@handle\` 처럼 플랫폼을 명시하거나 전체 URL을 넣어주세요.`,
        ],
      };
  }
}

const MIN_POST_CHARS = 15;

function isUseful(post: Post): boolean {
  const t = post.text.trim();
  if (t.length < MIN_POST_CHARS) return false;
  if (isBoilerplate(t)) return false;
  // 링크나 해시태그만 있는 글은 문체 분석에 무의미
  const withoutNoise = t
    .replace(/https?:\/\/\S+/g, "")
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/@[\w.]+/g, "")
    .trim();
  return withoutNoise.length >= MIN_POST_CHARS;
}

/** 모든 소스를 병렬 수집하고 중복을 제거한다. */
export async function collectPosts(refs: SourceRef[], options: CollectOptions): Promise<CollectResult> {
  const allRefs = [...refs];
  for (const file of options.inputFiles ?? []) {
    allRefs.push({ ...detectSource(file), platform: "manual", kind: "file", raw: file });
  }

  const results = await Promise.all(
    allRefs.map(async (ref) => {
      try {
        return await fetchOne(ref, options.limitPerSource, options);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warn(`${ref.raw} 수집 중 오류: ${msg}`);
        return { source: ref, posts: [], ok: false, strategy: "error", notes: [msg] } satisfies FetchResult;
      }
    }),
  );

  const raw = results.flatMap((r) => r.posts);
  const filtered = raw.filter(isUseful);
  const posts = dedupe(filtered, (p) => `${p.platform}|${p.text.trim().slice(0, 120)}`);
  debug(`수집 원본 ${raw.length}건 → 유효 ${filtered.length}건 → 중복제거 ${posts.length}건`);

  const notes = results.flatMap((r) => r.notes.map((n) => `[${r.source.platform}] ${n}`));
  return { posts, results, notes };
}
