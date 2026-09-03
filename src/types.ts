/**
 * social-persona 공용 타입 정의.
 *
 * 파이프라인: detect → fetch(adapters) → analyze → synthesize(optional LLM) → generate
 */

export type Platform = "x" | "instagram" | "threads" | "blog" | "manual" | "unknown";

export type SourceKind = "profile" | "post" | "feed" | "site" | "file" | "text";

/** 입력 URL(또는 파일/텍스트)을 정규화한 참조. */
export interface SourceRef {
  /** 원본 입력 문자열 */
  raw: string;
  platform: Platform;
  kind: SourceKind;
  /** 정규화된 URL (파일/텍스트 입력이면 생략) */
  url?: string;
  /** @ 없는 사용자명 */
  handle?: string;
  /** 개별 글 ID (post kind일 때) */
  postId?: string;
}

export interface PostMetrics {
  likes?: number;
  reposts?: number;
  replies?: number;
  views?: number;
}

/** 수집된 게시글 하나. 모든 어댑터의 공통 출력 단위. */
export interface Post {
  id: string;
  platform: Platform;
  text: string;
  url?: string;
  author?: string;
  title?: string;
  /** ISO 8601 */
  createdAt?: string;
  tags?: string[];
  metrics?: PostMetrics;
  /** 어떤 전략으로 얻었는지 (진단용) */
  strategy?: string;
}

/** 어댑터 한 번의 수집 결과. */
export interface FetchResult {
  source: SourceRef;
  posts: Post[];
  ok: boolean;
  strategy: string;
  /** 사람이 읽는 진단 메시지 (로그인 벽, 프록시 사용 등) */
  notes: string[];
}

export interface Counted<T = string> {
  value: T;
  count: number;
  /** 전체 대비 비율 0..1 */
  ratio?: number;
}

export type SpeechLevel =
  /** 합니다체 (격식 높임) */
  | "hapsyo"
  /** 해요체 (비격식 높임) */
  | "haeyo"
  /** 해체 / 반말 */
  | "hae"
  /** 서술체(-다), 문어체 */
  | "seosul"
  /** 명사·체언 종결 (개조식) */
  | "nominal"
  /** 판정 불가 */
  | "other";

export interface LengthStats {
  mean: number;
  median: number;
  p90: number;
  min: number;
  max: number;
}

export interface StyleProfile {
  postCount: number;
  totalChars: number;
  /** 문자 기준 언어 비중 0..1 */
  langMix: { ko: number; en: number; other: number };
  dominantLang: "ko" | "en" | "mixed";

  /** 게시글 길이(문자) */
  postLength: LengthStats;
  /** 문장 길이(문자) */
  sentenceLength: LengthStats;
  /** 게시글당 문장 수 */
  sentencesPerPost: number;
  /** 문장당 어절/단어 수 */
  wordsPerSentence: number;
  /** 문장 길이 변동성 (표준편차/평균) — 리듬감 지표 */
  burstiness: number;

  layout: {
    /** 게시글당 줄바꿈 수 */
    lineBreaksPerPost: number;
    /** 빈 줄로 단락을 나누는 글의 비율 */
    blankLineRatio: number;
    /** 불릿(-, •, ·) 사용 글 비율 */
    bulletRatio: number;
    /** 번호 목록 사용 글 비율 */
    numberedRatio: number;
    /** 한 줄로 끝내는 글 비율 */
    oneLinerRatio: number;
  };

  punctuation: {
    /** 1000자당 등장 횟수 */
    per1k: Record<string, number>;
    questionRatio: number;
    exclamationRatio: number;
    ellipsisRatio: number;
    tildeRatio: number;
    /** 마침표를 아예 안 쓰는 글 비율 */
    noPeriodRatio: number;
  };

  emoji: {
    perPost: number;
    usageRatio: number;
    unique: number;
    top: Counted[];
  };

  hashtag: { perPost: number; usageRatio: number; top: Counted[] };
  mention: { perPost: number; usageRatio: number; top: Counted[] };
  link: { perPost: number; usageRatio: number };

  korean: {
    /** 종결 어미 기반 화법 분포 0..1 */
    speechLevels: Record<SpeechLevel, number>;
    dominantSpeechLevel: SpeechLevel;
    /** 0(반말/구어) ~ 1(격식체) */
    formality: number;
    /** 자주 쓰는 종결 어미 */
    topEndings: Counted[];
  };

  lexicon: {
    typeTokenRatio: number;
    topWords: Counted[];
    topBigrams: Counted[];
    topTrigrams: Counted[];
    /** 이 사람만 유독 자주 쓰는 표현 (일반 코퍼스 대비) */
    signaturePhrases: Counted[];
    /** 자주 쓰는 접속·연결 표현 */
    connectives: Counted[];
  };

  structure: {
    /** 첫 문장 패턴 */
    openers: Counted[];
    /** 마지막 문장 패턴 */
    closers: Counted[];
    /** 독자에게 질문을 던지는 글 비율 */
    readerQuestionRatio: number;
    /** 1인칭 등장 비율 */
    firstPersonRatio: number;
    /** 청유/명령형 비율 */
    imperativeRatio: number;
  };

  topics: Counted[];

  timing: {
    /** 0..23 시간대별 게시 수 */
    byHour: number[];
    /** 0(일)..6(토) */
    byWeekday: number[];
    /** 가장 활발한 시간대 라벨 */
    peakLabel?: string;
  };
}

/** LLM이 만들어내는 정성적 페르소나 서술. LLM 없으면 결정론적 폴백으로 채운다. */
export interface PersonaSynthesis {
  /** 한 줄 정체성 */
  oneLiner: string;
  /** 목소리 특징 */
  voice: string[];
  /** 주요 관심 주제 */
  topics: string[];
  /** 드러나는 가치관·태도 */
  values: string[];
  /** 반복되는 습관·버릇 */
  quirks: string[];
  dos: string[];
  donts: string[];
  /** 생성 출처 */
  provider: "llm" | "heuristic";
  model?: string;
}

export interface Persona {
  name: string;
  slug: string;
  description: string;
  handles: string[];
  sources: SourceRef[];
  generatedAt: string;
  postCount: number;
  style: StyleProfile;
  synthesis: PersonaSynthesis;
  /** few-shot으로 쓸 대표 게시글 */
  examples: Post[];
  /** 수집 과정 진단 */
  notes: string[];
}

export interface GenerateOptions {
  /** 출력 디렉토리 (기본 ./out) */
  outDir: string;
  /** 페르소나 이름 override */
  name?: string;
  /** 수집할 게시글 상한 */
  limit: number;
  /** LLM 합성 사용 여부 */
  useLlm: boolean;
  /** 진단 로그 상세 출력 */
  verbose: boolean;
  /** 수동 입력 파일 (수집 실패 시 폴백) */
  inputFiles: string[];
  /** 표본이 부족해도 강제로 진행 */
  force: boolean;
  /** 헤드리스 브라우저 전략 사용 (playwright 설치 시에만 동작) */
  useBrowser: boolean;
  /** TLS 지문 위장 전략 사용 (impit 설치 시에만 동작) */
  useImpersonate: boolean;
}
