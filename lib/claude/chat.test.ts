import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./structured");

import { parseChatRequest, streamChat } from "./chat";
import { buildChatSystemPrompt } from "./editing";
import * as structured from "./structured";
import { CHAT_LIMITS, type ChatEvent, type ChatMessage } from "@/lib/chatProtocol";

const chapters = [{ chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["하린은 문을 열었다."] }];
const messages: ChatMessage[] = [{ role: "user", content: "[지금 보는 곳: 1장 1문단]\n이 문단 어때?" }];
const valid = { mode: "review", id: "session-1", chapters, messages };

function expectRejected(body: unknown) {
  const result = parseChatRequest(body);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).not.toBe("");
}

describe("parseChatRequest", () => {
  it("올바른 요청은 값을 그대로 돌려준다", () => {
    expect(parseChatRequest(valid)).toEqual({ ok: true, value: valid });
  });

  it("게시본 모드도 받는다", () => {
    expect(parseChatRequest({ ...valid, mode: "published" }).ok).toBe(true);
  });

  it.each([
    ["본문이 객체가 아님", null],
    ["mode가 알 수 없는 값", { ...valid, mode: "x" }],
    ["id가 빈 문자열", { ...valid, id: "" }],
    ["chapters 형식 오류", { ...valid, chapters: [{ chapterNumber: "1" }] }],
    ["messages가 빈 배열", { ...valid, messages: [] }],
    ["첫 메시지가 assistant", { ...valid, messages: [{ role: "assistant", content: "안녕" }, ...messages] }],
    ["마지막 메시지가 assistant", { ...valid, messages: [...messages, { role: "assistant", content: "답" }] }],
    ["role이 알 수 없는 값", { ...valid, messages: [{ role: "system", content: "x" }] }],
    ["content가 문자열이 아님", { ...valid, messages: [{ role: "user", content: 5 }] }],
    ["공백뿐인 content", { ...valid, messages: [{ role: "user", content: "  \n " }] }],
  ])("거절한다: %s", (_name, body) => expectRejected(body));

  it(`메시지가 ${CHAT_LIMITS.maxMessages}개를 넘으면 거절한다`, () => {
    const many: ChatMessage[] = Array.from({ length: CHAT_LIMITS.maxMessages + 1 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "가",
    }));
    expectRejected({ ...valid, messages: many });
  });

  it(`한 메시지가 ${CHAT_LIMITS.maxMessageChars}자를 넘으면 거절하고, 딱 그 길이는 받는다`, () => {
    expectRejected({ ...valid, messages: [{ role: "user", content: "가".repeat(CHAT_LIMITS.maxMessageChars + 1) }] });
    expect(parseChatRequest({ ...valid, messages: [{ role: "user", content: "가".repeat(CHAT_LIMITS.maxMessageChars) }] }).ok).toBe(true);
  });

  it(`글자 수 합계가 ${CHAT_LIMITS.maxTotalChars}자를 넘으면 거절하고, 딱 그 합계는 받는다`, () => {
    // 4000자짜리를 user/assistant 번갈아, 첫·마지막이 user가 되도록 홀수 개로 만든다.
    const make = (count: number): ChatMessage[] =>
      Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "가".repeat(CHAT_LIMITS.maxMessageChars),
      }));
    expect(parseChatRequest({ ...valid, messages: make(15) }).ok).toBe(true); // 60,000자
    expectRejected({ ...valid, messages: make(17) }); // 68,000자
  });
});

describe("streamChat", () => {
  const base = { title: "제목", level: "Lv3", chapters, characters: [], narrativeStyle: "-했다체", levelGuidance: null };

  it("모드별 대화 프롬프트와 소설 본문을 담아 streamConversation을 부르고, 그 이벤트를 그대로 내보낸다", async () => {
    const events: ChatEvent[] = [{ t: "delta", text: "가" }, { t: "done" }];
    vi.mocked(structured.streamConversation).mockReturnValueOnce(
      (async function* () {
        yield* events;
      })(),
    );
    const signal = new AbortController().signal;

    const out: ChatEvent[] = [];
    for await (const event of streamChat({ ...base, mode: "review", messages, signal })) out.push(event);

    expect(out).toEqual(events);
    const call = vi.mocked(structured.streamConversation).mock.calls[0][0];
    expect(call.system).toBe(buildChatSystemPrompt("review"));
    expect(call.context).toContain("[소설 본문]");
    expect(call.context).toContain("하린은 문을 열었다.");
    expect(call.effort).toBe("medium");
    expect(call.messages).toBe(messages);
    expect(call.signal).toBe(signal);
  });
});
