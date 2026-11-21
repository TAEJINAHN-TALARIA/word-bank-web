import { describe, it, expect } from "vitest";
import { readChatError, readChatStream } from "./chatClient";
import { encodeEvent, type ChatEvent } from "./chatProtocol";

const encoder = new TextEncoder();

// 주어진 바이트 조각들을 차례로 내보내는 스트리밍 응답.
function streamOf(...chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  );
}

async function read(response: Response): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await readChatStream(response, (event) => events.push(event));
  return events;
}

describe("readChatStream", () => {
  it("이벤트 줄을 순서대로 onEvent에 넘긴다", async () => {
    const list: ChatEvent[] = [{ t: "delta", text: "가" }, { t: "reset" }, { t: "done" }];
    expect(await read(streamOf(encoder.encode(list.map(encodeEvent).join(""))))).toEqual(list);
  });

  it("조각이 한글 한 글자의 바이트 중간에서 잘려도 글자가 깨지지 않는다", async () => {
    const bytes = encoder.encode(encodeEvent({ t: "delta", text: "한글" }));
    const prefix = encoder.encode('{"t":"delta","text":"').length;
    const cut = prefix + 1; // "한"(3바이트)의 첫 바이트만 앞 조각에 들어간다
    const events = await read(streamOf(bytes.slice(0, cut), bytes.slice(cut)));
    expect(events).toEqual([{ t: "delta", text: "한글" }]);
  });

  it("JSON 줄 중간에서 잘린 조각도 완성된 줄에서만 이벤트가 된다", async () => {
    const bytes = encoder.encode(encodeEvent({ t: "delta", text: "가나" }));
    const events = await read(streamOf(bytes.slice(0, 8), bytes.slice(8)));
    expect(events).toEqual([{ t: "delta", text: "가나" }]);
  });
});

describe("readChatError", () => {
  it("서버가 보낸 JSON 오류 문구를 그대로 쓴다", async () => {
    const response = Response.json({ error: "소설을 찾을 수 없습니다" }, { status: 404 });
    expect(await readChatError(response)).toBe("소설을 찾을 수 없습니다");
  });

  it("JSON이 아닌 오류 본문(HTML 등)이면 상태 코드로 한 줄 안내한다", async () => {
    const response = new Response("<html><body>Gateway Timeout</body></html>", { status: 504 });
    expect(await readChatError(response)).toBe("요청에 실패했습니다 (504)");
  });

  it("본문이 비어 있어도 상태 코드로 안내한다", async () => {
    expect(await readChatError(new Response(null, { status: 500 }))).toBe("요청에 실패했습니다 (500)");
  });
});
