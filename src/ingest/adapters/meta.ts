import type { FetchResult, Platform, Post, SourceRef } from "../../types.js";
import { httpGet, readerFetch } from "../http.js";
import { cleanReaderMarkdown, extractMeta } from "../html.js";
import { extractEmbeddedJson, mineCaptionsByRegex, mineMetaPosts } from "../embedded-json.js";
import { parseReaderTimeline, toUtcMidnightIfDateOnly } from "../reader-timeline.js";
import { BROWSER_INSTALL_HINT, openBrowser, renderPage } from "../browser.js";
import { IMPERSONATE_INSTALL_HINT, impersonateGet } from "../impersonate.js";
import { debug } from "../../util/log.js";

function toPost(text: string, ref: SourceRef, idx: number, extra: Partial<Post> = {}): Post {
  return {
    id: extra.id ?? `${ref.platform}-${ref.handle ?? "post"}-${idx}`,
    platform: ref.platform,
    text: text.trim(),
    url: extra.url ?? ref.url,
    author: extra.author ?? ref.handle,
    createdAt: extra.createdAt,
    metrics: extra.metrics,
    strategy: extra.strategy ?? `${ref.platform}:html`,
  };
}

/**
 * Instagram og:description 파싱.
 * `94K likes, 847 comments - nasa - August 28, 2026: "본문"` 형태에서 본문만 꺼낸다.
 * 댓글이 섞여 들어오는 DOM 추출보다 안전해서 개별 게시글에서는 이 경로를 1순위로 쓴다.
 */
