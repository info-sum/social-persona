const INITIALS = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
];
const MEDIALS = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi",
  "yu", "eu", "ui", "i",
];
const FINALS = [
  "", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t",
  "t", "ng", "t", "t", "k", "t", "p", "t",
];

const SYLLABLE_BASE = 0xac00;
const SYLLABLE_LAST = 0xd7a3;

/** 한글을 로마자(국어의 로마자 표기법 근사)로 옮긴다. 음운 변화는 반영하지 않는다. */
export function romanizeHangul(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < SYLLABLE_BASE || code > SYLLABLE_LAST) {
      out += ch;
      continue;
    }
    const offset = code - SYLLABLE_BASE;
    const initial = Math.floor(offset / 588);
    const medial = Math.floor((offset % 588) / 28);
    const final = offset % 28;
    out += `${INITIALS[initial] ?? ""}${MEDIALS[medial] ?? ""}${FINALS[final] ?? ""}`;
  }
  return out;
}

/** 파일명·디렉토리명으로 안전한 슬러그. 한글은 로마자로 옮긴다. */
export function slugify(input: string, fallback = "persona"): string {
  const romanized = romanizeHangul(input.trim());
  const base = romanized
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const slug = base.length >= 2 ? base : fallback;
  return slug.slice(0, 48).replace(/-+$/, "");
}

/**
 * 스킬 디렉토리/식별자 이름. 소문자 영숫자와 하이픈만 쓰고 `-persona` 접미사를 붙인다.
 */
export function skillName(input: string, fallback: string): string {
  const base = slugify(input, fallback);
  const cleaned = base.replace(/-?persona$/, "") || fallback;
  return `${cleaned}-persona`.slice(0, 64);
}
