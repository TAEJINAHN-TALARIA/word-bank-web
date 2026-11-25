import "server-only";
import { z } from "zod";
import { ClaudeCallError } from "./callError";
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

function httpError(status: number): ClaudeCallError {
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
    if (!res.ok) throw httpError(res.status);
    body = (await res.json()) as ResponsesBody;
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
