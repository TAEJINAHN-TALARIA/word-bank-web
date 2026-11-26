import "server-only";
import { z } from "zod";
import { ClaudeCallError } from "./callError";
import type { ChatEvent, ChatMessage } from "@/lib/chatProtocol";
import type { ChatUsage } from "./structured";

export const OPENAI_REVIEW_MODEL = "gpt-6.1-terra";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const TRUNCATED = "응답이 길어 중간에 잘렸습니다. 요청 범위를 줄여 다시 시도해 주세요";
const REFUSED = "AI가 이 요청을 처리하지 못했습니다 (정책상 거절)";

type OpenAIUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
};

/** OpenAI 사용량을 Claude 쪽 `ChatUsage` 모양으로 바꾼다. 입력 토큰은 캐시 읽기·쓰기를 뺀 값이다. */
export function openAIUsageToChatUsage(usage: unknown): ChatUsage {
  const u = (usage ?? {}) as OpenAIUsage;
  const read = u.input_tokens_details?.cached_tokens ?? 0;
  const written = u.input_tokens_details?.cache_write_tokens ?? 0;
  return {
    input_tokens: (u.input_tokens ?? 0) - read - written,
    output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: written,
    cache_read_input_tokens: read,
  };
}

/**
 * 변하지 않는 소설 본문을 맨 앞에 두고 그 끝에만 명시 캐시 브레이크포인트를 건다. 지시문·과제는 그 뒤(캐시에 쓰이지 않는다).
 */
export function buildOpenAIInput(context: string, system: string, rest: unknown[]) {
  return [
    { role: "developer", content: [{ type: "input_text", text: context, prompt_cache_breakpoint: { mode: "explicit" } }] },
    { role: "developer", content: system },
    ...rest,
  ];
}

function requireKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ClaudeCallError("OpenAI API 키가 없습니다 (OPENAI_API_KEY 확인)");
  return key;
}

const MAX_LOGGED_BODY = 500;

/**
 * HTTP 오류를 한국어 오류로 바꾼다. 요청 형식 문제(스키마·필드·모델 이름)는 응답 본문에만 이유가 있어서 앞부분을 서버 로그에 남긴다.
 * 오류 본문에는 요청 내용(소설 본문)이 없고, 키는 헤더에만 있다. 본문을 읽지 못해도 원래 오류는 그대로 던진다.
 */
async function httpError(res: { status: number; text?: () => Promise<string> }): Promise<ClaudeCallError> {
  const status = res.status;
  const detail = await res.text?.().catch(() => "");
  console.error("[editor-call] openai http error", { status, detail: (detail ?? "").slice(0, MAX_LOGGED_BODY) });
  if (status === 429) return new ClaudeCallError("요청이 많아 잠시 뒤에 다시 시도해 주세요");
  if (status === 401) return new ClaudeCallError("OpenAI API 인증에 실패했습니다 (OPENAI_API_KEY 확인)");
  return new ClaudeCallError(`OpenAI API 오류 (${status})`);
}

type ResponsesBody = {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
  usage?: OpenAIUsage;
};

