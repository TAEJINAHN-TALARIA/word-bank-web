import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session");
vi.mock("@/lib/admin-functions/storyGenerator");
vi.mock("@/lib/data/masterReviews");
vi.mock("@/lib/claude/editor");
vi.mock("@/lib/firebase/admin");
vi.mock("next/cache");

import {
  saveMasterReviewAction,
  approveMasterReviewAction,
  editPublishedStoryAction,
  suggestIdeasAction,
  suggestStructureAction,
  polishParagraphAction,
  reviewStoryAction,
  ensurePreReviewAction,
  evaluateMasterAction,
} from "./masterReviewActions";
import * as session from "@/lib/auth/session";
import * as generator from "@/lib/admin-functions/storyGenerator";
import * as reviews from "@/lib/data/masterReviews";
import * as editor from "@/lib/claude/editor";
import * as admin from "@/lib/firebase/admin";
import * as cache from "next/cache";
import type { EditorDetail, MasterChapter } from "@/lib/masterReview";

const mockSession = vi.mocked(session.getAdminSession);
const chapters: MasterChapter[] = [{ chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["하린은 문을 열었다."] }];

function detail(overrides: Partial<EditorDetail> = {}): EditorDetail {
  return {
    mode: "review", id: "s1", title: "제목", level: "Lv3", executionPath: "batch", chapters, original: chapters,
    characters: [{ name: "하린", speechStyle: "합쇼체" }], narrativeStyle: "-했다체",
    levelGuidance: { sentenceLen: 30, unit: "자", stageLabel: "중학생" }, confirmedChapters: [], gateNote: null, preReview: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ uid: "admin1" });
});

describe("관리자 세션 재확인", () => {
  it("세션이 없으면 모든 액션이 에러를 반환하고 아무 것도 호출하지 않는다", async () => {
    mockSession.mockResolvedValue(null);
    const expected = { error: "관리자 로그인이 필요합니다" };

    expect(await saveMasterReviewAction({ sessionId: "s1", edits: [], confirmedChapters: [] })).toEqual(expected);
    expect(await approveMasterReviewAction("s1")).toEqual(expected);
    expect(await editPublishedStoryAction({ docId: "d1", edits: [] })).toEqual(expected);
    expect(await suggestIdeasAction({ mode: "review", id: "s1", chapters, chapterNumber: 1, paragraphIndex: 0 })).toEqual(expected);
    expect(await polishParagraphAction({ mode: "review", id: "s1", chapters, chapterNumber: 1, paragraphIndex: 0 })).toEqual(expected);
    expect(await suggestStructureAction({ mode: "review", id: "s1", chapters, chapterNumber: 1 })).toEqual(expected);
    expect(await reviewStoryAction({ mode: "review", id: "s1", chapters, kind: "flow" })).toEqual(expected);
    expect(await ensurePreReviewAction("s1")).toEqual(expected);
    expect(await evaluateMasterAction({ sessionId: "s1", chapters })).toEqual(expected);

    expect(generator.saveMasterReview).not.toHaveBeenCalled();
    expect(generator.evaluateMaster).not.toHaveBeenCalled();
    expect(generator.approveMasterReview).not.toHaveBeenCalled();
    expect(editor.suggestIdeas).not.toHaveBeenCalled();
    expect(editor.polishParagraph).not.toHaveBeenCalled();
  });
});

