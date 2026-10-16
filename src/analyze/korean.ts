import type { SpeechLevel } from "../types.js";

/** 화법별 격식 점수 (0=반말/구어 … 1=격식체) */
export const FORMALITY_WEIGHT: Record<SpeechLevel, number> = {
  hapsyo: 1,
  seosul: 0.7,
  nominal: 0.55,
  haeyo: 0.45,
  hae: 0.1,
  other: 0.5,
};

export const SPEECH_LEVEL_LABEL: Record<SpeechLevel, string> = {
  hapsyo: "합니다체 (격식 높임)",
  haeyo: "해요체 (친근한 높임)",
  hae: "해체 / 반말",
  seosul: "서술체 (-다, 문어체)",
  nominal: "명사 종결 (개조식)",
  other: "판정 불가",
};

const HANGUL_SYLLABLE = /[\uAC00-\uD7A3]/;
const TRAILING_PUNCT = /[\s.!?…~^;:,"'”’)\]}·♥♡★☆→↗➡➔👇👉🙏🥲🥹]+$/u;

/** 종결부 판정을 위해 문장 끝의 부호·이모지를 제거한 어절 목록을 얻는다 (뒤에서부터). */
export function trailingEojeols(sentence: string, max = 3): string[] {
  const noEmoji = sentence.replace(/\p{Extended_Pictographic}(\uFE0F)?/gu, " ");
  const cleaned = noEmoji.replace(TRAILING_PUNCT, "").trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/\s+/).filter((p) => p.length > 0);
  return parts.slice(-max).reverse();
}

/** 문장의 마지막 어절 (부호·이모지 제거) */
export function finalEojeol(sentence: string): string {
  return trailingEojeols(sentence, 1)[0] ?? "";
}

const HAPSYO = /(?:니다|니까|십시오|ㅂ시다|읍시다|시죠)$/;
const NOT_HAPSYO = /(?:아니다|다니다|지니다|이니다)$/;
const HAEYO = /(?:요|죠|쥬|봐요|여요)$/;
const HAE =
  /(?:잖아|잖어|는데|은데|던데|구나|구만|군|거든|거든요?|네|냐|니|지|어|아|야|래|대|봐|더라|든지|을까|ㄹ까|음ㅋ|겠다|했음|이야|인가|같아|같애|해|임마)$/;
const SEOSUL = /(?:다|것이다|는다|았다|었다|하다|이다|리라|더라도)$/;
const NOMINAL = /(?:임|함|음|것|중|뿐|기|점|화|성|적|감|힘|말|생각|이유|정도|느낌|사람|하루|시간|이야기)$/;

/** 어절 하나의 화법을 판정한다. 판정 불가면 other. */
function classifyEojeol(tail: string): SpeechLevel {
  if (!tail || !HANGUL_SYLLABLE.test(tail)) return "other";
  if (HAPSYO.test(tail) && !NOT_HAPSYO.test(tail)) return "hapsyo";
  if (HAEYO.test(tail)) return "haeyo";
  // '~다'는 서술체를 우선하되, '~겠다/~았다' 등도 서술체로 본다
  if (SEOSUL.test(tail)) return "seosul";
  if (HAE.test(tail)) return "hae";
  if (NOMINAL.test(tail)) return "nominal";
  return "other";
}

export interface ResolvedEnding {
  /** 화법을 판정한 어절 */
  eojeol: string;
  level: SpeechLevel;
  /** 마지막 어절이 아니라 뒤에서 n번째를 썼는지 (구어체 후치 부사 대응) */
  offset: number;
}

/**
 * 문장의 종결부를 찾는다.
 *
 * 한국어 구어에서는 "생각보다 쉬워요 진짜루"처럼 어미 뒤에 부사·감탄사가 붙는다.
 * 마지막 어절이 판정 불가면 뒤에서 두 번째까지 거슬러 올라간다.
 */
export function resolveEnding(sentence: string): ResolvedEnding | undefined {
  const tails = trailingEojeols(sentence, 3);
  if (tails.length === 0) return undefined;
  for (let i = 0; i < Math.min(2, tails.length); i += 1) {
    const eojeol = tails[i]!;
    const level = classifyEojeol(eojeol);
    if (level !== "other") return { eojeol, level, offset: i };
  }
  return { eojeol: tails[0]!, level: "other", offset: 0 };
}

/** 한 문장의 한국어 화법(종결어미 유형)을 판정한다. */
export function classifySpeechLevel(sentence: string): SpeechLevel {
  return resolveEnding(sentence)?.level ?? "other";
}

/**
 * 종결 어미 표층형과 2음절 축약형.
 * 화법 판정이 불가한 문장(영문, 나열형 절 등)은 undefined —
 * 종결어미가 아닌 말이 "자주 쓰는 종결 표현"으로 새는 것을 막는다.
 */
export function endingForms(sentence: string): { surface: string; short: string } | undefined {
  const resolved = resolveEnding(sentence);
  if (!resolved || resolved.level === "other") return undefined;
  const tail = resolved.eojeol;
  const syllables = [...tail].filter((c) => HANGUL_SYLLABLE.test(c));
  if (syllables.length === 0) return undefined;
  return {
    surface: tail.length <= 8 ? tail : tail.slice(-8),
    short: syllables.slice(-2).join(""),
  };
}

