import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CLAUDE_REVIEW_MODEL, streamConversation, type ConversationClient } from "./structured";
import type { ChatEvent, ChatMessage } from "@/lib/chatProtocol";

const messages: ChatMessage[] = [{ role: "user", content: "[지금 보는 곳: 1장 1문단]\n이 문단 어때?" }];
const delta = (text: string) => ({ type: "content_block_delta", delta: { type: "text_delta", text } });
const fallbackStart = { type: "content_block_start", content_block: { type: "fallback" } };

type Script = { events: unknown[]; stopReason?: string | null; throwAt?: number; error?: Error };

// SDK 스트림을 흉내 낸다: 이벤트를 차례로 내보내다가 throwAt번째에서 error를 던질 수 있다.
function fakeClient({ events, stopReason = "end_turn", throwAt, error }: Script) {
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
            finalMessage: async () => ({ stop_reason: stopReason }),
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
