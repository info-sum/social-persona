import { describe, expect, it } from "vitest";
import {
  isBoilerplate,
  isDateMarker,
  isUiNoise,
  parseDateMarker,
  parseReaderTimeline,
} from "../src/ingest/reader-timeline.js";
import { extractShortcodes, parseInstagramOgDescription } from "../src/ingest/adapters/meta.js";
import { parseArgs } from "../src/cli-args.js";

describe("isDateMarker", () => {
  it("절대·상대 시각 표기를 인식한다", () => {
    for (const s of ["08/10/26", "2025-05-05", "3h", "2d", "3시간 전", "Aug 10", "5월 3일", "어제", "just now"]) {
      expect(isDateMarker(s), s).toBe(true);
    }
  });

  it("본문은 시각으로 보지 않는다", () => {
    for (const s of ["오늘 카페 다녀왔어요", "3시간 동안 코딩했다", "Hello there"]) {
      expect(isDateMarker(s), s).toBe(false);
    }
  });
});

describe("parseDateMarker", () => {
  const now = new Date("2025-05-10T12:00:00Z");

  it("상대 시각을 절대 시각으로 바꾼다", () => {
    expect(parseDateMarker("3h", now)).toBe("2025-05-10T09:00:00.000Z");
    expect(parseDateMarker("2d", now)).toBe("2025-05-08T12:00:00.000Z");
    expect(parseDateMarker("3시간 전", now)).toBe("2025-05-10T09:00:00.000Z");
    expect(parseDateMarker("어제", now)).toBe("2025-05-09T12:00:00.000Z");
  });

  it("MM/DD/YY를 읽는다", () => {
    expect(parseDateMarker("08/10/26", now)).toBe("2026-08-10T00:00:00.000Z");
  });

  it("한국어 전체 날짜를 읽는다", () => {
    expect(parseDateMarker("2025년 5월 3일", now)).toBe("2025-05-03T00:00:00.000Z");
  });
});

describe("isUiNoise", () => {
  it("UI 문구와 숫자 블록을 걸러낸다", () => {
    for (const s of ["Home", "Follow", "로그인", "1.9K", "505", "5.7M followers", "© 2026", "•••"]) {
      expect(isUiNoise(s), s).toBe(true);
    }
  });

  it("본문은 남긴다", () => {
    expect(isUiNoise("오늘 배포를 세 번 굴렀다.")).toBe(false);
  });
});

describe("isBoilerplate", () => {
  it("로그인 벽·오류 상용구를 걸러낸다", () => {
    for (const s of [
      "The link may be broken, or the profile may have been removed.",
      "Sorry, this page isn't available.",
      "Share everyday moments with close friends",
      "Log in to see more from zuck.",
      "Join Threads to share thoughts, find out what's going on",
      "페이지를 사용할 수 없습니다",
      "비공개 계정입니다",
      "Just a moment...",
    ]) {
      expect(isBoilerplate(s), s).toBe(true);
    }
  });

  it("일반 게시글은 통과시킨다", () => {
    expect(isBoilerplate("오늘은 아무것도 안 만들었다. 문서만 읽었다.")).toBe(false);
  });
});

