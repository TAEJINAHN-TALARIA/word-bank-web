import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const CLAUDE_REVIEW_MODEL = "claude-sonnet-5-5";

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** 화면에 그대로 보여줘도 되는 메시지를 가진 오류. */
export class ClaudeCallError extends Error {}

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
}): Promise<z.output<T>> {
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

  if (response.stop_reason === "refusal") throw new ClaudeCallError("Claude가 이 요청을 처리하지 못했습니다 (정책상 거절)");
  if (response.stop_reason === "max_tokens") throw new ClaudeCallError("응답이 길어 중간에 잘렸습니다. 요청 범위를 줄여 다시 시도해 주세요");
  if (!response.parsed_output) throw new ClaudeCallError("Claude 응답을 해석하지 못했습니다");
  return response.parsed_output as z.output<T>;
}
