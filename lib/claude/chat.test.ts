import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./structured");

import { parseChatRequest, streamChat } from "./chat";
import { buildChatSystemPrompt } from "./editing";
import * as structured from "./structured";
import { CHAT_LIMITS, type ChatEvent, type ChatMessage } from "@/lib/chatProtocol";
import { MAX_TITLE_CHARS } from "@/lib/masterReview";

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

  it("편집 중인 소설 제목(title)은 다듬은 값으로 돌려주고, 없으면 값에도 없다", () => {
    const withTitle = parseChatRequest({ ...valid, title: "  새 제목  " });
    expect(withTitle.ok && withTitle.value.title).toBe("새 제목");
    const without = parseChatRequest(valid);
    expect(without.ok && "title" in without.value).toBe(false);
  });

  it.each([
    ["빈 제목", ""],
    ["공백뿐인 제목", "   "],
    ["한도를 넘는 제목", "가".repeat(MAX_TITLE_CHARS + 1)],
    ["문자열이 아닌 제목", 123],
  ])("title이 올바르지 않으면 거절한다: %s", (_name, title) => {
    expectRejected({ ...valid, title });
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

  it("limitTo는 올바르면 새 객체로 담아 돌려주고, 없으면 값에도 없다", () => {
    const limitTo = { chapterNumber: 1, paragraphIndex: 0 };
    expect(parseChatRequest({ ...valid, limitTo })).toEqual({ ok: true, value: { ...valid, limitTo } });
    const without = parseChatRequest(valid);
    expect(without.ok && "limitTo" in without.value).toBe(false);
  });

  it.each([
    ["장 번호 0", { chapterNumber: 0, paragraphIndex: 0 }],
    ["문단 인덱스가 음수", { chapterNumber: 1, paragraphIndex: -1 }],
    ["장 번호가 소수", { chapterNumber: 1.5, paragraphIndex: 0 }],
    ["문단 인덱스가 문자열", { chapterNumber: 1, paragraphIndex: "0" }],
    ["빈 객체", {}],
    ["null", null],
    ["문자열", "1장"],
  ])("limitTo가 올바르지 않으면 거절한다: %s", (_name, limitTo) => {
    expectRejected({ ...valid, limitTo });
  });

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

  it("Claude 답변은 메시지당 한도를 넘게 길어도 받는다(합계 한도만 적용) — 긴 답변 한 번에 이후 전송이 막히면 안 된다", () => {
    const long = "가".repeat(CHAT_LIMITS.maxMessageChars + 1000);
    const conversation: ChatMessage[] = [
      { role: "user", content: "자세히 설명해줘" },
      { role: "assistant", content: long },
      { role: "user", content: "고마워, 이어서 하나만 더" },
    ];
    expect(parseChatRequest({ ...valid, messages: conversation }).ok).toBe(true);
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

  async function run(limitTo?: { chapterNumber: number; paragraphIndex: number }) {
    vi.mocked(structured.streamConversation).mockReturnValueOnce(
      (async function* () {
        yield { t: "done" } as ChatEvent;
      })(),
    );
    const multi = [{ chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["하나.", "둘.", "셋."] }];
    for await (const _ of streamChat({ ...base, chapters: multi, mode: "review", messages, ...(limitTo && { limitTo }) })) void _;
    return vi.mocked(structured.streamConversation).mock.calls.at(-1)![0];
  }

  it("limitTo가 있으면 문단 중심 본문을, 없으면 전체 본문을 쓴다", async () => {
    const limited = await run({ chapterNumber: 1, paragraphIndex: 0 });
    expect(limited.context).toContain("(범위:");
    expect(limited.context).not.toContain("셋.");
    const full = await run();
    expect(full.context).not.toContain("(범위:");
    expect(full.context).toContain("셋.");
  });

  it("사용량은 범위와 함께 토큰 수만 로그로 남긴다", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 7 };
    (await run({ chapterNumber: 1, paragraphIndex: 0 })).onUsage?.(usage);
    expect(info).toHaveBeenLastCalledWith("[editor-chat] usage", { scope: "paragraph", ...usage });
    (await run()).onUsage?.(usage);
    expect(info).toHaveBeenLastCalledWith("[editor-chat] usage", { scope: "full", ...usage });
    info.mockRestore();
  });
});