describe("parseReaderTimeline", () => {
  const timeline = [
    "Home",
    "",
    "New thread",
    "",
    "# zuck",
    "",
    "5.7M followers",
    "",
    "zuck",
    "",
    "08/10/26",
    "",
    "첫 번째 게시글이다. 충분히 길게 써서 본문으로 인식되게 한다.",
    "",
    "1.9K",
    "",
    "505",
    "",
    "zuck",
    "",
    "3h",
    "",
    "두 번째 게시글이다. 이것도 본문으로 잡혀야 한다.",
    "",
    "2.1K",
    "",
    "Log in to see more from zuck.",
  ].join("\n");

  it("작성자·시각 앵커로 본문만 잘라낸다", () => {
    const posts = parseReaderTimeline(timeline, "zuck");
    expect(posts).toHaveLength(2);
    expect(posts[0]?.anchored).toBe(true);
    expect(posts[0]?.text).toBe("첫 번째 게시글이다. 충분히 길게 써서 본문으로 인식되게 한다.");
    expect(posts[0]?.createdAt).toBe("2026-08-10T00:00:00.000Z");
    expect(posts[1]?.text).toBe("두 번째 게시글이다. 이것도 본문으로 잡혀야 한다.");
    expect(posts[1]?.createdAt).toBeDefined();
  });

  it("참여 수치와 UI 문구를 본문에 넣지 않는다", () => {
    const joined = parseReaderTimeline(timeline, "zuck")
      .map((p) => p.text)
      .join(" ");
    expect(joined).not.toContain("1.9K");
    expect(joined).not.toContain("followers");
    expect(joined).not.toContain("Log in");
  });

  it("핸들을 모르면 필터 폴백으로 동작한다", () => {
    const posts = parseReaderTimeline(timeline);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.anchored === false)).toBe(true);
    expect(posts.some((p) => p.text.includes("첫 번째 게시글"))).toBe(true);
  });

  it("상용구만 있으면 빈 배열", () => {
    const posts = parseReaderTimeline("Log in\n\nSign up\n\nThe link may be broken, or the profile may have been removed.");
    expect(posts).toHaveLength(0);
  });
});

describe("parseInstagramOgDescription", () => {
  it("좋아요·작성자·날짜·본문을 분리한다", () => {
    const parsed = parseInstagramOgDescription(
      '94K likes, 847 comments - nasa - August 28, 2026: "A stellar honor 🏅\n\nOn Aug. 28, 2026, the crew received the medal."',
    );
    expect(parsed).toBeDefined();
    expect(parsed?.author).toBe("nasa");
    expect(parsed?.likes).toBe(94_000);
    expect(parsed?.text).toContain("A stellar honor");
    expect(parsed?.text).not.toContain("94K likes");
    expect(parsed?.createdAt?.slice(0, 10)).toBe("2026-08-28");
  });

  it("형식이 안 맞으면 undefined", () => {
    expect(parseInstagramOgDescription("그냥 아무 설명")).toBeUndefined();
  });
});

describe("extractShortcodes", () => {
  it("게시글·릴스 shortcode를 중복 없이 뽑는다", () => {
    const html = `<a href="/p/DcmROZxILwv/">a</a><a href="/reel/Dcl2g18n_E7/">b</a><a href="/p/DcmROZxILwv/">dup</a>`;
    expect(extractShortcodes(html)).toEqual(["DcmROZxILwv", "Dcl2g18n_E7"]);
  });
});

describe("parseArgs", () => {
  it("기본값", () => {
    const a = parseArgs(["https://x.com/jack"]);
    expect(a.inputs).toEqual(["https://x.com/jack"]);
    expect(a.outDir).toBe("./out");
    expect(a.limit).toBe(60);
    expect(a.useLlm).toBe(true);
    expect(a.useBrowser).toBe(true);
    expect(a.force).toBe(false);
  });

  it("플래그를 읽는다", () => {
    const a = parseArgs([
      "u1",
      "-o",
      "/tmp/x",
      "-n",
      "이름",
      "-l",
      "12",
      "-i",
      "a.md",
      "--input",
      "b.md",
      "--no-llm",
      "--no-browser",
      "--force",
      "--dry-run",
      "--json",
      "-v",
    ]);
    expect(a.outDir).toBe("/tmp/x");
    expect(a.name).toBe("이름");
    expect(a.limit).toBe(12);
    expect(a.inputFiles).toEqual(["a.md", "b.md"]);
    expect(a.useLlm).toBe(false);
    expect(a.useBrowser).toBe(false);
    expect(a.force).toBe(true);
    expect(a.dryRun).toBe(true);
    expect(a.json).toBe(true);
    expect(a.verbose).toBe(true);
  });

  it("값이 빠진 옵션은 던진다", () => {
    expect(() => parseArgs(["--out"])).toThrow(/값이 필요/);
    expect(() => parseArgs(["--limit", "abc"])).toThrow(/양의 정수/);
  });

  it("모르는 옵션은 던진다", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/알 수 없는 옵션/);
  });

  it("--help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});
