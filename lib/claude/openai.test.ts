import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { OPENAI_REVIEW_MODEL, buildOpenAIInput, callStructuredOpenAI, openAIUsageToChatUsage } from "./openai";
import { ClaudeCallError } from "./callError";

const schema = z.object({ items: z.array(z.object({ text: z.string() })) });
const input = { schema, effort: "high" as const, system: "시스템 지시", context: "[소설 본문]\n본문 내용", task: "이번 과제", label: "테스트호출" };

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function fakeFetch(response: { ok?: boolean; status?: number; json: unknown }) {
  const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
  const impl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    return { ok: response.ok ?? true, status: response.status ?? 200, json: async () => response.json };
  }) as unknown as typeof fetch;
  return { impl, calls, body: (): Body => JSON.parse(calls[0].init.body) };
}

const completed = (text: string, usage: unknown = { input_tokens: 10, output_tokens: 5 }) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
  usage,
});

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.restoreAllMocks();
});

describe("callStructuredOpenAI", () => {
  it("요청 본문: 모델·명시 캐시·브레이크포인트 위치·사고 수준·strict 스키마", async () => {
    const f = fakeFetch({ json: completed(JSON.stringify({ items: [] })) });
    await callStructuredOpenAI(input, f.impl);

    expect(f.calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(f.calls[0].init.headers.Authorization).toBe("Bearer sk-test");
    const body = f.body();
    expect(body.model).toBe(OPENAI_REVIEW_MODEL);
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(body.input).toHaveLength(3);
    expect(body.input[0].role).toBe("developer");
    expect(body.input[0].content[0]).toEqual({
      type: "input_text",
      text: input.context,
      prompt_cache_breakpoint: { mode: "explicit" },
    });
    expect(body.input[1]).toEqual({ role: "developer", content: input.system });
    expect(body.input[2]).toEqual({ role: "user", content: input.task });
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.max_output_tokens).toBe(16000);
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "result", strict: true });
    expect(body.text.format.schema).not.toHaveProperty("$schema");
    expect(body.text.format.schema.properties).toHaveProperty("items");
  });

  it("output_text를 스키마로 검증해 돌려준다", async () => {
    const f = fakeFetch({ json: completed(JSON.stringify({ items: [{ text: "가" }] })) });
    expect(await callStructuredOpenAI(input, f.impl)).toEqual({ items: [{ text: "가" }] });
  });

  it("incomplete(max_output_tokens)는 잘렸다는 오류", async () => {
    const f = fakeFetch({ json: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] } });
    const err = await callStructuredOpenAI(input, f.impl).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeCallError);
    expect(err.message).toMatch(/잘렸습니다/);
  });

  it("incomplete의 그 밖의 이유는 완료되지 못했다는 오류", async () => {
    const f = fakeFetch({ json: { status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] } });
    const err = await callStructuredOpenAI(input, f.impl).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeCallError);
    expect(err.message).toMatch(/완료되지 못했습니다/);
  });

  it("refusal 콘텐츠는 정책상 거절 오류", async () => {
    const f = fakeFetch({ json: { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "안 됩니다" }] }] } });
    const err = await callStructuredOpenAI(input, f.impl).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeCallError);
    expect(err.message).toMatch(/정책상 거절/);
  });

  it("스키마에 안 맞는 JSON과 JSON이 아닌 글은 해석하지 못했다는 오류", async () => {
    for (const text of [JSON.stringify({ items: "문자열" }), "JSON 아님"]) {
      const f = fakeFetch({ json: completed(text) });
      const err = await callStructuredOpenAI(input, f.impl).catch((e) => e);
      expect(err).toBeInstanceOf(ClaudeCallError);
      expect(err.message).toMatch(/해석하지 못했습니다/);
    }
  });

  it("HTTP 오류는 상태별 한국어 메시지의 ClaudeCallError", async () => {
    const cases: [number, RegExp][] = [
      [429, /요청이 많아/],
      [401, /OPENAI_API_KEY/],
      [500, /OpenAI API 오류 \(500\)/],
    ];
    for (const [status, pattern] of cases) {
      const f = fakeFetch({ ok: false, status, json: { error: { message: "상세" } } });
      const err = await callStructuredOpenAI(input, f.impl).catch((e) => e);
      expect(err).toBeInstanceOf(ClaudeCallError);
      expect(err.message).toMatch(pattern);
    }
  });

  it("fetch가 예외를 던져도 ClaudeCallError로 바꾼다", async () => {
    const impl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const err = await callStructuredOpenAI(input, impl).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeCallError);
    expect(err.message).toBe("network down");
  });

  it("키가 없으면 요청을 보내지 않고 한국어 오류", async () => {
    delete process.env.OPENAI_API_KEY;
    const f = fakeFetch({ json: completed("{}") });
    const err = await callStructuredOpenAI(input, f.impl).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeCallError);
    expect(err.message).toMatch(/OpenAI API 키가 없습니다/);
    expect(f.calls).toHaveLength(0);
  });

  it("사용량을 [editor-call] usage로 남기고 본문은 남기지 않는다", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const usage = { input_tokens: 100, output_tokens: 7, input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 } };
    const f = fakeFetch({ json: completed(JSON.stringify({ items: [] }), usage) });
    await callStructuredOpenAI(input, f.impl);

    expect(spy).toHaveBeenCalledTimes(1);
    const [tag, payload] = spy.mock.calls[0];
    expect(tag).toBe("[editor-call] usage");
    expect(payload).toMatchObject({
      label: "테스트호출",
      provider: "openai",
      effort: "high",
      input_tokens: 30,
      output_tokens: 7,
      cache_read_input_tokens: 60,
      cache_creation_input_tokens: 10,
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("본문 내용");
  });
});

describe("openAIUsageToChatUsage", () => {
  it("입력 토큰에서 캐시 읽기·쓰기를 빼고 캐시 필드는 따로 둔다", () => {
    expect(
      openAIUsageToChatUsage({ input_tokens: 100, output_tokens: 7, input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 } }),
    ).toEqual({ input_tokens: 30, output_tokens: 7, cache_creation_input_tokens: 10, cache_read_input_tokens: 60 });
  });

  it("세부 항목이 없으면 캐시는 0", () => {
    expect(openAIUsageToChatUsage({ input_tokens: 5, output_tokens: 2 })).toEqual({
      input_tokens: 5,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });
});

describe("buildOpenAIInput", () => {
  it("[developer(본문+브레이크포인트), developer(시스템), ...나머지]", () => {
    expect(buildOpenAIInput("본문", "지시", [{ role: "user", content: "질문" }])).toEqual([
      { role: "developer", content: [{ type: "input_text", text: "본문", prompt_cache_breakpoint: { mode: "explicit" } }] },
      { role: "developer", content: "지시" },
      { role: "user", content: "질문" },
    ]);
  });
});
