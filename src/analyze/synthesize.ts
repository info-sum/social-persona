import type { Counted, PersonaSynthesis, Post, StyleProfile } from "../types.js";
import { SPEECH_LEVEL_LABEL } from "./korean.js";

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const values = (items: Counted[], max: number): string[] => items.slice(0, max).map((i) => String(i.value));

function describeLength(style: StyleProfile): string {
  // 중앙값을 기준으로 본다. 장문 하나가 평균을 끌어올리는 걸 막는다.
  const m = style.postLength.median;
  if (m < 120) return `아주 짧게 쓴다 (중앙값 ${Math.round(m)}자). 한 호흡에 끝낸다.`;
  if (m < 400) return `짧고 밀도 있게 쓴다 (중앙값 ${Math.round(m)}자).`;
  if (m < 1200) return `중간 길이의 글을 쓴다 (중앙값 ${Math.round(m)}자).`;
  return `길게 풀어쓴다 (중앙값 ${Math.round(m)}자, 최대 ${style.postLength.max}자).`;
}

function describeSentence(style: StyleProfile): string {
  const m = style.sentenceLength.mean;
  const rhythm =
    style.burstiness > 0.8
      ? "긴 문장과 한 줄 문장을 번갈아 두어 리듬을 만든다"
      : style.burstiness < 0.45
        ? "문장 길이를 고르게 유지한다"
        : "문장 길이에 약간의 변화를 준다";
  const size = m < 25 ? "문장을 짧게 끊는다" : m > 60 ? "문장을 길게 이어 붙인다" : "문장 길이는 중간 정도다";
  return `${size} (평균 ${Math.round(m)}자, 문장당 ${style.wordsPerSentence}어절). ${rhythm}.`;
}

function describeLayout(style: StyleProfile): string[] {
  const out: string[] = [];
  const l = style.layout;
  if (l.oneLinerRatio > 0.5) out.push(`글 ${pct(l.oneLinerRatio)}가 줄바꿈 없는 한 덩어리다.`);
  else if (l.blankLineRatio > 0.5) out.push(`빈 줄로 단락을 나눈다 (글 ${pct(l.blankLineRatio)}).`);
  if (l.lineBreaksPerPost >= 4) out.push(`줄바꿈을 자주 쓴다 (글당 ${l.lineBreaksPerPost}회). 시처럼 끊어 배치한다.`);
  if (l.bulletRatio > 0.2) out.push(`불릿 목록을 즐겨 쓴다 (글 ${pct(l.bulletRatio)}).`);
  if (l.numberedRatio > 0.15) out.push(`번호 매긴 목록을 쓴다 (글 ${pct(l.numberedRatio)}).`);
  return out;
}

function describeSurface(style: StyleProfile): string[] {
  const out: string[] = [];
  const p = style.punctuation;
  const e = style.emoji;

  if (e.usageRatio > 0.6) out.push(`이모지를 적극적으로 쓴다 (글 ${pct(e.usageRatio)}, 글당 ${e.perPost}개). 주로 ${values(e.top, 6).join(" ")}`);
  else if (e.usageRatio > 0.15) out.push(`이모지를 아껴 쓴다 (글 ${pct(e.usageRatio)}). 주로 ${values(e.top, 4).join(" ")}`);
  else out.push("이모지를 거의 쓰지 않는다.");

  if (p.noPeriodRatio > 0.5) out.push(`마침표를 잘 찍지 않는다 (글 ${pct(p.noPeriodRatio)}).`);
  if (p.exclamationRatio > 0.4) out.push(`감탄사를 자주 쓴다 (글 ${pct(p.exclamationRatio)}에 느낌표).`);
  if (p.questionRatio > 0.4) out.push(`물음표를 자주 쓴다 (글 ${pct(p.questionRatio)}).`);
  if (p.ellipsisRatio > 0.3) out.push(`말끝을 흐리는 '…'을 자주 쓴다 (글 ${pct(p.ellipsisRatio)}).`);
  if (p.tildeRatio > 0.25) out.push(`물결표(~)로 말투를 부드럽게 만든다 (글 ${pct(p.tildeRatio)}).`);
  if ((p.per1k["ㅋㅋ/ㅎㅎ"] ?? 0) > 0.5) out.push("ㅋㅋ/ㅎㅎ 같은 자음 웃음을 섞는다.");
  if ((p.per1k["초성체"] ?? 0) > 0.3) out.push("초성체(ㄱㅅ, ㅇㅈ 등)를 쓴다.");

  if (style.hashtag.usageRatio > 0.5) out.push(`해시태그를 습관적으로 붙인다 (글 ${pct(style.hashtag.usageRatio)}, 글당 ${style.hashtag.perPost}개).`);
  else if (style.hashtag.usageRatio > 0.15) out.push(`해시태그를 때때로 붙인다 (글 ${pct(style.hashtag.usageRatio)}).`);
  else out.push("해시태그를 거의 쓰지 않는다.");

  if (style.link.usageRatio > 0.4) out.push(`링크를 자주 공유한다 (글 ${pct(style.link.usageRatio)}).`);
  return out;
}

