import type { Platform, SourceKind, SourceRef } from "../types.js";

const STRIP_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "igsh",
  "igshid",
  "img_index",
  "s",
  "t",
  "ref_src",
  "ref_url",
  "fbclid",
  "gclid",
]);

const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com", "nitter.net"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "instagr.am", "ig.me"]);
const THREADS_HOSTS = new Set(["threads.net", "threads.com"]);

/** 블로그로 취급하는 대표 호스트 (그 외 도메인도 blog로 폴백된다) */
const KNOWN_BLOG_HOSTS = [
  "blog.naver.com",
  "m.blog.naver.com",
  "post.naver.com",
  "brunch.co.kr",
  "velog.io",
  "tistory.com",
  "medium.com",
  "substack.com",
  "wordpress.com",
  "ghost.io",
  "dev.to",
  "hashnode.dev",
  "note.com",
];

function stripWww(host: string): string {
  return host.replace(/^www\./, "");
}

/** 서브도메인까지 감안한 호스트 매칭 */
function hostMatches(host: string, set: Set<string>): boolean {
  if (set.has(host)) return true;
  for (const h of set) {
    if (host.endsWith(`.${h}`)) return true;
  }
  return false;
}

export function normalizeUrl(input: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const u = new URL(withScheme);
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (STRIP_QUERY_KEYS.has(key)) u.searchParams.delete(key);
  }
  u.host = stripWww(u.host.toLowerCase());
  if (u.pathname !== "/" && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

export function isUrlLike(input: string): boolean {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^@[A-Za-z0-9_.]{1,30}$/.test(s)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true;
  // 도메인처럼 생겼는지
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?)/i.test(s);
}

const X_RESERVED = new Set([
  "home",
  "explore",
  "notifications",
  "messages",
  "search",
  "settings",
  "i",
  "compose",
  "hashtag",
  "intent",
]);

/**
 * 입력 한 줄을 SourceRef로 정규화한다.
 * - URL, `@handle`, `x:@handle` 형태의 축약 입력 모두 처리
 * - 파일 경로는 kind="file"
 */
export function detectSource(input: string): SourceRef {
  const raw = input.trim();

  // 1) 축약 입력: "x:@user", "instagram:user", "threads:@user"
  const shorthand = /^(x|twitter|instagram|ig|threads|blog|rss)\s*:\s*@?([A-Za-z0-9_.-]+)$/i.exec(raw);
  if (shorthand) {
    const key = shorthand[1]!.toLowerCase();
    const handle = shorthand[2]!;
    const platform: Platform =
      key === "twitter" ? "x" : key === "ig" ? "instagram" : key === "rss" ? "blog" : (key as Platform);
    return {
      raw,
      platform,
      kind: "profile",
      handle,
      url: profileUrlFor(platform, handle),
    };
  }

  // 2) 로컬 파일
  if (!isUrlLike(raw) && /^[./~]|\.(txt|md|json|csv)$/i.test(raw)) {
    return { raw, platform: "manual", kind: "file" };
  }

  // 3) 순수 @handle → 플랫폼 불명
  if (/^@[A-Za-z0-9_.]{1,30}$/.test(raw)) {
    return { raw, platform: "unknown", kind: "profile", handle: raw.slice(1) };
  }

  if (!isUrlLike(raw)) {
    return { raw, platform: "manual", kind: "text" };
  }

  let u: URL;
  try {
    u = new URL(normalizeUrl(raw));
  } catch {
    return { raw, platform: "unknown", kind: "site" };
  }

  const host = u.host;
  const segments = u.pathname.split("/").filter(Boolean);
  const url = u.toString();

  // X / Twitter
  if (hostMatches(host, X_HOSTS)) {
    const first = segments[0];
    if (!first || X_RESERVED.has(first.toLowerCase())) {
      return { raw, platform: "x", kind: "site", url };
    }
    const handle = first.replace(/^@/, "");
    // /user/status/123
    const statusIdx = segments.findIndex((s) => s === "status" || s === "statuses");
    if (statusIdx > 0 && segments[statusIdx + 1]) {
      return { raw, platform: "x", kind: "post", url, handle, postId: segments[statusIdx + 1] };
    }
    return { raw, platform: "x", kind: "profile", url, handle };
  }

  // Instagram
  if (hostMatches(host, INSTAGRAM_HOSTS)) {
    const first = segments[0]?.toLowerCase();
    if (first === "p" || first === "reel" || first === "reels" || first === "tv") {
      return { raw, platform: "instagram", kind: "post", url, postId: segments[1] };
    }
    if (!first || first === "explore" || first === "accounts") {
      return { raw, platform: "instagram", kind: "site", url };
    }
    return { raw, platform: "instagram", kind: "profile", url, handle: segments[0] };
  }

  // Threads
  if (hostMatches(host, THREADS_HOSTS)) {
    // /@user, /@user/post/ABC
    const first = segments[0] ?? "";
    const handle = first.startsWith("@") ? first.slice(1) : undefined;
    const postIdx = segments.findIndex((s) => s === "post");
    if (postIdx >= 0 && segments[postIdx + 1]) {
      return { raw, platform: "threads", kind: "post", url, handle, postId: segments[postIdx + 1] };
    }
    if (handle) return { raw, platform: "threads", kind: "profile", url, handle };
    return { raw, platform: "threads", kind: "site", url };
  }

  // RSS/Atom 피드처럼 생긴 URL
  if (/(\/(rss|feed|atom)(\.xml|\/)?$)|\.(rss|atom)$|\/feed\.xml$|\/rss\.xml$|\/atom\.xml$|\/index\.xml$/i.test(u.pathname)) {
    return { raw, platform: "blog", kind: "feed", url, handle: blogHandleOf(u) };
  }

  const isKnownBlog = KNOWN_BLOG_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  const kind: SourceKind = segments.length === 0 ? "site" : isKnownBlog && segments.length === 1 ? "profile" : "post";
  return {
    raw,
    platform: "blog",
    kind: segments.length === 0 ? "site" : kind,
    url,
    handle: blogHandleOf(u),
  };
}

function blogHandleOf(u: URL): string | undefined {
  const segments = u.pathname.split("/").filter(Boolean);
  const host = u.host;
  if (host.endsWith("blog.naver.com") || host.endsWith("velog.io") || host.endsWith("brunch.co.kr")) {
    const first = segments[0];
    if (first) return first.replace(/^@/, "");
  }
  if (host.endsWith("medium.com") && segments[0]?.startsWith("@")) return segments[0].slice(1);
  const sub = host.split(".")[0];
  if (sub && sub !== host && sub !== "blog" && sub !== "www") return sub;
  return host;
}

export function profileUrlFor(platform: Platform, handle: string): string | undefined {
  const h = handle.replace(/^@/, "");
  switch (platform) {
    case "x":
      return `https://x.com/${h}`;
    case "instagram":
      return `https://instagram.com/${h}`;
    case "threads":
      return `https://www.threads.com/@${h}`;
    default:
      return undefined;
  }
}

/** 여러 입력을 받아 중복 제거된 SourceRef 목록으로. */
export function detectSources(inputs: string[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const input of inputs) {
    const trimmed = input.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const ref = detectSource(trimmed);
    const key = `${ref.platform}|${ref.kind}|${ref.url ?? ref.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}
