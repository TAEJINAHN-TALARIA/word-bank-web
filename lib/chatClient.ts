// 편집 화면 대화 응답을 브라우저에서 읽는 로직. fetch 응답(Response)만 다루므로 node에서도 테스트할 수 있다.
import { createEventParser, type ChatEvent } from "./chatProtocol";

// NDJSON 스트림을 읽으면서 완성된 이벤트마다 onEvent를 부른다.
export async function readChatStream(response: Response, onEvent: (event: ChatEvent) => void): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const feed = createEventParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // stream: true — 한글 한 글자(3바이트)가 조각 경계에서 잘려도 다음 조각과 이어 해석한다.
    for (const event of feed(decoder.decode(value, { stream: true }))) onEvent(event);
  }
  const rest = decoder.decode();
  if (rest) for (const event of feed(rest)) onEvent(event);
}

// 스트림이 시작되기 전의 오류 응답에서 화면에 보여줄 문구를 꺼낸다. JSON이 아닌 본문(게이트웨이 HTML 등)은 상태 코드로 안내한다.
export async function readChatError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.error === "string" && data.error) return data.error;
  } catch {
    // JSON이 아니면 아래의 기본 문구를 쓴다.
  }
  return `요청에 실패했습니다 (${response.status})`;
}
