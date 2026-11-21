// 편집 화면 Claude 대화의 요청 검증. 스트리밍 호출은 같은 파일의 streamChat이 맡는다.
import { CHAT_LIMITS, type ChatMessage } from "@/lib/chatProtocol";
import { isValidChaptersInput, type MasterChapter } from "@/lib/masterReview";

export type ChatRequest = {
  mode: "review" | "published";
  id: string;
  chapters: MasterChapter[];
  messages: ChatMessage[];
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
    if (!content.trim() || content.length > CHAT_LIMITS.maxMessageChars) return null;
    total += content.length;
    messages.push({ role, content });
  }
  if (total > CHAT_LIMITS.maxTotalChars) return null;
  // 첫 메시지는 user(본문과 함께 캐시되는 자리), 마지막도 user(답할 질문)여야 한다.
  if (messages[0].role !== "user" || messages[messages.length - 1].role !== "user") return null;
  return messages;
}

export function parseChatRequest(body: unknown): { ok: true; value: ChatRequest } | { ok: false; error: string } {
  const input = body as { mode?: unknown; id?: unknown; chapters?: unknown; messages?: unknown } | null;
  if (!input || typeof input !== "object") return INVALID;
  if (input.mode !== "review" && input.mode !== "published") return INVALID;
  if (typeof input.id !== "string" || !input.id) return INVALID;
  if (!isValidChaptersInput(input.chapters)) return INVALID;
  const messages = parseMessages(input.messages);
  if (!messages) return { ok: false, error: "대화 내용이 올바르지 않거나 너무 깁니다" };
  return { ok: true, value: { mode: input.mode, id: input.id, chapters: input.chapters, messages } };
}