describe("saveMasterReviewAction", () => {
  it("저장 후 편집 목록을 revalidate한다", async () => {
    expect(await saveMasterReviewAction({ sessionId: "s1", edits: [], confirmedChapters: [1] })).toEqual({});
    expect(generator.saveMasterReview).toHaveBeenCalledWith("s1", [], [1]);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/admin/edit");
  });

  it("제목을 함께 저장하면 함수에 title을 넘긴다", async () => {
    expect(await saveMasterReviewAction({ sessionId: "s1", edits: [], confirmedChapters: [1], title: "새 제목" })).toEqual({});
    expect(generator.saveMasterReview).toHaveBeenCalledWith("s1", [], [1], "새 제목");
  });

  it("빈 제목이면 함수를 부르지 않고 error를 돌려준다", async () => {
    expect(await saveMasterReviewAction({ sessionId: "s1", edits: [], confirmedChapters: [], title: "  " })).toEqual({
      error: "소설 제목이 비어 있어요",
    });
    expect(generator.saveMasterReview).not.toHaveBeenCalled();
  });

  it("함수 호출이 실패하면 메시지를 error로 돌려준다", async () => {
    vi.mocked(generator.saveMasterReview).mockRejectedValueOnce(new Error("본문이 비어 있습니다"));
    expect(await saveMasterReviewAction({ sessionId: "s1", edits: [], confirmedChapters: [] })).toEqual({ error: "본문이 비어 있습니다" });
  });
});

describe("evaluateMasterAction", () => {
  const evaluation = {
    ruleBase: { pass: true, failures: [], warnings: [] },
    llm: { pass: true, failItems: [], items: [] },
  };

  it("편집 중인 챕터를 MasterEdit(문단은 빈 줄로 이은 body)로 바꿔 함수에 넘기고 결과를 돌려준다", async () => {
    vi.mocked(generator.evaluateMaster).mockResolvedValueOnce(evaluation);
    const edited: MasterChapter[] = [{ chapterNumber: 2, chapterTitle: "둘째", paragraphs: ["첫 문단", "", "둘째 문단\n\n셋째 문단"] }];
    expect(await evaluateMasterAction({ sessionId: "s1", chapters: edited })).toEqual({ result: evaluation });
    expect(generator.evaluateMaster).toHaveBeenCalledWith("s1", [
      { chapterNumber: 2, chapterTitle: "둘째", body: "첫 문단\n\n둘째 문단\n\n셋째 문단" },
    ]);
  });

  it("챕터 형식이 올바르지 않으면 함수를 부르지 않고 error를 돌려준다", async () => {
    expect(await evaluateMasterAction({ sessionId: "s1", chapters: [{ chapterNumber: "x" }] as never })).toHaveProperty("error");
    expect(generator.evaluateMaster).not.toHaveBeenCalled();
  });

  it("함수가 실패하면 메시지를 error로 돌려준다", async () => {
    vi.mocked(generator.evaluateMaster).mockRejectedValueOnce(new Error("점검 실패 (500)"));
    expect(await evaluateMasterAction({ sessionId: "s1", chapters })).toEqual({ error: "점검 실패 (500)" });
  });
});

describe("approveMasterReviewAction", () => {
  it("배치 세션은 승인만 하고 재개 호출은 하지 않는다", async () => {
    vi.mocked(generator.approveMasterReview).mockResolvedValueOnce({ resume: "batch", warnings: ["분량 경고"] });
    expect(await approveMasterReviewAction("s1")).toEqual({ warnings: ["분량 경고"] });
    expect(generator.resumeOnDemand).not.toHaveBeenCalled();
  });

  it("온디맨드 세션은 승인 뒤 resumeOnDemand를 호출한다", async () => {
    vi.mocked(generator.approveMasterReview).mockResolvedValueOnce({ resume: "onDemand", warnings: [] });
    vi.mocked(generator.resumeOnDemand).mockResolvedValueOnce("started");
    expect(await approveMasterReviewAction("s1")).toEqual({ warnings: [] });
    expect(generator.resumeOnDemand).toHaveBeenCalledWith("s1");
  });

  it("승인은 됐는데 재개 호출이 실패하면 그 사실과 복구 방법(CLI)을 알린다", async () => {
    vi.mocked(generator.approveMasterReview).mockResolvedValueOnce({ resume: "onDemand", warnings: [] });
    vi.mocked(generator.resumeOnDemand).mockRejectedValueOnce(new Error("연결 실패"));
    const result = await approveMasterReviewAction("s1");
    expect(result.error).toContain("승인은 완료");
    expect(result.error).toContain("resume-now.mjs s1");
  });

  it("승인 자체가 실패하면(규칙 검사 등) 사유를 error로 돌려준다", async () => {
    vi.mocked(generator.approveMasterReview).mockRejectedValueOnce(new Error("확인하지 않은 챕터가 있습니다: 3장"));
    expect(await approveMasterReviewAction("s1")).toEqual({ error: "확인하지 않은 챕터가 있습니다: 3장" });
    expect(generator.resumeOnDemand).not.toHaveBeenCalled();
  });
});

