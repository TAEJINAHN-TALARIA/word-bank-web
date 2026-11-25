import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

// 실제 SDK를 부르지 않도록 가짜로 바꾼다. toCallError가 instanceof로 쓰는 오류 클래스도 있어야 한다.
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => {
  class RateLimitError extends Error {}
  class AuthenticationError extends Error {}
  class APIError extends Error {
    status = 0;
  }
  class Anthropic {
    static RateLimitError = RateLimitError;
    static AuthenticationError = AuthenticationError;
    static APIError = APIError;
    beta = { messages: { parse } };
  }
  return { default: Anthropic };
});
vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({ zodOutputFormat: () => ({ type: "json_schema" }) }));
vi.mock("./openai", () => ({ callStructuredOpenAI: vi.fn(), streamConversationOpenAI: vi.fn() }));

import { CLAUDE_REVIEW_MODEL, callStructured, reviewProvider, streamConversation, type ChatUsage, type ConversationClient } from "./structured";
import { callStructuredOpenAI, streamConversationOpenAI } from "./openai";
import type { ChatEvent, ChatMessage } from "@/lib/chatProtocol";

const messages: ChatMessage[] = [{ role: "user", content: "[지금 보는 곳: 1장 1문단]\n이 문단 어때?" }];
const delta = (text: string) => ({ type: "content_block_delta", delta: { type: "text_delta", text } });
const fallbackStart = { type: "content_block_start", content_block: { type: "fallback" } };

type Script = { events: unknown[]; stopReason?: string | null; throwAt?: number; error?: Error; usage?: ChatUsage };

// SDK 스트림을 흉내 낸다: 이벤트를 차례로 내보내다가 throwAt번째에서 error를 던질 수 있다.
function fakeClient({ events, stopReason = "end_turn", throwAt, error, usage }: Script) {
  const calls: { body: any; options: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const client: ConversationClient = {
    beta: {
      messages: {
        stream(body, options) {
          calls.push({ body, options });
          return {
            async *[Symbol.asyncIterator]() {
              for (let i = 0; i < events.length; i++) {
                if (throwAt === i) throw error;
                yield events[i];
              }
              if (throwAt === events.length) throw error;
            },
            finalMessage: async () => ({ stop_reason: stopReason, ...(usage && { usage }) }),
          };
        },
      },
    },
  };
  return { client, calls };
}

async function collect(generator: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const event of generator) out.push(event);
  return out;
}

const base = { system: "시스템", context: "[소설 본문]\n…", messages, effort: "medium" as const };

describe("streamConversation", () => {
  it("모델·베타·폴백·캐시·effort를 지정해 스트리밍 호출하고 signal을 넘긴다", async () => {
    const { client, calls } = fakeClient({ events: [] });
    const signal = new AbortController().signal;
    await collect(streamConversation({ ...base, signal }, client));

    const { body, options } = calls[0];
    expect(body.model).toBe(CLAUDE_REVIEW_MODEL);
    expect(body.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(body.fallbacks).toBe("default");
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.system).toBe("시스템");
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: "[소설 본문]\n…", cache_control: { type: "ephemeral" } });
    expect(options).toEqual({ signal });
  });

  it("응답이 끝나면 사용량(usage)을 onUsage로 한 번 넘기고, 이벤트는 그대로다", async () => {
    const usage: ChatUsage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 7 };
    const { client } = fakeClient({ events: [delta("가")], usage });
    const onUsage = vi.fn();
    expect(await collect(streamConversation({ ...base, onUsage }, client))).toEqual([{ t: "delta", text: "가" }, { t: "done" }]);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(usage);
  });

  it("usage가 없으면 onUsage를 부르지 않는다", async () => {
    const { client } = fakeClient({ events: [delta("가")] });
    const onUsage = vi.fn();
    await collect(streamConversation({ ...base, onUsage }, client));
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("글 조각은 delta로, 끝나면 done으로 내보낸다", async () => {
    const { client } = fakeClient({ events: [delta("가"), { type: "ping" }, delta("나")] });
    expect(await collect(streamConversation(base, client))).toEqual([
      { t: "delta", text: "가" },
      { t: "delta", text: "나" },
      { t: "done" },
    ]);
  });

  it("폴백 블록이 끼면 그 자리에 reset을 낸다(앞의 글은 화면이 버린다)", async () => {
    const { client } = fakeClient({ events: [delta("가"), fallbackStart, delta("다")] });
    expect(await collect(streamConversation(base, client))).toEqual([
      { t: "delta", text: "가" },
      { t: "reset" },
      { t: "delta", text: "다" },
      { t: "done" },
    ]);
  });

  it("거절로 끝나면 done 없이 오류 이벤트로 끝난다", async () => {
    const { client } = fakeClient({ events: [delta("가")], stopReason: "refusal" });
    expect(await collect(streamConversation(base, client))).toEqual([
      { t: "delta", text: "가" },
      { t: "error", message: "Claude가 이 요청을 처리하지 못했습니다 (정책상 거절)" },
    ]);
  });

  it("길이 초과로 잘리면 오류 이벤트로 끝난다", async () => {
    const { client } = fakeClient({ events: [delta("가")], stopReason: "max_tokens" });
    expect(await collect(streamConversation(base, client))).toEqual([
      { t: "delta", text: "가" },
      { t: "error", message: "응답이 길어 중간에 잘렸습니다. 요청 범위를 줄여 다시 시도해 주세요" },
    ]);
  });

  it("스트림 도중 예외는 예외로 던지지 않고 오류 이벤트 하나로 끝난다", async () => {
    const { client } = fakeClient({ events: [delta("가"), delta("나")], throwAt: 1, error: new Error("boom") });
    expect(await collect(streamConversation(base, client))).toEqual([
      { t: "delta", text: "가" },
      { t: "error", message: "boom" },
    ]);
  });

  it("편집자가 중단해(signal abort) 예외가 나면 오류 이벤트 없이 조용히 끝난다", async () => {
    const controller = new AbortController();
    const { client } = fakeClient({ events: [delta("가"), delta("나")], throwAt: 1, error: new Error("aborted") });
    const generator = streamConversation({ ...base, signal: controller.signal }, client);
    const events: ChatEvent[] = [];
    for await (const event of generator) {
      events.push(event);
      controller.abort(); // 첫 조각을 받은 뒤 중단
    }
    expect(events).toEqual([{ t: "delta", text: "가" }]);
  });
});

