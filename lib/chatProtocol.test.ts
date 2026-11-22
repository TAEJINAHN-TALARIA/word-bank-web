import { describe, it, expect } from "vitest";
import {
  CHAT_LIMITS,
  EDITED_NOTICE,
  applyChatEvent,
  chatLimit,
  createEventParser,
  encodeEvent,
  focusLine,
  manuscriptEdited,
  manuscriptKey,
  stripFocus,
  trimHistory,
  withFocus,
  type ChatMessage,
} from "./chatProtocol";
import type { MasterChapter } from "./masterReview";

const PARSE_ERROR = { t: "error", message: "응답을 해석하지 못했습니다" };

describe("focusLine / withFocus / stripFocus", () => {
  it("문단을 보고 있으면 장과 문단 번호(1부터)를 적는다", () => {
    expect(focusLine({ chapterNumber: 3, paragraphIndex: 1 })).toBe("[지금 보는 곳: 3장 2문단]");
  });

  it("전체 읽기 화면이면 위치 대신 그렇다고 적는다", () => {
    expect(focusLine(null)).toBe("[지금 보는 곳: 전체 읽기 화면]");
  });

  it("제목을 보고 있으면 소설 제목·장 제목이라고 적는다", () => {
    expect(focusLine({ novelTitle: true })).toBe("[지금 보는 곳: 소설 제목]");
    expect(focusLine({ chapterNumber: 3, chapterTitle: true })).toBe("[지금 보는 곳: 3장 제목]");
    expect(stripFocus(withFocus("질문", { novelTitle: true }))).toBe("질문");
    expect(stripFocus(withFocus("질문", { chapterNumber: 3, chapterTitle: true }))).toBe("질문");
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

describe("원고 수정 알림 (EDITED_NOTICE)", () => {
  const paragraphFocus = { chapterNumber: 3, paragraphIndex: 1 };

  it("withFocus는 manuscriptEdited일 때 포커스 줄 다음에 알림 줄을 붙인다", () => {
    expect(EDITED_NOTICE).toBe("[참고: 직전 질문 뒤에 원고가 수정됐어요]");
    expect(withFocus("질문", paragraphFocus, { manuscriptEdited: true })).toBe(
      "[지금 보는 곳: 3장 2문단]\n[참고: 직전 질문 뒤에 원고가 수정됐어요]\n질문",
    );
  });

  it("withFocus는 옵션이 없거나 false면 알림 없이 기존 모양 그대로다", () => {
    expect(withFocus("질문", paragraphFocus)).toBe("[지금 보는 곳: 3장 2문단]\n질문");
    expect(withFocus("질문", paragraphFocus, { manuscriptEdited: false })).toBe("[지금 보는 곳: 3장 2문단]\n질문");
  });

  it.each([
    ["문단", paragraphFocus],
    ["전체 읽기", null],
    ["소설 제목", { novelTitle: true as const }],
    ["장 제목", { chapterNumber: 3, chapterTitle: true as const }],
  ])("stripFocus는 %s 포커스에서도 알림 줄까지 떼어 편집자가 쓴 글만 남긴다", (_name, focus) => {
    expect(stripFocus(withFocus("질문", focus, { manuscriptEdited: true }))).toBe("질문");
  });

  it("manuscriptEdited: 이전 전송이 없으면 false, 같으면 false, 다르면 true", () => {
    expect(manuscriptEdited(null, "a")).toBe(false);
    expect(manuscriptEdited("a", "a")).toBe(false);
    expect(manuscriptEdited("a", "b")).toBe(true);
  });

  describe("manuscriptKey", () => {
    const chapters = (paragraphs: string[], chapterTitle = "1장"): MasterChapter[] => [
      { chapterNumber: 1, chapterTitle, paragraphs },
    ];

    it("같은 입력은 같은 열쇠다", () => {
      expect(manuscriptKey(chapters(["가", "나"]), "제목")).toBe(manuscriptKey(chapters(["가", "나"]), "제목"));
    });

    it("문단 글자·장 제목·소설 제목이 바뀌면 열쇠가 달라진다", () => {
      const base = manuscriptKey(chapters(["가", "나"]), "제목");
      expect(manuscriptKey(chapters(["가", "다"]), "제목")).not.toBe(base);
      expect(manuscriptKey(chapters(["가", "나"], "새 장 제목"), "제목")).not.toBe(base);
      expect(manuscriptKey(chapters(["가", "나"]), "새 제목")).not.toBe(base);
    });

    it("끝에 빈 문단만 더해도(저장 정규화로 사라지는 차이) 열쇠는 같다", () => {
      expect(manuscriptKey(chapters(["가", "나", ""]), "제목")).toBe(manuscriptKey(chapters(["가", "나"]), "제목"));
    });

    it("소설 제목 양끝 공백만 다르거나 제목이 없음/빈 값이어도 열쇠는 같다", () => {
      expect(manuscriptKey(chapters(["가"]), " 제목 ")).toBe(manuscriptKey(chapters(["가"]), "제목"));
      expect(manuscriptKey(chapters(["가"]), undefined)).toBe(manuscriptKey(chapters(["가"]), ""));
    });
  });
});

describe("chatLimit", () => {
  const paragraphFocus = { chapterNumber: 3, paragraphIndex: 1 };

  it("문단을 보고 있고 범위가 문단 중심이면 그 문단 위치를 돌려준다(포커스와 다른 새 객체, 두 키만)", () => {
    const limit = chatLimit(paragraphFocus, "paragraph");
    expect(limit).toEqual({ chapterNumber: 3, paragraphIndex: 1 });
    expect(limit).not.toBe(paragraphFocus);
  });

  it("범위가 전체 원고면 문단을 보고 있어도 제한이 없다", () => {
    expect(chatLimit(paragraphFocus, "full")).toBeUndefined();
  });

  it.each([
    ["전체 읽기 화면", null],
    ["소설 제목", { novelTitle: true as const }],
    ["장 제목", { chapterNumber: 3, chapterTitle: true as const }],
  ])("%s는 범위가 문단 중심이어도 제한이 없다(이야기 전체가 필요)", (_name, focus) => {
    expect(chatLimit(focus, "paragraph")).toBeUndefined();
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
