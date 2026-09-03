import type { Counted, Persona, Post, SpeechLevel, StyleProfile } from "../types.js";
import { SPEECH_LEVEL_LABEL } from "../analyze/korean.js";
import { percentDistribution } from "../util/stats.js";
import { truncate } from "../util/text.js";

const pct = (n: number): string => `${Math.round(n * 100)}%`;

function yamlString(v: string): string {
  const oneLine = v.replace(/\s+/g, " ").trim();
  return `"${oneLine.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function bullets(items: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    const t = i.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(`- ${t}`);
  }
  return out.length > 0 ? out.join("\n") : "- (관찰된 신호 없음)";
}

function countedList(items: Counted[], max: number, wrap = ""): string {
  if (items.length === 0) return "—";
  return items
    .slice(0, max)
    .map((i) => `${wrap}${i.value}${wrap}${i.count > 1 ? ` ×${i.count}` : ""}`)
    .join(", ");
}

function metricsTable(style: StyleProfile): string {
  const rows: [string, string][] = [
    ["분석한 글 수", `${style.postCount}건 (${style.totalChars.toLocaleString("ko-KR")}자)`],
    ["글 길이", `중앙값 ${style.postLength.median}자 · 평균 ${style.postLength.mean}자 · 상위10% ${style.postLength.p90}자`],
    ["문장 길이", `평균 ${style.sentenceLength.mean}자 · 중앙값 ${style.sentenceLength.median}자`],
    ["글당 문장 수", `${style.sentencesPerPost}문장`],
    ["문장당 어절", `${style.wordsPerSentence}개`],
    ["리듬 변동성", `${style.burstiness} (0.8↑이면 장·단문 교차)`],
    ["줄바꿈", `글당 ${style.layout.lineBreaksPerPost}회 · 빈 줄 단락 ${pct(style.layout.blankLineRatio)}`],
    ["한 줄 글 비중", pct(style.layout.oneLinerRatio)],
    ["이모지", `글 ${pct(style.emoji.usageRatio)} · 글당 ${style.emoji.perPost}개 · 종류 ${style.emoji.unique}`],
    ["해시태그", `글 ${pct(style.hashtag.usageRatio)} · 글당 ${style.hashtag.perPost}개`],
    ["링크", `글 ${pct(style.link.usageRatio)}`],
    ["물음표 / 느낌표", `${pct(style.punctuation.questionRatio)} / ${pct(style.punctuation.exclamationRatio)}`],
    ["마침표 없는 글", pct(style.punctuation.noPeriodRatio)],
    ["격식도", `${style.korean.formality} / 1.0`],
    ["어휘 다양성(TTR)", String(style.lexicon.typeTokenRatio)],
    ["언어 비중", `한글 ${pct(style.langMix.ko)} · 영문 ${pct(style.langMix.en)}`],
  ];
  if (style.timing.peakLabel) rows.push(["게시 시간대", style.timing.peakLabel]);
  return ["| 항목 | 값 |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
}

function speechTable(style: StyleProfile): string {
  const k = style.korean;
  const order: SpeechLevel[] = ["hapsyo", "haeyo", "hae", "seosul", "nominal", "other"];
  const present = order
    .filter((l) => k.speechLevels[l] > 0)
    .sort((a, b) => k.speechLevels[b] - k.speechLevels[a]);
  if (present.length === 0) return "";
  // 반올림 합이 100%를 넘지 않게 맞춘다
  const percents = percentDistribution(present.map((l) => k.speechLevels[l]));
  const rows = present.map((l, i) => `| ${SPEECH_LEVEL_LABEL[l]} | ${percents[i] ?? 0}% |`);
  return ["| 화법 | 문장 비중 |", "| --- | --- |", ...rows].join("\n");
}

function exampleBlock(posts: Post[]): string {
  if (posts.length === 0) return "_(원문 표본 없음)_";
  return posts
    .map((p, i) => {
      const meta = [
        p.platform,
        p.createdAt ? p.createdAt.slice(0, 10) : undefined,
        p.metrics?.likes ? `♥ ${p.metrics.likes}` : undefined,
        `${p.text.length}자`,
      ]
        .filter(Boolean)
        .join(" · ");
      const body = truncate(p.text.replace(/\r/g, ""), 900);
      return `### 표본 ${i + 1} — ${meta}\n\n\`\`\`text\n${body}\n\`\`\``;
    })
    .join("\n\n");
}