export interface KoreanMarkers {
  /** ㅋㅋ, ㅎㅎ 같은 자음 웃음 */
  laughter: number;
  /** ㅠㅠ, ㅜㅜ */
  crying: number;
  /** 초성체 (ㄱㅅ, ㅇㅈ, ㄹㅇ …) */
  chosung: number;
  /** 물결표 늘임 (좋아요~~) */
  tilde: number;
  /** 모음 늘임 (좋아아아) */
  elongation: number;
}

const LAUGH_RE = /[ㅋㅎ]{2,}/g;
const CRY_RE = /[ㅠㅜ]{2,}/g;
/** 초성체(ㄱㅅ, ㅇㅈ, ㄹㅇ …). ㅋㅋ·ㅎㅎ 같은 자음 웃음은 따로 세므로 제외한다. */
const CHOSUNG_RE = /(?:^|\s)(?![ㅋㅎ]+(?:\s|$|[.!?]))[ㄱ-ㅎ]{2,4}(?=\s|$|[.!?])/g;
const ELONG_RE = /([\uAC00-\uD7A3])\1{1,}|[아어오우이애]{3,}/g;

export function koreanMarkers(text: string): KoreanMarkers {
  const count = (re: RegExp): number => (text.match(re) ?? []).length;
  return {
    laughter: count(LAUGH_RE),
    crying: count(CRY_RE),
    chosung: count(CHOSUNG_RE),
    tilde: count(/~+/g),
    elongation: count(ELONG_RE),
  };
}

/** 조사·어미를 떼어 어간에 가까운 형태로 만든다 (경량 스테밍). */
const PARTICLES = [
  "으로써",
  "이라고",
  "라고는",
  "에서는",
  "에게서",
  "이라는",
  "까지도",
  "부터는",
  "으로는",
  "하고는",
  "에서도",
  "이나마",
  "에게",
  "께서",
  "으로",
  "라고",
  "처럼",
  "보다",
  "마다",
  "조차",
  "밖에",
  "부터",
  "까지",
  "이랑",
  "한테",
  "에는",
  "에도",
  "에서",
  "만큼",
  "이라",
  "라도",
  "든지",
  "이며",
  "이고",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "와",
  "과",
  "도",
  "만",
  "랑",
  // '요'는 뺀다. 조사로 쓰이기도 하지만("그건요") 해요체 종결어미가 압도적으로 많아
  // '주세요→주세', '있어요→있어'처럼 어간을 망가뜨린다.
];

/** 이 토큰에서 떼어낼 수 있는 조사 후보를 긴 것부터 돌려준다. */
function particleCandidates(token: string): { stem: string; suffix: string }[] {
  if (!HANGUL_SYLLABLE.test(token)) return [];
  const syllables = [...token];
  if (syllables.length <= 2) return [];
  const out: { stem: string; suffix: string }[] = [];
  for (const p of PARTICLES) {
    if (token.endsWith(p) && syllables.length - [...p].length >= 2) {
      out.push({ stem: token.slice(0, token.length - p.length), suffix: p });
    }
  }
  return out.sort((a, b) => b.suffix.length - a.suffix.length);
}

export function stripParticles(token: string): string {
  return particleCandidates(token)[0]?.stem ?? token;
}

/**
 * 코퍼스 전체에서 관찰된 어간→조사 목록.
 * 1음절 조사를 무턱대고 떼면 '올가을→올가'처럼 명사가 깨진다.
 * 실제로 여러 조사와 함께 등장했거나 조사 없이도 등장한 어간만 신뢰하기 위한 색인이다.
 */
export interface StemIndex {
  /** 어간 → 함께 관찰된 조사 집합 */
  suffixes: Map<string, Set<string>>;
  /** 코퍼스에 등장한 모든 토큰 */
  tokens: Set<string>;
}

export function buildStemIndex(allTokens: Iterable<string>): StemIndex {
  const suffixes = new Map<string, Set<string>>();
  const tokens = new Set<string>();
  for (const t of allTokens) {
    tokens.add(t);
    for (const { stem, suffix } of particleCandidates(t)) {
      let set = suffixes.get(stem);
      if (!set) {
        set = new Set<string>();
        suffixes.set(stem, set);
      }
      set.add(suffix);
    }
  }
  return { suffixes, tokens };
}

/**
 * 근거 있는 스테밍.
 * 어간이 (1) 조사 없이도 등장했거나 (2) 두 종류 이상의 조사와 함께 등장했을 때만 분리한다.
 * 근거가 없으면 원형을 그대로 둔다 — 틀린 어간을 만드는 것보다 안전하다.
 */
export function stripParticlesWithEvidence(token: string, index: StemIndex): { stem: string; stripped: boolean } {
  for (const { stem } of particleCandidates(token)) {
    const observedSuffixes = index.suffixes.get(stem)?.size ?? 0;
    if (index.tokens.has(stem) || observedSuffixes >= 2) {
      return { stem, stripped: true };
    }
  }
  return { stem: token, stripped: false };
}
