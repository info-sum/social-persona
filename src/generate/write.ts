import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Persona, Post } from "../types.js";
import { renderSkillMarkdown } from "./skill.js";
import { renderMetricsMarkdown, renderSamplesMarkdown } from "./references.js";

export interface WriteResult {
  skillDir: string;
  files: string[];
}

/**
 * 스킬 디렉토리를 만든다.
 * <outDir>/<slug>/SKILL.md
 *                /persona.json
 *                /references/metrics.md
 *                /references/samples.md
 */
export async function writeSkill(persona: Persona, posts: Post[], outDir: string): Promise<WriteResult> {
  const skillDir = resolve(outDir, persona.slug);
  const refDir = join(skillDir, "references");
  await mkdir(refDir, { recursive: true });

  const files: string[] = [];
  const put = async (path: string, content: string): Promise<void> => {
    await writeFile(path, content, "utf8");
    files.push(path);
  };

  await put(join(skillDir, "SKILL.md"), renderSkillMarkdown(persona));
  await put(
    join(skillDir, "persona.json"),
    `${JSON.stringify({ ...persona, examples: persona.examples.map((e) => ({ ...e })) }, null, 2)}\n`,
  );
  await put(join(refDir, "metrics.md"), renderMetricsMarkdown(persona));
  await put(join(refDir, "samples.md"), renderSamplesMarkdown(persona, posts));
  await put(join(refDir, "posts.json"), `${JSON.stringify(posts, null, 2)}\n`);

  return { skillDir, files };
}

export { renderSkillMarkdown, renderMetricsMarkdown, renderSamplesMarkdown };
