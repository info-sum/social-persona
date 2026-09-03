import type { FetchResult, Post, SourceRef } from "../../types.js";
import { httpGet, readerFetch } from "../http.js";
import { cleanReaderMarkdown, discoverFeeds, extractArticleText, extractInternalLinks, extractMeta } from "../html.js";
import { parseFeed, parseJsonFeed, type ParsedFeed } from "../rss.js";
import { debug } from "../../util/log.js";
import { dedupe, stripCodeBlocks } from "../../util/text.js";

/** 플랫폼별로 알려진 피드 경로를 우선순위대로 만든다. */
export function candidateFeedUrls(rawUrl: string): string[] {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return [];
  }
  const host = u.host.replace(/^www\./, "");
  const segments = u.pathname.split("/").filter(Boolean);
  const first = segments[0] ?? "";
  const handle = first.replace(/^@+/, "");
  const out: string[] = [];

  if (host.endsWith("blog.naver.com") || host.endsWith("m.blog.naver.com")) {
    if (handle) out.push(`https://rss.blog.naver.com/${handle}.xml`);
  } else if (host.endsWith("velog.io")) {
    if (handle) out.push(`https://api.velog.io/rss/@${handle}`, `https://v2.velog.io/rss/@${handle}`);
  } else if (host.endsWith("brunch.co.kr")) {
    if (handle) out.push(`https://brunch.co.kr/rss/@@${handle}`);
  } else if (host.endsWith("medium.com")) {
    if (first.startsWith("@")) out.push(`https://medium.com/feed/${first}`);
    else if (handle) out.push(`https://medium.com/feed/@${handle}`, `https://${host}/feed`);
  } else if (host.endsWith("substack.com")) {
    out.push(`${u.origin}/feed`);
  } else if (host.endsWith("tistory.com")) {
    out.push(`${u.origin}/rss`);
  } else if (host.endsWith("note.com")) {
    if (handle) out.push(`https://note.com/${handle}/rss`);
  }

  // 일반적인 관례 경로
  for (const p of ["/rss", "/feed", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/feed.json", "/rss/feed"]) {
    out.push(`${u.origin}${p}`);
  }
  // 하위 경로 기준 (예: /blog/feed)
  if (segments.length > 0) {
    const prefix = `${u.origin}/${segments[0]}`;
    out.push(`${prefix}/rss`, `${prefix}/feed`, `${prefix}/rss.xml`);
  }
  return [...new Set(out)];
}

async function tryFeed(url: string): Promise<ParsedFeed | undefined> {
  const res = await httpGet(url, { bot: true, accept: "application/rss+xml,application/atom+xml,application/xml,application/json;q=0.9,*/*;q=0.8", retries: 1, timeoutMs: 12_000 });
  if (!res.ok || res.body.trim().length === 0) return undefined;
  const body = res.body.trim();
  if (body.startsWith("{")) {
    const jf = parseJsonFeed(body);
    if (jf && jf.items.length > 0) return jf;
    return undefined;
  }
  if (!body.startsWith("<")) return undefined;
  if (/^<!doctype html|^<html/i.test(body)) return undefined;
  const feed = parseFeed(body);
  if (feed && feed.items.length > 0) return feed;
  return undefined;
}

function feedToPosts(feed: ParsedFeed, ref: SourceRef, strategy: string): Post[] {
  return feed.items
    .map((item, idx) => {
      const text = stripCodeBlocks([item.title, item.content].filter(Boolean).join("\n\n").trim());
      return {
        id: item.id ?? item.link ?? `${ref.platform}-${idx}`,
        platform: ref.platform,
        text,
        url: item.link,
        title: item.title,
        author: item.author ?? feed.author,
        createdAt: item.publishedAt,
        tags: item.categories?.filter(Boolean),
        strategy,
      } satisfies Post;
    })
    .filter((p) => p.text.length >= 40);
}

/** 개별 글 URL 하나를 본문 추출한다. */
export async function fetchSingleArticle(url: string, ref: SourceRef): Promise<Post | undefined> {
  const res = await httpGet(url);
  if (res.ok && res.body.length > 500) {
    const meta = extractMeta(res.body);
    const body = extractArticleText(res.body);
    if (body.length >= 120) {
      return {
        id: url,
        platform: ref.platform,
        url,
        title: meta.title,
        author: meta.author,
        createdAt: meta.publishedAt,
        text: stripCodeBlocks([meta.title, body].filter(Boolean).join("\n\n")),
        strategy: "html:article",
      };
    }
  }
  const reader = await readerFetch(url);
  if (reader.ok && reader.body.length > 200) {
    const cleaned = stripCodeBlocks(cleanReaderMarkdown(reader.body));
    if (cleaned.length >= 120) {
      return {
        id: url,
        platform: ref.platform,
        url,
        text: cleaned,
        strategy: "reader:jina",
      };
    }
  }
  return undefined;
}

