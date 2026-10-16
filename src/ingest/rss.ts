import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  title?: string;
  link?: string;
  content: string;
  publishedAt?: string;
  author?: string;
  categories?: string[];
  id?: string;
}

export interface ParsedFeed {
  title?: string;
  author?: string;
  siteUrl?: string;
  items: FeedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: true,
  parseTagValue: false,
  removeNSPrefix: true,
  textNodeName: "#text",
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join("\n");
  if (typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if ("#text" in rec) return textOf(rec["#text"]);
    if ("@href" in rec) return String(rec["@href"]);
  }
  return "";
}

function linkOf(node: unknown): string | undefined {
  const links = asArray(node as unknown);
  for (const l of links) {
    if (typeof l === "string" && l.trim()) return l.trim();
    if (l && typeof l === "object") {
      const rec = l as Record<string, unknown>;
      const rel = rec["@rel"];
      if (rel === undefined || rel === "alternate") {
        const href = rec["@href"] ?? rec["#text"];
        if (typeof href === "string" && href.trim()) return href.trim();
      }
    }
  }
  return undefined;
}

/**
 * HTML 태그를 제거하고 블록 요소는 줄바꿈으로 보존한다.
 * 코드 블록은 문체 분석에 잡음이므로 자리표시자로 바꾼다.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<pre[\s\S]*?<\/pre>/gi, "\n[코드]\n")
    .replace(/<code[\s\S]*?<\/code>/gi, " [코드] ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|section|article)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** RSS 2.0 / Atom / RDF 피드를 공통 구조로 파싱. */
export function parseFeed(xml: string): ParsedFeed | undefined {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  // RSS 2.0 / RDF
  const rss = (doc["rss"] ?? doc["RDF"]) as Record<string, unknown> | undefined;
  if (rss) {
    const channel = (rss["channel"] ?? {}) as Record<string, unknown>;
    const rawItems = asArray(channel["item"] ?? (rss["item"] as unknown));
    return {
      title: textOf(channel["title"]) || undefined,
      siteUrl: textOf(channel["link"]) || undefined,
      author: textOf(channel["managingEditor"]) || textOf(channel["creator"]) || undefined,
      items: rawItems.map((raw) => {
        const it = raw as Record<string, unknown>;
        const html =
          textOf(it["encoded"]) || textOf(it["content"]) || textOf(it["description"]) || textOf(it["summary"]);
        return {
          title: textOf(it["title"]) || undefined,
          link: linkOf(it["link"]) ?? textOf(it["guid"]) ?? undefined,
          content: htmlToText(html),
          publishedAt: normalizeDate(textOf(it["pubDate"]) || textOf(it["date"]) || textOf(it["published"])),
          author: textOf(it["creator"]) || textOf(it["author"]) || undefined,
          categories: asArray(it["category"]).map(textOf).filter(Boolean),
          id: textOf(it["guid"]) || undefined,
        } satisfies FeedItem;
      }),
    };
  }

  // Atom
  const feed = doc["feed"] as Record<string, unknown> | undefined;
  if (feed) {
    const rawItems = asArray(feed["entry"]);
    return {
      title: textOf(feed["title"]) || undefined,
      siteUrl: linkOf(feed["link"]),
      author: textOf((feed["author"] as Record<string, unknown> | undefined)?.["name"]) || undefined,
      items: rawItems.map((raw) => {
        const it = raw as Record<string, unknown>;
        const html = textOf(it["content"]) || textOf(it["summary"]) || textOf(it["description"]);
        return {
          title: textOf(it["title"]) || undefined,
          link: linkOf(it["link"]),
          content: htmlToText(html),
          publishedAt: normalizeDate(textOf(it["published"]) || textOf(it["updated"])),
          author: textOf((it["author"] as Record<string, unknown> | undefined)?.["name"]) || undefined,
          categories: asArray(it["category"]).map((c) => {
            const rec = c as Record<string, unknown>;
            return String(rec["@term"] ?? textOf(c));
          }),
          id: textOf(it["id"]) || undefined,
        } satisfies FeedItem;
      }),
    };
  }

  // JSON Feed 는 별도 경로에서 처리
  return undefined;
}

export interface JsonFeed {
  title?: string;
  home_page_url?: string;
  author?: { name?: string };
  items?: {
    id?: string;
    url?: string;
    title?: string;
    content_text?: string;
    content_html?: string;
    summary?: string;
    date_published?: string;
    tags?: string[];
    author?: { name?: string };
  }[];
}

export function parseJsonFeed(body: string): ParsedFeed | undefined {
  let json: JsonFeed;
  try {
    json = JSON.parse(body) as JsonFeed;
  } catch {
    return undefined;
  }
  if (!Array.isArray(json.items)) return undefined;
  return {
    title: json.title,
    siteUrl: json.home_page_url,
    author: json.author?.name,
    items: json.items.map((it) => ({
      title: it.title,
      link: it.url,
      content: it.content_text ?? htmlToText(it.content_html ?? it.summary ?? ""),
      publishedAt: normalizeDate(it.date_published),
      author: it.author?.name,
      categories: it.tags,
      id: it.id,
    })),
  };
}
