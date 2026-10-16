import { splitPostBlocks } from "../util/text.js";

/**
 * 리더 프록시(r.jina.ai)가 돌려주는 타임라인 마크다운을 게시글로 자른다.
 *
 * X·Threads·Instagram의 렌더링 결과는 대개 아래 패턴을 반복한다.
 *
 *   handle          ← 작성자
 *   3h / 08/10/26   ← 게시 시각
 *   본문 …          ← 한 덩어리 또는 여러 단락
 *   1.9K            ← 좋아요·댓글 수 (숫자만 있는 블록)
 *
 * 작성자·시각 마커를 앵커로 삼아 본문만 걷어낸다.
 * 마커를 못 찾으면 잡음 블랙리스트 기반 필터로 폴백한다.
 */

/** UI 문구 — 본문일 수 없는 블록 */
const UI_NOISE = [
  "home","explore","search","notifications","messages","profile","more","new thread","post","posts","repost","reposts",
  "quote","share","like","likes","reply","replies","media","follow","following","followers","follow back","mention",
  "log in","login","sign up","signup","subscribe","translate post","show more","show less","see more","view",
  "threads","instagram","twitter","x","continue with instagram","report a problem","terms","privacy","cookies",
  "홈","검색","탐색","알림","메시지","프로필","더 보기","더보기","게시","게시물","리포스트","인용","공유","좋아요","답글",
  "미디어","팔로우","팔로잉","팔로워","로그인","가입하기","가입","번역","약관","개인정보","쿠키","문제 신고",
];

const UI_NOISE_SET = new Set(UI_NOISE);

const NUMERIC_ONLY = /^[\d][\d,.]*\s*[KMB만천억]?$/i;

const DATE_MARKERS: RegExp[] = [
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/, // 08/10/26
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{1,3}\s*[smhdwy]$/i, // 3h, 2d
  /^\d{1,3}\s*(?:초|분|시간|일|주|개월|달|년)\s*(?:전)?$/, // 3시간 전
  /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2}(?:,\s*\d{4})?$/i,
  /^\d{1,2}월\s*\d{1,2}일$/,
  /^\d{4}년\s*\d{1,2}월\s*\d{1,2}일$/,
  /^(?:방금|어제|오늘|yesterday|today|just now)$/i,
];

export function isDateMarker(block: string): boolean {
  const b = block.trim();
  if (b.length > 24) return false;
  return DATE_MARKERS.some((re) => re.test(b));
}

