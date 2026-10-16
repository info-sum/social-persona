import { debug, warn } from "../util/log.js";
import type { HttpResponse } from "./http.js";

/**
 * TLS 지문 위장 전송 계층 (선택적 `impit` 의존).
 *
 * ## 왜 필요한가
 *
 * Instagram·Threads는 **User-Agent가 아니라 TLS ClientHello 지문으로** 클라이언트를 가른다.
 * 같은 URL에 같은 Chrome UA를 붙여도,
 *
 *   - Node `fetch`(undici) / plain curl → 619KB의 빈 JS 셸, 캡션 0건
 *   - 실제 브라우저 TLS 지문      → 824KB의 프리페치 JSON 포함, 캡션 12건
 *
 * 이 차이는 쿠키 워밍이나 referer 체인이 아니라 지문 자체에서 온다
 * (impersonate를 끄고 쿠키 워밍만 해도 캡션 0건).
 *
 * `impit`은 브라우저 ClientHello를 재현하는 Rust 네이티브 클라이언트다. 이걸 쓰면
 * 헤드리스 브라우저 없이 공개 게시글 본문을 얻는다 — 60초가 1초가 된다.
 *
 * ## 경계
 *
 * 이건 **공개 페이지를 읽는 수단**이지 인증 우회가 아니다. 로그인·비공개 계정은
 * 지문을 바꿔도 열리지 않으며, 그 경우 그대로 실패를 보고한다.
 * `impit`이 없으면 조용히 비활성화되고 기존 전략(리더 프록시·헤드리스 브라우저)으로 넘어간다.
 */

/** impit이 지원하는 브라우저 프로필. 앞에서부터 시도한다. */
export const IMPERSONATE_TARGETS = ["chrome", "firefox", "safari"] as const;
export type ImpersonateTarget = (typeof IMPERSONATE_TARGETS)[number];

export const IMPERSONATE_INSTALL_HINT = "TLS 지문 위장을 쓰려면: npm i impit";

interface ImpitModule {
  Impit: new (options?: {
    browser?: string;
    timeout?: number;
    followRedirects?: boolean;
    maxRedirects?: number;
    ignoreTlsErrors?: boolean;
    vanillaFallback?: boolean;
    headers?: Record<string, string>;
  }) => {
    fetch: (
      url: string,
      init?: { method?: string; headers?: Record<string, string> },
    ) => Promise<{ status: number; url?: string; headers?: unknown; text: () => Promise<string> }>;
  };
}

let cachedModule: ImpitModule | null | undefined;

