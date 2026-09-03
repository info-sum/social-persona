import * as cheerio from "cheerio";

/** 페이지에 박혀 있는 `<script type="application/json">` 블록들을 파싱해 반환. */
export function extractEmbeddedJson(html: string): unknown[] {
  const $ = cheerio.load(html);
  const out: unknown[] = [];
  $('script[type="application/json"], script[data-sjs], script[type="text/javascript"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw || raw.length < 20) return;
    const candidate = raw.startsWith("{") || raw.startsWith("[") ? raw : sliceJsonPayload(raw);
    if (!candidate) return;
    try {
      out.push(JSON.parse(candidate));
    } catch {
      /* 무시 */
    }
  });
  return out;
}

/** `window.__X = {...};` 형태에서 JSON 부분만 잘라낸다. */
function sliceJsonPayload(raw: string): string | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return raw.slice(start, end + 1);
}

export interface MinedPost {
  text: string;
  code?: string;
  pk?: string;
  takenAt?: number;
  likeCount?: number;
  username?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function numberish(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return undefined;
}

/**
 * Meta(Instagram/Threads) 계열 JSON 트리에서 게시글 텍스트를 캐낸다.
 * 스키마가 자주 바뀌므로 구조 대신 특징적인 키 조합을 찾는다.
 */
export function mineMetaPosts(roots: unknown[]): MinedPost[] {
  const found: MinedPost[] = [];
  const seen = new Set<string>();

  const push = (post: MinedPost): void => {
    const text = post.text.trim();
    if (text.length < 2) return;
    const key = post.pk ?? post.code ?? text.slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ ...post, text });
  };

  const walk = (node: unknown, depth: number, inheritedUser?: string): void => {
    if (depth > 30 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1, inheritedUser);
      return;
    }
    const rec = node as Record<string, unknown>;
    const user = isRecord(rec["user"]) ? (rec["user"]["username"] as string | undefined) : undefined;
    const currentUser = typeof user === "string" ? user : inheritedUser;

    // Threads: { caption: { text }, code, pk, taken_at, like_count }
    const caption = rec["caption"];
    if (isRecord(caption) && typeof caption["text"] === "string") {
      push({
        text: caption["text"],
        code: typeof rec["code"] === "string" ? rec["code"] : undefined,
        pk: typeof rec["pk"] === "string" ? rec["pk"] : numberish(rec["pk"])?.toString(),
        takenAt: numberish(rec["taken_at"]),
        likeCount: numberish(rec["like_count"]),
        username: currentUser,
      });
    }

    // Instagram GraphQL: edge_media_to_caption.edges[].node.text
    const edgeCaption = rec["edge_media_to_caption"];
    if (isRecord(edgeCaption) && Array.isArray(edgeCaption["edges"])) {
      for (const edge of edgeCaption["edges"]) {
        if (isRecord(edge) && isRecord(edge["node"]) && typeof edge["node"]["text"] === "string") {
          push({
            text: edge["node"]["text"],
            code: typeof rec["shortcode"] === "string" ? rec["shortcode"] : undefined,
            takenAt: numberish(rec["taken_at_timestamp"]),
            username: currentUser,
          });
        }
      }
    }

    // Threads 대체 스키마: { text: "...", pk, code } 조합
    if (typeof rec["text"] === "string" && (typeof rec["code"] === "string" || rec["pk"] !== undefined)) {
      const t = rec["text"];
      if (t.length >= 10) {
        push({
          text: t,
          code: typeof rec["code"] === "string" ? rec["code"] : undefined,
          pk: typeof rec["pk"] === "string" ? rec["pk"] : numberish(rec["pk"])?.toString(),
          takenAt: numberish(rec["taken_at"]),
          likeCount: numberish(rec["like_count"]),
          username: currentUser,
        });
      }
    }

    for (const v of Object.values(rec)) walk(v, depth + 1, currentUser);
  };

  for (const root of roots) walk(root, 0);
  return found;
}

/**
 * JSON 파싱이 불가능할 때를 위한 정규식 기반 캡션 추출.
 * `"caption":{"text":"..."}` / `"text":"..."` 패턴을 훑는다.
 */
export function mineCaptionsByRegex(html: string): string[] {
  const out: string[] = [];
  const re = /"(?:caption|text)"\s*:\s*(?:\{\s*"text"\s*:\s*)?"((?:[^"\\]|\\.){20,4000})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    try {
      const decoded = JSON.parse(`"${raw}"`) as string;
      if (decoded.trim().length >= 20) out.push(decoded);
    } catch {
      /* 무시 */
    }
  }
  return [...new Set(out)];
}