export function isUiNoise(block: string): boolean {
  const b = block.trim().replace(/^#+\s*/, "");
  if (b.length === 0) return true;
  const lower = b.toLowerCase();
  if (UI_NOISE_SET.has(lower)) return true;
  if (NUMERIC_ONLY.test(b)) return true;
  if (/^[\d,.]+\s*[KMB]?\s*(followers|following|팔로워|팔로잉)$/i.test(b)) return true;
  if (/^©\s*\d{4}/.test(b)) return true;
  if (/^(log in|sign up|로그인|가입)/i.test(b) && b.length < 80) return true;
  if (/^[^\p{L}\p{N}]+$/u.test(b)) return true; // 기호만
  return false;
}

/** 상대 시각 마커를 ISO 날짜로 바꾼다. 절대 날짜는 그대로 파싱. */
export function parseDateMarker(block: string, now = new Date()): string | undefined {
  const b = block.trim();

  const rel = /^(\d{1,3})\s*([smhdwy])$/i.exec(b);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.toLowerCase();
    const ms: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, y: 31_536_000_000 };
    return new Date(now.getTime() - n * (ms[unit] ?? 0)).toISOString();
  }

  const relKo = /^(\d{1,3})\s*(초|분|시간|일|주|개월|달|년)\s*전?$/.exec(b);
  if (relKo) {
    const n = Number(relKo[1]);
    const unit = relKo[2]!;
    const ms: Record<string, number> = {
      초: 1000,
      분: 60_000,
      시간: 3_600_000,
      일: 86_400_000,
      주: 604_800_000,
      개월: 2_592_000_000,
      달: 2_592_000_000,
      년: 31_536_000_000,
    };
    return new Date(now.getTime() - n * (ms[unit] ?? 0)).toISOString();
  }

  if (/^(방금|just now)$/i.test(b)) return now.toISOString();
  if (/^(오늘|today)$/i.test(b)) return now.toISOString();
  if (/^(어제|yesterday)$/i.test(b)) return new Date(now.getTime() - 86_400_000).toISOString();

  // MM/DD/YY
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(b);
  if (slash) {
    const yearRaw = Number(slash[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const d = new Date(Date.UTC(year, Number(slash[1]) - 1, Number(slash[2])));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  const koFull = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/.exec(b);
  if (koFull) {
    const d = new Date(Date.UTC(Number(koFull[1]), Number(koFull[2]) - 1, Number(koFull[3])));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  const parsed = new Date(b);
  return Number.isNaN(parsed.getTime()) ? undefined : toUtcMidnightIfDateOnly(b, parsed);
}

/**
 * 시각 정보가 없는 날짜 문자열은 로컬 자정으로 파싱된다.
 * 타임존에 따라 하루가 밀리므로 UTC 자정으로 고정한다.
 */
export function toUtcMidnightIfDateOnly(raw: string, parsed: Date): string {
  if (/\d:\d/.test(raw) || /[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) {
    return parsed.toISOString();
  }
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())).toISOString();
}

/** 로그인 벽·오류 페이지의 상용구. 게시글로 오인하면 엉뚱한 페르소나가 나온다. */
const BOILERPLATE: RegExp[] = [
  /this page isn'?t available/i,
  /the link (?:you followed )?may be broken/i,
  /(?:profile|page|post) may have been removed/i,
  /page not found/i,
  /something went wrong/i,
  /sorry, we'?re having trouble/i,
  /share everyday moments with (close )?friends/i,
  /sign up to see (photos|what)/i,
  /log in to see more/i,
  /join threads to share/i,
  /see what people are talking about/i,
  /create an account or log in/i,
  /this account is private/i,
  /follow to see (their|his|her) (photos|posts)/i,
  /페이지를 사용할 수 없습니다/,
  /링크가 잘못되었거나/,
  /페이지를 찾을 수 없습니다/,
  /비공개 계정입니다/,
  /로그인하여 더 보기/,
  /가입하여 .{0,20}보기/,
  /문제가 발생했습니다/,
  /계정을 만들거나 로그인/,
  /^\s*(?:cookie|쿠키) (?:policy|정책)/i,
  /enable javascript/i,
  /javascript를 사용하도록 설정/i,
  /just a moment\.{0,3}$/i,
  /verify you are human/i,
  /사람인지 확인/,
];

export function isBoilerplate(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  return BOILERPLATE.some((re) => re.test(t));
}

export interface ReaderPost {
  text: string;
  createdAt?: string;
  /** 앵커 패턴으로 잘라냈는지 (false면 폴백 필터 결과) */
  anchored: boolean;
}

const MIN_TEXT = 15;
const MAX_TEXT = 4000;

/**
 * 리더 마크다운을 게시글 목록으로 자른다.
 * @param handle 작성자 핸들 (있으면 앵커 정확도가 크게 올라간다)
 */
export function parseReaderTimeline(markdown: string, handle?: string): ReaderPost[] {
  const blocks = splitPostBlocks(markdown).map((b) => b.trim());
  const anchored = extractAnchored(blocks, handle);
  if (anchored.length > 0) return anchored;
  return extractByFilter(blocks);
}

function normalizeHandle(v: string): string {
  return v.trim().replace(/^@/, "").replace(/^#+\s*/, "").toLowerCase();
}

function extractAnchored(blocks: string[], handle?: string): ReaderPost[] {
  const target = handle ? normalizeHandle(handle) : undefined;
  const posts: ReaderPost[] = [];

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    const isAuthor = target !== undefined && normalizeHandle(block) === target;
    if (!isAuthor) continue;

    // 작성자 다음 블록이 시각 마커여야 게시글 시작으로 본다
    let cursor = i + 1;
    let createdAt: string | undefined;
    if (cursor < blocks.length && isDateMarker(blocks[cursor]!)) {
      createdAt = parseDateMarker(blocks[cursor]!);
      cursor += 1;
    } else {
      continue;
    }

    const parts: string[] = [];
    while (cursor < blocks.length) {
      const b = blocks[cursor]!;
      if (normalizeHandle(b) === target) break; // 다음 게시글
      if (isDateMarker(b)) break;
      if (NUMERIC_ONLY.test(b)) break; // 참여 수치 구간 진입
      if (!isUiNoise(b)) parts.push(b);
      cursor += 1;
    }

    const text = parts.join("\n\n").trim();
    if (text.length >= MIN_TEXT && text.length <= MAX_TEXT && !isBoilerplate(text)) {
      posts.push({ text, createdAt, anchored: true });
    }
    i = cursor - 1;
  }

  return dedupeByText(posts);
}

function extractByFilter(blocks: string[]): ReaderPost[] {
  const posts: ReaderPost[] = [];
  for (const b of blocks) {
    if (isUiNoise(b) || isDateMarker(b)) continue;
    const text = b.replace(/^#+\s*/, "").trim();
    if (text.length < 25 || text.length > MAX_TEXT) continue;
    // 문장다운 최소 조건: 어절이 넷 이상
    if (text.split(/\s+/).filter((w) => w.length > 0).length < 4) continue;
    if (isBoilerplate(text)) continue;
    posts.push({ text, anchored: false });
  }
  return dedupeByText(posts);
}

function dedupeByText(posts: ReaderPost[]): ReaderPost[] {
  const seen = new Set<string>();
  const out: ReaderPost[] = [];
  for (const p of posts) {
    const key = p.text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
