import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToText, parseFeed, parseJsonFeed } from "../src/ingest/rss.js";
import { candidateFeedUrls } from "../src/ingest/adapters/blog.js";
import { cleanReaderMarkdown, discoverFeeds, extractArticleText, extractMeta } from "../src/ingest/html.js";
import { mineCaptionsByRegex, mineMetaPosts } from "../src/ingest/embedded-json.js";
import { syndicationToken } from "../src/ingest/adapters/x.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

describe("htmlToText", () => {
  it("블록 요소를 줄바꿈으로 바꾸고 엔티티를 푼다", () => {
    const out = htmlToText("<p>가&amp;나</p><p>다</p><br>라&#39;");
    expect(out).toContain("가&나");
    expect(out).toContain("다");
    expect(out).toContain("라'");
  });

  it("script/style을 제거한다", () => {
    expect(htmlToText("<style>p{}</style><script>var a=1</script><p>본문</p>")).toBe("본문");
  });
});

describe("parseFeed — RSS 2.0", () => {
  it("항목과 메타데이터를 읽는다", async () => {
    const xml = await readFile(join(FIXTURES, "feed-rss2.xml"), "utf8");
    const feed = parseFeed(xml);
    expect(feed).toBeDefined();
    expect(feed?.title).toBe("테스트 블로그");
    expect(feed?.items).toHaveLength(2);

    const first = feed!.items[0]!;
    expect(first.title).toBe("첫 번째 글");
    expect(first.link).toBe("https://example.com/posts/1");
    expect(first.author).toBe("글쓴이");
    expect(first.categories).toEqual(["회고", "개발"]);
    expect(first.content).toContain("배포를 세 번 굴렀다");
    expect(first.content).toContain("캐시");
    expect(first.content).not.toContain("<b>");
    expect(first.publishedAt).toBe("2025-05-05T00:30:00.000Z");
  });

  it("description만 있는 항목도 읽는다", async () => {
    const xml = await readFile(join(FIXTURES, "feed-rss2.xml"), "utf8");
    const feed = parseFeed(xml);
    expect(feed!.items[1]!.content).toContain("지울 수 있는 코드");
  });
});

describe("parseFeed — Atom", () => {
  it("entry를 읽는다", async () => {
    const xml = await readFile(join(FIXTURES, "feed-atom.xml"), "utf8");
    const feed = parseFeed(xml);
    expect(feed?.items).toHaveLength(1);
    const item = feed!.items[0]!;
    expect(item.title).toBe("아톰 첫 글");
    expect(item.link).toBe("https://atom.example.com/1");
    expect(item.content).toContain("기술 부채");
    expect(item.publishedAt).toBe("2025-03-01T12:00:00.000Z");
    expect(feed?.author).toBe("아톰작성자");
  });

  it("잘못된 XML은 undefined", () => {
    expect(parseFeed("not xml at all <<<")).toBeUndefined();
  });
});

