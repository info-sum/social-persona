import type { Persona, Post } from "../types.js";

const pct = (n: number): string => `${Math.round(n * 1000) / 10}%`;

/** 전체 정량 지표를 사람이 읽을 수 있게 펼친 참고 문서. */
export function renderMetricsMarkdown(persona: Persona): string {
  const s = persona.style;
  const table = (rows: [string, string | number][]): string =>
    ["| 항목 | 값 |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");

  const counted = (items: { value: string; count: number; ratio?: number }[]): string => {
    if (items.length === 0) return "_(없음)_\n";
    return (
      ["| 값 | 횟수 | 비율 |", "| --- | --- | --- |"]
        .concat(items.map((i) => `| \`${i.value}\` | ${i.count} | ${i.ratio !== undefined ? pct(i.ratio) : "—"} |`))
        .join("\n") + "\n"
    );
  };

  const hourRows = s.timing.byHour
    .map((n, h) => ({ h, n }))
    .filter((x) => x.n > 0)
    .map((x) => `| ${String(x.h).padStart(2, "0")}시 | ${x.n} |`);

  const weekdayKo = ["일", "월", "화", "수", "목", "금", "토"];
  const weekdayRows = s.timing.byWeekday
    .map((n, d) => ({ d, n }))
    .filter((x) => x.n > 0)
    .map((x) => `| ${weekdayKo[x.d]}요일 | ${x.n} |`);

  return `# ${persona.name} — 전체 문체 지표

생성: ${persona.generatedAt} · 표본 ${persona.postCount}건

## 분량

${table([
  ["글 수", s.postCount],
  ["총 글자 수", s.totalChars],
  ["글 길이 평균", s.postLength.mean],
  ["글 길이 중앙값", s.postLength.median],
  ["글 길이 상위 10%", s.postLength.p90],
  ["글 길이 최소/최대", `${s.postLength.min} / ${s.postLength.max}`],
  ["문장 길이 평균", s.sentenceLength.mean],
  ["문장 길이 중앙값", s.sentenceLength.median],
  ["글당 문장 수", s.sentencesPerPost],
  ["문장당 어절 수", s.wordsPerSentence],
  ["리듬 변동성 (표준편차/평균)", s.burstiness],
])}

## 언어

${table([
  ["한글 비중", pct(s.langMix.ko)],
  ["영문 비중", pct(s.langMix.en)],
  ["기타", pct(s.langMix.other)],
  ["주 언어", s.dominantLang],
  ["어휘 다양성(TTR)", s.lexicon.typeTokenRatio],
])}

## 레이아웃

${table([
  ["글당 줄바꿈", s.layout.lineBreaksPerPost],
  ["빈 줄 단락 사용률", pct(s.layout.blankLineRatio)],
  ["불릿 사용률", pct(s.layout.bulletRatio)],
  ["번호 목록 사용률", pct(s.layout.numberedRatio)],
  ["한 줄 글 비율", pct(s.layout.oneLinerRatio)],
])}

## 구두점 (1000자당)

${table(Object.entries(s.punctuation.per1k).sort((a, b) => b[1] - a[1]) as [string, number][])}

${table([
  ["물음표 포함 글", pct(s.punctuation.questionRatio)],
  ["느낌표 포함 글", pct(s.punctuation.exclamationRatio)],
  ["줄임표 포함 글", pct(s.punctuation.ellipsisRatio)],
  ["물결표 포함 글", pct(s.punctuation.tildeRatio)],
  ["마침표 없는 글", pct(s.punctuation.noPeriodRatio)],
])}

## 한국어 화법

${table([
  ["합니다체", pct(s.korean.speechLevels.hapsyo)],
  ["해요체", pct(s.korean.speechLevels.haeyo)],
  ["해체/반말", pct(s.korean.speechLevels.hae)],
  ["서술체(-다)", pct(s.korean.speechLevels.seosul)],
  ["명사 종결", pct(s.korean.speechLevels.nominal)],
  ["판정 불가", pct(s.korean.speechLevels.other)],
  ["지배 화법", s.korean.dominantSpeechLevel],
  ["격식도", s.korean.formality],
])}

### 자주 쓰는 종결 표현

${counted(s.korean.topEndings)}

## 이모지

${table([
  ["사용률", pct(s.emoji.usageRatio)],
  ["글당 개수", s.emoji.perPost],
  ["종류 수", s.emoji.unique],
])}

${counted(s.emoji.top)}

## 해시태그 · 멘션

${table([
  ["해시태그 사용률", pct(s.hashtag.usageRatio)],
  ["글당 해시태그", s.hashtag.perPost],
  ["멘션 사용률", pct(s.mention.usageRatio)],
  ["링크 포함 글", pct(s.link.usageRatio)],
])}

${counted(s.hashtag.top)}

## 어휘

### 상위 단어

${counted(s.lexicon.topWords)}

### 시그니처 표현 (흔한 말 제외, 반복 등장)

${counted(s.lexicon.signaturePhrases)}

### 자주 붙여 쓰는 2-gram

${counted(s.lexicon.topBigrams)}

### 3-gram

${counted(s.lexicon.topTrigrams)}

### 접속 표현

${counted(s.lexicon.connectives)}

## 구조

${table([
  ["질문으로 닫는 글", pct(s.structure.readerQuestionRatio)],
  ["1인칭 등장 글", pct(s.structure.firstPersonRatio)],
  ["청유·권유 표현 글", pct(s.structure.imperativeRatio)],
])}

### 첫 문장 패턴

${counted(s.structure.openers)}

### 마지막 문장 패턴

${counted(s.structure.closers)}

## 토픽

${counted(s.topics)}

## 게시 시간

${hourRows.length > 0 ? ["| 시각 | 글 수 |", "| --- | --- |", ...hourRows].join("\n") : "_(타임스탬프 없음)_"}

${weekdayRows.length > 0 ? ["| 요일 | 글 수 |", "| --- | --- |", ...weekdayRows].join("\n") : ""}

## 수집 진단

${persona.notes.length > 0 ? persona.notes.map((n) => `- ${n}`).join("\n") : "- (없음)"}
`;
}

/** 수집한 원문 전체를 보존한다. 지표보다 원문이 더 정확한 참고자료다. */
export function renderSamplesMarkdown(persona: Persona, posts: Post[]): string {
  const body = posts
    .map((p, i) => {
      const meta = [
        `#${i + 1}`,
        p.platform,
        p.createdAt ? p.createdAt.slice(0, 16).replace("T", " ") : undefined,
        `${p.text.length}자`,
        p.metrics?.likes !== undefined ? `♥${p.metrics.likes}` : undefined,
        p.strategy,
      ]
        .filter(Boolean)
        .join(" · ");
      const link = p.url ? `\n<${p.url}>\n` : "";
      return `## ${meta}\n${link}\n\`\`\`text\n${p.text.replace(/```/g, "``\u200b`")}\n\`\`\``;
    })
    .join("\n\n");

  return `# ${persona.name} — 수집 원문 ${posts.length}건

생성: ${persona.generatedAt}

원문은 공개 게시글에서 수집했다. 문체 재현 참고용으로만 쓴다.

${body}
`;
}
