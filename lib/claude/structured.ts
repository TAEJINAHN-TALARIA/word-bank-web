import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { ChatEvent, ChatMessage } from "@/lib/chatProtocol";
import { buildChatMessages } from "./chatMessages";
import { ClaudeCallError } from "./callError";
import { callStructuredOpenAI, streamConversationOpenAI } from "./openai";

export { ClaudeCallError };

export const CLAUDE_REVIEW_MODEL = "claude-sonnet-5-5";

/**
 * 편집 AI 호출이 갈 곳. `REVIEW_PROVIDER=openai`일 때만 OpenAI이고 그 밖에는 Claude다.
 * 되돌릴 때는 환경변수를 지우고 재배포한다.
 */
export function reviewProvider(): "anthropic" | "openai" {
  return process.env.REVIEW_PROVIDER === "openai" ? "openai" : "anthropic";
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

function toCallError(err: unknown): ClaudeCallError {
  if (err instanceof ClaudeCallError) return err;
  if (err instanceof Anthropic.RateLimitError) return new ClaudeCallError("요청이 많아 잠시 뒤에 다시 시도해 주세요");
  if (err instanceof Anthropic.AuthenticationError) {
    return new ClaudeCallError("Anthropic API 인증에 실패했습니다 (ANTHROPIC_API_KEY 확인)");
  }
  if (err instanceof Anthropic.APIError) return new ClaudeCallError(`Claude API 오류 (${err.status})`);
  return new ClaudeCallError(err instanceof Error ? err.message : "Claude 호출 실패");
}

/**
 * 소설 본문(context)을 앞에 두고 캐시한다 — 같은 소설에 대한 요청이 반복되므로 본문 처리 비용이 한 번만 든다.
 * 정책상 거절에 대비해 서버 측 fallbacks를 켠다.
 */
export async function callStructured<T extends z.ZodType>(input: {
  schema: T;
  effort: "low" | "medium" | "high";
  system: string;
  context: string;
  task: string;
  // 사용량 로그에서 어느 호출인지 알아보는 이름.
  label?: string;
}): Promise<z.output<T>> {
  if (reviewProvider() === "openai") return callStructuredOpenAI(input);

  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: CLAUDE_REVIEW_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: input.system,
      output_config: { effort: input.effort, format: zodOutputFormat(input.schema) },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.context, cache_control: { type: "ephemeral" } },
            { type: "text", text: input.task },
          ],
        },
      ],
    });
  } catch (err) {
    throw toCallError(err);
  }

  // 토큰 수만 남긴다(본문·제목은 남기지 않는다). 호출별 입력량과 캐시 적중량을 Vercel 로그에서 비교한다.
  const { usage } = response;
  if (usage) {
    console.info("[editor-call] usage", {
      label: input.label,
      provider: "anthropic",
      effort: input.effort,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
    });
  }

  if (response.stop_reason === "refusal") throw new ClaudeCallError("Claude가 이 요청을 처리하지 못했습니다 (정책상 거절)");
  if (response.stop_reason === "max_tokens") throw new ClaudeCallError("응답이 길어 중간에 잘렸습니다. 요청 범위를 줄여 다시 시도해 주세요");
  if (!response.parsed_output) throw new ClaudeCallError("Claude 응답을 해석하지 못했습니다");
  return response.parsed_output as z.output<T>;
}

// 응답 한 번의 토큰 사용량(캐시 쓰기·읽기 포함). 효과 확인용 로그에만 쓴다.
export type ChatUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

// SDK 스트림 중 이 파일이 쓰는 부분만 적은 모양 — 테스트에서 가짜 클라이언트를 넣을 수 있게 한다.
export type ConversationClient = {
  beta: {
    messages: {
      stream(
        body: unknown,
        options?: { signal?: AbortSignal },
      ): AsyncIterable<unknown> & { finalMessage(): Promise<{ stop_reason: string | null; usage?: ChatUsage }> };
    };
  };
};

type StreamEvent = { type?: string; delta?: { type?: string; text?: string }; content_block?: { type?: string } };

/**
 * 대화 응답을 스트리밍으로 받아 화면에 보낼 이벤트로 바꾼다. 예외는 던지지 않고 마지막에 error 이벤트로 알린다.
 * 응답 도중 서버 측 폴백이 일어나면 `fallback` 블록이 끼어들고 앞의 글은 이미 나간 뒤라서, reset으로 화면이 버리게 한다.
 * 편집자가 중단(signal abort)해서 난 예외는 오류가 아니므로 조용히 끝낸다.
 */
export async function* streamConversation(
  input: {
    system: string;
    context: string;
    messages: ChatMessage[];
    effort: "low" | "medium" | "high";
    signal?: AbortSignal;
    // 응답이 끝났을 때 토큰 사용량을 받는다(캐시가 실제로 맞는지 확인하는 로그용).
    onUsage?: (usage: ChatUsage) => void;
  },
  client?: ConversationClient,
): AsyncGenerator<ChatEvent> {
  // 가짜 클라이언트를 직접 넘기는 것은 Claude 경로의 테스트뿐이다.
  if (!client && reviewProvider() === "openai") {
    yield* streamConversationOpenAI(input);
    return;
  }
  try {
    const conversation = client ?? (getClient() as unknown as ConversationClient);
    const stream = conversation.beta.messages.stream(
      {
        model: CLAUDE_REVIEW_MODEL,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: input.system,
        output_config: { effort: input.effort },
        messages: buildChatMessages(input.context, input.messages),
      },
      input.signal ? { signal: input.signal } : undefined,
    );

    for await (const raw of stream) {
      const event = raw as StreamEvent;
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        yield { t: "delta", text: event.delta.text ?? "" };
      } else if (event.type === "content_block_start" && event.content_block?.type === "fallback") {
        yield { t: "reset" };
      }
    }

    const { stop_reason, usage } = await stream.finalMessage();
    if (usage) input.onUsage?.(usage);
    if (stop_reason === "refusal") {
      yield { t: "error", message: "Claude가 이 요청을 처리하지 못했습니다 (정책상 거절)" };
    } else if (stop_reason === "max_tokens") {
      yield { t: "error", message: "응답이 길어 중간에 잘렸습니다. 요청 범위를 줄여 다시 시도해 주세요" };
    } else {
      yield { t: "done" };
    }
  } catch (err) {
    if (input.signal?.aborted) return;
    yield { t: "error", message: toCallError(err).message };
  }
}
