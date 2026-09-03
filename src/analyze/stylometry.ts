import type { Counted, Post, SpeechLevel, StyleProfile } from "../types.js";
import {
  EMOJI_RE,
  HASHTAG_RE,
  MENTION_RE,
  URL_RE,
  countMatches,
  extractAll,
  languageMix,
  ngrams,
  splitSentences,
  strip,
  tokenizeWords,
  truncate,
} from "../util/text.js";
import { increment, lengthStats, mean, median, round, safeRatio, stdev, topN } from "../util/stats.js";
import {
  FORMALITY_WEIGHT,
  buildStemIndex,
  classifySpeechLevel,
  endingForms,
  koreanMarkers,
  stripParticles,
  stripParticlesWithEvidence,
} from "./korean.js";
import { CONNECTIVES, FIRST_PERSON, IMPERATIVE_MARKERS, isJamoOnly, isStopword, isTopicAllowed, isTopicCandidate, raritySpecificity } from "./stopwords.js";

const PUNCT_TRACKED = [".", ",", "!", "?", "…", "~", "-", "—", ":", ";", "(", ")", '"', "'", "·", "/"] as const;

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function hourLabel(hours: number[]): string | undefined {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total === 0) return undefined;
  const buckets: { label: string; range: number[] }[] = [
    { label: "새벽(0–6시)", range: [0, 1, 2, 3, 4, 5] },
    { label: "아침(6–11시)", range: [6, 7, 8, 9, 10] },
    { label: "낮(11–17시)", range: [11, 12, 13, 14, 15, 16] },
    { label: "저녁(17–22시)", range: [17, 18, 19, 20, 21] },
    { label: "심야(22–24시)", range: [22, 23] },
  ];
  let best = buckets[0]!;
  let bestSum = -1;
  for (const b of buckets) {
    const sum = b.range.reduce((a, h) => a + (hours[h] ?? 0), 0);
    if (sum > bestSum) {
      bestSum = sum;
      best = b;
    }
  }
  return `${best.label} ${Math.round((bestSum / total) * 100)}%`;
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

