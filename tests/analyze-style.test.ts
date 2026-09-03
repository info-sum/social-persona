import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Post } from "../src/types.js";
import { analyzeStyle, pickExamples } from "../src/analyze/stylometry.js";
import { heuristicSynthesis } from "../src/analyze/synthesize.js";
import { parseManualText } from "../src/ingest/adapters/manual.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

async function loadFixture(name: string): Promise<Post[]> {
  const raw = await readFile(join(FIXTURES, name), "utf8");
  return parseManualText(raw, "manual", name);
}

describe("parseManualText", () => {
  it("--- 구분선을 경계로 쓴다 (빈 줄로 더 쪼개지 않는다)", () => {
    const posts = parseManualText("첫 글이다.\n\n같은 글의 둘째 단락이다.\n\n---\n두 번째 글이다.", "manual", "t");
    expect(posts).toHaveLength(2);
    expect(posts[0]?.text).toContain("둘째 단락");
  });

  it("구분선이 없으면 빈 줄 두 개를 경계로 쓴다", () => {
    const posts = parseManualText("첫 글이다.\n\n두 번째 글이다.\n\n세 번째 글이다.", "manual", "t");
    expect(posts).toHaveLength(3);
  });

  it("구분선의 날짜 주석을 게시일로 읽는다", () => {
    const posts = parseManualText("첫 글이다 충분히 길게.\n--- @2025-05-05 ---\n두 번째 글이다 충분히 길게.", "manual", "t");
    expect(posts).toHaveLength(2);
    expect(posts[1]?.createdAt).toBe(new Date("2025-05-05").toISOString());
  });

  it("JSON 배열을 읽는다", () => {
    const posts = parseManualText(
      JSON.stringify([
        { text: "첫 글이다.", createdAt: "2025-01-02", likes: 5, platform: "x" },
        { content: "둘째 글이다." },
        { text: "" },
      ]),
      "manual",
      "t",
    );
    expect(posts).toHaveLength(2);
    expect(posts[0]?.platform).toBe("x");
    expect(posts[0]?.metrics?.likes).toBe(5);
    expect(posts[1]?.text).toBe("둘째 글이다.");
  });

  it("{posts:[]} 형태도 읽는다", () => {
    const posts = parseManualText('{"posts":[{"caption":"캡션 글이다."}]}', "instagram", "t");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.platform).toBe("instagram");
  });

  it("빈 입력은 빈 배열", () => {
    expect(parseManualText("   ", "manual", "t")).toEqual([]);
  });
});

describe("analyzeStyle — 서술체 개발자 픽스처", () => {
  it("서술체를 지배 화법으로 잡는다", async () => {
    const style = analyzeStyle(await loadFixture("posts-ko-seosul.md"));
    expect(style.postCount).toBe(6);
    expect(style.korean.dominantSpeechLevel).toBe("seosul");
    expect(style.korean.speechLevels.seosul).toBeGreaterThan(0.7);
    expect(style.korean.formality).toBeGreaterThan(0.6);
  });

  it("이모지·해시태그를 안 쓴다고 판정한다", async () => {
    const style = analyzeStyle(await loadFixture("posts-ko-seosul.md"));
    expect(style.emoji.usageRatio).toBe(0);
    expect(style.hashtag.usageRatio).toBe(0);
  });

  it("한국어를 주 언어로 잡는다", async () => {
    const style = analyzeStyle(await loadFixture("posts-ko-seosul.md"));
    expect(style.dominantLang).toBe("ko");
    expect(style.langMix.ko).toBeGreaterThan(0.9);
  });

  it("명사 토픽을 뽑는다", async () => {
    const style = analyzeStyle(await loadFixture("posts-ko-seosul.md"));
    const topics = style.topics.map((t) => String(t.value));
    expect(topics).toContain("코드");
    // 활용형·접속사는 토픽에 들어가지 않는다
    expect(topics).not.toContain("결국");
    expect(topics).not.toContain("쉽다");
    // 조사가 덜 떨어진 형태도 올라오지 않는다
    expect(topics.some((t) => /(?:은|는|을|를|의|이|가|도|요)$/.test(t))).toBe(false);
  });

  it("자기 핸들은 소재로 올라오지 않는다", async () => {
    const posts = (await loadFixture("posts-ko-seosul.md")).map((p) => ({
      ...p,
      text: `${p.text}\n#밤코딩 by 밤코딩`,
      author: "밤코딩",
    }));
    const { buildPersona } = await import("../src/analyze/index.js");
    const persona = await buildPersona({
      posts,
      sources: [{ raw: "x:@밤코딩", platform: "x", kind: "profile", handle: "밤코딩" }],
      notes: [],
      options: { useLlm: false },
    });
    expect(persona.style.topics.map((t) => String(t.value))).not.toContain("밤코딩");
  });
});

