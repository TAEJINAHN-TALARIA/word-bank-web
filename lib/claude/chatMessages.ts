// 대화 요청을 Claude API 메시지로 조립하는 순수 로직. structured.ts가 쓰므로 chat.ts와 분리해 둔다(순환 import 방지).
import type { ChatMessage } from "@/lib/chatProtocol";

export type ChatApiMessage = {
  role: "user" | "assistant";
  content: string | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];
};

/**
 * 소설 본문(context)을 첫 user 메시지의 앞 블록에 두고 캐시한다 — 대화가 이어져도 본문 처리 비용은 한 번만 든다.
 * "지금 보는 곳" 줄은 각 메시지에 이미 박혀 있어서, 이전 대화는 매 요청 같은 모양으로 이어진다.
 */
export function buildChatMessages(context: string, messages: ChatMessage[]): ChatApiMessage[] {
  return messages.map((message, i) =>
    i === 0
      ? {
          role: message.role,
          content: [
            { type: "text", text: context, cache_control: { type: "ephemeral" } },
            { type: "text", text: message.content },
          ],
        }
      : { role: message.role, content: message.content },
  );
}