/** 게시글 묶음에서 결정론적 문체 프로필을 만든다. LLM을 쓰지 않는다. */
export function analyzeStyle(posts: Post[]): StyleProfile {
  const texts = posts.map((p) => p.text.trim()).filter((t) => t.length > 0);
  const postCount = texts.length;
  const joined = texts.join("\n\n");
  const totalChars = joined.length;

  const postLengths: number[] = [];
  const sentenceLengths: number[] = [];
  const sentenceCounts: number[] = [];
  const wordsPerSentenceAll: number[] = [];

  const emojiCounts = new Map<string, number>();
  const hashtagCounts = new Map<string, number>();
  const mentionCounts = new Map<string, number>();
  const punctCounts = new Map<string, number>();
  const wordCounts = new Map<string, number>();
  const stemCounts = new Map<string, number>();
  const stemDocFreq = new Map<string, number>();
  /** 조사가 붙은 채 등장해 명사로 추정되는 어간 (코퍼스 근거 기반, 정밀) */
  const nounEvidence = new Map<string, number>();
  /** 근거 없이 조사 목록만으로 분리한 어간 (표본이 작을 때 쓰는 폴백, 재현율 우선) */
  const nounEvidenceNaive = new Map<string, number>();
  const bigramCounts = new Map<string, number>();
  const trigramCounts = new Map<string, number>();
  const endingSurface = new Map<string, number>();
  const endingShort = new Map<string, number>();
  const openerCounts = new Map<string, number>();
  const closerCounts = new Map<string, number>();
  const connectiveCounts = new Map<string, number>();
  const speechCounts = new Map<SpeechLevel, number>();

  let emojiPosts = 0;
  let hashtagPosts = 0;
  let mentionPosts = 0;
  let linkPosts = 0;
  let linkTotal = 0;
  let questionPosts = 0;
  let exclamationPosts = 0;
  let ellipsisPosts = 0;
  let tildePosts = 0;
  let noPeriodPosts = 0;
  let blankLinePosts = 0;
  let bulletPosts = 0;
  let numberedPosts = 0;
  let oneLinerPosts = 0;
  let lineBreakTotal = 0;
  let readerQuestionPosts = 0;
  let firstPersonPosts = 0;
  let imperativePosts = 0;

  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);

  // 사전 패스: 코퍼스 전체 토큰으로 어간 색인을 만든다.
  // 1음절 조사를 근거 없이 떼면 '올가을→올가'처럼 명사가 깨지므로,
  // 실제로 관찰된 어간만 신뢰한다.
  const allTokens: string[] = [];
  for (const text of texts) {
    allTokens.push(...tokenizeWords(strip(text).clean));
  }
  const stemIndex = buildStemIndex(allTokens);

  for (const text of texts) {
    postLengths.push(text.length);

    const emojis = extractAll(text, EMOJI_RE);
    if (emojis.length > 0) emojiPosts += 1;
    for (const e of emojis) increment(emojiCounts, e);

    const hashtags = extractAll(text, HASHTAG_RE, 1);
    if (hashtags.length > 0) hashtagPosts += 1;
    for (const h of hashtags) increment(hashtagCounts, h.toLowerCase());

    const mentions = extractAll(text, MENTION_RE, 1);
    if (mentions.length > 0) mentionPosts += 1;
    for (const m of mentions) increment(mentionCounts, m.toLowerCase());

    const links = countMatches(text, URL_RE);
    linkTotal += links;
    if (links > 0) linkPosts += 1;

    for (const p of PUNCT_TRACKED) {
      const n = text.split(p).length - 1;
      if (n > 0) increment(punctCounts, p, n);
    }
    if (text.includes("?") || text.includes("？")) questionPosts += 1;
    if (text.includes("!") || text.includes("！")) exclamationPosts += 1;
    if (/\.{2,}|…/.test(text)) ellipsisPosts += 1;
    if (/~/.test(text)) tildePosts += 1;
    if (!/[.。]/.test(text)) noPeriodPosts += 1;

    const lines = text.split("\n");
    lineBreakTotal += lines.length - 1;
    if (/\n\s*\n/.test(text)) blankLinePosts += 1;
    if (/^\s*[-•·*]\s+/m.test(text)) bulletPosts += 1;
    if (/^\s*\d+[.)]\s+/m.test(text)) numberedPosts += 1;
    if (lines.filter((l) => l.trim().length > 0).length === 1) oneLinerPosts += 1;

    const { clean } = strip(text);
    const sentences = splitSentences(clean).filter((s) => s.length > 0);
    sentenceCounts.push(Math.max(1, sentences.length));

    if (sentences.length > 0) {
      const first = sentences[0]!;
      const last = sentences[sentences.length - 1]!;
      increment(openerCounts, truncate(first, 48));
      increment(closerCounts, truncate(last, 48));
      if (/[?？]\s*$/.test(last.trim())) readerQuestionPosts += 1;
    }

    if (containsAny(clean, FIRST_PERSON)) firstPersonPosts += 1;
    if (containsAny(clean, IMPERATIVE_MARKERS)) imperativePosts += 1;

    for (const c of CONNECTIVES) {
      const n = clean.toLowerCase().split(c.toLowerCase()).length - 1;
      if (n > 0) increment(connectiveCounts, c, n);
    }

    for (const s of sentences) {
      sentenceLengths.push(s.length);
      const words = tokenizeWords(s);
      wordsPerSentenceAll.push(words.length);
      const level = classifySpeechLevel(s);
      increment(speechCounts, level);
      const ending = endingForms(s);
      if (ending) {
        increment(endingSurface, ending.surface);
        increment(endingShort, ending.short);
      }
    }

    const tokens = tokenizeWords(clean);
    const docStems = new Set<string>();
    for (const t of tokens) {
      increment(wordCounts, t);
      const { stem, stripped } = stripParticlesWithEvidence(t, stemIndex);
      // 조사가 실제로 떨어져 나갔다면 그 어간은 명사일 가능성이 높다
      if (stripped && stem.length >= 2 && !isJamoOnly(stem)) increment(nounEvidence, stem);
      const naive = stripParticles(t);
      if (naive !== t && naive.length >= 2 && !isJamoOnly(naive)) increment(nounEvidenceNaive, naive);
      if (stem.length >= 2 && !isStopword(stem)) {
        increment(stemCounts, stem);
        docStems.add(stem);
      }
      // 폴백 경로에서 쓸 수 있게 naive 어간도 문서빈도에 반영한다
      if (naive !== stem && naive.length >= 2 && !isStopword(naive)) docStems.add(naive);
    }
    for (const s of docStems) increment(stemDocFreq, s);

    const contentTokens = tokens.filter((t) => !isStopword(t));
    for (const g of ngrams(contentTokens, 2)) increment(bigramCounts, g);
    for (const g of ngrams(contentTokens, 3)) increment(trigramCounts, g);
  }

  for (const p of posts) {
    if (!p.createdAt) continue;
    const d = new Date(p.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    byHour[d.getHours()] = (byHour[d.getHours()] ?? 0) + 1;
    byWeekday[d.getDay()] = (byWeekday[d.getDay()] ?? 0) + 1;
  }

  const totalSentences = sentenceLengths.length;
  const sentenceMean = mean(sentenceLengths);
  const langMix = languageMix(joined);
  const dominantLang: StyleProfile["dominantLang"] =
    langMix.ko >= 0.65 ? "ko" : langMix.en >= 0.65 ? "en" : "mixed";

  const speechTotal = [...speechCounts.values()].reduce((a, b) => a + b, 0);
  const speechLevels: Record<SpeechLevel, number> = {
    hapsyo: 0,
    haeyo: 0,
    hae: 0,
    seosul: 0,
    nominal: 0,
    other: 0,
  };
  for (const [level, count] of speechCounts) {
    speechLevels[level] = round(count / Math.max(1, speechTotal), 3);
  }
  const rankedLevels = (Object.keys(speechLevels) as SpeechLevel[])
    .filter((l) => l !== "other")
    .sort((a, b) => speechLevels[b] - speechLevels[a]);
  const topLevel = rankedLevels[0];
  // 한국어 종결어미가 하나도 안 잡히면(영문 등) 판정 불가로 둔다
  const dominantSpeechLevel: SpeechLevel =
    speechTotal === 0 || topLevel === undefined || speechLevels[topLevel] === 0 ? "other" : topLevel;
  const formality =
    dominantSpeechLevel === "other"
      ? 0
      : round(
          (Object.keys(speechLevels) as SpeechLevel[]).reduce((acc, l) => acc + speechLevels[l] * FORMALITY_WEIGHT[l], 0),
          3,
        );

  const markers = koreanMarkers(joined);

  // 시그니처 표현: 희소성 가중 + 여러 글에 반복 등장
  const signature = new Map<string, number>();
  for (const [stem, count] of stemCounts) {
    if (isJamoOnly(stem)) continue;
    const spec = raritySpecificity(stem);
    if (spec === 0) continue;
    const df = stemDocFreq.get(stem) ?? 1;
    if (postCount >= 4 && df < 2) continue;
    const score = count * spec * (1 + Math.log(df));
    if (score >= 1) signature.set(stem, Math.round(score * 10) / 10);
  }

  // 토픽.
  // 형태소 분석기 없이 명사를 고르는 두 가지 근거를 쓴다.
  //  (1) 해시태그 — 작성자가 직접 붙인 주제 라벨
  //  (2) 조사가 붙은 채 등장한 어간 — 한국어에서 조사를 취하는 건 대체로 체언이다
  // 원형 토큰(활용형 포함)은 절대 토픽으로 올리지 않는다.
  const requireMultiDoc = postCount >= 8;
  const topicScores = new Map<string, number>();
  for (const [tag, count] of hashtagCounts) {
    if (!isTopicAllowed(tag)) continue;
    topicScores.set(tag, (topicScores.get(tag) ?? 0) + round(count * 3, 1));
  }

  const addNounTopics = (evidence: Map<string, number>): number => {
    let added = 0;
    for (const [stem, hits] of evidence) {
      if (!isTopicAllowed(stem) || !isTopicCandidate(stem)) continue;
      const df = stemDocFreq.get(stem) ?? 1;
      if (requireMultiDoc && df < 2) continue;
      if (topicScores.has(stem)) continue;
      topicScores.set(stem, round(hits * (1 + Math.log(df)), 1));
      added += 1;
    }
    return added;
  };

  addNounTopics(nounEvidence);
  // 표본이 작으면 어간 근거가 모이지 않는다. 그때만 재현율 우선 폴백을 쓴다.
  if (topicScores.size < 5) addNounTopics(nounEvidenceNaive);

  const punctPer1k: Record<string, number> = {};
  for (const [p, n] of punctCounts) {
    punctPer1k[p] = round((n / Math.max(1, totalChars)) * 1000, 2);
  }
  if (markers.laughter > 0) punctPer1k["ㅋㅋ/ㅎㅎ"] = round((markers.laughter / Math.max(1, totalChars)) * 1000, 2);
  if (markers.crying > 0) punctPer1k["ㅠㅠ/ㅜㅜ"] = round((markers.crying / Math.max(1, totalChars)) * 1000, 2);
  if (markers.chosung > 0) punctPer1k["초성체"] = round((markers.chosung / Math.max(1, totalChars)) * 1000, 2);

  const uniqueWords = wordCounts.size;
  const totalWords = [...wordCounts.values()].reduce((a, b) => a + b, 0);

  return {
    postCount,
    totalChars,
    langMix: { ko: round(langMix.ko, 3), en: round(langMix.en, 3), other: round(langMix.other, 3) },
    dominantLang,

    postLength: lengthStats(postLengths),
    sentenceLength: lengthStats(sentenceLengths),
    // 장문 블로그와 단문 SNS가 섞이면 평균이 무너진다. 중앙값을 쓴다.
    sentencesPerPost: round(median(sentenceCounts), 2),
    wordsPerSentence: round(mean(wordsPerSentenceAll), 2),
    burstiness: sentenceMean > 0 ? round(stdev(sentenceLengths) / sentenceMean, 3) : 0,

    layout: {
      lineBreaksPerPost: round(lineBreakTotal / Math.max(1, postCount), 2),
      blankLineRatio: safeRatio(blankLinePosts, postCount),
      bulletRatio: safeRatio(bulletPosts, postCount),
      numberedRatio: safeRatio(numberedPosts, postCount),
      oneLinerRatio: safeRatio(oneLinerPosts, postCount),
    },

    punctuation: {
      per1k: punctPer1k,
      questionRatio: safeRatio(questionPosts, postCount),
      exclamationRatio: safeRatio(exclamationPosts, postCount),
      ellipsisRatio: safeRatio(ellipsisPosts, postCount),
      tildeRatio: safeRatio(tildePosts, postCount),
      noPeriodRatio: safeRatio(noPeriodPosts, postCount),
    },

    emoji: {
      perPost: round([...emojiCounts.values()].reduce((a, b) => a + b, 0) / Math.max(1, postCount), 2),
      usageRatio: safeRatio(emojiPosts, postCount),
      unique: emojiCounts.size,
      top: topN(emojiCounts, 12),
    },

    hashtag: {
      perPost: round([...hashtagCounts.values()].reduce((a, b) => a + b, 0) / Math.max(1, postCount), 2),
      usageRatio: safeRatio(hashtagPosts, postCount),
      top: topN(hashtagCounts, 15),
    },
    mention: {
      perPost: round([...mentionCounts.values()].reduce((a, b) => a + b, 0) / Math.max(1, postCount), 2),
      usageRatio: safeRatio(mentionPosts, postCount),
      top: topN(mentionCounts, 10),
    },
    link: {
      perPost: round(linkTotal / Math.max(1, postCount), 2),
      usageRatio: safeRatio(linkPosts, postCount),
    },

    korean: {
      speechLevels,
      dominantSpeechLevel,
      formality,
      topEndings: topN(endingSurface, 15, totalSentences),
    },

    lexicon: {
      typeTokenRatio: safeRatio(uniqueWords, totalWords, 4),
      topWords: topN(
        new Map([...wordCounts].filter(([w]) => !isStopword(w) && w.length >= 2 && !isJamoOnly(w))),
        25,
        totalWords,
      ),
      topBigrams: topN(new Map([...bigramCounts].filter(([, c]) => c >= 2)), 15),
      topTrigrams: topN(new Map([...trigramCounts].filter(([, c]) => c >= 2)), 10),
      signaturePhrases: topN(signature, 20),
      connectives: topN(connectiveCounts, 12),
    },

    structure: {
      openers: topN(openerCounts, 8),
      closers: topN(closerCounts, 8),
      readerQuestionRatio: safeRatio(readerQuestionPosts, postCount),
      firstPersonRatio: safeRatio(firstPersonPosts, postCount),
      imperativeRatio: safeRatio(imperativePosts, postCount),
    },

    topics: topN(topicScores, 20),

    timing: {
      byHour,
      byWeekday,
      peakLabel: describeTiming(byHour, byWeekday),
    },
  };
}

