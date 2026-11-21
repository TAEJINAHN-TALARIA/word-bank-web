import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session");
vi.mock("@/lib/firebase/admin");

import { savePublishedDraftAction, discardPublishedDraftAction } from "./publishedDraftActions";
import * as session from "@/lib/auth/session";
import * as admin from "@/lib/firebase/admin";

const LOGIN_REQUIRED = { error: "관리자 로그인이 필요합니다" };

// "컬렉션/id" 키로 문서를 두는 가짜 Firestore. set/delete 호출을 기록한다.
function fakeDb(existing: Record<string, unknown>) {
  const set = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockResolvedValue(undefined);
  const db = {
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: `${c}/${id}` in existing, data: () => existing[`${c}/${id}`] }),
        set: (data: unknown) => set(`${c}/${id}`, data),
        delete: () => del(`${c}/${id}`),
      }),
    }),
  };
  vi.mocked(admin.getAdminFirestore).mockReturnValue(db as never);
  return { set, del };
}

const published = { "stories/d1": { lang: "ko" }, "storyContent/d1": { chapters: [] } };
const edits = [{ num: 2, paragraphs: ["고친 문단"] }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(session.getAdminSession).mockResolvedValue({ uid: "admin1" });
});

describe("savePublishedDraftAction", () => {
  it("세션이 없으면 거절하고 DB를 건드리지 않는다", async () => {
    vi.mocked(session.getAdminSession).mockResolvedValue(null);
    const { set } = fakeDb(published);
    expect(await savePublishedDraftAction({ docId: "d1", edits, baseContentVersion: 1 })).toEqual(LOGIN_REQUIRED);
    expect(set).not.toHaveBeenCalled();
    expect(admin.getAdminFirestore).not.toHaveBeenCalled();
  });

  it("잘못된 입력은 거절한다(edits 모양, 버전, docId)", async () => {
    const { set } = fakeDb(published);
    const bad = [
      { docId: "d1", edits: [{ num: 1.5, paragraphs: ["x"] }], baseContentVersion: 1 },
      { docId: "d1", edits, baseContentVersion: -1 },
      { docId: "d1", edits, baseContentVersion: 1.5 },
      { docId: "", edits, baseContentVersion: 1 },
      { docId: "a/b", edits, baseContentVersion: 1 },
    ];
    for (const input of bad) expect(await savePublishedDraftAction(input as never)).toHaveProperty("error");
    expect(set).not.toHaveBeenCalled();
  });

  it("게시된 소설이 없거나 한국어가 아니면 거절한다", async () => {
    const missing = fakeDb({});
    expect(await savePublishedDraftAction({ docId: "d1", edits, baseContentVersion: 1 })).toEqual({
      error: "게시된 한국어 소설을 찾을 수 없습니다",
    });
    expect(missing.set).not.toHaveBeenCalled();

    const english = fakeDb({ "stories/d1": { lang: "en" }, "storyContent/d1": { chapters: [] } });
    expect(await savePublishedDraftAction({ docId: "d1", edits, baseContentVersion: 1 })).toEqual({
      error: "게시된 한국어 소설을 찾을 수 없습니다",
    });
    expect(english.set).not.toHaveBeenCalled();
  });

  it("정상이면 publishedDrafts/{docId}에 초안을 저장한다", async () => {
    const { set } = fakeDb(published);
    expect(await savePublishedDraftAction({ docId: "d1", edits, baseContentVersion: 4 })).toEqual({});
    expect(set).toHaveBeenCalledWith("publishedDrafts/d1", { edits, baseContentVersion: 4, updatedAt: expect.any(Date) });
  });

  it("고친 곳이 하나도 없으면(모두 되돌림) 초안을 지운다", async () => {
    const { set, del } = fakeDb(published);
    expect(await savePublishedDraftAction({ docId: "d1", edits: [], baseContentVersion: 4 })).toEqual({});
    expect(set).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith("publishedDrafts/d1");
  });

  it("DB 오류는 메시지를 error로 돌려준다", async () => {
    const { set } = fakeDb(published);
    set.mockRejectedValueOnce(new Error("쓰기 실패"));
    expect(await savePublishedDraftAction({ docId: "d1", edits, baseContentVersion: 1 })).toEqual({ error: "쓰기 실패" });
  });
});

describe("discardPublishedDraftAction", () => {
  it("세션이 없으면 거절한다", async () => {
    vi.mocked(session.getAdminSession).mockResolvedValue(null);
    const { del } = fakeDb(published);
    expect(await discardPublishedDraftAction("d1")).toEqual(LOGIN_REQUIRED);
    expect(del).not.toHaveBeenCalled();
  });

  it("초안 문서를 지운다", async () => {
    const { del } = fakeDb(published);
    expect(await discardPublishedDraftAction("d1")).toEqual({});
    expect(del).toHaveBeenCalledWith("publishedDrafts/d1");
  });

  it("잘못된 docId는 거절한다", async () => {
    const { del } = fakeDb(published);
    expect(await discardPublishedDraftAction("a/b")).toHaveProperty("error");
    expect(del).not.toHaveBeenCalled();
  });

  it("DB 오류는 메시지를 error로 돌려준다", async () => {
    const { del } = fakeDb(published);
    del.mockRejectedValueOnce(new Error("삭제 실패"));
    expect(await discardPublishedDraftAction("d1")).toEqual({ error: "삭제 실패" });
  });
});
