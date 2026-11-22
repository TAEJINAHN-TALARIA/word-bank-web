// 편집 화면 Claude 대화 — 요청 검증(parseChatRequest)과 스트리밍 호출(streamChat).
import "server-only";
import { CHAT_LIMITS, type ChatEvent, type ChatLimit, type ChatMessage } from "@/lib/chatProtocol";
import { isValidChaptersInput, MAX_TITLE_CHARS, type MasterChapter } from "@/lib/masterReview";
import { buildChatSystemPrompt, buildStoryContext } from "./editing";
import type { EditorContextInput } from "./editor";
import { streamConversation } from "./structured";

export type ChatRequest = {
  mode: "review" | "published";
  id: string;
  chapters: MasterChapter[];
  messages: ChatMessage[];
  // 편집 중인 소설 제목. 저장된 제목보다 이 값을 Claude에게 보여 준다(검토 모드에서만 보낸다).
  title?: string;
  // 문단 중심으로 읽을 문단 위치. 없으면 원고 전체를 읽는다.
  limitTo?: ChatLimit;
};

const INVALID = { ok: false, error: "요청 형식이 올바르지 않습니다" } as const;

function parseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > CHAT_LIMITS.maxMessages) return null;
  const messages: ChatMessage[] = [];
  let total = 0;
  for (const item of raw) {
    const role = item?.role;
    const content = item?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    // 글자 수 한도는 편집자가 쓴 메시지에만 건다. Claude 답변은 max_tokens까지 길어질 수 있어 합계 한도로만 제한한다
    // (답변에도 걸면 긴 답변 한 번에 이후 모든 전송이 막힌다).
    if (!content.trim() || (role === "user" && content.length > CHAT_LIMITS.maxMessageChars)) return null;
    total += content.length;
    messages.push({ role, content });
  }
  if (total > CHAT_LIMITS.maxTotalChars) return null;
  // 첫 메시지는 user(본문과 함께 캐시되는 자리), 마지막도 user(답할 질문)여야 한다.
  if (messages[0].role !== "user" || messages[messages.length - 1].role !== "user") return null;
  return messages;
}

export function parseChatRequest(body: unknown): { ok: true; value: ChatRequest } | { ok: false; error: string } {
  const input = body as { mode?: unknown; id?: unknown; chapters?: unknown; messages?: unknown; title?: unknown; limitTo?: unknown } | null;
  if (!input || typeof input !== "object") return INVALID;
  if (input.mode !== "review" && input.mode !== "published") return INVALID;
  if (typeof input.id !== "string" || !input.id) return INVALID;
  if (!isValidChaptersInput(input.chapters)) return INVALID;
  const messages = parseMessages(input.messages);
  if (!messages) return { ok: false, error: "대화 내용이 올바르지 않거나 너무 깁니다" };
  let title: string | undefined;
  if (input.title !== undefined) {
    title = typeof input.title === "string" ? input.title.trim() : undefined;
    if (!title || title.length > MAX_TITLE_CHARS) return INVALID;
  }
  let limitTo: ChatLimit | undefined;
  if (input.limitTo !== undefined) {
    const raw = input.limitTo as { chapterNumber?: unknown; paragraphIndex?: unknown } | null;
    const { chapterNumber, paragraphIndex } = raw ?? {};
    if (typeof chapterNumber !== "number" || !Number.isInteger(chapterNumber) || chapterNumber < 1) return INVALID;
    if (typeof paragraphIndex !== "number" || !Number.isInteger(paragraphIndex) || paragraphIndex < 0) return INVALID;
    limitTo = { chapterNumber, paragraphIndex };
  }
  return {
    ok: true,
    value: { mode: input.mode, id: input.id, chapters: input.chapters, messages, ...(title !== undefined && { title }), ...(limitTo && { limitTo }) },
  };
}

// 편집 중인 현재 본문(limitTo가 있으면 그 문단과 앞뒤만, 없으면 전체)과 대화 기록으로 Claude에게 답을 스트리밍으로 받는다. 본문은 바꾸지 않는다.
export function streamChat(
  input: EditorContextInput & { mode: "review" | "published"; messages: ChatMessage[]; limitTo?: ChatLimit; signal?: AbortSignal },
): AsyncGenerator<ChatEvent> {
  return streamConversation({
    system: buildChatSystemPrompt(input.mode),
    context: buildStoryContext(input, input.limitTo),
    messages: input.messages,
    effort: "medium",
    signal: input.signal,
    // 토큰 수만 남긴다(본문·제목은 남기지 않는다). 범위별 입력량과 캐시 적중량을 Vercel 로그에서 비교한다.
    onUsage: (usage) => console.info("[editor-chat] usage", { scope: input.limitTo ? "paragraph" : "full", ...usage }),
  });
}