export function parseInstagramOgDescription(desc: string): { text: string; author?: string; createdAt?: string; likes?: number } | undefined {
  const m = /^(.*?)\s[-–]\s([A-Za-z0-9._]{1,40})\s(?:on\s)?[-–]?\s*([^:]{4,30}):\s*[“"']([\s\S]+)[”"']\s*$/.exec(desc.trim());
  if (m) {
    const likes = /([\d.,]+)\s*([KMB])?\s*likes?/i.exec(m[1] ?? "");
    const rawDate = (m[3] ?? "").trim();
    const parsedDate = new Date(rawDate);
    return {
      text: (m[4] ?? "").trim(),
      author: m[2],
      ...(Number.isNaN(parsedDate.getTime()) ? {} : { createdAt: toUtcMidnightIfDateOnly(rawDate, parsedDate) }),
      ...(likes ? { likes: scaleCount(likes[1] ?? "0", likes[2]) } : {}),
    };
  }
  // 따옴표 없이 콜론 뒤에 본문만 오는 변형
  const simple = /^.*?\s[-–]\s([A-Za-z0-9._]{1,40})\s[-–]\s[^:]{4,30}:\s*([\s\S]{10,})$/.exec(desc.trim());
  if (simple) {
    return { text: (simple[2] ?? "").trim(), author: simple[1] };
  }
  return undefined;
}

function scaleCount(raw: string, suffix?: string): number {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  const mult = suffix?.toUpperCase() === "K" ? 1e3 : suffix?.toUpperCase() === "M" ? 1e6 : suffix?.toUpperCase() === "B" ? 1e9 : 1;
  return Math.round(n * mult);
}

/** HTML에서 임베드 JSON → 정규식 → og:description 순으로 캡션을 캐낸다. */
function minePostsFromHtml(html: string, ref: SourceRef, strategyPrefix: string): Post[] {
  // Instagram 개별 게시글은 og:description이 가장 깨끗하다 (댓글이 섞이지 않는다)
  if (ref.platform === "instagram") {
    const desc = extractMeta(html).description;
    if (desc) {
      const parsed = parseInstagramOgDescription(desc);
      if (parsed && parsed.text.length >= 15) {
        return [
          toPost(parsed.text, ref, 0, {
            ...(parsed.author ? { author: parsed.author } : {}),
            ...(parsed.createdAt ? { createdAt: parsed.createdAt } : {}),
            ...(parsed.likes !== undefined ? { metrics: { likes: parsed.likes } } : {}),
            strategy: `${strategyPrefix}:og-description`,
          }),
        ];
      }
    }
  }

  const mined = mineMetaPosts(extractEmbeddedJson(html));
  if (mined.length > 0) {
    return mined.map((m, idx) =>
      toPost(m.text, ref, idx, {
        id: m.pk ?? m.code ?? undefined,
        url: m.code
          ? ref.platform === "threads"
            ? `https://www.threads.com/@${m.username ?? ref.handle}/post/${m.code}`
            : `https://www.instagram.com/p/${m.code}/`
          : ref.url,
        author: m.username ?? ref.handle,
        createdAt: m.takenAt ? new Date(m.takenAt * 1000).toISOString() : undefined,
        metrics: m.likeCount !== undefined ? { likes: m.likeCount } : undefined,
        strategy: `${strategyPrefix}:embedded-json`,
      }),
    );
  }

  const byRegex = mineCaptionsByRegex(html);
  if (byRegex.length > 0) {
    return byRegex.map((text, idx) => toPost(text, ref, idx, { strategy: `${strategyPrefix}:regex` }));
  }

  const meta = extractMeta(html);
  if (meta.description && meta.description.length > 40) {
    // 인스타 og:description 형태: `123 likes, 4 comments - handle on May 1, 2024: "본문"`
    const quoted = /:\s*[“"](.+)[”"]\s*$/s.exec(meta.description);
    const text = quoted?.[1] ?? meta.description;
    return [toPost(text, ref, 0, { strategy: `${strategyPrefix}:og-description` })];
  }
  return [];
}

async function viaReader(ref: SourceRef, strategyPrefix: string): Promise<Post[]> {
  if (!ref.url) return [];
  const res = await readerFetch(ref.url);
  if (!res.ok || res.body.length < 150) return [];
  const cleaned = cleanReaderMarkdown(res.body);
  const parsed = parseReaderTimeline(cleaned, ref.handle);
  return parsed.map((p, idx) =>
    toPost(p.text, ref, idx, {
      ...(p.createdAt ? { createdAt: p.createdAt } : {}),
      strategy: `${strategyPrefix}:reader${p.anchored ? "" : "-loose"}`,
    }),
  );
}

/** 헤드리스 브라우저로 렌더링한 뒤 GraphQL 응답과 DOM 텍스트 양쪽에서 캔다. */
async function viaBrowser(ref: SourceRef, strategyPrefix: string): Promise<Post[]> {
  if (!ref.url) return [];
  const rendered = await renderPage(ref.url, { scrolls: ref.kind === "profile" ? 6 : 2 });
  if (!rendered) return [];

  // 1순위: 네트워크로 흘러간 JSON 페이로드
  const mined = mineMetaPosts(rendered.payloads);
  if (mined.length > 0) {
    return mined.map((m, idx) =>
      toPost(m.text, ref, idx, {
        ...(m.pk ?? m.code ? { id: m.pk ?? m.code } : {}),
        ...(m.username ?? ref.handle ? { author: m.username ?? ref.handle } : {}),
        ...(m.takenAt ? { createdAt: new Date(m.takenAt * 1000).toISOString() } : {}),
        ...(m.likeCount !== undefined ? { metrics: { likes: m.likeCount } } : {}),
        strategy: `${strategyPrefix}:browser-graphql`,
      }),
    );
  }

  // 2순위: 렌더된 HTML의 임베드 JSON
  const fromHtml = minePostsFromHtml(rendered.html, ref, `${strategyPrefix}:browser`);
  if (fromHtml.length > 0) return fromHtml;

  // 3순위: 화면 텍스트를 타임라인 파서에 태운다
  const parsed = parseReaderTimeline(rendered.text, ref.handle);
  return parsed.map((p, idx) =>
    toPost(p.text, ref, idx, {
      ...(p.createdAt ? { createdAt: p.createdAt } : {}),
      strategy: `${strategyPrefix}:browser-dom${p.anchored ? "" : "-loose"}`,
    }),
  );
}

/**
 * 전략을 순서대로 돌린다.
 *
 * 값싼 전략이 조금 건져도 뒤 전략이 훨씬 많이 건지는 경우가 흔하므로, 표본이 충분해질
 * 때까지 다음 전략도 계속 시도한다. 다만 **개수보다 정확도가 우선**이다.
 * 작성자·시각 앵커에 실패한 블록(`-loose`)은 남의 댓글이나 UI 문구가 섞일 수 있어
 * 1/4로 깎아 계산한다. 그래서 "정확한 캡션 1건"이 "출처 불명 10블록"을 이긴다.
 */
const ENOUGH_PROFILE = 12;

interface Strategy {
  name: string;
  run: () => Promise<Post[]>;
  /** 실패했을 때 남길 메시지 */
  onEmpty: string;
  /** false면 건너뛴다 */
  enabled?: boolean;
  /** 건너뛸 때 남길 메시지 */
  skipNote?: string;
}

function looseCount(posts: Post[]): number {
  return posts.filter((p) => p.strategy?.endsWith("-loose")).length;
}

/** 정확도를 반영한 점수. loose 블록은 1/4만 인정한다. */
function qualityScore(posts: Post[]): number {
  const loose = looseCount(posts);
  return posts.length - loose + loose * 0.25;
}

async function runStrategies(
  ref: SourceRef,
  limit: number,
  strategies: Strategy[],
  finalHint: string,
): Promise<FetchResult> {
  const notes: string[] = [];
  // 개별 글 URL이면 한 건만 정확히 얻으면 끝이다
  const enough = ref.kind === "post" ? 1 : ENOUGH_PROFILE;
  let best: { posts: Post[]; name: string; score: number } = { posts: [], name: "none", score: 0 };

  for (const s of strategies) {
    if (s.enabled === false) {
      if (s.skipNote) notes.push(s.skipNote);
      continue;
    }
    let posts: Post[] = [];
    try {
      posts = await s.run();
    } catch (err) {
      notes.push(`${s.name} 오류: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (posts.length === 0) {
      notes.push(s.onEmpty);
      continue;
    }
    const loose = looseCount(posts);
    const score = qualityScore(posts);
    notes.push(`${s.name}: ${posts.length}건 확보${loose > 0 ? ` (앵커 실패 ${loose}건, 정확도 낮음)` : ""}`);
    if (score > best.score) best = { posts, name: s.name, score };
    if (best.score >= enough) break;
  }

  if (best.posts.length === 0) {
    notes.push(finalHint);
    return { source: ref, posts: [], ok: false, strategy: "none", notes };
  }
  notes.push(`채택: ${best.name} (${best.posts.length}건)`);
  return {
    source: ref,
    posts: best.posts.slice(0, limit),
    ok: true,
    strategy: best.posts[0]?.strategy ?? best.name,
    notes,
  };
}

async function viaStaticHtml(ref: SourceRef, prefix: string): Promise<Post[]> {
  if (!ref.url) return [];
  const res = await httpGet(ref.url, { escalate: false });
  if (!res.ok || res.body.length < 1000) return [];
  return minePostsFromHtml(res.body, ref, prefix);
}

/**
 * TLS 지문 위장으로 공개 HTML을 받아 캡션을 캔다.
 *
 * Instagram·Threads는 TLS ClientHello 지문으로 클라이언트를 가른다.
 * 평범한 fetch는 빈 JS 셸(619KB, 캡션 0건)을 받지만, 브라우저 지문으로 요청하면
 * 프리페치 JSON이 포함된 페이지(844KB, 캡션 12건)가 온다.
 * 헤드리스 브라우저와 같은 결과를 1초 안에 얻는 경로다.
 */
async function viaImpersonate(ref: SourceRef, prefix: string): Promise<Post[]> {
  if (!ref.url) return [];
  const res = await impersonateGet(ref.url, {
    isGood: (r) => r.ok && /"caption"|"edge_media_to_caption"|og:description/.test(r.body),
  });
  if (!res?.ok) return [];
  return minePostsFromHtml(res.body, ref, `${prefix}:impersonate`);
}

/**
 * 프로필에서 shortcode를 뽑아 개별 게시글을 순회한다 (TLS 지문 위장, 브라우저 없음).
 * 프로필 HTML만으로도 캡션이 나오지만, 잘려 있거나 수가 적을 때 이걸로 보강한다.
 */
async function viaImpersonateCrawl(ref: SourceRef, limit: number, prefix: string): Promise<Post[]> {
  if (!ref.url) return [];
  const profile = await impersonateGet(ref.url);
  if (!profile?.ok) return [];

  const fromProfile = minePostsFromHtml(profile.body, ref, `${prefix}:impersonate`);
  const codes = extractShortcodes(profile.body, Math.min(limit, 24), ref.platform);
  if (codes.length === 0) return fromProfile;

  debug(`${prefix}: shortcode ${codes.length}개 → 개별 게시글 순회 (TLS 위장)`);
  const seenCodes = new Set<string>();
  const posts: Post[] = [...fromProfile];
  const seenText = new Set(posts.map((p) => p.text.slice(0, 100)));

  for (const code of codes) {
    if (posts.length >= limit) break;
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);
    const postUrl =
      ref.platform === "threads"
        ? `https://www.threads.com/@${ref.handle ?? ""}/post/${code}`
        : `https://www.instagram.com/p/${code}/`;
    const res = await impersonateGet(postUrl, { timeoutMs: 25_000 });
    if (!res?.ok) continue;
    const postRef: SourceRef = { ...ref, kind: "post", url: postUrl, postId: code };
    for (const p of minePostsFromHtml(res.body, postRef, `${prefix}:impersonate-crawl`)) {
      const key = p.text.slice(0, 100);
      if (seenText.has(key)) continue;
      seenText.add(key);
      posts.push({ ...p, id: p.id === postRef.url || !p.id ? code : p.id, url: postUrl });
      if (posts.length >= limit) break;
    }
  }
  return posts;
}

export interface MetaFetchOptions {
  /** 헤드리스 브라우저 전략 사용 (기본 true, playwright 없으면 자동 비활성) */
  useBrowser?: boolean;
  /** TLS 지문 위장 전략 사용 (기본 true, impit 없으면 자동 비활성) */
  useImpersonate?: boolean;
}

/** Threads 어댑터. TLS 지문 위장 → 공개 HTML → 리더 프록시 → 헤드리스 브라우저. */
export async function fetchThreads(ref: SourceRef, limit: number, options: MetaFetchOptions = {}): Promise<FetchResult> {
  if (!ref.url) return { source: ref, posts: [], ok: false, strategy: "none", notes: ["URL이 없습니다."] };
  const useBrowser = options.useBrowser !== false;
  const useImpersonate = options.useImpersonate !== false;
  return runStrategies(
    ref,
    limit,
    [
      {
        name: "TLS 지문 위장",
        run: () =>
          ref.kind === "profile" ? viaImpersonateCrawl(ref, limit, "threads") : viaImpersonate(ref, "threads"),
        onEmpty: `TLS 지문 위장으로도 게시글 JSON이 없음. ${IMPERSONATE_INSTALL_HINT}`,
        enabled: useImpersonate,
        skipNote: "TLS 지문 위장은 --no-impersonate 로 비활성화됨",
      },
      { name: "공개 HTML 임베드 JSON", run: () => viaStaticHtml(ref, "threads"), onEmpty: "평범한 fetch로는 게시글 JSON이 없음 (JS 셸만 반환)" },
      { name: "리더 프록시(r.jina.ai)", run: () => viaReader(ref, "threads"), onEmpty: "리더 프록시에서 게시글을 찾지 못함" },
      {
        name: "헤드리스 브라우저",
        run: () => viaBrowser(ref, "threads"),
        onEmpty: `헤드리스 브라우저 결과 없음. ${BROWSER_INSTALL_HINT}`,
        enabled: useBrowser,
        skipNote: "헤드리스 브라우저 전략은 --no-browser 로 비활성화됨",
      },
    ],
    ref.kind === "profile"
      ? "Threads 프로필에서 게시글을 얻지 못했습니다. 로그인 벽 이전에 보이는 글이 없거나 비공개 계정입니다. 개별 글 URL을 넣거나 --input 을 쓰세요."
      : "Threads 수집 실패. 글을 복사해 --input 파일로 넘겨주세요.",
  );
}

/** Instagram 어댑터. TLS 지문 위장이 1순위 — 브라우저 없이 프로필 캡션을 얻는다. */
export async function fetchInstagram(ref: SourceRef, limit: number, options: MetaFetchOptions = {}): Promise<FetchResult> {
  if (!ref.url) return { source: ref, posts: [], ok: false, strategy: "none", notes: ["URL이 없습니다."] };
  const useBrowser = options.useBrowser !== false;
  const useImpersonate = options.useImpersonate !== false;
  return runStrategies(
    ref,
    limit,
    [
      {
        name: "TLS 지문 위장",
        run: () =>
          ref.kind === "profile" ? viaImpersonateCrawl(ref, limit, "instagram") : viaImpersonate(ref, "instagram"),
        onEmpty: `TLS 지문 위장으로도 캡션이 없음 (비공개 계정이거나 삭제된 글). ${IMPERSONATE_INSTALL_HINT}`,
        enabled: useImpersonate,
        skipNote: "TLS 지문 위장은 --no-impersonate 로 비활성화됨",
      },
      { name: "공개 HTML 임베드 JSON", run: () => viaStaticHtml(ref, "instagram"), onEmpty: "평범한 fetch로는 캡션이 없음 (JS 셸만 반환)" },
      { name: "리더 프록시(r.jina.ai)", run: () => viaReader(ref, "instagram"), onEmpty: "리더 프록시에서 캡션을 찾지 못함" },
      {
        name: "헤드리스 브라우저 + 게시글 순회",
        run: () => viaBrowserInstagramProfile(ref, limit),
        onEmpty: "프로필에서 게시글 shortcode를 얻지 못했습니다",
        enabled: useBrowser && ref.kind === "profile",
        ...(useBrowser ? {} : { skipNote: "헤드리스 브라우저 전략은 --no-browser 로 비활성화됨" }),
      },
      {
        name: "헤드리스 브라우저",
        run: () => viaBrowser(ref, "instagram"),
        onEmpty: `헤드리스 브라우저 결과 없음. ${BROWSER_INSTALL_HINT}`,
        enabled: useBrowser && ref.kind !== "profile",
      },
    ],
    ref.kind === "profile"
      ? "Instagram 프로필에서 캡션을 얻지 못했습니다. 비공개 계정이면 공개 경로로는 열리지 않습니다. 개별 게시글 URL을 넣거나 --input 을 쓰세요."
      : "Instagram 수집 실패. 캡션을 복사해 --input 파일로 넘겨주세요.",
  );
}

/**
 * 프로필 HTML에서 개별 게시글 코드를 뽑는다.
 * Instagram은 `/p/{code}/`·`/reel/{code}/`, Threads는 `/post/{code}` 형태다.
 */
export function extractShortcodes(html: string, max = 24, platform: Platform = "instagram"): string[] {
  const re =
    platform === "threads"
      ? /\/post\/([A-Za-z0-9_-]{8,})/g
      : /\/(?:p|reel)\/([A-Za-z0-9_-]{8,})\//g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const code = m[1];
    if (code && !out.includes(code)) out.push(code);
    if (out.length >= max) break;
  }
  // 임베드 JSON의 "code" 필드도 함께 본다 (링크가 없는 렌더링 형태 대응)
  if (out.length < max) {
    const jsonRe = /"code"\s*:\s*"([A-Za-z0-9_-]{8,})"/g;
    let j: RegExpExecArray | null;
    while ((j = jsonRe.exec(html)) !== null) {
      const code = j[1];
      if (code && !out.includes(code)) out.push(code);
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * Instagram 프로필 크롤.
 * 프로필 페이지는 로그인 없이 캡션을 주지 않지만 게시글 shortcode는 HTML에 남아 있다.
 * 그 코드로 개별 게시글 페이지를 돌면서 og:description에서 캡션을 얻는다.
 */
async function viaBrowserInstagramProfile(ref: SourceRef, limit: number): Promise<Post[]> {
  if (!ref.url) return [];
  const session = await openBrowser();
  if (!session) return [];
  try {
    const profile = await session.render(ref.url, { scrolls: 4 });
    if (!profile) return [];
    const codes = extractShortcodes(profile.html, Math.min(limit, 24));
    if (codes.length === 0) {
      debug("instagram: 프로필에서 shortcode를 찾지 못함");
      return [];
    }
    debug(`instagram: shortcode ${codes.length}개 발견 → 개별 게시글 순회`);

    const posts: Post[] = [];
    for (const code of codes) {
      const postUrl = `https://www.instagram.com/p/${code}/`;
      const rendered = await session.render(postUrl, { scrolls: 0, scrollDelayMs: 0 });
      if (!rendered) continue;
      const postRef: SourceRef = { ...ref, kind: "post", url: postUrl, postId: code };
      const mined = minePostsFromHtml(rendered.html, postRef, "instagram:browser-crawl");
      for (const p of mined) posts.push({ ...p, id: code, url: postUrl });
      if (posts.length >= limit) break;
    }
    return posts;
  } finally {
    await session.close();
  }
}

