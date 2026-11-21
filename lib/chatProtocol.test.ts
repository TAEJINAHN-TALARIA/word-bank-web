import { describe, it, expect } from "vitest";
import {
  CHAT_LIMITS,
  applyChatEvent,
  createEventParser,
  encodeEvent,
  focusLine,
  stripFocus,
  trimHistory,
  withFocus,
  type ChatMessage,
} from "./chatProtocol";

const PARSE_ERROR = { t: "error", message: "응답을 해석하지 못했습니다" };

describe("focusLine / withFocus / stripFocus", () => {
  it("문단을 보고 있으면 장과 문단 번호(1부터)를 적는다", () => {
    expect(focusLine({ chapterNumber: 3, paragraphIndex: 1 })).toBe("[지금 보는 곳: 3장 2문단]");
  });

  it("전체 읽기 화면이면 위치 대신 그렇다고 적는다", () => {
    expect(focusLine(null)).toBe("[지금 보는 곳: 전체 읽기 화면]");
  });

  it("withFocus는 질문 앞에 포커스 줄을 붙이고 stripFocus가 되돌린다", () => {
    const focus = { chapterNumber: 3, paragraphIndex: 1 };
    expect(withFocus("질문", focus)).toBe("[지금 보는 곳: 3장 2문단]\n질문");
    expect(stripFocus(withFocus("질문", focus))).toBe("질문");
    expect(stripFocus(withFocus("질문", null))).toBe("질문");
  });

  it("stripFocus는 포커스 줄이 없는 글을 그대로 둔다", () => {
    expect(stripFocus("그냥 질문")).toBe("그냥 질문");
  });
});

describe("trimHistory", () => {
  const turn = (i: number, size = 10): ChatMessage => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: String(i).padEnd(size, "x"),
  });

  it("짧은 대화는 그대로 둔다", () => {
    const messages = [turn(0), turn(1), turn(2)];
    expect(trimHistory(messages)).toEqual(messages);
  });

  it("개수 한도를 넘으면 오래된 것부터 버리되 마지막은 남기고 첫 메시지는 user다", () => {
    const messages = Array.from({ length: 40 }, (_, i) => turn(i));
    messages.push({ role: "user", content: "마지막 질문" });
    const trimmed = trimHistory(messages);
    expect(trimmed.length).toBeLessThanOrEqual(CHAT_LIMITS.maxMessages);
    expect(trimmed[trimmed.length - 1]).toEqual({ role: "user", content: "마지막 질문" });
    expect(trimmed[0].role).toBe("user");
  });

  it("글자 수 합계 한도를 넘으면 오래된 것부터 버리고, 번갈아 오는 대화는 첫 메시지가 user가 되도록 하나 더 버린다", () => {
    const big = (role: ChatMessage["role"]): ChatMessage => ({ role, content: "가".repeat(20_000) });
    const messages = [big("user"), big("assistant"), big("user"), big("assistant")];
    const trimmed = trimHistory(messages);
    const total = trimmed.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(CHAT_LIMITS.maxTotalChars);
    expect(trimmed[0].role).toBe("user");
    expect(trimmed[trimmed.length - 1]).toBe(messages[3]);
    expect(trimmed).toHaveLength(2);
  });

  it("user만 이어진 대화는 한도 안에서 마지막 3개를 남긴다", () => {
    const messages = Array.from({ length: 4 }, (): ChatMessage => ({ role: "user", content: "가".repeat(20_000) }));
    expect(trimHistory(messages)).toEqual(messages.slice(1));
  });
});

describe("encodeEvent", () => {
  it("이벤트를 JSON 한 줄(끝에 줄바꿈)로 만든다", () => {
    expect(encodeEvent({ t: "delta", text: "안녕" })).toBe('{"t":"delta","text":"안녕"}\n');
  });
});

describe("createEventParser", () => {
  it("한 줄이 두 조각으로 나뉘어 와도 완성된 줄에서 이벤트를 낸다", () => {
    const feed = createEventParser();
    expect(feed('{"t":"del')).toEqual([]);
    expect(feed('ta","text":"가"}\n')).toEqual([{ t: "delta", text: "가" }]);
  });

  it("한 조각에 여러 줄이 있으면 이벤트를 모두 낸다", () => {
    const feed = createEventParser();
    expect(feed('{"t":"delta","text":"가"}\n{"t":"done"}\n')).toEqual([{ t: "delta", text: "가" }, { t: "done" }]);
  });

  it("빈 줄은 무시한다", () => {
    const feed = createEventParser();
    expect(feed('\n\n{"t":"reset"}\n\n')).toEqual([{ t: "reset" }]);
  });

  it("깨진 JSON 줄은 해석 실패 오류 이벤트가 된다", () => {
    const feed = createEventParser();
    expect(feed("{not json\n")).toEqual([PARSE_ERROR]);
  });

  it("알 수 없는 이벤트 종류도 해석 실패 오류 이벤트가 된다", () => {
    const feed = createEventParser();
    expect(feed('{"t":"mystery"}\n')).toEqual([PARSE_ERROR]);
  });
});

describe("applyChatEvent", () => {
  it("delta는 이어 붙이고 reset은 비운다", () => {
    expect(applyChatEvent("안", { t: "delta", text: "녕" })).toBe("안녕");
    expect(applyChatEvent("안녕", { t: "reset" })).toBe("");
  });

  it("error와 done은 글을 바꾸지 않는다", () => {
    expect(applyChatEvent("안녕", { t: "error", message: "x" })).toBe("안녕");
    expect(applyChatEvent("안녕", { t: "done" })).toBe("안녕");
  });
});