/** 관찰된 열기/닫기 패턴으로 재사용 가능한 골격을 제시한다. */
function structureTemplate(style: StyleProfile): string {
  const lines: string[] = [];
  const openers = style.structure.openers.filter((o) => String(o.value).length >= 6).slice(0, 4);
  const closers = style.structure.closers.filter((c) => String(c.value).length >= 6).slice(0, 4);

  const sentenceTarget = Math.max(1, Math.round(style.sentencesPerPost));
  const lengthTarget = Math.round(style.postLength.median);

  lines.push(`1. **여는 문장** — ${style.sentenceLength.median}자 안팎. 배경 설명 없이 바로 본론으로 들어간다.`);
  if (openers.length > 0) {
    lines.push(`   관찰된 첫 문장: ${openers.map((o) => `\`${o.value}\``).join(" / ")}`);
  }
  lines.push(
    `2. **본문** — ${Math.max(1, sentenceTarget - 2)}~${sentenceTarget + 1}문장. ` +
      (style.layout.blankLineRatio > 0.4
        ? "빈 줄로 단락을 끊는다."
        : style.layout.lineBreaksPerPost >= 3
          ? "줄바꿈으로 호흡을 끊되 빈 줄은 쓰지 않는다."
          : "줄바꿈 없이 한 덩어리로 붙인다."),
  );
  lines.push(
    `3. **닫는 문장** — ` +
      (style.structure.readerQuestionRatio > 0.25
        ? "독자에게 질문을 던지거나 여운을 남긴다."
        : "결론을 한 문장으로 못 박는다. 요약하거나 정리하지 않는다."),
  );
  if (closers.length > 0) {
    lines.push(`   관찰된 마지막 문장: ${closers.map((c) => `\`${c.value}\``).join(" / ")}`);
  }
  lines.push(
    `4. **꼬리** — ` +
      (style.hashtag.usageRatio > 0.4
        ? `해시태그 ${Math.max(1, Math.round(style.hashtag.perPost))}개.`
        : "해시태그 없이 끝낸다."),
  );
  lines.push("");
  lines.push(`전체 목표 길이: **${lengthTarget}자 ± 30%** (상한 ${Math.round(style.postLength.p90)}자)`);
  return lines.join("\n");
}

function checklist(style: StyleProfile): string {
  const items: string[] = [];
  items.push(`[ ] 길이가 ${Math.round(style.postLength.median)}자 ± 30% 안에 있는가`);
  items.push(`[ ] 문장이 평균 ${Math.round(style.sentenceLength.mean)}자를 크게 넘지 않는가`);
  if (style.dominantLang !== "en") {
    items.push(`[ ] 종결 어미가 ${SPEECH_LEVEL_LABEL[style.korean.dominantSpeechLevel]}로 일관되는가`);
    const endings = style.korean.topEndings.slice(0, 5).map((e) => e.value);
    if (endings.length > 0) items.push(`[ ] 관찰된 종결 표현(${endings.join(", ")})을 재사용했는가`);
  }
  items.push(
    style.emoji.usageRatio > 0.3
      ? `[ ] 이모지가 글당 ${Math.max(1, Math.round(style.emoji.perPost))}개 수준인가`
      : "[ ] 이모지를 넣지 않았는가",
  );
  items.push(
    style.hashtag.usageRatio > 0.4 ? "[ ] 해시태그를 붙였는가" : "[ ] 해시태그를 만들어 붙이지 않았는가",
  );
  if (style.layout.bulletRatio < 0.1) items.push("[ ] 불릿 목록으로 정리하지 않았는가");
  items.push("[ ] 원문에 없는 사실·수치를 만들어내지 않았는가");
  items.push("[ ] 상용구('여러분', '~해보시는 건 어떨까요')를 넣지 않았는가");
  return items.map((i) => `- ${i}`).join("\n");
}

function sourceList(persona: Persona): string {
  if (persona.sources.length === 0) return "- (없음)";
  return persona.sources
    .map((s) => `- \`${s.platform}\` / ${s.kind}: ${s.url ?? s.raw}`)
    .join("\n");
}

