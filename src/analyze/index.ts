import type { GenerateOptions, Persona, Post, SourceRef } from "../types.js";
import { analyzeStyle, pickExamples } from "./stylometry.js";
import { heuristicSynthesis, mergeSynthesis } from "./synthesize.js";
import { llmSynthesize, resolveLlmConfig } from "./llm.js";
import { skillName, slugify } from "../util/slug.js";
import { debug, step, warn } from "../util/log.js";

/** 수집된 글과 소스에서 표시 이름을 추론한다. */
export function inferName(posts: Post[], sources: SourceRef[], override?: string): string {
  if (override && override.trim()) return override.trim();

  const authorCounts = new Map<string, number>();
  for (const p of posts) {
    const a = p.author?.trim();
    if (a && a.length <= 40) authorCounts.set(a, (authorCounts.get(a) ?? 0) + 1);
  }
  const topAuthor = [...authorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topAuthor) return topAuthor;

  const handle = sources.find((s) => s.handle)?.handle;
  if (handle) return handle;

  const host = sources.find((s) => s.url)?.url;
  if (host) {
    try {
      return new URL(host).host.replace(/^www\./, "");
    } catch {
      /* 무시 */
    }
  }
  return "unknown-author";
}

export interface BuildPersonaInput {
  posts: Post[];
  sources: SourceRef[];
  notes: string[];
  options: Pick<GenerateOptions, "name" | "useLlm"> & { force?: boolean };
}

/** 문체를 특징짓기 위한 최소 표본 */
export const MIN_POSTS = 3;
export const MIN_CHARS = 300;

export class InsufficientDataError extends Error {
  constructor(
    message: string,
    readonly postCount: number,
    readonly charCount: number,
  ) {
    super(message);
    this.name = "InsufficientDataError";
  }
}

export async function buildPersona(input: BuildPersonaInput): Promise<Persona> {
  const { posts, sources, notes, options } = input;
  if (posts.length === 0) {
    throw new InsufficientDataError("분석할 게시글이 없습니다. 수집이 모두 실패했습니다.", 0, 0);
  }

  const charCount = posts.reduce((a, p) => a + p.text.trim().length, 0);
  if (!options.force && (posts.length < MIN_POSTS || charCount < MIN_CHARS)) {
    throw new InsufficientDataError(
      `표본이 너무 작습니다 (${posts.length}건 / ${charCount}자). ` +
        `문체를 특징짓기 위해 최소 ${MIN_POSTS}건, ${MIN_CHARS}자가 필요합니다. ` +
        `수집이 로그인 벽에 막혔을 수 있습니다. --force 로 그래도 진행할 수 있지만 결과를 신뢰하기 어렵습니다.`,
      posts.length,
      charCount,
    );
  }

  step(`문체 분석: ${posts.length}건`);
  const style = analyzeStyle(posts);
  const name = inferName(posts, sources, options.name);
  const slug = slugify(name);

  // 자기 핸들·이름은 소재가 아니다. 자기 계정을 언급하는 글이 많으면 토픽 상위로 올라온다.
  const selfTerms = new Set(
    [
      name,
      ...sources.map((s) => s.handle).filter((h): h is string => Boolean(h)),
      ...posts.map((p) => p.author).filter((a): a is string => Boolean(a)),
    ]
      .flatMap((v) => [v, ...v.split(/[\s_.-]+/)])
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v.length >= 2),
  );
  style.topics = style.topics.filter((t) => !selfTerms.has(String(t.value).toLowerCase()));
  style.lexicon.signaturePhrases = style.lexicon.signaturePhrases.filter(
    (t) => !selfTerms.has(String(t.value).toLowerCase()),
  );

  let synthesis = heuristicSynthesis(style, posts, name);

  if (options.useLlm) {
    const cfg = resolveLlmConfig();
    if (!cfg) {
      warn("LLM API 키가 없어 결정론적 분석만 사용합니다 (ANTHROPIC_API_KEY 또는 OPENAI_API_KEY).");
    } else {
      step(`LLM 합성: ${cfg.provider}/${cfg.model}`);
      const llm = await llmSynthesize(style, posts, cfg);
      if (llm) {
        synthesis = mergeSynthesis(synthesis, llm, cfg.model);
        debug("LLM 합성 성공");
      }
    }
  }

  const handles = [...new Set(sources.map((s) => s.handle).filter((h): h is string => Boolean(h)))];
  const platforms = [...new Set(posts.map((p) => p.platform))].filter((p) => p !== "manual");
  const topicLabel = synthesis.topics.slice(0, 5).join(", ");

  const description =
    `${name}의 SNS 글(${platforms.join("·") || "manual"}, ${posts.length}건)에서 추출한 문체 페르소나. ` +
    `${topicLabel ? `주요 소재: ${topicLabel}. ` : ""}` +
    `이 사람의 말투로 게시글·댓글·글 초안을 쓰거나, 초안을 이 문체로 고쳐 쓸 때 사용한다.`;

  return {
    name,
    slug: skillName(slug, "sns"),
    description,
    handles,
    sources,
    generatedAt: new Date().toISOString(),
    postCount: posts.length,
    style,
    synthesis,
    examples: pickExamples(posts, 6),
    notes,
  };
}

export { analyzeStyle, pickExamples };
