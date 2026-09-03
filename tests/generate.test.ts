import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/index.js";
import { renderMetricsMarkdown, renderSamplesMarkdown, renderSkillMarkdown } from "../src/generate/write.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "posts-ko-haeyo.md");
const FIXTURE_DEV = join(import.meta.dirname, "fixtures", "posts-ko-seosul.md");

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "social-persona-test-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** SKILL.md 프론트매터를 최소 파싱한다 (name/description). */
function parseFrontmatter(md: string): { name?: string; description?: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(md);
  if (!m) return { body: md };
  const out: { name?: string; description?: string; body: string } = { body: m[2] ?? "" };
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    let value = (kv[2] ?? "").trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = JSON.parse(value) as string;
    }
    if (key === "name") out.name = value;
    if (key === "description") out.description = value;
  }
  return out;
}

describe("run — 수동 입력 엔드투엔드 (네트워크 없음)", () => {
  it("페르소나와 스킬 파일을 만든다", async () => {
    const outDir = await makeTempDir();
    const result = await run([], {
      inputFiles: [FIXTURE],
      outDir,
      name: "소연",
      useLlm: false,
    });

    expect(result.posts.length).toBe(5);
    expect(result.persona.name).toBe("소연");
    expect(result.persona.slug).toBe("soyeon-persona");
    expect(result.persona.synthesis.provider).toBe("heuristic");
    expect(result.write?.files).toHaveLength(5);

    const skillPath = join(outDir, "soyeon-persona", "SKILL.md");
    const md = await readFile(skillPath, "utf8");
    const fm = parseFrontmatter(md);

    expect(fm.name).toBe("soyeon-persona");
    expect(fm.description).toBeDefined();
    expect(fm.description!.length).toBeGreaterThan(30);
    // 프론트매터 값에 줄바꿈이 섞여 YAML이 깨지지 않아야 한다
    expect(fm.description).not.toContain("\n");

    for (const heading of [
      "## 언제 쓰는가",
      "## 목소리",
      "## 측정된 문체 지표",
      "## 종결 어미와 말투",
      "## 글 구조 골격",
      "## 반드시 할 것",
      "## 하지 말 것",
      "## 원문 표본",
      "## 출력 전 체크리스트",
      "## 데이터 출처와 한계",
      "## 경계",
    ]) {
      expect(fm.body).toContain(heading);
    }
  });

  it("수동 입력 파일이 소스 목록에 남는다", async () => {
    const result = await run([], { inputFiles: [FIXTURE], useLlm: false, write: false });
    expect(result.sources.some((s) => s.kind === "file" && s.raw === FIXTURE)).toBe(true);
    const md = renderSkillMarkdown(result.persona);
    expect(md).toContain("posts-ko-haeyo.md");
  });

  it("write: false 면 파일을 만들지 않는다", async () => {
    const result = await run([], { inputFiles: [FIXTURE], useLlm: false, write: false });
    expect(result.write).toBeUndefined();
  });

  it("참고 문서를 함께 쓴다", async () => {
    const outDir = await makeTempDir();
    await run([], { inputFiles: [FIXTURE], outDir, name: "소연", useLlm: false });
    const metrics = await readFile(join(outDir, "soyeon-persona", "references", "metrics.md"), "utf8");
    const samples = await readFile(join(outDir, "soyeon-persona", "references", "samples.md"), "utf8");
    const posts = JSON.parse(await readFile(join(outDir, "soyeon-persona", "references", "posts.json"), "utf8")) as unknown[];

    expect(metrics).toContain("## 한국어 화법");
    expect(metrics).toContain("## 이모지");
    expect(samples).toContain("수집 원문 5건");
    expect(posts).toHaveLength(5);
  });

  it("persona.json 이 다시 읽을 수 있는 JSON이다", async () => {
    const outDir = await makeTempDir();
    const result = await run([], { inputFiles: [FIXTURE], outDir, name: "소연", useLlm: false });
    const raw = await readFile(join(outDir, "soyeon-persona", "persona.json"), "utf8");
    const parsed = JSON.parse(raw) as { name: string; style: { postCount: number } };
    expect(parsed.name).toBe("소연");
    expect(parsed.style.postCount).toBe(result.posts.length);
  });

  it("이름을 안 주면 슬러그를 폴백으로 만든다", async () => {
    const result = await run([], { inputFiles: [FIXTURE], useLlm: false, write: false });
    expect(result.persona.slug).toMatch(/-persona$/);
  });

  it("여러 입력 파일을 합친다", async () => {
    const result = await run([], { inputFiles: [FIXTURE, FIXTURE_DEV], useLlm: false, write: false });
    expect(result.posts.length).toBe(11);
  });

  it("수집이 전부 실패하면 명확히 던진다", async () => {
    await expect(run(["@nobody-knows-this-platform"], { useLlm: false, write: false })).rejects.toThrow(
      /게시글이 없습니다/,
    );
  });
});

describe("렌더러 단위", () => {
  it("문체가 다르면 지시문도 달라진다", async () => {
    const a = await run([], { inputFiles: [FIXTURE], useLlm: false, write: false, name: "소연" });
    const b = await run([], { inputFiles: [FIXTURE_DEV], useLlm: false, write: false, name: "밤코딩" });

    const mdA = renderSkillMarkdown(a.persona);
    const mdB = renderSkillMarkdown(b.persona);

    expect(mdA).toContain("해요체");
    expect(mdB).toContain("서술체");
    expect(mdA).toContain("해시태그를 붙였는가");
    expect(mdB).toContain("해시태그를 만들어 붙이지 않았는가");
  });

  it("metrics/samples 렌더러가 빈 값에도 죽지 않는다", async () => {
    const r = await run([], { inputFiles: [FIXTURE], useLlm: false, write: false });
    expect(() => renderMetricsMarkdown(r.persona)).not.toThrow();
    expect(() => renderSamplesMarkdown(r.persona, r.posts)).not.toThrow();
  });

  it("원문의 코드펜스가 마크다운을 깨지 않는다", async () => {
    const r = await run([], { inputFiles: [FIXTURE], useLlm: false, write: false });
    const withFence = [{ ...r.posts[0]!, text: "```\ncode\n```" }];
    const md = renderSamplesMarkdown(r.persona, withFence);
    // 원문 안의 ``` 은 그대로 남지 않는다
    expect(md.split("```").length - 1).toBe(2);
  });
});