describe("analyzeStyle — 해요체 라이프스타일 픽스처", () => {
  it("해요체를 지배 화법으로 잡는다", async () => {
    const style = analyzeStyle(await loadFixture("posts-ko-haeyo.md"));
    expect(style.korean.dominantSpeechLevel).toBe("haeyo");
    expect(style.korean.formality).toBeLessThan(0.6);
  });

  it("이모지와 해시태그 습관을 잡는다", async () => {
    const style = analyzeStyle(await loadFixture("posts-ko-haeyo.md"));
    expect(style.emoji.usageRatio).toBe(1);
    expect(style.emoji.perPost).toBeGreaterThan(0.9);
    expect(style.hashtag.usageRatio).toBe(1);
    expect(style.hashtag.perPost).toBeGreaterThanOrEqual(3);
  });

  it("해시태그를 토픽 신호로 쓴다", async () => {
    const style = analyzeStyle(await loadFixture("posts-ko-haeyo.md"));
    const topics = style.topics.map((t) => String(t.value));
    expect(topics.some((t) => ["카페투어", "산책", "독서", "집밥", "소확행"].includes(t))).toBe(true);
  });

  it("물결표와 자음 웃음을 감지한다", async () => {
    const style = analyzeStyle(await loadFixture("posts-ko-haeyo.md"));
    expect(style.punctuation.tildeRatio).toBeGreaterThan(0.5);
    expect(style.punctuation.per1k["ㅋㅋ/ㅎㅎ"]).toBeGreaterThan(0);
  });

  it("두 픽스처의 격식도가 구분된다", async () => {
    const a = analyzeStyle(await loadFixture("posts-ko-seosul.md"));
    const b = analyzeStyle(await loadFixture("posts-ko-haeyo.md"));
    expect(a.korean.formality).toBeGreaterThan(b.korean.formality);
  });
});

describe("analyzeStyle — 구조 신호", () => {
  it("불릿과 번호 목록을 센다", () => {
    const posts: Post[] = [
      { id: "1", platform: "blog", text: "정리한다.\n- 하나\n- 둘\n- 셋" },
      { id: "2", platform: "blog", text: "순서대로.\n1. 하나\n2. 둘" },
    ];
    const style = analyzeStyle(posts);
    expect(style.layout.bulletRatio).toBe(0.5);
    expect(style.layout.numberedRatio).toBe(0.5);
  });

  it("한 줄 글 비율을 센다", () => {
    const style = analyzeStyle([
      { id: "1", platform: "x", text: "한 줄로 끝나는 글이다." },
      { id: "2", platform: "x", text: "여러 줄\n로 된 글이다." },
    ]);
    expect(style.layout.oneLinerRatio).toBe(0.5);
  });

  it("질문으로 닫는 글을 센다", () => {
    const style = analyzeStyle([
      { id: "1", platform: "x", text: "다들 어떻게 생각하세요?" },
      { id: "2", platform: "x", text: "그냥 하는 이야기다." },
    ]);
    expect(style.structure.readerQuestionRatio).toBe(0.5);
  });

  it("타임스탬프로 시간대 분포를 만든다", () => {
    const style = analyzeStyle([
      { id: "1", platform: "x", text: "새벽에 쓴 글이다.", createdAt: "2025-05-05T00:00:00+09:00" },
      { id: "2", platform: "x", text: "또 새벽이다.", createdAt: "2025-05-06T01:00:00+09:00" },
    ]);
    expect(style.timing.byHour.reduce((a, b) => a + b, 0)).toBe(2);
    expect(style.timing.peakLabel).toBeDefined();
  });

  it("영어 글은 dominantLang이 en", () => {
    const style = analyzeStyle([
      { id: "1", platform: "x", text: "Shipping beats perfection. Every single time." },
      { id: "2", platform: "x", text: "Write the test first. Then make it pass." },
    ]);
    expect(style.dominantLang).toBe("en");
  });
});

describe("pickExamples", () => {
  it("표본이 적으면 전부 돌려준다", () => {
    const posts: Post[] = [{ id: "1", platform: "x", text: "하나" }];
    expect(pickExamples(posts, 6)).toHaveLength(1);
  });

  it("길이·참여도 스펙트럼에서 중복 없이 고른다", () => {
    const posts: Post[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      platform: "x" as const,
      text: "가".repeat(10 + i * 20),
      metrics: { likes: i * 3 },
      createdAt: new Date(2025, 0, i + 1).toISOString(),
    }));
    const picked = pickExamples(posts, 6);
    expect(picked).toHaveLength(6);
    expect(new Set(picked.map((p) => p.id)).size).toBe(6);
  });
});

describe("heuristicSynthesis", () => {
  it("LLM 없이도 모든 항목을 채운다", async () => {
    const posts = await loadFixture("posts-ko-haeyo.md");
    const s = heuristicSynthesis(analyzeStyle(posts), posts, "소연");
    expect(s.provider).toBe("heuristic");
    expect(s.oneLiner).toContain("소연");
    expect(s.voice.length).toBeGreaterThan(3);
    expect(s.dos.length).toBeGreaterThan(3);
    expect(s.donts.length).toBeGreaterThan(3);
    expect(s.quirks.length).toBeGreaterThan(0);
    expect(s.topics.length).toBeGreaterThan(0);
  });

  it("이모지를 쓰는 사람에겐 이모지 지시가 들어간다", async () => {
    const posts = await loadFixture("posts-ko-haeyo.md");
    const s = heuristicSynthesis(analyzeStyle(posts), posts, "소연");
    expect(s.dos.join(" ")).toMatch(/이모지/);
  });

  it("이모지를 안 쓰는 사람에겐 금지 지시가 들어간다", async () => {
    const posts = await loadFixture("posts-ko-seosul.md");
    const s = heuristicSynthesis(analyzeStyle(posts), posts, "밤코딩");
    expect(s.donts.join(" ")).toMatch(/이모지를 뿌리지 않는다/);
  });
});