describe("parseJsonFeed", () => {
  it("JSON Feed를 읽는다", () => {
    const feed = parseJsonFeed(
      JSON.stringify({
        title: "제이슨 피드",
        items: [{ id: "1", url: "https://a.co/1", title: "제목", content_text: "본문이다.", date_published: "2025-01-01T00:00:00Z" }],
      }),
    );
    expect(feed?.items[0]?.content).toBe("본문이다.");
    expect(feed?.items[0]?.publishedAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("items가 없으면 undefined", () => {
    expect(parseJsonFeed('{"title":"x"}')).toBeUndefined();
  });
});

describe("candidateFeedUrls", () => {
  it("네이버 블로그 전용 피드를 만든다", () => {
    expect(candidateFeedUrls("https://blog.naver.com/someid")).toContain("https://rss.blog.naver.com/someid.xml");
  });

  it("velog 전용 피드를 만든다", () => {
    expect(candidateFeedUrls("https://velog.io/@handle")).toContain("https://api.velog.io/rss/@handle");
  });

  it("일반 관례 경로를 포함한다", () => {
    const urls = candidateFeedUrls("https://my.site/blog/post-1");
    expect(urls).toContain("https://my.site/rss");
    expect(urls).toContain("https://my.site/atom.xml");
    expect(urls).toContain("https://my.site/blog/feed");
  });
});

describe("html 유틸", () => {
  const html = `<!doctype html><html><head>
    <title>페이지 제목</title>
    <meta property="og:title" content="OG 제목">
    <meta property="og:description" content="설명입니다">
    <meta name="author" content="작성자">
    <link rel="canonical" href="https://ex.com/a">
    <link rel="alternate" type="application/rss+xml" href="/rss.xml">
    <link rel="alternate" type="application/json" href="https://ex.com/feed.json">
    </head><body>
    <nav><a href="/menu">메뉴</a></nav>
    <article><p>첫 단락이다. 충분히 길게 써서 본문으로 인식되게 한다.</p><p>두 번째 단락이다. 이것도 본문이다.</p></article>
    <footer>푸터</footer>
    </body></html>`;

  it("메타데이터를 읽는다", () => {
    const meta = extractMeta(html);
    expect(meta.title).toBe("OG 제목");
    expect(meta.description).toBe("설명입니다");
    expect(meta.author).toBe("작성자");
    expect(meta.canonical).toBe("https://ex.com/a");
  });

  it("선언된 피드를 절대 URL로 찾는다", () => {
    const feeds = discoverFeeds(html, "https://ex.com/page");
    expect(feeds).toContain("https://ex.com/rss.xml");
    expect(feeds).toContain("https://ex.com/feed.json");
  });

  it("본문만 추출하고 네비게이션·푸터는 뺀다", () => {
    const text = extractArticleText(html);
    expect(text).toContain("첫 단락이다");
    expect(text).toContain("두 번째 단락이다");
    expect(text).not.toContain("메뉴");
    expect(text).not.toContain("푸터");
  });
});

describe("cleanReaderMarkdown", () => {
  it("리더 헤더와 이미지, 링크 목록을 걷어낸다", () => {
    const md = [
      "Title: 어떤 글",
      "URL Source: https://a.co",
      "Markdown Content:",
      "![image](https://a.co/i.png)",
      "- [메뉴](https://a.co/menu)",
      "",
      "실제 본문이다. [링크](https://a.co/x)도 텍스트만 남는다.",
    ].join("\n");
    const out = cleanReaderMarkdown(md);
    expect(out).not.toContain("Title:");
    expect(out).not.toContain("![");
    expect(out).not.toContain("메뉴");
    expect(out).toContain("실제 본문이다.");
    expect(out).toContain("링크도 텍스트만 남는다.");
  });
});

describe("embedded-json 채굴", () => {
  it("Threads 스타일 caption.text를 찾는다", () => {
    const posts = mineMetaPosts([
      {
        data: {
          items: [
            { pk: "1", code: "AAA", taken_at: 1_700_000_000, like_count: 12, caption: { text: "첫 번째 스레드다." }, user: { username: "someone" } },
            { pk: "2", code: "BBB", caption: { text: "두 번째 스레드다." } },
          ],
        },
      },
    ]);
    expect(posts).toHaveLength(2);
    expect(posts[0]?.text).toBe("첫 번째 스레드다.");
    expect(posts[0]?.username).toBe("someone");
    expect(posts[0]?.likeCount).toBe(12);
  });

  it("Instagram GraphQL edge_media_to_caption을 찾는다", () => {
    const posts = mineMetaPosts([
      { shortcode: "XYZ", edge_media_to_caption: { edges: [{ node: { text: "인스타 캡션이다." } }] } },
    ]);
    expect(posts[0]?.text).toBe("인스타 캡션이다.");
    expect(posts[0]?.code).toBe("XYZ");
  });

  it("중복 텍스트를 한 번만 담는다", () => {
    const posts = mineMetaPosts([
      { pk: "1", caption: { text: "같은 글이다." } },
      { pk: "1", caption: { text: "같은 글이다." } },
    ]);
    expect(posts).toHaveLength(1);
  });

  it("정규식 폴백도 캡션을 찾는다", () => {
    const found = mineCaptionsByRegex('{"caption":{"text":"정규식으로도 찾을 수 있는 충분히 긴 캡션이다."}}');
    expect(found[0]).toContain("정규식으로도");
  });
});

describe("syndicationToken", () => {
  it("같은 id에는 같은 토큰이 나온다", () => {
    expect(syndicationToken("20")).toBe(syndicationToken("20"));
  });

  it("숫자가 아니면 폴백 토큰", () => {
    expect(syndicationToken("abc")).toBe("a");
  });

  it("0과 소수점 문자를 제거한다", () => {
    expect(syndicationToken("1866656143348174915")).not.toMatch(/[.0]/);
  });
});
