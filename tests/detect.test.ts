import { describe, expect, it } from "vitest";
import { detectSource, detectSources, normalizeUrl } from "../src/ingest/detect.js";

describe("normalizeUrl", () => {
  it("스킴을 붙이고 추적 파라미터를 제거한다", () => {
    expect(normalizeUrl("velog.io/@handle?utm_source=x&keep=1")).toBe("https://velog.io/@handle?keep=1");
  });

  it("www와 끝 슬래시, 해시를 정리한다", () => {
    expect(normalizeUrl("https://www.Example.com/post/1/#top")).toBe("https://example.com/post/1");
  });
});

describe("detectSource — X", () => {
  it("프로필 URL", () => {
    const r = detectSource("https://x.com/jack");
    expect(r.platform).toBe("x");
    expect(r.kind).toBe("profile");
    expect(r.handle).toBe("jack");
  });

  it("twitter.com도 x로 취급한다", () => {
    expect(detectSource("https://twitter.com/jack").platform).toBe("x");
  });

  it("개별 트윗 URL에서 postId를 뽑는다", () => {
    const r = detectSource("https://x.com/jack/status/20?s=20&t=abc");
    expect(r.kind).toBe("post");
    expect(r.postId).toBe("20");
    expect(r.handle).toBe("jack");
  });

  it("예약 경로는 프로필로 오인하지 않는다", () => {
    expect(detectSource("https://x.com/home").kind).toBe("site");
    expect(detectSource("https://x.com/i/status/1").kind).toBe("site");
  });
});

describe("detectSource — Instagram / Threads", () => {
  it("인스타 프로필", () => {
    const r = detectSource("https://www.instagram.com/nasa/");
    expect(r.platform).toBe("instagram");
    expect(r.kind).toBe("profile");
    expect(r.handle).toBe("nasa");
  });

  it("인스타 개별 게시글", () => {
    const r = detectSource("https://www.instagram.com/p/Cabc123/?igshid=1");
    expect(r.kind).toBe("post");
    expect(r.postId).toBe("Cabc123");
    expect(r.url).not.toContain("igshid");
  });

  it("인스타 릴스", () => {
    expect(detectSource("https://instagram.com/reel/XYZ/").kind).toBe("post");
  });

  it("Threads 프로필", () => {
    const r = detectSource("https://www.threads.com/@zuck");
    expect(r.platform).toBe("threads");
    expect(r.kind).toBe("profile");
    expect(r.handle).toBe("zuck");
  });

  it("Threads 개별 글", () => {
    const r = detectSource("https://www.threads.net/@zuck/post/ABC123");
    expect(r.platform).toBe("threads");
    expect(r.kind).toBe("post");
    expect(r.postId).toBe("ABC123");
  });
});

describe("detectSource — 블로그와 피드", () => {
  it("RSS 경로는 feed로 본다", () => {
    expect(detectSource("https://example.com/rss.xml").kind).toBe("feed");
    expect(detectSource("https://example.com/feed").kind).toBe("feed");
    expect(detectSource("https://example.com/index.xml").kind).toBe("feed");
  });

  it("velog 프로필", () => {
    const r = detectSource("https://velog.io/@someone");
    expect(r.platform).toBe("blog");
    expect(r.handle).toBe("someone");
  });

  it("모르는 도메인은 blog로 폴백한다", () => {
    const r = detectSource("https://my-cool-site.dev/writing/hello-world");
    expect(r.platform).toBe("blog");
    expect(r.kind).toBe("post");
  });
});

describe("detectSource — 축약 표기와 파일", () => {
  it("x:@handle", () => {
    const r = detectSource("x:@beom");
    expect(r.platform).toBe("x");
    expect(r.handle).toBe("beom");
    expect(r.url).toBe("https://x.com/beom");
  });

  it("threads:handle", () => {
    const r = detectSource("threads:beom");
    expect(r.platform).toBe("threads");
    expect(r.url).toBe("https://www.threads.com/@beom");
  });

  it("로컬 파일 경로", () => {
    const r = detectSource("./posts.md");
    expect(r.platform).toBe("manual");
    expect(r.kind).toBe("file");
  });

  it("플랫폼 없는 @handle은 unknown", () => {
    expect(detectSource("@beom").platform).toBe("unknown");
  });
});

describe("detectSources", () => {
  it("중복과 주석을 제거한다", () => {
    const refs = detectSources([
      "https://x.com/jack",
      "https://x.com/jack/",
      "# 주석",
      "",
      "https://velog.io/@a",
    ]);
    expect(refs).toHaveLength(2);
  });
});
