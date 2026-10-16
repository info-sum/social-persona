import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { llmSynthesize, resolveLlmConfig } from "../src/analyze/llm.js";
import { analyzeStyle } from "../src/analyze/stylometry.js";
import { heuristicSynthesis, mergeSynthesis } from "../src/analyze/synthesize.js";
import { parseManualText } from "../src/ingest/adapters/manual.js";
import { run } from "../src/index.js";
import type { Post } from "../src/types.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "posts-ko-haeyo.md");

const SAMPLE_JSON = {
  oneLiner: "일상의 작은 장면을 해요체로 기록하는 사람",
  voice: ["문장을 짧게 끊고 이모지로 감정을 마무리한다"],
  topics: ["카페", "산책", "집밥"],
  values: ["작은 습관이 쌓이는 것을 중요하게 본다"],
  quirks: ["문장 끝에 물결표를 붙인다"],
  dos: ["해요체로 쓴다"],
  donts: ["격식체로 쓰지 않는다"],
};

interface MockServer {
  server: Server;
  baseUrl: string;
  requests: { url: string; headers: Record<string, unknown>; body: string }[];
}

async function startMock(handler: (path: string, body: string) => { status: number; body: string }): Promise<MockServer> {
  const requests: MockServer["requests"] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += String(c);
    });
    req.on("end", () => {
      requests.push({ url: req.url ?? "", headers: req.headers as Record<string, unknown>, body });
      const out = handler(req.url ?? "", body);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(out.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}`, requests };
}

async function stopMock(mock: MockServer): Promise<void> {
  await new Promise<void>((resolve) => mock.server.close(() => resolve()));
}

async function loadPosts(): Promise<Post[]> {
  return parseManualText(await readFile(FIXTURE, "utf8"), "manual", "fixture");
}

const SAVED_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.SOCIAL_PERSONA_MODEL;
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
});

describe("resolveLlmConfig", () => {
  it("키가 없으면 undefined", () => {
    expect(resolveLlmConfig()).toBeUndefined();
  });

  it("ANTHROPIC_API_KEY 우선", () => {
    process.env.ANTHROPIC_API_KEY = "sk-a";
    process.env.OPENAI_API_KEY = "sk-o";
    const cfg = resolveLlmConfig();
    expect(cfg?.provider).toBe("anthropic");
    expect(cfg?.apiKey).toBe("sk-a");
  });

  it("OPENAI_API_KEY만 있으면 openai", () => {
    process.env.OPENAI_API_KEY = "sk-o";
    expect(resolveLlmConfig()?.provider).toBe("openai");
  });

  it("모델 이름을 override 한다", () => {
    process.env.ANTHROPIC_API_KEY = "sk-a";
    process.env.SOCIAL_PERSONA_MODEL = "my-model";
    expect(resolveLlmConfig()?.model).toBe("my-model");
  });
});

describe("llmSynthesize — Anthropic 경로", () => {
  it("응답 JSON을 파싱한다", async () => {
    const mock = await startMock((path) => {
      expect(path).toBe("/v1/messages");
      return { status: 200, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(SAMPLE_JSON) }] }) };
    });
    try {
      const posts = await loadPosts();
      const out = await llmSynthesize(analyzeStyle(posts), posts, {
        provider: "anthropic",
        apiKey: "sk-test",
        model: "test-model",
        baseUrl: mock.baseUrl,
      });
      expect(out?.oneLiner).toBe(SAMPLE_JSON.oneLiner);
      expect(out?.topics).toEqual(SAMPLE_JSON.topics);
      expect(mock.requests[0]?.headers["x-api-key"]).toBe("sk-test");
      expect(mock.requests[0]?.headers["anthropic-version"]).toBe("2023-06-01");
      // 프롬프트에 정량 지표와 원문 표본이 모두 들어간다
      expect(mock.requests[0]?.body).toContain("정량 지표");
      expect(mock.requests[0]?.body).toContain("원문 표본");
    } finally {
      await stopMock(mock);
    }
  });

  it("코드펜스에 감싼 JSON도 읽는다", async () => {
    const mock = await startMock(() => ({
      status: 200,
      body: JSON.stringify({ content: [{ type: "text", text: `\`\`\`json\n${JSON.stringify(SAMPLE_JSON)}\n\`\`\`` }] }),
    }));
    try {
      const posts = await loadPosts();
      const out = await llmSynthesize(analyzeStyle(posts), posts, {
        provider: "anthropic",
        apiKey: "k",
        model: "m",
        baseUrl: mock.baseUrl,
      });
      expect(out?.oneLiner).toBe(SAMPLE_JSON.oneLiner);
    } finally {
      await stopMock(mock);
    }
  });

  it("오류 응답이면 undefined", async () => {
    const mock = await startMock(() => ({ status: 500, body: '{"error":"boom"}' }));
    try {
      const posts = await loadPosts();
      const out = await llmSynthesize(analyzeStyle(posts), posts, {
        provider: "anthropic",
        apiKey: "k",
        model: "m",
        baseUrl: mock.baseUrl,
      });
      expect(out).toBeUndefined();
    } finally {
      await stopMock(mock);
    }
  });

  it("JSON이 아니면 undefined", async () => {
    const mock = await startMock(() => ({
      status: 200,
      body: JSON.stringify({ content: [{ type: "text", text: "죄송하지만 만들 수 없습니다." }] }),
    }));
    try {
      const posts = await loadPosts();
      const out = await llmSynthesize(analyzeStyle(posts), posts, {
        provider: "anthropic",
        apiKey: "k",
        model: "m",
        baseUrl: mock.baseUrl,
      });
      expect(out).toBeUndefined();
    } finally {
      await stopMock(mock);
    }
  });
});

