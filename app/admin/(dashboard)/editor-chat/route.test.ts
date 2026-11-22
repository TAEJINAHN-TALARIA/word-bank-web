import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getAdminSession: vi.fn() }));
vi.mock("@/lib/claude/editorContext", () => ({ loadEditorContext: vi.fn() }));
vi.mock("@/lib/claude/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude/chat")>()),
  streamChat: vi.fn(),
}));

import { POST, maxDuration } from "./route";
import { getAdminSession } from "@/lib/auth/session";
import { loadEditorContext } from "@/lib/claude/editorContext";
import { streamChat } from "@/lib/claude/chat";
import { encodeEvent, type ChatEvent } from "@/lib/chatProtocol";

const chapters = [{ chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["하린은 문을 열었다."] }];
const validBody = {
  mode: "review",
  id: "session-1",
  chapters,
  messages: [{ role: "user", content: "[지금 보는 곳: 1장 1문단]\n이 문단 어때?" }],
};
const context = { title: "제목", level: "Lv3", chapters, characters: [], narrativeStyle: null, levelGuidance: null };

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/admin/editor-chat", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function events(...list: ChatEvent[]): AsyncGenerator<ChatEvent> {
  return (async function* () {
    yield* list;
  })();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdminSession).mockResolvedValue({ uid: "admin1" });
  vi.mocked(loadEditorContext).mockResolvedValue(context);
});

describe("POST /admin/editor-chat", () => {
  it("실행 시간 상한은 Vercel Hobby+Fluid의 최대치인 300초다", () => {
    expect(maxDuration).toBe(300);
  });

  it("로그인이 없으면 401이고 Claude를 부르지 않는다", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null);
    const res = await post(validBody);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "관리자 로그인이 필요합니다" });
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("본문이 JSON이 아니면 400이다", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "요청 형식이 올바르지 않습니다" });
  });

  it("검증에 실패한 요청은 400이고 Claude를 부르지 않는다", async () => {
    const res = await post({ ...validBody, messages: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toBe("");
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("소설을 찾을 수 없으면 404다", async () => {
    vi.mocked(loadEditorContext).mockResolvedValue({ error: "소설을 찾을 수 없습니다" });
    const res = await post(validBody);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "소설을 찾을 수 없습니다" });
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("소설을 읽다 예외가 나면 500 JSON 오류다", async () => {
    vi.mocked(loadEditorContext).mockRejectedValue(new Error("firestore down"));
    const res = await post(validBody);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "대화를 시작하지 못했습니다" });
  });

  it("정상 요청은 이벤트를 NDJSON 줄로 흘려보낸다", async () => {
    const list: ChatEvent[] = [{ t: "delta", text: "가" }, { t: "delta", text: "나" }, { t: "done" }];
    vi.mocked(streamChat).mockReturnValue(events(...list));

    const res = await post(validBody);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(await res.text()).toBe(list.map(encodeEvent).join(""));
    const input = vi.mocked(streamChat).mock.calls[0][0];
    expect(input).toMatchObject({ ...context, mode: "review", messages: validBody.messages });
  });

  it("limitTo가 있으면 streamChat에 넘기고, 올바르지 않으면 400이다", async () => {
    vi.mocked(streamChat).mockReturnValue(events({ t: "done" }));
    const limitTo = { chapterNumber: 1, paragraphIndex: 0 };
    await (await post({ ...validBody, limitTo })).text();
    expect(vi.mocked(streamChat).mock.calls[0][0]).toMatchObject({ limitTo });

    vi.mocked(streamChat).mockClear();
    const bad = await post({ ...validBody, limitTo: { chapterNumber: 0, paragraphIndex: 0 } });
    expect(bad.status).toBe(400);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("limitTo가 없으면 streamChat 입력에도 limitTo가 없다", async () => {
    vi.mocked(streamChat).mockReturnValue(events({ t: "done" }));
    await (await post(validBody)).text();
    expect("limitTo" in vi.mocked(streamChat).mock.calls[0][0]).toBe(false);
  });

  it("응답을 끊으면(취소) Claude 호출에 넘긴 signal이 abort된다", async () => {
    vi.mocked(streamChat).mockReturnValue(
      (async function* () {
        yield { t: "delta", text: "가" } as ChatEvent;
        await new Promise(() => {}); // 끊길 때까지 응답이 이어지는 상황
      })(),
    );

    const res = await post(validBody);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    expect(vi.mocked(streamChat).mock.calls[0][0].signal?.aborted).toBe(true);
  });
});
