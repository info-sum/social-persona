import type { FetchResult, Post, SourceRef } from "../../types.js";
import { httpGet, httpGetJson, readerFetch } from "../http.js";
import { cleanReaderMarkdown } from "../html.js";
import { parseReaderTimeline } from "../reader-timeline.js";
import { debug } from "../../util/log.js";
import { dedupe } from "../../util/text.js";

/** 공개 syndication 엔드포인트가 요구하는 토큰 계산식. */
export function syndicationToken(tweetId: string): string {
  const n = Number(tweetId);
  if (!Number.isFinite(n)) return "a";
  return ((n / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

interface SyndicationTweet {
  id_str?: string;
  text?: string;
  full_text?: string;
  created_at?: string;
  favorite_count?: number;
  conversation_count?: number;
  user?: { screen_name?: string; name?: string };
}

function tweetToPost(t: SyndicationTweet, strategy: string): Post | undefined {
  const text = (t.full_text ?? t.text ?? "").trim();
  if (!text) return undefined;
  const id = t.id_str ?? `${Date.now()}-${Math.random()}`;
  const handle = t.user?.screen_name;
  return {
    id,
    platform: "x",
    text,
    url: handle ? `https://x.com/${handle}/status/${id}` : undefined,
    author: t.user?.name ?? handle,
    createdAt: t.created_at ? new Date(t.created_at).toISOString() : undefined,
    metrics: {
      ...(typeof t.favorite_count === "number" ? { likes: t.favorite_count } : {}),
      ...(typeof t.conversation_count === "number" ? { replies: t.conversation_count } : {}),
    },
    strategy,
  };
}

/** 단일 트윗 — cdn.syndication.twimg.com */
async function fetchSingleTweet(id: string): Promise<Post | undefined> {
  const token = syndicationToken(id);
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=ko`;
  const json = await httpGetJson<SyndicationTweet>(url, {
    retries: 1,
    headers: { referer: "https://platform.twitter.com/" },
  });
  if (!json) return undefined;
  return tweetToPost(json, "x:syndication-tweet");
}

/** 프로필 타임라인 — syndication.twitter.com 위젯 (embedded __NEXT_DATA__) */
async function fetchProfileTimeline(handle: string): Promise<{ posts: Post[]; status: number; note?: string }> {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}?showReplies=false`;
  const res = await httpGet(url, { retries: 2, headers: { referer: "https://platform.twitter.com/" } });
  if (!res.ok) {
    const note =
      res.status === 429
        ? "X 위젯 API 레이트리밋(429). IP 단위 제한이므로 몇 분 뒤 다시 시도하면 성공할 수 있습니다."
        : res.status === 404
          ? "해당 핸들의 위젯 타임라인이 없습니다 (핸들 오타 / 비공개 계정 / 삭제된 계정)."
          : `위젯 타임라인 요청 실패 (status ${res.status})`;
    return { posts: [], status: res.status, note };
  }

  const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(res.body);
  if (!match?.[1]) {
    debug("x: __NEXT_DATA__ 없음");
    return { posts: [], status: res.status, note: "위젯 응답에 타임라인 JSON이 없습니다 (보호된 계정일 수 있음)." };
  }
  let data: unknown;
  try {
    data = JSON.parse(match[1]) as unknown;
  } catch {
    return { posts: [], status: res.status, note: "위젯 타임라인 JSON 파싱 실패" };
  }

  const tweets: SyndicationTweet[] = [];
  const walk = (node: unknown, depth = 0): void => {
    if (depth > 12 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec["full_text"] === "string" || (typeof rec["text"] === "string" && typeof rec["id_str"] === "string")) {
      tweets.push(rec as SyndicationTweet);
    }
    for (const v of Object.values(rec)) walk(v, depth + 1);
  };
  walk(data);

  const posts = dedupe(
    tweets.map((t) => tweetToPost(t, "x:syndication-timeline")).filter((p): p is Post => p !== undefined),
    (p) => p.id,
  );
  return { posts, status: res.status };
}

/** 리더 프록시로 프로필 텍스트를 긁고 게시글 블록으로 자른다. */
async function fetchViaReader(url: string, handle?: string): Promise<Post[]> {
  const res = await readerFetch(url);
  if (!res.ok || res.body.length < 200) return [];
  const cleaned = cleanReaderMarkdown(res.body);
  const parsed = parseReaderTimeline(cleaned, handle);
  return parsed.map((p, idx) => ({
    id: `${handle ?? "x"}-reader-${idx}`,
    platform: "x" as const,
    text: p.text,
    url,
    ...(handle ? { author: handle } : {}),
    ...(p.createdAt ? { createdAt: p.createdAt } : {}),
    strategy: `x:reader${p.anchored ? "" : "-loose"}`,
  }));
}

/**
 * X(트위터) 어댑터.
 * 공식 API 없이 동작하는 공개 엔드포인트를 순차 시도한다.
 */
export async function fetchX(ref: SourceRef, limit: number): Promise<FetchResult> {
  const notes: string[] = [];

  if (ref.kind === "post" && ref.postId) {
    const post = await fetchSingleTweet(ref.postId);
    if (post) {
      notes.push("syndication 단일 트윗 API 사용");
      return { source: ref, posts: [post], ok: true, strategy: "x:syndication-tweet", notes };
    }
    notes.push("단일 트윗 API 실패");
  }

  const handle = ref.handle;
  if (handle) {
    const timeline = await fetchProfileTimeline(handle);
    if (timeline.posts.length > 0) {
      notes.push(`syndication 타임라인 위젯에서 ${timeline.posts.length}건 확보`);
      return { source: ref, posts: timeline.posts.slice(0, limit), ok: true, strategy: "x:syndication-timeline", notes };
    }
    if (timeline.note) notes.push(timeline.note);
  }

  const target = ref.url ?? (handle ? `https://x.com/${handle}` : undefined);
  if (target) {
    const viaReader = await fetchViaReader(target, handle);
    if (viaReader.length > 0) {
      notes.push(`리더 프록시로 ${viaReader.length}개 블록 확보 (정확도 낮음)`);
      return { source: ref, posts: viaReader.slice(0, limit), ok: true, strategy: "x:reader", notes };
    }
    notes.push("리더 프록시도 실패");
  }

  notes.push(
    "X는 로그인 없는 수집을 강하게 제한합니다. 프로필에서 글을 복사해 텍스트 파일로 만들고 --input 으로 넘겨주세요.",
  );
  return { source: ref, posts: [], ok: false, strategy: "none", notes };
}
