import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/session";
import { parseChatRequest, streamChat } from "@/lib/claude/chat";
import { loadEditorContext } from "@/lib/claude/editorContext";
import { encodeEvent } from "@/lib/chatProtocol";

// 대화는 원고 전체를 읽고 답하므로 오래 걸릴 수 있다. 300초는 Vercel Hobby(Fluid Compute)의 최대치다.
export const maxDuration = 300;

// Route Handler는 (dashboard) 레이아웃의 로그인 게이트를 타지 않으므로 직접 세션을 확인한다.
export async function POST(request: Request) {
  if (!(await getAdminSession())) {
    return NextResponse.json({ error: "관리자 로그인이 필요합니다" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다" }, { status: 400 });
  }

  const parsed = parseChatRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { mode, id, chapters, messages } = parsed.value;

  let context;
  try {
    context = await loadEditorContext({ mode, id, chapters });
  } catch (err) {
    console.error("[editor-chat]", err);
    return NextResponse.json({ error: "대화를 시작하지 못했습니다" }, { status: 500 });
  }
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: 404 });

  // 화면이 응답을 끊거나(멈추기·창 닫기) 연결이 끊기면 Claude 호출도 함께 중단한다.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const events = streamChat({ ...context, mode, messages, signal: abort.signal });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(encodeEvent(value)));
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
