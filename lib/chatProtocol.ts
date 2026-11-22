// 편집 화면 Claude 대화의 서버·클라이언트 공유 순수 로직 — 이벤트 형식, 한도, 기록 자르기.
// "server-only"를 import하지 않으므로 클라이언트 컴포넌트에서도 가져올 수 있다.
// 설계: docs/superpowers/specs/2026-11-21-editor-chat-and-download-design.md

import { chaptersKey } from "@/lib/qualityCheck";
import type { MasterChapter } from "@/lib/masterReview";

export type ChatMessage = { role: "user" | "assistant"; content: string };

// 편집자가 화면에서 보고 있는 곳: 문단, 소설 제목, 장 제목. 전체 읽기 화면이면 null.
export type ChatFocus =
  | { chapterNumber: number; paragraphIndex: number }
  | { novelTitle: true }
  | { chapterNumber: number; chapterTitle: true }
  | null;

// 대화가 읽는 원고의 범위: 지금 보는 문단과 앞뒤만("paragraph") 또는 원고 전체("full").
export type ChatScope = "paragraph" | "full";
// 문단 중심으로 읽을 때 중심이 되는 문단 위치(paragraphIndex는 0부터).
export type ChatLimit = { chapterNumber: number; paragraphIndex: number };

export type ChatEvent =
  | { t: "delta"; text: string }
  | { t: "reset" }
  | { t: "error"; message: string }
  | { t: "done" };

// maxMessageChars는 편집자(user) 메시지에만 적용한다 — Claude 답변은 합계(maxTotalChars)로만 제한한다.
export const CHAT_LIMITS = {
  maxMessages: 30,
  maxMessageChars: 4000,
  maxTotalChars: 60_000,
} as const;

const PARSE_ERROR: ChatEvent = { t: "error", message: "응답을 해석하지 못했습니다" };

export function focusLine(focus: ChatFocus): string {
  if (!focus) return "[지금 보는 곳: 전체 읽기 화면]";
  if ("novelTitle" in focus) return "[지금 보는 곳: 소설 제목]";
  if ("chapterTitle" in focus) return `[지금 보는 곳: ${focus.chapterNumber}장 제목]`;
  return `[지금 보는 곳: ${focus.chapterNumber}장 ${focus.paragraphIndex + 1}문단]`;
}

// 문단 중심 범위는 문단을 보고 있을 때만 적용한다 — 제목 대상과 전체 읽기 화면은 이야기 전체가 필요하므로 항상 전체 원고다.
export function chatLimit(focus: ChatFocus, scope: ChatScope): ChatLimit | undefined {
  if (scope !== "paragraph" || !focus || !("paragraphIndex" in focus)) return undefined;
  return { chapterNumber: focus.chapterNumber, paragraphIndex: focus.paragraphIndex };
}

// 지난 전송 뒤에 원고가 바뀌었음을 Claude에게 알리는 줄. 시스템 프롬프트(buildChatSystemPrompt)가 이 줄의 뜻을 설명한다.
export const EDITED_NOTICE = "[참고: 직전 질문 뒤에 원고가 수정됐어요]";

// 이전 대화가 매 요청 같은 모양으로 재전송되어 캐시가 깨지지 않도록, 포커스 줄과 알림 줄은 보낼 때의 값으로 메시지에 박아 둔다.
export function withFocus(text: string, focus: ChatFocus, options?: { manuscriptEdited?: boolean }): string {
  const notice = options?.manuscriptEdited ? `${EDITED_NOTICE}\n` : "";
  return `${focusLine(focus)}\n${notice}${text}`;
}

const FOCUS_PREFIX = /^\[지금 보는 곳: [^\]\n]*\]\n/;
const NOTICE_PREFIX = new RegExp(`^${EDITED_NOTICE.replace(/[[\]]/g, "\\$&")}\n`);

export function stripFocus(content: string): string {
  const withoutFocus = content.replace(FOCUS_PREFIX, "");
  return withoutFocus === content ? content : withoutFocus.replace(NOTICE_PREFIX, "");
}

// 원고가 바뀌었는지 비교하는 열쇠: 장 번호·제목·정규화한 문단(chaptersKey)과 편집 중인 소설 제목(양끝 공백 뺌).
export function manuscriptKey(chapters: MasterChapter[], title?: string): string {
  return `${chaptersKey(chapters)}\n${(title ?? "").trim()}`;
}

// 이전 전송이 없으면(첫 전송, 대화를 지운 직후) 비교할 옛 답변이 없으므로 수정으로 보지 않는다.
export function manuscriptEdited(previousKey: string | null, currentKey: string): boolean {
  return previousKey !== null && previousKey !== currentKey;
}

// 요청에 실을 기록을 한도 안으로 줄인다 — 오래된 것부터 버리고, 첫 메시지는 user여야 하므로 앞쪽 assistant는 더 버린다.
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const overLimit = kept.length >= CHAT_LIMITS.maxMessages || total + message.content.length > CHAT_LIMITS.maxTotalChars;
    if (overLimit && kept.length > 0) break;
    kept.unshift(message);
    total += message.content.length;
  }
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return kept;
}

export function encodeEvent(event: ChatEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function parseEvent(line: string): ChatEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return PARSE_ERROR;
  }
  const event = value as { t?: unknown; text?: unknown; message?: unknown } | null;
  switch (event?.t) {
    case "delta":
      return typeof event.text === "string" ? { t: "delta", text: event.text } : PARSE_ERROR;
    case "error":
      return typeof event.message === "string" ? { t: "error", message: event.message } : PARSE_ERROR;
    case "reset":
      return { t: "reset" };
    case "done":
      return { t: "done" };
    default:
      return PARSE_ERROR;
  }
}

// 네트워크 조각은 줄 중간에서 끊길 수 있으므로, 남은 조각을 보관했다가 완성된 줄에서만 이벤트를 낸다.
export function createEventParser(): (chunk: string) => ChatEvent[] {
  let rest = "";
  return (chunk) => {
    rest += chunk;
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    return lines.filter((line) => line.trim() !== "").map(parseEvent);
  };
}

// 답변 한 개의 글에 이벤트를 반영한다. reset은 폴백 모델이 처음부터 다시 쓰기 시작할 때 그때까지의 글을 버린다.
export function applyChatEvent(text: string, event: ChatEvent): string {
  if (event.t === "delta") return text + event.text;
  if (event.t === "reset") return "";
  return text;
}
