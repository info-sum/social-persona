import { describe, expect, it } from "vitest";
import { isBrowserAvailable } from "../src/ingest/browser.js";
import { impersonateGet, isImpersonateAvailable } from "../src/ingest/impersonate.js";
import { httpGet } from "../src/ingest/http.js";
import { fetchBlog } from "../src/ingest/adapters/blog.js";
import { fetchX } from "../src/ingest/adapters/x.js";
import { fetchThreads, fetchInstagram } from "../src/ingest/adapters/meta.js";
import { detectSource } from "../src/ingest/detect.js";

/**
 * 실제 네트워크를 타는 통합 테스트.
 * 외부 사이트 상태에 의존하므로 기본적으로는 건너뛴다.
 *   RUN_NETWORK_TESTS=1 npx vitest run tests/network.test.ts
 */
const enabled = process.env.RUN_NETWORK_TESTS === "1";

describe("전송 계층 가용성", () => {
  it("playwright 설치 여부를 확인한다 (설치 안 됐으면 false)", async () => {
    const available = await isBrowserAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("impit 설치 여부를 확인한다 (설치 안 됐으면 false)", async () => {
    const available = await isImpersonateAvailable();
    expect(typeof available).toBe("boolean");
  });
});

describe.skipIf(!enabled)("네트워크 통합 — TLS 지문 위장", () => {
  it("평범한 fetch와 TLS 위장의 응답이 실제로 다르다", async () => {
    if (!(await isImpersonateAvailable())) return;
    const url = "https://www.instagram.com/nasa/";

    const plain = await httpGet(url, { escalate: false });
    const plainCaptions = (plain.body.match(/"caption"\s*:/g) ?? []).length;

    const spoofed = await impersonateGet(url);
    const spoofedCaptions = (spoofed?.body.match(/"caption"\s*:/g) ?? []).length;

    // 이 프로젝트의 전제: Instagram은 UA가 아니라 TLS 지문으로 클라이언트를 가른다
    expect(plainCaptions).toBe(0);
    expect(spoofedCaptions).toBeGreaterThan(0);
    expect(spoofed!.body.length).toBeGreaterThan(plain.body.length);
  }, 180_000);
});

describe.skipIf(!enabled)("네트워크 통합 — 블로그 / RSS", () => {
  it("RSS 피드에서 글을 수집한다", async () => {
    const ref = detectSource("https://blog.rust-lang.org/feed.xml");
    const result = await fetchBlog(ref, 10);
    expect(result.ok).toBe(true);
    expect(result.posts.length).toBeGreaterThanOrEqual(5);
    expect(result.posts[0]?.text.length).toBeGreaterThan(200);
  }, 120_000);

  it("프로필 URL에서 피드를 자동 발견한다 (velog)", async () => {
    const ref = detectSource("https://velog.io/@velopert");
    const result = await fetchBlog(ref, 5);
    expect(result.ok).toBe(true);
    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.notes.join(" ")).toMatch(/피드 사용/);
  }, 120_000);
});

describe.skipIf(!enabled)("네트워크 통합 — X", () => {
  it("개별 트윗을 syndication API로 가져온다", async () => {
    const ref = detectSource("https://x.com/jack/status/20");
    const result = await fetchX(ref, 1);
    expect(result.ok).toBe(true);
    expect(result.posts[0]?.text).toContain("just setting up my twttr");
    expect(result.posts[0]?.author).toBeDefined();
  }, 60_000);

  it("프로필 타임라인을 가져온다 (레이트리밋이면 진단 메시지를 남긴다)", async () => {
    const ref = detectSource("https://x.com/naval");
    const result = await fetchX(ref, 20);
    if (result.ok) {
      expect(result.posts.length).toBeGreaterThan(3);
    } else {
      expect(result.notes.join(" ")).toMatch(/레이트리밋|실패|비공개/);
    }
  }, 120_000);
});

describe.skipIf(!enabled)("네트워크 통합 — Threads / Instagram", () => {
  it("Threads 프로필에서 글을 수집한다 (TLS 위장 경로)", async () => {
    const ref = detectSource("https://www.threads.com/@zuck");
    const result = await fetchThreads(ref, 20, { useBrowser: false });
    expect(result.ok).toBe(true);
    expect(result.posts.length).toBeGreaterThan(3);
    expect(result.notes.join(" ")).toMatch(/TLS 지문 위장/);
  }, 300_000);

  it("Instagram 프로필을 브라우저 없이 수집한다", async () => {
    if (!(await isImpersonateAvailable())) return;
    const ref = detectSource("https://www.instagram.com/nasa/");
    const result = await fetchInstagram(ref, 12, { useBrowser: false });
    expect(result.ok).toBe(true);
    expect(result.posts.length).toBeGreaterThan(5);
    expect(result.notes.join(" ")).toMatch(/TLS 지문 위장/);
    // 캡션이 로그인 벽 상용구가 아니라 실제 본문이어야 한다
    expect(result.posts.some((p) => p.text.length > 200)).toBe(true);
  }, 300_000);

  it("한국어 Instagram 계정도 한국어 캡션을 얻는다", async () => {
    if (!(await isImpersonateAvailable())) return;
    const ref = detectSource("https://www.instagram.com/seoul_official/");
    const result = await fetchInstagram(ref, 10, { useBrowser: false });
    expect(result.ok).toBe(true);
    const joined = result.posts.map((p) => p.text).join(" ");
    expect(/[\uAC00-\uD7A3]/.test(joined)).toBe(true);
  }, 300_000);

  it("존재하지 않는 계정은 상용구를 게시글로 착각하지 않는다", async () => {
    const ref = detectSource("https://www.instagram.com/this_account_surely_does_not_exist_zzz9/");
    const result = await fetchInstagram(ref, 5, { useBrowser: false });
    const chars = result.posts.reduce((a, p) => a + p.text.length, 0);
    expect(chars).toBeLessThan(300);
  }, 300_000);

  it("헤드리스 브라우저 경로도 여전히 동작한다 (더 깊은 스크롤)", async () => {
    if (!(await isBrowserAvailable())) return;
    const ref = detectSource("https://www.threads.com/@zuck");
    const result = await fetchThreads(ref, 40, { useImpersonate: false, useBrowser: true });
    expect(result.ok).toBe(true);
    expect(result.posts.length).toBeGreaterThan(3);
  }, 600_000);
});
