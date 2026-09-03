import { debug } from "../util/log.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BOT_UA = "Mozilla/5.0 (compatible; social-persona/0.1; +https://github.com/)";

export interface HttpResponse {
  ok: boolean;
  status: number;
  body: string;
  finalUrl: string;
  contentType: string;
  error?: string;
}

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** 봇 친화 UA 사용 (RSS 등) */
  bot?: boolean;
  accept?: string;
  /** 429/5xx 응답에도 재시도한다 (기본 true) */
  retryOnStatus?: boolean;
  /**
   * 차단 신호를 받으면 TLS 지문 위장으로 한 번 더 시도한다 (기본 true).
   * `impit`이 없으면 아무 일도 일어나지 않는다.
   */
  escalate?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function httpGet(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const plain = await plainGet(url, opts);
  if (opts.escalate === false) return plain;

  // 평범한 fetch가 차단당했으면 브라우저 TLS 지문으로 한 번 더.
  // Instagram·Threads처럼 지문으로 클라이언트를 가르는 사이트에서 결정적이다.
  const { impersonateGet, looksBlocked } = await import("./impersonate.js");
  if (!looksBlocked(plain)) return plain;

  debug(`차단 신호 감지 (status ${plain.status}) → TLS 지문 위장으로 재시도`);
  const escalated = await impersonateGet(url, {
    timeoutMs: opts.timeoutMs ?? 30_000,
    ...(opts.headers ? { headers: opts.headers } : {}),
  });
  if (!escalated) return plain;
  if (escalated.body.length > plain.body.length || (escalated.ok && !plain.ok)) return escalated;
  return plain;
}

async function plainGet(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const { timeoutMs = 15_000, retries = 2, headers = {}, bot = false, accept, retryOnStatus = true } = opts;
  let lastError = "unknown error";
  let lastResponse: HttpResponse | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      debug(`GET ${url}${attempt > 0 ? ` (retry ${attempt})` : ""}`);
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": bot ? BOT_UA : DEFAULT_UA,
          accept:
            accept ??
            "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
          "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          "cache-control": "no-cache",
          ...headers,
        },
      });
      const body = await res.text();
      clearTimeout(timer);
      const result: HttpResponse = {
        ok: res.ok,
        status: res.status,
        body,
        finalUrl: res.url || url,
        contentType: res.headers.get("content-type") ?? "",
      };
      if (res.ok || !retryOnStatus || !RETRYABLE_STATUS.has(res.status) || attempt === retries) {
        return result;
      }
      lastResponse = result;
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 1500 * 2 ** attempt;
      debug(`status ${res.status} → ${waitMs}ms 후 재시도`);
      await sleep(waitMs);
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err.message : String(err);
      debug(`GET failed: ${lastError}`);
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }

  if (lastResponse) return lastResponse;
  return { ok: false, status: 0, body: "", finalUrl: url, contentType: "", error: lastError };
}

export async function httpGetJson<T>(url: string, opts: HttpOptions = {}): Promise<T | undefined> {
  const res = await httpGet(url, { accept: "application/json,*/*;q=0.8", ...opts });
  if (!res.ok || !res.body) return undefined;
  try {
    return JSON.parse(res.body) as T;
  } catch {
    return undefined;
  }
}

/**
 * r.jina.ai 리더 프록시. 로그인 벽·JS 렌더링 페이지를 마크다운 텍스트로 받아온다.
 * JINA_API_KEY가 있으면 인증 헤더를 붙여 rate limit을 완화한다.
 *
 * 주의: 브라우저 UA로 요청하면 r.jina.ai가 Cloudflare 챌린지(403)를 돌려준다.
 * 반드시 봇 UA와 최소 헤더로 호출한다.
 */
export async function readerFetch(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const key = process.env.JINA_API_KEY;
  const target = `https://r.jina.ai/${url}`;
  return httpGet(target, {
    timeoutMs: 60_000,
    retries: 1,
    ...opts,
    bot: true,
    accept: "text/plain,text/markdown,*/*;q=0.8",
    headers: {
      "x-respond-with": "markdown",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
}