function describeVoiceCore(style: StyleProfile): string[] {
  const out: string[] = [];
  const k = style.korean;
  if (style.dominantLang !== "en") {
    out.push(
      `기본 화법은 ${SPEECH_LEVEL_LABEL[k.dominantSpeechLevel]}. 격식도 ${k.formality}/1.0 ` +
        `(합니다체 ${pct(k.speechLevels.hapsyo)} · 해요체 ${pct(k.speechLevels.haeyo)} · 반말 ${pct(k.speechLevels.hae)} · 서술체 ${pct(k.speechLevels.seosul)}).`,
    );
  }
  if (style.dominantLang === "mixed") {
    out.push(`한국어와 영어를 섞는다 (한글 ${pct(style.langMix.ko)} / 영문 ${pct(style.langMix.en)}). 영어 단어를 그대로 박아 넣는다.`);
  } else if (style.dominantLang === "en") {
    out.push(`영어로 쓴다 (영문 ${pct(style.langMix.en)}).`);
  }
  out.push(describeLength(style));
  out.push(describeSentence(style));
  return out;
}

function describeQuirks(style: StyleProfile): string[] {
  const out: string[] = [];
  const endings = style.korean.topEndings.filter((e) => e.count >= 2);
  if (endings.length > 0) {
    out.push(`자주 쓰는 종결 표현: ${endings.slice(0, 8).map((e) => `"${e.value}"`).join(", ")}`);
  }
  const sig = style.lexicon.signaturePhrases.slice(0, 12);
  if (sig.length > 0) out.push(`반복 어휘: ${sig.map((s) => s.value).join(", ")}`);
  const bigrams = style.lexicon.topBigrams.slice(0, 8);
  if (bigrams.length > 0) out.push(`자주 붙여 쓰는 조합: ${bigrams.map((b) => `"${b.value}"`).join(", ")}`);
  const conn = style.lexicon.connectives.slice(0, 6);
  if (conn.length > 0) out.push(`문장을 잇는 말: ${conn.map((c) => c.value).join(", ")}`);
  if (style.emoji.top.length > 0) out.push(`즐겨 쓰는 이모지: ${values(style.emoji.top, 8).join(" ")}`);
  if (style.structure.readerQuestionRatio > 0.25) {
    out.push(`글을 질문으로 닫는 일이 많다 (${pct(style.structure.readerQuestionRatio)}).`);
  }
  if (style.timing.peakLabel) out.push(`게시 시간대: ${style.timing.peakLabel}`);
  return out;
}

function describeValues(style: StyleProfile): string[] {
  const out: string[] = [];
  if (style.structure.firstPersonRatio > 0.6) {
    out.push(`자기 경험을 1인칭으로 말한다 (글 ${pct(style.structure.firstPersonRatio)}). 남의 말을 인용하기보다 직접 겪은 것을 근거로 든다.`);
  } else if (style.structure.firstPersonRatio < 0.25) {
    out.push("주관을 앞세우지 않고 사실·대상 중심으로 서술한다.");
  }
  if (style.structure.imperativeRatio > 0.35) {
    out.push(`읽는 사람에게 행동을 권한다 (글 ${pct(style.structure.imperativeRatio)}에 청유·권유 표현).`);
  }
  if (style.layout.bulletRatio > 0.3 || style.layout.numberedRatio > 0.2) {
    out.push("생각을 정리해 목록으로 떨어뜨리는 걸 선호한다. 구조화된 설명을 신뢰한다.");
  }
  if (style.lexicon.typeTokenRatio > 0.6) out.push("같은 단어를 반복하지 않으려 한다. 어휘를 계속 바꿔 쓴다.");
  else if (style.lexicon.typeTokenRatio < 0.35) out.push("핵심 단어를 반복해서 각인시킨다.");
  if (out.length === 0) out.push("수집한 글만으로는 가치관을 단정하기 어렵다. 문체 신호만 신뢰할 것.");
  return out;
}

