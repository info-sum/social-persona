#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { run, type RunResult } from "./index.js";
import { HELP, parseArgs, type CliArgs } from "./cli-args.js";
import { fail, info, ok, setVerbose, step, warn } from "./util/log.js";
import { resolveLlmConfig } from "./analyze/llm.js";
import { isBrowserAvailable, BROWSER_INSTALL_HINT } from "./ingest/browser.js";
import { isImpersonateAvailable, IMPERSONATE_INSTALL_HINT } from "./ingest/impersonate.js";

async function readLinkFiles(files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    const raw = await readFile(f, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith("#")) out.push(t);
    }
  }
  return out;
}

function printSummary(persona: RunResult["persona"]): void {
  const s = persona.style;
  info("");
  info(`페르소나: ${persona.name}  (스킬 이름: ${persona.slug})`);
  info(`표본: ${persona.postCount}건 · ${s.totalChars.toLocaleString("ko-KR")}자`);
  info(`화법: ${s.korean.dominantSpeechLevel} · 격식도 ${s.korean.formality} · 주 언어 ${s.dominantLang}`);
  info(`길이: 중앙값 ${s.postLength.median}자 · 문장 ${s.sentenceLength.mean}자 · 글당 ${s.sentencesPerPost}문장`);
  info(`이모지 ${Math.round(s.emoji.usageRatio * 100)}% · 해시태그 ${Math.round(s.hashtag.usageRatio * 100)}%`);
  if (s.topics.length > 0) info(`토픽: ${s.topics.slice(0, 8).map((t) => t.value).join(", ")}`);
  info(`합성: ${persona.synthesis.provider}${persona.synthesis.model ? ` (${persona.synthesis.model})` : ""}`);
}

/** 수집 대상에 Instagram/Threads가 있으면 필요한 전략 가용성을 미리 알려준다. */
async function warnIfBrowserNeeded(inputs: string[], useBrowser: boolean, useImpersonate: boolean): Promise<void> {
  const needsMeta = inputs.some((i) => /instagram\.com|threads\.(net|com)|^(instagram|ig|threads):/i.test(i));
  if (!needsMeta) return;

  const hasImpersonate = useImpersonate && (await isImpersonateAvailable());
  if (hasImpersonate) return; // 가장 빠른 경로가 살아 있으면 더 말할 것 없다

  if (!useImpersonate) {
    warn("Instagram/Threads는 --no-impersonate 로는 공개 캡션을 거의 얻을 수 없습니다.");
  } else {
    warn(`Instagram/Threads 수집의 1순위 경로가 꺼져 있습니다. ${IMPERSONATE_INSTALL_HINT}`);
  }
  if (useBrowser && !(await isBrowserAvailable())) {
    warn(`대체 경로인 헤드리스 브라우저도 없습니다. ${BROWSER_INSTALL_HINT}`);
  }
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    info("`social-persona --help` 로 사용법을 확인하세요.");
    return 2;
  }

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  setVerbose(args.verbose);

  const fromLinks = args.fromFiles.length > 0 ? await readLinkFiles(args.fromFiles) : [];
  const inputs = [...args.inputs, ...fromLinks];

  if (inputs.length === 0 && args.inputFiles.length === 0) {
    fail("링크가 없습니다.");
    process.stdout.write(HELP);
    return 2;
  }

  if (args.useLlm && !resolveLlmConfig()) {
    warn("LLM API 키가 없습니다. 결정론적 문체 분석만으로 진행합니다 (품질은 낮지만 완전히 동작합니다).");
  }
  await warnIfBrowserNeeded(inputs, args.useBrowser, args.useImpersonate);

  const outDir = args.install ? join(homedir(), ".kiro", "skills") : args.outDir;

  try {
    const result = await run(inputs, {
      outDir,
      name: args.name,
      limit: args.limit,
      useLlm: args.useLlm,
      useBrowser: args.useBrowser,
      useImpersonate: args.useImpersonate,
      verbose: args.verbose,
      inputFiles: args.inputFiles,
      force: args.force,
      write: !args.dryRun,
    });

    for (const note of result.notes) info(`  ${note}`);
    printSummary(result.persona);

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result.persona, null, 2)}\n`);
    }

    if (result.write) {
      info("");
      ok(`스킬 생성: ${result.write.skillDir}`);
      for (const f of result.write.files) info(`   ${relative(process.cwd(), f)}`);
      info("");
      if (args.install) {
        step("설치 완료. 새 세션에서 이 페르소나 스킬을 쓸 수 있습니다.");
      } else {
        step(`설치하려면: cp -R ${relative(process.cwd(), result.write.skillDir)} ~/.kiro/skills/`);
      }
    } else {
      info("");
      step("--dry-run 이므로 파일을 쓰지 않았습니다.");
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(msg);
    info("");
    info("수집이 실패했다면 다음을 시도하세요:");
    info("  1. 개별 게시글 URL을 여러 개 넣기 (프로필보다 성공률이 높습니다)");
    info("  2. 글을 복사해 텍스트 파일로 만들고 --input ./posts.md 로 넘기기");
    info("  3. -v 로 어떤 전략이 실패했는지 확인하기");
    info("  4. Instagram/Threads라면 npx playwright install chromium 후 재시도");
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
