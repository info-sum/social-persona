import type { GenerateOptions, Persona, Post, SourceRef } from "./types.js";
import { detectSources } from "./ingest/detect.js";
import { collectPosts } from "./ingest/index.js";
import { buildPersona } from "./analyze/index.js";
import { writeSkill, type WriteResult } from "./generate/write.js";
import { debug, step } from "./util/log.js";

export * from "./types.js";
export { detectSource, detectSources, normalizeUrl } from "./ingest/detect.js";
export { collectPosts } from "./ingest/index.js";
export { analyzeStyle, pickExamples, buildPersona, inferName } from "./analyze/index.js";
export { heuristicSynthesis } from "./analyze/synthesize.js";
export { classifySpeechLevel, endingForms, koreanMarkers } from "./analyze/korean.js";
export { parseManualText } from "./ingest/adapters/manual.js";
export { renderSkillMarkdown, renderMetricsMarkdown, renderSamplesMarkdown, writeSkill } from "./generate/write.js";
export { parseFeed, parseJsonFeed, htmlToText } from "./ingest/rss.js";
export { extractArticleText, extractMeta, discoverFeeds, cleanReaderMarkdown } from "./ingest/html.js";

export interface RunResult {
  persona: Persona;
  posts: Post[];
  sources: SourceRef[];
  write?: WriteResult;
  notes: string[];
}

export const DEFAULT_OPTIONS: GenerateOptions = {
  outDir: "./out",
  limit: 60,
  useLlm: true,
  verbose: false,
  inputFiles: [],
  force: false,
  useBrowser: true,
  useImpersonate: true,
};

/**
 * 전체 파이프라인: 링크 감지 → 수집 → 분석 → 합성 → 스킬 생성.
 * `write: false`면 파일을 만들지 않고 결과만 돌려준다.
 */
export async function run(
  inputs: string[],
  options: Partial<GenerateOptions> & { write?: boolean } = {},
): Promise<RunResult> {
  const opts: GenerateOptions = { ...DEFAULT_OPTIONS, ...options };
  const urlSources = detectSources(inputs);
  const fileSources: SourceRef[] = opts.inputFiles.map((f) => ({
    raw: f,
    platform: "manual",
    kind: "file",
  }));
  const sources = [...urlSources, ...fileSources];
  debug(`소스 ${sources.length}개 감지: ${sources.map((s) => `${s.platform}/${s.kind}`).join(", ")}`);

  step(`수집 시작: ${urlSources.length}개 소스${opts.inputFiles.length > 0 ? ` + 입력파일 ${opts.inputFiles.length}개` : ""}`);
  const collected = await collectPosts(urlSources, {
    limitPerSource: opts.limit,
    inputFiles: opts.inputFiles,
    useBrowser: opts.useBrowser,
    useImpersonate: opts.useImpersonate,
  });

  const persona = await buildPersona({
    posts: collected.posts,
    sources,
    notes: collected.notes,
    options: { name: opts.name, useLlm: opts.useLlm, force: opts.force },
  });

  const result: RunResult = {
    persona,
    posts: collected.posts,
    sources,
    notes: collected.notes,
  };

  if (options.write !== false) {
    result.write = await writeSkill(persona, collected.posts, opts.outDir);
  }
  return result;
}