function describeTiming(byHour: number[], byWeekday: number[]): string | undefined {
  const label = hourLabel(byHour);
  if (!label) return undefined;
  const total = byWeekday.reduce((a, b) => a + b, 0);
  if (total === 0) return label;
  const weekend = (byWeekday[0] ?? 0) + (byWeekday[6] ?? 0);
  const weekendPct = Math.round((weekend / total) * 100);
  const peakDay = byWeekday.indexOf(Math.max(...byWeekday));
  return `${label}, 최다 ${WEEKDAY_KO[peakDay] ?? "?"}요일, 주말 비중 ${weekendPct}%`;
}

/** SKILL.md few-shot용 대표 게시글 선정: 길이 다양성 + 참여도 + 최신성. */
export function pickExamples(posts: Post[], max = 6): Post[] {
  if (posts.length <= max) return [...posts];
  const scored = posts.map((p) => {
    const len = p.text.length;
    const engagement = (p.metrics?.likes ?? 0) + (p.metrics?.reposts ?? 0) * 2;
    const recency = p.createdAt ? new Date(p.createdAt).getTime() : 0;
    return { post: p, len, engagement, recency };
  });

  const byEngagement = [...scored].sort((a, b) => b.engagement - a.engagement);
  const byLength = [...scored].sort((a, b) => a.len - b.len);

  const chosen: Post[] = [];
  const seen = new Set<string>();
  const take = (p: Post | undefined): void => {
    if (!p || seen.has(p.id)) return;
    seen.add(p.id);
    chosen.push(p);
  };

  // 참여도 상위 2건
  take(byEngagement[0]?.post);
  take(byEngagement[1]?.post);
  // 길이 스펙트럼: 짧은 글, 중간, 긴 글
  take(byLength[Math.floor(byLength.length * 0.15)]?.post);
  take(byLength[Math.floor(byLength.length * 0.5)]?.post);
  take(byLength[Math.floor(byLength.length * 0.85)]?.post);
  // 최신
  take([...scored].sort((a, b) => b.recency - a.recency)[0]?.post);

  for (const s of scored) {
    if (chosen.length >= max) break;
    take(s.post);
  }
  return chosen.slice(0, max);
}

export function summarizeCounted(items: Counted[], max = 8): string {
  return items
    .slice(0, max)
    .map((i) => `${i.value}${i.count > 1 ? `(${i.count})` : ""}`)
    .join(", ");
}