describe("editPublishedStoryAction", () => {
  it("저장 결과의 경고와 버전을 돌려주고 관련 화면을 revalidate한다", async () => {
    vi.mocked(generator.editPublishedStory).mockResolvedValueOnce({ editedNums: [2], warnings: ["하이라이트 제거"], contentVersion: 3 });
    expect(await editPublishedStoryAction({ docId: "d1", edits: [{ num: 2, paragraphs: ["a"] }] })).toEqual({
      warnings: ["하이라이트 제거"], contentVersion: 3,
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/admin/edit");
  });

  // "컬렉션/id" 삭제 호출을 기록하는 가짜 Firestore.
  function fakeDraftDb() {
    const del = vi.fn().mockResolvedValue(undefined);
    vi.mocked(admin.getAdminFirestore).mockReturnValue({
      collection: (c: string) => ({ doc: (id: string) => ({ delete: () => del(`${c}/${id}`) }) }),
    } as never);
    return del;
  }

  it("반영에 성공하면 그 소설의 초안을 함께 지운다", async () => {
    const del = fakeDraftDb();
    vi.mocked(generator.editPublishedStory).mockResolvedValueOnce({ editedNums: [2], warnings: [], contentVersion: 3 });
    expect(await editPublishedStoryAction({ docId: "d1", edits: [{ num: 2, paragraphs: ["a"] }] })).toEqual({ warnings: [], contentVersion: 3 });
    expect(del).toHaveBeenCalledWith("publishedDrafts/d1");
  });

  it("초안 삭제가 실패해도 반영 결과는 성공으로 돌려준다", async () => {
    const del = fakeDraftDb();
    del.mockRejectedValueOnce(new Error("삭제 실패"));
    vi.mocked(generator.editPublishedStory).mockResolvedValueOnce({ editedNums: [2], warnings: [], contentVersion: 3 });
    expect(await editPublishedStoryAction({ docId: "d1", edits: [{ num: 2, paragraphs: ["a"] }] })).toEqual({ warnings: [], contentVersion: 3 });
  });

  it("반영이 실패하면 초안을 지우지 않는다", async () => {
    const del = fakeDraftDb();
    vi.mocked(generator.editPublishedStory).mockRejectedValueOnce(new Error("규칙 검사 실패"));
    expect(await editPublishedStoryAction({ docId: "d1", edits: [{ num: 2, paragraphs: ["a"] }] })).toEqual({ error: "규칙 검사 실패" });
    expect(del).not.toHaveBeenCalled();
  });
});

describe("Claude 액션", () => {
  it("방향 제시: 서버에서 설정집을 읽어 현재 본문과 함께 Claude에 넘긴다", async () => {
    vi.mocked(reviews.getMasterReview).mockResolvedValueOnce(detail());
    const ideas = [{ title: "젖지 않은 우산", sketch: "물이 안 떨어진다", link: "7장" }];
    vi.mocked(editor.suggestIdeas).mockResolvedValueOnce(ideas);

    const result = await suggestIdeasAction({ mode: "review", id: "s1", chapters, chapterNumber: 1, paragraphIndex: 0, instruction: "더 긴장되게" });

    expect(result).toEqual({ ideas });
    expect(editor.suggestIdeas).toHaveBeenCalledWith(
      expect.objectContaining({ chapters, characters: detail().characters, narrativeStyle: "-했다체", level: "Lv3", chapterNumber: 1, paragraphIndex: 0, instruction: "더 긴장되게" }),
    );
  });

  it("방향 제시는 마스터 검토에서만 가능하다 — 게시된 소설은 표현 수정만 허용하므로 Claude를 부르지 않고 거절한다", async () => {
    const result = await suggestIdeasAction({ mode: "published", id: "d1", chapters, chapterNumber: 1, paragraphIndex: 0 });
    expect(result).toHaveProperty("error");
    expect(editor.suggestIdeas).not.toHaveBeenCalled();
  });

  it("문단 구성 제안: 서버에서 설정집을 읽어 현재 본문과 함께 Claude에 넘기고 제안 목록을 돌려준다", async () => {
    vi.mocked(reviews.getMasterReview).mockResolvedValueOnce(detail());
    const changes = [{ kind: "merge" as const, paragraphIndex: 0, splitBefore: "", reason: "한 호흡이에요" }];
    vi.mocked(editor.suggestStructure).mockResolvedValueOnce(changes);

    const result = await suggestStructureAction({ mode: "review", id: "s1", chapters, chapterNumber: 1, instruction: "대사 단위로" });

    expect(result).toEqual({ changes });
    expect(editor.suggestStructure).toHaveBeenCalledWith(
      expect.objectContaining({ chapters, characters: detail().characters, level: "Lv3", chapterNumber: 1, instruction: "대사 단위로" }),
    );
  });

  it("문단 구성 제안은 마스터 검토에서만 가능하다 — 게시된 소설은 Claude를 부르지 않고 거절한다", async () => {
    const result = await suggestStructureAction({ mode: "published", id: "d1", chapters, chapterNumber: 1 });
    expect(result).toEqual({ error: "게시된 소설은 문단 구조를 바꿀 수 없습니다" });
    expect(editor.suggestStructure).not.toHaveBeenCalled();
  });

  it("문단 구성 제안의 지시가 너무 길면 Claude를 부르지 않고 거절한다", async () => {
    const result = await suggestStructureAction({ mode: "review", id: "s1", chapters, chapterNumber: 1, instruction: "가".repeat(501) });
    expect(result).toEqual({ error: "지시가 너무 깁니다" });
    expect(editor.suggestStructure).not.toHaveBeenCalled();
  });

  it("다듬기: 고른 방향과 거절한 제안을 함께 넘기고 고칠 곳 목록을 돌려준다", async () => {
    vi.mocked(reviews.getMasterReview).mockResolvedValueOnce(detail());
    const changes = [{ before: "문을 열었다", after: "문을 밀었다", reason: "동작이 구체적이에요" }];
    vi.mocked(editor.polishParagraph).mockResolvedValueOnce(changes);

    const result = await polishParagraphAction({
      mode: "review", id: "s1", chapters, chapterNumber: 1, paragraphIndex: 0,
      direction: { title: "젖지 않은 우산", sketch: "물이 안 떨어진다" },
      rejected: [{ before: "하린은", after: "하린이" }],
    });

    expect(result).toEqual({ changes });
    expect(editor.polishParagraph).toHaveBeenCalledWith(
      expect.objectContaining({ direction: { title: "젖지 않은 우산", sketch: "물이 안 떨어진다" }, rejected: [{ before: "하린은", after: "하린이" }] }),
    );
  });

  it("다듬기는 게시된 소설에서도 쓸 수 있다", async () => {
    vi.mocked(reviews.getPublishedStoryForEdit).mockResolvedValueOnce({ lang: "ko", detail: detail({ mode: "published", levelGuidance: null }) });
    vi.mocked(editor.polishParagraph).mockResolvedValueOnce([]);
    expect(await polishParagraphAction({ mode: "published", id: "d1", chapters, chapterNumber: 1, paragraphIndex: 0 })).toEqual({ changes: [] });
  });

  it("형태가 틀리거나 과도한 입력은 Claude를 부르지 않고 거절한다", async () => {
    const bad = [{ chapterNumber: "1" }] as unknown as MasterChapter[];
    expect(await suggestIdeasAction({ mode: "review", id: "s1", chapters: bad, chapterNumber: 1, paragraphIndex: 0 })).toHaveProperty("error");
    expect(
      await polishParagraphAction({ mode: "review", id: "s1", chapters, chapterNumber: 1, paragraphIndex: 0, rejected: Array.from({ length: 21 }, () => ({ before: "a", after: "b" })) }),
    ).toHaveProperty("error");
    expect(
      await polishParagraphAction({ mode: "review", id: "s1", chapters, chapterNumber: 1, paragraphIndex: 0, instruction: "가".repeat(501) }),
    ).toHaveProperty("error");
    expect(editor.suggestIdeas).not.toHaveBeenCalled();
    expect(editor.polishParagraph).not.toHaveBeenCalled();
  });

  it("게시본 모드의 전체 점검은 게시본 설정집을 읽는다", async () => {
    vi.mocked(reviews.getPublishedStoryForEdit).mockResolvedValueOnce({ lang: "ko", detail: detail({ mode: "published", levelGuidance: null }) });
    vi.mocked(editor.reviewStory).mockResolvedValueOnce({ title: "전체 흐름", items: [] });

    const result = await reviewStoryAction({ mode: "published", id: "d1", chapters, kind: "flow" });

    expect(result).toEqual({ result: { title: "전체 흐름", items: [] } });
    expect(reviews.getPublishedStoryForEdit).toHaveBeenCalledWith("d1");
  });

  it("없는 소설이면 에러를 돌려준다", async () => {
    vi.mocked(reviews.getMasterReview).mockResolvedValueOnce(null);
    expect(await suggestIdeasAction({ mode: "review", id: "nope", chapters, chapterNumber: 1, paragraphIndex: 0 })).toHaveProperty("error");
  });

  it("Claude 호출 실패 메시지를 error로 돌려준다", async () => {
    vi.mocked(reviews.getMasterReview).mockResolvedValueOnce(detail());
    vi.mocked(editor.reviewStory).mockRejectedValueOnce(new Error("요청이 많아 잠시 뒤에 다시 시도해 주세요"));
    expect(await reviewStoryAction({ mode: "review", id: "s1", chapters, kind: "voice" })).toEqual({ error: "요청이 많아 잠시 뒤에 다시 시도해 주세요" });
  });
});

describe("ensurePreReviewAction", () => {
  it("이미 생성된 사전 검토가 있으면 Claude를 다시 부르지 않는다 (캐시)", async () => {
    const cached = [{ chapterNumber: 1, paragraphIndex: 0, kind: "시제", text: "x" }];
    vi.mocked(reviews.getMasterReview).mockResolvedValueOnce(detail({ preReview: cached }));
    expect(await ensurePreReviewAction("s1")).toEqual({ items: cached });
    expect(editor.generatePreReview).not.toHaveBeenCalled();
  });

  it("없으면 생성해서 세션의 masterReview.preReview에 저장한다", async () => {
    const generated = [{ chapterNumber: 1, paragraphIndex: 0, kind: "긴 문장", text: "길어요" }];
    vi.mocked(reviews.getMasterReview).mockResolvedValueOnce(detail());
    vi.mocked(editor.generatePreReview).mockResolvedValueOnce(generated);
    const update = vi.fn().mockResolvedValue(undefined);
    vi.mocked(admin.getAdminFirestore).mockReturnValue({ collection: () => ({ doc: () => ({ update }) }) } as never);

    expect(await ensurePreReviewAction("s1")).toEqual({ items: generated });
    expect(update).toHaveBeenCalledWith({ "masterReview.preReview": generated });
  });
});
