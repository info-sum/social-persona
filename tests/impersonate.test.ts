import { describe, expect, it } from "vitest";
import { IMPERSONATE_TARGETS, looksBlocked } from "../src/ingest/impersonate.js";
import { extractShortcodes } from "../src/ingest/adapters/meta.js";

describe("looksBlocked", () => {
  it("차단 상태코드를 잡는다", () => {
    for (const status of [401, 403, 429, 503, 0]) {
      expect(looksBlocked({ status, body: "" }), String(status)).toBe(true);
    }
  });

  it("Cloudflare·캡차 챌린지 본문을 잡는다", () => {
    for (const body of [
      "<html><head><title>Just a moment...</title>",
      "Attention Required! | Cloudflare",
      "Please enable JavaScript and cookies to continue",
      "<div>Verify you are human</div>",
      "사람인지 확인 중입니다",
      "cf_chl_opt = {}",
    ]) {
      expect(looksBlocked({ status: 200, body }), body.slice(0, 30)).toBe(true);
    }
  });

  it("정상 응답은 통과시킨다", () => {
    expect(looksBlocked({ status: 200, body: '<html><body><h1>블로그 글</h1><p>본문이다.</p></body></html>' })).toBe(false);
  });

  it("본문 앞부분만 검사한다 (긴 글의 'captcha' 언급에 오검출하지 않는다)", () => {
    const body = `${"가".repeat(5000)} captcha 라는 단어가 본문 뒤쪽에 나온다`;
    expect(looksBlocked({ status: 200, body })).toBe(false);
  });
});

describe("IMPERSONATE_TARGETS", () => {
  it("chrome을 먼저 시도한다", () => {
    expect(IMPERSONATE_TARGETS[0]).toBe("chrome");
    expect(IMPERSONATE_TARGETS.length).toBeGreaterThanOrEqual(2);
  });
});

describe("extractShortcodes — 플랫폼별", () => {
  it("Instagram의 /p/ 와 /reel/ 을 뽑는다", () => {
    const html = `<a href="/p/DcmROZxILwv/">a</a><a href="/reel/Dcl2g18n_E7/">b</a><a href="/p/DcmROZxILwv/">dup</a>`;
    expect(extractShortcodes(html, 24, "instagram")).toEqual(["DcmROZxILwv", "Dcl2g18n_E7"]);
  });

  it("Threads의 /post/ 를 뽑는다", () => {
    const html = `<a href="/@zuck/post/Db2wI-DilLt">a</a><a href="/@zuck/post/Db2v6H6kUkq">b</a>`;
    expect(extractShortcodes(html, 24, "threads")).toEqual(["Db2wI-DilLt", "Db2v6H6kUkq"]);
  });

  it("링크가 없으면 임베드 JSON의 code 필드를 본다", () => {
    const html = `{"pk":"1","code":"Db2wI-DilLt","caption":{"text":"x"}}`;
    expect(extractShortcodes(html, 24, "threads")).toEqual(["Db2wI-DilLt"]);
  });

  it("Instagram 패턴은 Threads 링크를 잡지 않는다", () => {
    const html = `<a href="/@zuck/post/Db2wI-DilLt">a</a>`;
    expect(extractShortcodes(html, 24, "instagram")).toEqual([]);
  });

  it("상한을 지킨다", () => {
    const html = Array.from({ length: 30 }, (_, i) => `<a href="/p/CODE${String(i).padStart(6, "0")}/">x</a>`).join("");
    expect(extractShortcodes(html, 5, "instagram")).toHaveLength(5);
  });
});
