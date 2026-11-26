import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { OPENAI_REVIEW_MODEL, buildOpenAIInput, callStructuredOpenAI, openAIUsageToChatUsage, streamConversationOpenAI } from "./openai";
import type { ChatEvent, ChatMessage } from "@/lib/chatProtocol";
import { ClaudeCallError } from "./callError";

const schema = z.object({ items: z.array(z.object({ text: z.string() })) });
const input = { schema, effort: "high" as const, system: "시스템 지시", context: "[소설 본문]\n본문 내용", task: "이번 과제", label: "테스트호출" };

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function fakeFetch(response: { ok?: boolean; status?: number; json: unknown; text?: string }) {
  const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
  const impl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json,
      text: async () => response.text ?? JSON.stringify(response.json),
    };
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

  it("HTTP 오류의 응답 본문은 서버 로그에 남기고 화면 메시지에는 넣지 않는다", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const detail = "Unknown parameter: 'prompt_cache_options'";
    const f = fakeFetch({ ok: false, status: 400, json: { error: { message: detail } } });
    const err = await callStructuredOpenAI(input, f.impl).catch((e) => e);

    expect(err.message).toBe("OpenAI API 오류 (400)");
    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorLog.mock.calls[0]);
    expect(logged).toContain("400");
    expect(logged).toContain(detail);
    expect(logged).not.toContain("sk-test");
    expect(logged).not.toContain(input.context);
  });

  it("오류 본문이 아주 길면 로그에는 앞부분만 남긴다", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch({ ok: false, status: 500, json: {}, text: "가".repeat(5000) });
    await callStructuredOpenAI(input, f.impl).catch((e) => e);
    expect(JSON.stringify(errorLog.mock.calls[0]).length).toBeLessThan(1000);
  });

  it("오류 본문을 읽지 못해도 원래 오류 메시지는 그대로다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const impl = (async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
      text: async () => {
        throw new Error("body stream broke");
      },
    })) as unknown as typeof fetch;
    const err = await callStructuredOpenAI(input, impl).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeCallError);
    expect(err.message).toBe("OpenAI API 오류 (502)");
  });

  it("채팅 스트림도 HTTP 오류 본문을 서버 로그에 남긴다", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const detail = "Invalid value for 'model'";
    const impl = (async () => ({ ok: false, status: 400, text: async () => detail })) as unknown as typeof fetch;
    const events = await collect(streamConversationOpenAI(chat, impl));
    expect(events).toEqual([{ t: "error", message: "OpenAI API 오류 (400)" }]);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(detail);
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

// ── 대화 스트림 ──────────────────────────────────────────────────────────────

const sse = (type: string, data: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const delta = (text: string) => sse("response.output_text.delta", { delta: text });
const done = (usage: unknown = { input_tokens: 100, output_tokens: 7, input_tokens_details: { cached_tokens: 60 } }) =>
  sse("response.completed", { response: { status: "completed", usage } });

// 조각(chunks)을 하나씩 내보내는 가짜 SSE 응답. 이벤트 경계와 상관없이 자른 조각을 그대로 넘긴다.
function fakeStream(chunks: (string | Uint8Array)[], init: { ok?: boolean; status?: number; failAt?: Error } = {}) {
  const calls: { url: string; init: { headers: Record<string, string>; body: string; signal?: AbortSignal } }[] = [];
  const impl = (async (url: string, req: { headers: Record<string, string>; body: string; signal?: AbortSignal }) => {
    calls.push({ url, init: req });
    const encoder = new TextEncoder();
    let i = 0;
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (i < chunks.length) {
            const chunk = chunks[i++];
            controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
          } else if (init.failAt) controller.error(init.failAt);
          else controller.close();
        },
      }),
    };
  }) as unknown as typeof fetch;
  return { impl, calls, body: (): Body => JSON.parse(calls[0].init.body) };
}

async function collect(generator: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const event of generator) out.push(event);
  return out;
}

const history: ChatMessage[] = [
  { role: "user", content: "[지금 보는 곳: 1장 1문단]\n이 문단 어때?" },
  { role: "assistant", content: "좋아요." },
  { role: "user", content: "[지금 보는 곳: 1장 2문단]\n이건?" },
];
const chat = { system: "시스템", context: "[소설 본문]\n본문", messages: history, effort: "medium" as const };