afterEach(() => {
  delete process.env.REVIEW_PROVIDER;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("reviewProvider", () => {
  it("openai로 정확히 지정했을 때만 openai, 없거나 모르는 값은 anthropic", () => {
    expect(reviewProvider()).toBe("anthropic");
    for (const value of ["anthropic", "OPENAI ", "OpenAI", "", "gemini"]) {
      process.env.REVIEW_PROVIDER = value;
      expect(reviewProvider()).toBe("anthropic");
    }
    process.env.REVIEW_PROVIDER = "openai";
    expect(reviewProvider()).toBe("openai");
  });
});

describe("callStructured 공급자 선택", () => {
  const schema = z.object({ items: z.array(z.string()) });
  const input = { schema, effort: "high" as const, system: "지시", context: "[소설 본문] 비밀 본문", task: "과제", label: "점검" };

  it("기본(anthropic)이면 Claude로 부르고 사용량을 [editor-call] usage로 남긴다(본문은 남기지 않는다)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    parse.mockResolvedValueOnce({
      stop_reason: "end_turn",
      parsed_output: { items: ["가"] },
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 7 },
    });

    expect(await callStructured(input)).toEqual({ items: ["가"] });
    expect(callStructuredOpenAI).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("[editor-call] usage", {
      label: "점검",
      provider: "anthropic",
      effort: "high",
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 3,
      cache_read_input_tokens: 7,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("비밀 본문");
  });

  it("usage가 없으면 로그를 남기지 않는다", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    parse.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { items: [] } });
    await callStructured(input);
    expect(info).not.toHaveBeenCalled();
  });

  it("openai이면 Claude를 부르지 않고 같은 입력을 OpenAI 호출로 넘긴다", async () => {
    process.env.REVIEW_PROVIDER = "openai";
    vi.mocked(callStructuredOpenAI).mockResolvedValueOnce({ items: ["나"] });

    expect(await callStructured(input)).toEqual({ items: ["나"] });
    expect(callStructuredOpenAI).toHaveBeenCalledWith(input);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("streamConversation 공급자 선택", () => {
  it("openai이고 가짜 클라이언트가 없으면 OpenAI 스트림으로 보낸다", async () => {
    process.env.REVIEW_PROVIDER = "openai";
    vi.mocked(streamConversationOpenAI).mockImplementationOnce(async function* () {
      yield { t: "delta", text: "가" } as const;
      yield { t: "done" } as const;
    });
    const onUsage = vi.fn();
    expect(await collect(streamConversation({ ...base, onUsage }))).toEqual([{ t: "delta", text: "가" }, { t: "done" }]);
    expect(streamConversationOpenAI).toHaveBeenCalledWith({ ...base, onUsage });
  });

  it("기본(anthropic)이면 OpenAI 스트림을 부르지 않는다", async () => {
    const { client } = fakeClient({ events: [] });
    await collect(streamConversation(base, client));
    expect(streamConversationOpenAI).not.toHaveBeenCalled();
  });
});