/** 구조화 응답 한 번을 부른다. Claude 쪽 `callStructured`와 같은 입력·같은 오류 규칙. */
export async function callStructuredOpenAI<T extends z.ZodType>(
  input: {
    schema: T;
    effort: "low" | "medium" | "high";
    system: string;
    context: string;
    task: string;
    label?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<z.output<T>> {
  const key = requireKey();
  const jsonSchema = z.toJSONSchema(input.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;

  let body: ResponsesBody;
  try {
    const res = await fetchImpl(RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: OPENAI_REVIEW_MODEL,
        max_output_tokens: 16000,
        reasoning: { effort: input.effort },
        prompt_cache_options: { mode: "explicit" },
        input: buildOpenAIInput(input.context, input.system, [{ role: "user", content: input.task }]),
        text: { format: { type: "json_schema", name: "result", schema: jsonSchema, strict: true } },
      }),
    });
    if (!res.ok) throw await httpError(res);
    body =(await res.json()) as ResponsesBody;
  } catch (err) {
    throw err instanceof ClaudeCallError ? err : new ClaudeCallError(err instanceof Error ? err.message : "OpenAI 호출 실패");
  }

  if (body.usage) {
    console.info("[editor-call] usage", {
      label: input.label,
      provider: "openai",
      effort: input.effort,
      ...openAIUsageToChatUsage(body.usage),
    });
  }

  if (body.status === "incomplete") {
    throw new ClaudeCallError(body.incomplete_details?.reason === "max_output_tokens" ? TRUNCATED : "AI 응답이 완료되지 못했습니다");
  }
  const parts = (body.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
  if (parts.some((p) => p.type === "refusal")) throw new ClaudeCallError(REFUSED);
  const text = parts.find((p) => p.type === "output_text")?.text;
  try {
    return input.schema.parse(JSON.parse(text ?? ""));
  } catch {
    throw new ClaudeCallError("AI 응답을 해석하지 못했습니다");
  }
}

type StreamEvent = {
  type?: string;
  delta?: string;
  message?: string;
  response?: { usage?: OpenAIUsage; incomplete_details?: { reason?: string }; error?: { message?: string } };
};

/** SSE 한 덩어리(`event:`·`data:` 줄들)에서 data 줄을 모아 JSON으로 읽는다. 읽을 수 없으면 null. */
function parseSseBlock(block: string): StreamEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as StreamEvent;
  } catch {
    return null;
  }
}

/**
 * 대화 응답을 스트리밍으로 받아 화면에 보낼 이벤트로 바꾼다. Claude 쪽 `streamConversation`과 같은 규칙:
 * 예외는 던지지 않고 마지막에 error 이벤트로 알리고, 편집자가 중단(signal abort)한 것은 오류가 아니므로 조용히 끝낸다.
 * 서버 측 폴백이 없어서 reset 이벤트는 내지 않는다.
 */
export async function* streamConversationOpenAI(
  input: {
    system: string;
    context: string;
    messages: ChatMessage[];
    effort: "low" | "medium" | "high";
    signal?: AbortSignal;
    onUsage?: (usage: ChatUsage) => void;
  },
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<ChatEvent> {
  try {
    const key = requireKey();
    const history = input.messages.map((m) =>
      m.role === "assistant" ? { role: "assistant", content: [{ type: "output_text", text: m.content }] } : { role: "user", content: m.content },
    );
    const res = await fetchImpl(RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: OPENAI_REVIEW_MODEL,
        stream: true,
        max_output_tokens: 8000,
        reasoning: { effort: input.effort },
        prompt_cache_options: { mode: "explicit" },
        input: buildOpenAIInput(input.context, input.system, history),
      }),
      signal: input.signal,
    });
    if (!res.ok) throw await httpError(res);
    if (!res.body) throw new ClaudeCallError("AI 응답을 받지 못했습니다");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let refused = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const event = parseSseBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (!event) continue;

        if (event.type === "response.output_text.delta") {
          yield { t: "delta", text: event.delta ?? "" };
        } else if (event.type === "response.refusal.delta") {
          refused = true;
        } else if (event.type === "response.completed") {
          if (event.response?.usage) input.onUsage?.(openAIUsageToChatUsage(event.response.usage));
          yield refused ? { t: "error", message: REFUSED } : { t: "done" };
          return;
        } else if (event.type === "response.incomplete") {
          const truncated = event.response?.incomplete_details?.reason === "max_output_tokens";
          yield { t: "error", message: truncated ? TRUNCATED : "AI 응답이 완료되지 못했습니다" };
          return;
        } else if (event.type === "response.failed" || event.type === "error") {
          // 상세 사유는 서버 로그에만 남기고 화면에는 고정 문구를 보인다.
          console.error("[editor-chat] openai stream error", event.response?.error?.message ?? event.message);
          yield { t: "error", message: "AI 응답을 만들지 못했습니다. 잠시 뒤에 다시 시도해 주세요" };
          return;
        }
      }
    }
    // 완료 이벤트 없이 끝난 스트림은 중간에 끊긴 것이다.
    yield { t: "error", message: refused ? REFUSED : "AI 응답이 중간에 끊겼습니다. 다시 시도해 주세요" };
  } catch (err) {
    if (input.signal?.aborted) return;
    yield { t: "error", message: err instanceof ClaudeCallError ? err.message : err instanceof Error ? err.message : "OpenAI 호출 실패" };
  }
}