/** ~/.kiro/skills 규격의 SKILL.md 본문을 만든다. */
export function renderSkillMarkdown(persona: Persona): string {
  const { style, synthesis } = persona;
  const speech = speechTable(style);

  const sections: string[] = [];

  sections.push(`---
name: ${persona.slug}
description: ${yamlString(persona.description)}
---`);

  sections.push(`# ${persona.name} 페르소나

${synthesis.oneLiner}

> 이 스킬은 ${persona.postCount}개의 실제 게시글을 측정해 만들었다. 아래 수치는 원문에서 계산된 값이며, 글을 쓸 때 지켜야 하는 제약이다.
> 생성 시각 ${persona.generatedAt} · 합성 방식 ${synthesis.provider === "llm" ? `LLM(${synthesis.model}) + 결정론적 지표` : "결정론적 지표만"}`);

  sections.push(`## 언제 쓰는가

- ${persona.name}의 말투로 게시글·댓글·스레드 초안을 쓸 때
- 내가 쓴 초안을 이 사람의 문체로 고쳐 쓸 때
- 이 사람이 이 주제에 대해 어떻게 말할지 시뮬레이션할 때

쓰지 않는 경우: 사실 확인이 필요한 정보 제공, 이 사람 이름으로 하는 실제 발화(사칭). 아래 "경계" 참고.`);

  sections.push(`## 목소리

${bullets(synthesis.voice)}`);

  sections.push(`## 측정된 문체 지표

${metricsTable(style)}${speech ? `\n\n${speech}` : ""}`);

  sections.push(`## 종결 어미와 말투

관찰된 종결 표현 (빈도순):

${countedList(style.korean.topEndings, 15, "`")}

문장을 잇는 말: ${countedList(style.lexicon.connectives, 10)}`);

  sections.push(`## 반복되는 습관

${bullets(synthesis.quirks)}`);

  sections.push(`## 글 구조 골격

${structureTemplate(style)}`);

  const hashtagLine =
    style.hashtag.top.length > 0
      ? `\n\n관찰된 해시태그: ${style.hashtag.top.slice(0, 15).map((h) => `#${h.value}`).join(" ")}`
      : "";
  sections.push(`## 소재

${synthesis.topics.length > 0 ? synthesis.topics.map((t) => `\`${t}\``).join(" · ") : "—"}${hashtagLine}`);

  sections.push(`## 드러나는 태도

${bullets(synthesis.values)}`);

  sections.push(`## 반드시 할 것

${bullets(synthesis.dos)}`);

  sections.push(`## 하지 말 것

${bullets(synthesis.donts)}`);

  sections.push(`## 원문 표본

이 문체를 재현하기 전에 아래 원문의 호흡을 먼저 읽어라. 지표보다 원문이 우선이다.

${exampleBlock(persona.examples)}

더 많은 원문: \`references/samples.md\` · 전체 지표: \`references/metrics.md\``);

  sections.push(`## 출력 전 체크리스트

${checklist(style)}`);

  sections.push(`## 데이터 출처와 한계

수집 소스:

${sourceList(persona)}

- 분석 표본은 ${persona.postCount}건이다. ${persona.postCount < 15 ? "표본이 적어 지표의 신뢰도가 낮다. 원문 표본을 더 크게 신뢰할 것." : "지표는 표본 범위 안에서만 유효하다."}
- 공개 게시글에서만 수집했다. 비공개·삭제된 글은 포함되지 않는다.
- 문체 재현 도구다. 이 사람의 의견·사실 주장을 대신 만들어내는 근거로 쓰면 안 된다.

## 경계

- 실제 인물을 사칭해 그 사람 이름으로 발화하지 않는다. 본인이 자기 문체를 재사용하는 용도, 또는 명시적 동의를 받은 경우에만 쓴다.
- 개인식별정보(연락처, 주소, 가족 관계 등)를 생성 결과에 넣지 않는다.
- 원문에 없는 사실·수치·인용을 만들어내지 않는다.`);

  return `${sections.join("\n\n").replace(/\n{4,}/g, "\n\n\n").trim()}\n`;
}
