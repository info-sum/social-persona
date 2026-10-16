import * as cheerio from "cheerio";
import { htmlToText } from "./rss.js";

export interface PageMeta {
  title?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
  siteName?: string;
  canonical?: string;
}

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "iframe",
  "figure figcaption",
  "[role=navigation]",
  "[role=banner]",
  "[aria-hidden=true]",
  ".comment",
  ".comments",
  "#comments",
  ".sidebar",
  ".advertisement",
  ".ad",
  ".related",
  ".share",
  ".sns",
  ".pagination",
  ".cookie",
];

const ARTICLE_SELECTORS = [
  "article",
  "main article",
  "[itemprop=articleBody]",
  ".post-content",
  ".entry-content",
  ".article-body",
  ".article__body",
  ".se-main-container", // 네이버 블로그 스마트에디터 ONE
  "#postViewArea", // 네이버 구버전
  ".tt_article_useless_p_margin", // 티스토리
  ".wrap_body", // 브런치
  ".article_view",
  ".markdown-body",
  ".atom-one", // velog
  "main",
  "#content",
  ".content",
];

export function loadHtml(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}

export function extractMeta(html: string): PageMeta {
  const $ = cheerio.load(html);
  const metaContent = (selector: string): string | undefined => {
    const v = $(selector).first().attr("content");
    return v && v.trim() ? v.trim() : undefined;
  };
  return {
    title:
      metaContent('meta[property="og:title"]') ??
      metaContent('meta[name="twitter:title"]') ??
      ($("title").first().text().trim() || undefined),
    description:
      metaContent('meta[property="og:description"]') ??
      metaContent('meta[name="twitter:description"]') ??
      metaContent('meta[name="description"]'),
    author:
      metaContent('meta[name="author"]') ??
      metaContent('meta[property="article:author"]') ??
      metaContent('meta[name="twitter:creator"]'),
    publishedAt:
      metaContent('meta[property="article:published_time"]') ??
      metaContent('meta[name="date"]') ??
      $("time[datetime]").first().attr("datetime"),
    siteName: metaContent('meta[property="og:site_name"]'),
    canonical: $('link[rel="canonical"]').first().attr("href"),
  };
}

/** 페이지에 선언된 RSS/Atom/JSON 피드 URL을 절대 URL로 반환. */
export function discoverFeeds(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $('link[rel="alternate"], link[rel="feed"]').each((_, el) => {
    const type = ($(el).attr("type") ?? "").toLowerCase();
    const href = $(el).attr("href");
    if (!href) return;
    if (
      type.includes("rss") ||
      type.includes("atom") ||
      type.includes("xml") ||
      type.includes("json") ||
      /(rss|atom|feed)/i.test(href)
    ) {
      try {
        out.push(new URL(href, baseUrl).toString());
      } catch {
        /* 무시 */
      }
    }
  });
  return [...new Set(out)];
}

/** JSON-LD 블록들을 파싱해 배열로 반환. */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of items) {
        if (it && typeof it === "object") {
          const rec = it as Record<string, unknown>;
          out.push(rec);
          const graph = rec["@graph"];
          if (Array.isArray(graph)) {
            for (const g of graph) if (g && typeof g === "object") out.push(g as Record<string, unknown>);
          }
        }
      }
    } catch {
      /* 깨진 JSON-LD 무시 */
    }
  });
  return out;
}

/**
 * 본문 추출. 알려진 셀렉터를 우선 시도하고,
 * 실패하면 텍스트 밀도가 가장 높은 블록을 고른다.
 */
export function extractArticleText(html: string): string {
  const $ = cheerio.load(html);
  $(NOISE_SELECTORS.join(",")).remove();

  let best = "";
  for (const sel of ARTICLE_SELECTORS) {
    const node = $(sel).first();
    if (node.length === 0) continue;
    const text = htmlToText(node.html() ?? "");
    if (text.length > best.length) best = text;
    if (best.length > 600) break;
  }

  if (best.length < 200) {
    // 밀도 기반 폴백: p 태그를 가장 많이 품은 컨테이너
    let bestScore = 0;
    let bestNode = "";
    $("div, section, td").each((_, el) => {
      const node = $(el);
      const paragraphs = node.children("p").length;
      if (paragraphs < 2) return;
      const text = node.text().replace(/\s+/g, " ").trim();
      const links = node.find("a").length;
      const score = text.length - links * 40 + paragraphs * 30;
      if (score > bestScore) {
        bestScore = score;
        bestNode = htmlToText(node.html() ?? "");
      }
    });
    if (bestNode.length > best.length) best = bestNode;
  }

  if (best.length < 100) {
    best = htmlToText($("body").html() ?? "");
  }
  return best.replace(/\n{3,}/g, "\n\n").trim();
}

/** 같은 도메인 내 글 링크 후보를 수집 (프로필/목록 페이지용). */
export function extractInternalLinks(html: string, baseUrl: string, max = 40): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    try {
      const u = new URL(href, baseUrl);
      if (u.host !== base.host) return;
      u.hash = "";
      const path = u.pathname;
      if (path === base.pathname) return;
      if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|mp4)$/i.test(path)) return;
      out.push(u.toString());
    } catch {
      /* 무시 */
    }
  });
  return [...new Set(out)].slice(0, max);
}

/**
 * r.jina.ai 마크다운 응답에서 잡음(리더 헤더, 이미지, 링크 목록)을 걷어낸다.
 */
export function cleanReaderMarkdown(markdown: string): string {
  // 이미지 먼저 제거한다. `[![alt](img)](href)` 처럼 링크에 감싸인 경우가 많아
  // 링크 평탄화보다 먼저 해야 한다.
  const withoutImages = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  const lines = withoutImages.split("\n");
  const kept: string[] = [];
  let inCodeFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inCodeFence = !inCodeFence;
    if (inCodeFence) {
      kept.push(line);
      continue;
    }
    if (/^(Title|URL Source|Published Time|Markdown Content|Warning|Images):/i.test(line)) continue;
    if (/^\s*[-*]\s*\[[^\]]*\]\([^)]*\)\s*$/.test(line)) continue; // 링크만 있는 목록 항목
    if (/^\s*={3,}\s*$/.test(line)) continue;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 링크는 텍스트만
    .replace(/^\s*\[\s*\]\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