describe("streamConversationOpenAI", () => {
  it("요청: stream true, 대화 기록 매핑, 이전 답변은 output_text", async () => {
    const f = fakeStream([done()]);
    const signal = new AbortController().signal;
    await collect(streamConversationOpenAI({ ...chat, signal }, f.impl));

    expect(f.calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(f.calls[0].init.headers.Authorization).toBe("Bearer sk-test");
    expect(f.calls[0].init.signal).toBe(signal);
    const body = f.body();
    expect(body.model).toBe(OPENAI_REVIEW_MODEL);
    expect(body.stream).toBe(true);
    expect(body.max_output_tokens).toBe(8000);
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(body.input).toEqual([
      { role: "developer", content: [{ type: "input_text", text: chat.context, prompt_cache_breakpoint: { mode: "explicit" } }] },
      { role: "developer", content: "시스템" },
      { role: "user", content: history[0].content },
      { role: "assistant", content: [{ type: "output_text", text: "좋아요." }] },
      { role: "user", content: history[2].content },
    ]);
  });

  it("response.output_text.delta는 delta로, response.completed는 done과 onUsage 한 번", async () => {
    const f = fakeStream([sse("response.created"), delta("가"), delta("나"), done()]);
    const onUsage = vi.fn();
    expect(await collect(streamConversationOpenAI({ ...chat, onUsage }, f.impl))).toEqual([
      { t: "delta", text: "가" },
      { t: "delta", text: "나" },
      { t: "done" },
    ]);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({ input_tokens: 40, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 60 });
  });

  it("SSE 조각이 이벤트 중간에서 끊겨도 이어 붙여 읽는다", async () => {
    const all = delta("가나") + delta("다") + done();
    const f = fakeStream([all.slice(0, 20), all.slice(20, 75), all.slice(75)]);
    expect(await collect(streamConversationOpenAI(chat, f.impl))).toEqual([
      { t: "delta", text: "가나" },
      { t: "delta", text: "다" },
      { t: "done" },
    ]);
  });

  it("한글이 조각 경계의 바이트 중간에서 잘려도 깨지지 않는다", async () => {
    const bytes = new TextEncoder().encode(delta("한글") + done());
    const cut = bytes.indexOf(0xed) + 1; // '한'(3바이트)의 첫 바이트 바로 뒤
    const f = fakeStream([bytes.slice(0, cut), bytes.slice(cut)]);
    expect(await collect(streamConversationOpenAI(chat, f.impl))).toEqual([{ t: "delta", text: "한글" }, { t: "done" }]);
  });

  it("response.incomplete(max_output_tokens)는 길어서 잘렸다는 오류 이벤트", async () => {
    const f = fakeStream([delta("가"), sse("response.incomplete", { response: { incomplete_details: { reason: "max_output_tokens" } } })]);
    expect(await collect(streamConversationOpenAI(chat, f.impl))).toEqual([
      { t: "delta", text: "가" },
      { t: "error", message: "응답이 길어 중간에 잘렸습니다. 요청 범위를 줄여 다시 시도해 주세요" },
    ]);
  });

  it("response.failed와 error 이벤트와 HTTP 오류는 오류 이벤트 하나로 끝난다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const chunks of [[delta("가"), sse("response.failed", { response: { error: { message: "x" } } })], [sse("error", { message: "y" })]]) {
      const events = await collect(streamConversationOpenAI(chat, fakeStream(chunks).impl));
      expect(events.filter((e) => e.t === "error")).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ t: "error" });
      expect(events.some((e) => e.t === "done")).toBe(false);
    }
    expect(await collect(streamConversationOpenAI(chat, fakeStream([], { ok: false, status: 429 }).impl))).toEqual([
      { t: "error", message: "요청이 많아 잠시 뒤에 다시 시도해 주세요" },
    ]);
    expect(await collect(streamConversationOpenAI(chat, fakeStream([], { ok: false, status: 500 }).impl))).toEqual([
      { t: "error", message: "OpenAI API 오류 (500)" },
    ]);
  });

  it("refusal은 정책상 거절 오류 이벤트", async () => {
    const f = fakeStream([sse("response.refusal.delta", { delta: "안 됩니다" }), done()]);
    expect(await collect(streamConversationOpenAI(chat, f.impl))).toEqual([
      { t: "error", message: "AI가 이 요청을 처리하지 못했습니다 (정책상 거절)" },
    ]);
  });

  it("완료 이벤트 없이 스트림이 끝나면 오류 이벤트", async () => {
    const events = await collect(streamConversationOpenAI(chat, fakeStream([delta("가")]).impl));
    expect(events[0]).toEqual({ t: "delta", text: "가" });
    expect(events.at(-1)).toMatchObject({ t: "error" });
  });

  it("스트림 읽기 중 예외는 던지지 않고 오류 이벤트 하나로 끝난다", async () => {
    const f = fakeStream([delta("가")], { failAt: new Error("boom") });
    expect(await collect(streamConversationOpenAI(chat, f.impl))).toEqual([
      { t: "delta", text: "가" },
      { t: "error", message: "boom" },
    ]);
  });

  it("중단(signal abort)이면 오류 이벤트 없이 조용히 끝난다", async () => {
    const controller = new AbortController();
    const f = fakeStream([delta("가")], { failAt: new Error("aborted") });
    const events: ChatEvent[] = [];
    for await (const event of streamConversationOpenAI({ ...chat, signal: controller.signal }, f.impl)) {
      events.push(event);
      controller.abort();
    }
    expect(events).toEqual([{ t: "delta", text: "가" }]);
  });

  it("키 없음 → 오류 이벤트 'OpenAI API 키가 없습니다' (예외로 던지지 않는다)", async () => {
    delete process.env.OPENAI_API_KEY;
    const f = fakeStream([done()]);
    const events = await collect(streamConversationOpenAI(chat, f.impl));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ t: "error" });
    expect((events[0] as { message: string }).message).toMatch(/OpenAI API 키가 없습니다/);
    expect(f.calls).toHaveLength(0);
  });
});
