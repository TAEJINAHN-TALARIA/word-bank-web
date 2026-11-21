import { describe, it, expect } from "vitest";
import { buildChatMessages } from "./chatMessages";
import type { ChatMessage } from "@/lib/chatProtocol";

describe("buildChatMessages", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "[지금 보는 곳: 1장 1문단]\n첫 질문" },
    { role: "assistant", content: "첫 답" },
    { role: "user", content: "[지금 보는 곳: 1장 2문단]\n둘째 질문" },
  ];

  it("소설 본문을 첫 user 메시지의 앞 블록에 캐시 표시와 함께 두고, 그 뒤에 첫 질문을 잇는다", () => {
    const [first] = buildChatMessages("[소설 본문]\n…", messages);
    expect(first).toEqual({
      role: "user",
      content: [
        { type: "text", text: "[소설 본문]\n…", cache_control: { type: "ephemeral" } },
        { type: "text", text: messages[0].content },
      ],
    });
  });

  it("둘째 메시지부터는 입력 그대로 넘긴다", () => {
    expect(buildChatMessages("ctx", messages).slice(1)).toEqual(messages.slice(1));
  });

  it("입력 배열을 바꾸지 않는다", () => {
    const copy = structuredClone(messages);
    buildChatMessages("ctx", messages);
    expect(messages).toEqual(copy);
  });
});