function buildDos(style: StyleProfile): string[] {
  const dos: string[] = [];
  const k = style.korean;
  if (style.dominantLang !== "en") {
    dos.push(`${SPEECH_LEVEL_LABEL[k.dominantSpeechLevel]}로 쓴다. 종결 표현은 ${k.topEndings.slice(0, 4).map((e) => `"${e.value}"`).join(" / ") || "관찰된 어미"} 계열을 재사용한다.`);
  }
  dos.push(`한 편의 길이는 ${Math.round(style.postLength.median)}자 안팎, 최대 ${Math.round(style.postLength.p90)}자를 넘기지 않는다.`);
  dos.push(`문장은 평균 ${Math.round(style.sentenceLength.mean)}자로 끊고, 글당 ${Math.round(style.sentencesPerPost)}문장 정도로 맞춘다.`);
  if (style.layout.lineBreaksPerPost >= 3) dos.push(`줄바꿈을 글당 ${Math.round(style.layout.lineBreaksPerPost)}회 정도 넣어 호흡을 만든다.`);
  if (style.emoji.usageRatio > 0.3) dos.push(`이모지는 글당 ${Math.max(1, Math.round(style.emoji.perPost))}개 이내로, ${values(style.emoji.top, 5).join(" ")} 중에서 고른다.`);
  if (style.hashtag.usageRatio > 0.4 && style.hashtag.top.length > 0) {
    dos.push(`해시태그를 ${Math.max(1, Math.round(style.hashtag.perPost))}개 붙인다. 관찰된 태그: ${values(style.hashtag.top, 8).map((t) => `#${t}`).join(" ")}`);
  }
  if (style.structure.readerQuestionRatio > 0.25) dos.push("마지막 문장은 독자에게 던지는 질문으로 닫는 편이 자연스럽다.");
  if (style.topics.length > 0) dos.push(`소재는 ${values(style.topics, 8).join(", ")} 주변에서 고른다.`);
  return dos;
}

function buildDonts(style: StyleProfile): string[] {
  const donts: string[] = [];
  const k = style.korean;
  if (style.dominantLang !== "en") {
    if (k.dominantSpeechLevel === "hae" || k.dominantSpeechLevel === "haeyo") {
      donts.push("'~합니다', '~하였습니다' 같은 격식체로 올리지 않는다.");
    }
    if (k.dominantSpeechLevel === "hapsyo" || k.dominantSpeechLevel === "seosul") {
      donts.push("반말이나 '~해요'로 내려가지 않는다.");
    }
  }
  if (style.emoji.usageRatio < 0.2) donts.push("이모지를 뿌리지 않는다. 원문에 거의 없다.");
  if (style.hashtag.usageRatio < 0.2) donts.push("해시태그를 만들어 붙이지 않는다.");
  if (style.layout.bulletRatio < 0.1 && style.layout.numberedRatio < 0.1) {
    donts.push("불릿·번호 목록으로 정리하지 않는다. 원문은 줄글이다.");
  }
  if (style.postLength.median < 400) donts.push("장문으로 늘려 쓰지 않는다. 설명을 덧붙이려는 충동을 참는다.");
  donts.push("'여러분', '~해보시는 건 어떨까요?' 같은 일반 블로그 상용구를 넣지 않는다. 관찰된 표현만 쓴다.");
  donts.push("수집된 글에 없는 사실·수치·인물을 만들어내지 않는다.");
  return donts;
}

/** LLM 없이 문체 지표만으로 페르소나 서술을 만든다. */
export function heuristicSynthesis(style: StyleProfile, posts: Post[], displayName: string): PersonaSynthesis {
  const platforms = [...new Set(posts.map((p) => p.platform))].filter((p) => p !== "manual");
  const platformLabel = platforms.length > 0 ? platforms.join("·") : "SNS";
  const topicLabel = values(style.topics, 4).join(", ");

  const oneLiner =
    `${platformLabel}에 ${SPEECH_LEVEL_LABEL[style.korean.dominantSpeechLevel]}로 글을 쓰는 ${displayName}.` +
    (topicLabel ? ` 주로 ${topicLabel} 이야기를 한다.` : "");

  return {
    oneLiner,
    voice: [...describeVoiceCore(style), ...describeLayout(style), ...describeSurface(style)],
    topics: values(style.topics, 12),
    values: describeValues(style),
    quirks: describeQuirks(style),
    dos: buildDos(style),
    donts: buildDonts(style),
    provider: "heuristic",
  };
}

/** LLM 결과와 휴리스틱 결과를 합친다. 정량 지표는 휴리스틱 쪽을 신뢰한다. */
export function mergeSynthesis(base: PersonaSynthesis, llm: Partial<PersonaSynthesis>, model: string): PersonaSynthesis {
  const pick = (a: string[] | undefined, b: string[]): string[] => (a && a.length > 0 ? a : b);
  return {
    oneLiner: llm.oneLiner?.trim() || base.oneLiner,
    voice: [...pick(llm.voice, []), ...base.voice],
    topics: [...new Set([...(llm.topics ?? []), ...base.topics])].slice(0, 16),
    values: pick(llm.values, base.values),
    quirks: [...new Set([...(llm.quirks ?? []), ...base.quirks])],
    dos: [...base.dos, ...(llm.dos ?? [])],
    donts: [...base.donts, ...(llm.donts ?? [])],
    provider: "llm",
    model,
  };
}