describe("llmSynthesize — OpenAI 경로", () => {
  it("chat/completions 응답을 파싱한다", async () => {
    const mock = await startMock((path) => {
      expect(path).toBe("/chat/completions");
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(SAMPLE_JSON) } }] }) };
    });
    try {
      const posts = await loadPosts();
      const out = await llmSynthesize(analyzeStyle(posts), posts, {
        provider: "openai",
        apiKey: "sk-o",
        model: "gpt-test",
        baseUrl: mock.baseUrl,
      });
      expect(out?.quirks).toEqual(SAMPLE_JSON.quirks);
      expect(mock.requests[0]?.headers["authorization"]).toBe("Bearer sk-o");
    } finally {
      await stopMock(mock);
    }
  });
});

describe("mergeSynthesis", () => {
  it("정량 지시문은 휴리스틱을 유지하고 정성 서술은 LLM을 얹는다", async () => {
    const posts = await loadPosts();
    const base = heuristicSynthesis(analyzeStyle(posts), posts, "소연");
    const merged = mergeSynthesis(base, SAMPLE_JSON, "test-model");

    expect(merged.provider).toBe("llm");
    expect(merged.model).toBe("test-model");
    expect(merged.oneLiner).toBe(SAMPLE_JSON.oneLiner);
    // 휴리스틱이 만든 측정 기반 지시문이 남아 있어야 한다
    expect(merged.dos.some((d) => /자 안팎/.test(d))).toBe(true);
    // LLM 항목도 합쳐진다
    expect(merged.dos).toContain("해요체로 쓴다");
    expect(merged.topics).toContain("카페");
  });

  it("LLM이 빈 배열을 주면 휴리스틱을 쓴다", async () => {
    const posts = await loadPosts();
    const base = heuristicSynthesis(analyzeStyle(posts), posts, "소연");
    const merged = mergeSynthesis(base, { values: [] }, "m");
    expect(merged.values).toEqual(base.values);
  });
});

describe("run — LLM 경로 엔드투엔드", () => {
  it("모의 Anthropic 서버로 LLM 합성까지 수행한다", async () => {
    const mock = await startMock(() => ({
      status: 200,
      body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(SAMPLE_JSON) }] }),
    }));
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.ANTHROPIC_BASE_URL = mock.baseUrl;
    process.env.SOCIAL_PERSONA_MODEL = "mock-model";
    try {
      const result = await run([], { inputFiles: [FIXTURE], useLlm: true, write: false, name: "소연" });
      expect(result.persona.synthesis.provider).toBe("llm");
      expect(result.persona.synthesis.model).toBe("mock-model");
      expect(result.persona.synthesis.oneLiner).toBe(SAMPLE_JSON.oneLiner);
      expect(mock.requests).toHaveLength(1);
    } finally {
      await stopMock(mock);
    }
  });

  it("LLM 서버가 죽어 있어도 결정론적 결과로 완주한다", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:1"; // 연결 불가
    const result = await run([], { inputFiles: [FIXTURE], useLlm: true, write: false, name: "소연" });
    expect(result.persona.synthesis.provider).toBe("heuristic");
    expect(result.persona.synthesis.voice.length).toBeGreaterThan(0);
  });
});