async function loadImpit(): Promise<ImpitModule | null> {
  if (cachedModule !== undefined) return cachedModule;
  try {
    cachedModule = (await import("impit")) as unknown as ImpitModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export async function isImpersonateAvailable(): Promise<boolean> {
  return (await loadImpit()) !== null;
}

/**
 * (호스트, 프로필)별 클라이언트 재사용.
 * impit 인스턴스 하나가 쿠키 자와 커넥션 풀을 들고 있으므로, 재사용하면
 * WAF 센서 쿠키가 성숙하고 핸드셰이크도 아낀다.
 */
const clients = new Map<string, InstanceType<ImpitModule["Impit"]>>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

async function clientFor(url: string, target: ImpersonateTarget, timeoutMs: number) {
  const mod = await loadImpit();
  if (!mod) return undefined;
  const key = `${hostOf(url)}|${target}`;
  const existing = clients.get(key);
  if (existing) return existing;
  try {
    const client = new mod.Impit({
      browser: target,
      timeout: timeoutMs,
      followRedirects: true,
      maxRedirects: 5,
      // 대상이 해당 프로필을 거부하면 평범한 UA로라도 응답을 받는다
      vanillaFallback: true,
    });
    clients.set(key, client);
    return client;
  } catch (err) {
    debug(`impit 클라이언트 생성 실패 (${target}): ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** 차단·챌린지 응답의 흔적 */
const BLOCK_MARKERS = [
  /just a moment/i,
  /attention required/i,
  /cf-browser-verification/i,
  /cf_chl_opt/i,
  /access denied/i,
  /you have been blocked/i,
  /verify you are (a )?human/i,
  /enable javascript and cookies to continue/i,
  /captcha/i,
  /사람인지 확인/,
  /비정상적인 접근/,
];

const BLOCK_STATUS = new Set([401, 403, 405, 406, 429, 451, 503]);

/** 응답이 콘텐츠가 아니라 차단·챌린지처럼 보이는지 */
export function looksBlocked(res: Pick<HttpResponse, "status" | "body">): boolean {
  if (BLOCK_STATUS.has(res.status)) return true;
  if (res.status === 0) return true;
  const head = res.body.slice(0, 4000);
  return BLOCK_MARKERS.some((re) => re.test(head));
}

export interface ImpersonateOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** 시도할 프로필 목록 (기본 chrome → firefox → safari) */
  targets?: readonly ImpersonateTarget[];
  /**
   * 성공 판정 함수. 상태코드는 200이지만 내용이 비어 있는 경우
   * (예: JS 셸만 온 경우) 다음 프로필로 넘어가기 위해 쓴다.
   */
  isGood?: (res: HttpResponse) => boolean;
  /** 깊은 요청 전에 사이트 루트를 한 번 두드려 센서 쿠키를 받는다 */
  warmup?: boolean;
}

async function once(
  url: string,
  target: ImpersonateTarget,
  opts: ImpersonateOptions,
): Promise<HttpResponse | undefined> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const client = await clientFor(url, target, timeoutMs);
  if (!client) return undefined;

  if (opts.warmup) {
    try {
      const root = new URL(url).origin + "/";
      await client.fetch(root);
    } catch {
      /* 워밍 실패는 무시 */
    }
  }

  try {
    const res = await client.fetch(url, {
      method: "GET",
      headers: {
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        ...(opts.headers ?? {}),
      },
    });
    const body = await res.text();
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      body,
      finalUrl: res.url ?? url,
      contentType: "",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debug(`impit ${target} 실패: ${msg}`);
    return { ok: false, status: 0, body: "", finalUrl: url, contentType: "", error: msg };
  }
}

/**
 * 브라우저 TLS 지문으로 GET 한다.
 * 프로필을 순서대로 시도하고, 가장 많은 본문을 돌려준 응답을 채택한다.
 * `impit`이 없으면 undefined — 호출자는 다음 전략으로 넘어가야 한다.
 */
export async function impersonateGet(url: string, opts: ImpersonateOptions = {}): Promise<HttpResponse | undefined> {
  if (!(await isImpersonateAvailable())) {
    debug(`impit 없음 → TLS 위장 생략. ${IMPERSONATE_INSTALL_HINT}`);
    return undefined;
  }
  const targets = opts.targets ?? IMPERSONATE_TARGETS;
  const isGood = opts.isGood ?? ((r: HttpResponse) => r.ok && !looksBlocked(r));

  let best: HttpResponse | undefined;
  for (const target of targets) {
    const res = await once(url, target, opts);
    if (!res) continue;
    debug(`impit ${target}: status=${res.status} bytes=${res.body.length}`);
    if (!best || res.body.length > best.body.length) best = res;
    if (isGood(res)) return res;
    // 차단으로 보이면 다음 프로필에서는 루트 워밍을 켠다
    if (looksBlocked(res)) opts = { ...opts, warmup: true };
  }
  if (best && looksBlocked(best)) {
    warn(`TLS 위장 요청이 차단 신호를 받았습니다 (status ${best.status}): ${url}`);
  }
  return best;
}

/** 테스트에서 상태를 초기화하기 위한 훅 */
export function resetImpersonateClients(): void {
  clients.clear();
}
