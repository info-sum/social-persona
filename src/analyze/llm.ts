import type { PersonaSynthesis, Post, StyleProfile } from "../types.js";
import { debug, warn } from "../util/log.js";
import { truncate } from "../util/text.js";

export interface LlmConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** 환경변수로 LLM 사용 가능 여부를 판단한다. 키가 없으면 undefined. */
export function resolveLlmConfig(): LlmConfig | undefined {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return {
      provider: "anthropic",
      apiKey: anthropicKey,
      model: process.env.SOCIAL_PERSONA_MODEL ?? "claude-sonnet-4-20250514",
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      provider: "openai",
      apiKey: openaiKey,
      model: process.env.SOCIAL_PERSONA_MODEL ?? "gpt-4o-mini",
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    };
  }
  return undefined;
}

const SYSTEM_PROMPT = `당신은 문체 분석가다. 주어진 SNS 게시글 원문과 정량 지표를 근거로, 그 사람처럼 글을 쓰기 위한 페르소나 명세를 만든다.

규칙:
- 원문에서 실제로 확인되는 것만 쓴다. 추측하거나 꾸미지 않는다.
- 성격을 칭찬하거나 브랜딩하지 않는다. 관찰 결과만 건조하게 적는다.
- 각 항목은 한국어 한 문장으로, 재현 가능한 지시문 형태로 쓴다.
- 실명·연락처·주소 등 개인식별정보는 결과에 넣지 않는다.
- 반드시 아래 JSON 스키마 하나만 출력한다. 코드펜스나 설명을 덧붙이지 않는다.

{
  "oneLiner": "이 사람을 한 문장으로",
  "voice": ["목소리 특징 (5~8개)"],
  "topics": ["반복되는 주제 (5~10개)"],
  "values": ["글에서 드러나는 태도·관점 (3~6개)"],
  "quirks": ["반복되는 습관적 표현이나 구조 (3~8개)"],
  "dos": ["이 사람처럼 쓰려면 반드시 할 것 (5~8개)"],
  "donts": ["절대 하지 말 것 (4~7개)"]
}`;

function buildUserPrompt(style: StyleProfile, posts: Post[]): string {
  const metrics = {
    게시글수: style.postCount,
    평균길이: style.postLength.mean,
    문장평균길이: style.sentenceLength.mean,
    글당문장수: style.sentencesPerPost,
    리듬변동성: style.burstiness,
    화법분포: style.korean.speechLevels,
    격식도: style.korean.formality,
    자주쓰는종결어미: style.korean.topEndings.slice(0, 10).map((e) => e.value),
    이모지: { 사용률: style.emoji.usageRatio, 상위: style.emoji.top.slice(0, 8).map((e) => e.value) },
    해시태그: { 사용률: style.hashtag.usageRatio, 상위: style.hashtag.top.slice(0, 10).map((e) => e.value) },
    구두점1000자당: style.punctuation.per1k,
    레이아웃: style.layout,
    반복어휘: style.lexicon.signaturePhrases.slice(0, 15).map((s) => s.value),
    자주쓰는조합: style.lexicon.topBigrams.slice(0, 10).map((s) => s.value),
    토픽: style.topics.slice(0, 15).map((t) => t.value),
    언어비중: style.langMix,
  };

  const samples = posts
    .slice(0, 25)
    .map((p, i) => `--- 글 ${i + 1} (${p.platform}${p.createdAt ? `, ${p.createdAt.slice(0, 10)}` : ""}) ---\n${truncate(p.text, 1200)}`)
    .join("\n\n");

  return `## 정량 지표\n${JSON.stringify(metrics, null, 2)}\n\n## 원문 표본\n${samples}\n\n위 근거만으로 JSON을 출력하라.`;
}

function extractJson(raw: string): Partial<PersonaSynthesis> | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    const arr = (k: string): string[] | undefined => {
      const v = parsed[k];
      if (!Array.isArray(v)) return undefined;
      return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
    };
    return {
      oneLiner: typeof parsed["oneLiner"] === "string" ? parsed["oneLiner"] : undefined,
      voice: arr("voice"),
      topics: arr("topics"),
      values: arr("values"),
      quirks: arr("quirks"),
      dos: arr("dos"),
      donts: arr("donts"),
    };
  } catch {
    return undefined;
  }
}

async function callAnthropic(cfg: LlmConfig, userPrompt: string): Promise<string | undefined> {
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    warn(`Anthropic API 오류 ${res.status}: ${truncate(await res.text(), 200)}`);
    return undefined;
  }
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (json.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

async function callOpenai(cfg: LlmConfig, userPrompt: string): Promise<string | undefined> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 3000,
    }),
  });
  if (!res.ok) {
    warn(`OpenAI API 오류 ${res.status}: ${truncate(await res.text(), 200)}`);
    return undefined;
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? undefined;
}

/** LLM으로 정성적 페르소나 서술을 만든다. 실패하면 undefined를 돌려주고 호출자는 휴리스틱을 쓴다. */
export async function llmSynthesize(
  style: StyleProfile,
  posts: Post[],
  cfg: LlmConfig,
): Promise<Partial<PersonaSynthesis> | undefined> {
  const prompt = buildUserPrompt(style, posts);
  debug(`LLM 호출: ${cfg.provider}/${cfg.model}, prompt ${prompt.length}자`);
  try {
    const raw = cfg.provider === "anthropic" ? await callAnthropic(cfg, prompt) : await callOpenai(cfg, prompt);
    if (!raw) return undefined;
    const parsed = extractJson(raw);
    if (!parsed) {
      warn("LLM 응답을 JSON으로 파싱하지 못했습니다. 휴리스틱 결과만 사용합니다.");
      return undefined;
    }
    return parsed;
  } catch (err) {
    warn(`LLM 호출 실패: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