/**
 * 블로그 어댑터.
 * 1) 피드(RSS/Atom/JSON) → 2) 페이지 내 피드 자동 발견 → 3) 관례 경로 → 4) 글 링크 크롤 → 5) 리더 프록시
 */
export async function fetchBlog(ref: SourceRef, limit: number): Promise<FetchResult> {
  const notes: string[] = [];
  const url = ref.url;
  if (!url) {
    return { source: ref, posts: [], ok: false, strategy: "none", notes: ["URL이 없습니다."] };
  }

  const feedCandidates: string[] = [];
  if (ref.kind === "feed") feedCandidates.push(url);

  // 페이지를 먼저 읽어 선언된 피드를 찾는다 (post kind면 본문도 확보)
  let pageHtml = "";
  const pageRes = await httpGet(url);
  if (pageRes.ok) {
    pageHtml = pageRes.body;
    const declared = discoverFeeds(pageHtml, pageRes.finalUrl);
    if (declared.length > 0) {
      notes.push(`페이지에서 피드 ${declared.length}개 발견`);
      feedCandidates.push(...declared);
    }
  } else {
    notes.push(`페이지 직접 요청 실패 (status ${pageRes.status})`);
  }
  feedCandidates.push(...candidateFeedUrls(url));

  const tried = new Set<string>();
  for (const candidate of feedCandidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    const feed = await tryFeed(candidate);
    if (!feed) continue;
    let posts = feedToPosts(feed, ref, `feed:${candidate}`);
    if (posts.length === 0) continue;
    notes.push(`피드 사용: ${candidate} (${posts.length}건)`);

    // 피드가 요약만 담고 있으면 원문을 보강한다
    const avg = posts.reduce((a, p) => a + p.text.length, 0) / posts.length;
    if (avg < 400) {
      notes.push(`피드 본문이 짧음(평균 ${Math.round(avg)}자) → 원문 보강 시도`);
      const targets = posts.slice(0, Math.min(limit, 8));
      const enriched = await Promise.all(
        targets.map(async (p) => {
          if (!p.url) return p;
          const full = await fetchSingleArticle(p.url, ref);
          if (full && full.text.length > p.text.length * 1.5) {
            return { ...p, text: full.text, strategy: `${p.strategy}+${full.strategy}` };
          }
          return p;
        }),
      );
      posts = [...enriched, ...posts.slice(targets.length)];
    }
    return { source: ref, posts: posts.slice(0, limit), ok: true, strategy: `feed`, notes };
  }

  notes.push("사용 가능한 피드를 찾지 못했습니다.");

  // 개별 글이면 그 글만이라도
  if (ref.kind === "post") {
    const single = await fetchSingleArticle(url, ref);
    if (single) {
      return { source: ref, posts: [single], ok: true, strategy: single.strategy ?? "html", notes };
    }
  }

  // 목록 페이지에서 글 링크를 훑는다
  if (pageHtml) {
    const links = extractInternalLinks(pageHtml, url, 30).filter((l) => /\d{4}|\/(posts?|entry|archives?|article)\//i.test(l));
    if (links.length > 0) {
      notes.push(`내부 링크 ${links.length}개에서 본문 크롤 시도`);
      const targets = links.slice(0, Math.min(limit, 10));
      const results = await Promise.all(targets.map((l) => fetchSingleArticle(l, ref)));
      const posts = dedupe(
        results.filter((p): p is Post => p !== undefined),
        (p) => p.id,
      );
      if (posts.length > 0) {
        return { source: ref, posts, ok: true, strategy: "crawl:links", notes };
      }
    }
  }

  // 최후: 리더 프록시로 페이지 전체
  const reader = await readerFetch(url);
  if (reader.ok) {
    const cleaned = cleanReaderMarkdown(reader.body);
    if (cleaned.length >= 200) {
      debug(`reader fallback length=${cleaned.length}`);
      notes.push("리더 프록시(r.jina.ai)로 페이지 텍스트만 확보");
      return {
        source: ref,
        posts: [{ id: url, platform: ref.platform, url, text: cleaned, strategy: "reader:jina" }],
        ok: true,
        strategy: "reader:jina",
        notes,
      };
    }
  }

  notes.push("모든 전략이 실패했습니다. --input 으로 본문을 직접 넣어주세요.");
  return { source: ref, posts: [], ok: false, strategy: "none", notes };
}
