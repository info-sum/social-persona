import { debug, warn } from "../util/log.js";

/**
 * 선택적 헤드리스 브라우저 렌더러.
 *
 * Instagram·Threads처럼 서버가 빈 셸만 주고 클라이언트에서 데이터를 채우는 페이지는
 * 정적 요청으로는 게시글을 얻을 수 없다. playwright가 설치돼 있으면 실제로 렌더링해서
 *  (1) 네트워크로 흘러간 GraphQL/API JSON 응답과
 *  (2) 렌더링된 DOM 텍스트
 * 둘 다 확보한다. playwright가 없으면 조용히 비활성화된다.
 */

export interface RenderResult {
  /** 렌더링 완료 후의 HTML */
  html: string;
  /** 화면에 보이는 텍스트 (리더 프록시 출력과 같은 형태) */
  text: string;
  /** GraphQL/API 응답에서 모은 JSON 페이로드 */
  payloads: unknown[];
  finalUrl: string;
}

export interface RenderOptions {
  /** 스크롤 반복 횟수 (지연 로딩 유도) */
  scrolls?: number;
  /** 스크롤 사이 대기 (ms) */
  scrollDelayMs?: number;
  timeoutMs?: number;
  locale?: string;
}

type PlaywrightModule = typeof import("playwright");

let cachedModule: PlaywrightModule | null | undefined;

/** playwright를 로드한다. 없으면 null. */
async function loadPlaywright(): Promise<PlaywrightModule | null> {
  if (cachedModule !== undefined) return cachedModule;
  try {
    cachedModule = (await import("playwright")) as PlaywrightModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export async function isBrowserAvailable(): Promise<boolean> {
  return (await loadPlaywright()) !== null;
}

export const BROWSER_INSTALL_HINT =
  "헤드리스 브라우저 전략을 쓰려면: npm i playwright && npx playwright install chromium";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const JSON_URL_HINT = /\/(graphql|api)\/|\/api\/v1\/|graphql_query|\.json(\?|$)/i;

export interface BrowserSession {
  render: (url: string, options?: RenderOptions) => Promise<RenderResult | undefined>;
  close: () => Promise<void>;
}

/**
 * 브라우저를 한 번 띄우고 여러 페이지를 연달아 렌더링한다.
 * 프로필 → 개별 글 크롤처럼 여러 번 방문해야 할 때 쓴다.
 * playwright가 없으면 undefined.
 */
export async function openBrowser(): Promise<BrowserSession | undefined> {
  const pw = await loadPlaywright();
  if (!pw) {
    debug(`playwright 없음 → 브라우저 전략 생략. ${BROWSER_INSTALL_HINT}`);
    return undefined;
  }

  let browser: Awaited<ReturnType<PlaywrightModule["chromium"]["launch"]>>;
  try {
    try {
      browser = await pw.chromium.launch({ headless: true, channel: "chrome" });
    } catch {
      browser = await pw.chromium.launch({ headless: true });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`브라우저 실행 실패: ${msg}. ${BROWSER_INSTALL_HINT}`);
    return undefined;
  }

  const context = await browser.newContext({
    userAgent: UA,
    locale: "ko-KR",
    viewport: { width: 1280, height: 1600 },
    timezoneId: "Asia/Seoul",
  });

  const render = async (url: string, options: RenderOptions = {}): Promise<RenderResult | undefined> => {
    const { scrolls = 4, scrollDelayMs = 1200, timeoutMs = 45_000 } = options;
    const page = await context.newPage();
    try {
      const payloads: unknown[] = [];
      page.on("response", (res) => {
        if (!JSON_URL_HINT.test(res.url())) return;
        void res
          .json()
          .then((json: unknown) => {
            payloads.push(json);
          })
          .catch(() => {
            /* JSON 아니면 무시 */
          });
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(2500);
      for (let i = 0; i < scrolls; i += 1) {
        // 문자열 표현식으로 평가한다. Node 타입 환경에 DOM 전역을 끌어오지 않기 위한 선택.
        await page.evaluate("window.scrollBy(0, window.innerHeight * 2)");
        await page.waitForTimeout(scrollDelayMs);
      }
      const html = await page.content();
      const text = await page.evaluate<string>("document.body ? document.body.innerText : ''");
      const finalUrl = page.url();
      debug(`브라우저 렌더: ${url} → html ${html.length}자, text ${text.length}자, payloads ${payloads.length}개`);
      return { html, text, payloads, finalUrl };
    } catch (err) {
      debug(`브라우저 렌더 실패 (${url}): ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    } finally {
      await page.close().catch(() => undefined);
    }
  };

  const close = async (): Promise<void> => {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  };

  return { render, close };
}

/**
 * 페이지 하나를 렌더링한다. 실패하면 undefined.
 */
export async function renderPage(url: string, options: RenderOptions = {}): Promise<RenderResult | undefined> {
  const session = await openBrowser();
  if (!session) return undefined;
  try {
    return await session.render(url, options);
  } finally {
    await session.close();
  }
}
