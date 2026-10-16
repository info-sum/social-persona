/** 한국어/영어 혼용 텍스트를 다루는 토크나이즈·정규화 유틸. */

export const URL_RE = /https?:\/\/[^\s<>()[\]{}"']+|(?:^|\s)(?:www\.)[^\s<>()[\]{}"']+/gi;
export const MENTION_RE = /(?:^|[^\w@])@([A-Za-z0-9_.]{2,30})/g;
export const HASHTAG_RE = /(?:^|\s)#([\p{L}\p{N}_]{1,50})/gu;
export const EMOJI_RE = /\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*/gu;
const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/g;
const LATIN_RE = /[A-Za-z]/g;

export interface StrippedText {
  /** URL/멘션/해시태그/이모지를 제거한 본문 */
  clean: string;
  urls: string[];
  mentions: string[];
  hashtags: string[];
  emojis: string[];
}

export function countMatches(text: string, re: RegExp): number {
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let n = 0;
  while (r.exec(text) !== null) n += 1;
  return n;
}

export function extractAll(text: string, re: RegExp, group = 0): string[] {
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    const v = m[group] ?? m[0];
    if (v) out.push(v.trim());
    if (m.index === r.lastIndex) r.lastIndex += 1;
  }
  return out;
}

/** 코드 블록 자리표시자. 분석에서는 제거하고, 원문 표본에는 남겨 사람이 읽을 수 있게 한다. */
export const CODE_PLACEHOLDER = "[코드]";
const CODE_PLACEHOLDER_RE = /\[코드\]/g;

export function strip(text: string): StrippedText {
  const urls = extractAll(text, URL_RE);
  const mentions = extractAll(text, MENTION_RE, 1);
  const hashtags = extractAll(text, HASHTAG_RE, 1);
  const emojis = extractAll(text, EMOJI_RE);
  let clean = text.replace(URL_RE, " ");
  clean = clean.replace(MENTION_RE, " ");
  clean = clean.replace(HASHTAG_RE, " ");
  clean = clean.replace(EMOJI_RE, " ");
  // 코드 자리표시자가 토픽·어휘로 잡히면 안 된다
  clean = clean.replace(CODE_PLACEHOLDER_RE, " ");
  clean = clean.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n");
  return { clean: clean.trim(), urls, mentions, hashtags, emojis };
}

/**
 * 문장 분리. 줄바꿈은 문장 경계로 취급하고,
 * 종결 부호(. ! ? … 。 ！ ？) 뒤 공백에서도 자른다.
 * 소수점/약어(e.g. 3.5, Mr.)에서 잘리지 않도록 숫자·단일 대문자 뒤 마침표는 보호한다.
 */
export function splitSentences(text: string): string[] {
  const protectedText = text
    .replace(/(\d)\.(\d)/g, "$1\u0001$2")
    .replace(/\b([A-Z])\.\s?([A-Z])\./g, "$1\u0001 $2\u0001");

  const byLine = protectedText.split(/\n+/);
  const out: string[] = [];
  for (const line of byLine) {
    const parts = line.split(/(?<=[.!?…。！？]["')\]]?)\s+/);
    for (const p of parts) {
      const s = p.replace(/\u0001/g, ".").trim();
      if (s.length > 0) out.push(s);
    }
  }
  return out;
}

/** 어절(공백 단위) 토큰. 주변 구두점 제거. */
export function tokenizeWords(text: string): string[] {
  return text
    .split(/[\s]+/)
    .map((w) =>
      w
        .replace(/^[^\p{L}\p{N}]+/u, "")
        .replace(/[^\p{L}\p{N}]+$/u, "")
        .toLowerCase(),
    )
    .filter((w) => w.length > 0);
}

export function ngrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i += 1) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

export interface LangMix {
  ko: number;
  en: number;
  other: number;
}

export function languageMix(text: string): LangMix {
  const letters = text.replace(/[^\p{L}]/gu, "");
  const total = letters.length;
  if (total === 0) return { ko: 0, en: 0, other: 0 };
  const ko = (letters.match(HANGUL_RE) ?? []).length;
  const en = (letters.match(LATIN_RE) ?? []).length;
  return {
    ko: ko / total,
    en: en / total,
    other: Math.max(0, (total - ko - en) / total),
  };
}

export function hasHangul(text: string): boolean {
  return HANGUL_RE.test(text);
}

/** 표시용 축약 */
export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** 마크다운 코드 펜스·인라인 코드를 자리표시자로 바꾼다. 코드는 문체 신호가 아니다. */
export function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "\n[코드]\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n[코드]\n")
    .replace(/^(?: {4}|\t)\S[^\n]*$/gm, "[코드]")
    .replace(/`[^`\n]+`/g, "[코드]")
    .replace(/(?:\n\[코드\]\n?)+/g, "\n[코드]\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 여러 줄 텍스트를 게시글 단위로 분할 (빈 줄 2개 또는 `---` 구분자) */
export function splitPostBlocks(raw: string): string[] {
  return raw
    .split(/\n\s*(?:-{3,}|={3,}|\*{3,})\s*\n|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function dedupe<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyOf(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
