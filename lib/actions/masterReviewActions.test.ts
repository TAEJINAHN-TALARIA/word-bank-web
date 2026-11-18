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
  suggestParagraphAction,
  reviewStoryAction,
  ensurePreReviewAction,
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
    expect(await suggestParagraphAction({ mode: "review", id: "s1", chapters, chapterNumber: 1, paragraphIndex: 0, instruction: "x" })).toEqual(expected);
    expect(await reviewStoryAction({ mode: "review", id: "s1", chapters, kind: "flow" })).toEqual(expected);
    expect(await ensurePreReviewAction("s1")).toEqual(expected);

    expect(generator.saveMasterReview).not.toHaveBeenCalled();
    expect(generator.approveMasterReview).not.toHaveBeenCalled();
    expect(editor.suggestParagraph).not.toHaveBeenCalled();
  });
});

describe("saveMasterReviewAction", () => {
  it("저장 후 편집 목록을 revalidate한다", async () => {
    expect(await saveMasterReviewAction({ sessionId: "s1", edits: [], confirmedChapters: [1] })).toEqual({});
    expect(generator.saveMasterReview).toHaveBeenCalledWith("s1", [], [1]);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/admin/edit");
  });

  it("함수 호출이 실패하면 메시지를 error로 돌려준다", async () => {
    vi.mocked(generator.saveMasterReview).mockRejectedValueOnce(new Error("본문이 비어 있습니다"));
    expect(await saveMasterReviewAction({ sessionId: "s1", edits: [], confirmedChapters: [] })).toEqual({ error: "본문이 비어 있습니다" });
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
});

describe("Claude 액션", () => {
  it("문단 제안: 서버에서 설정집을 읽어 현재 본문과 함께 Claude에 넘긴다", async () => {
    vi.mocked(reviews.getMasterReview).mockResolvedValueOnce(detail());
    vi.mocked(editor.suggestParagraph).mockResolvedValueOnce({ kind: "suggestion", reason: "짧게", after: "하린이 문을 열었다." });

    const result = await suggestParagraphAction({ mode: "review", id: "s1", chapters, chapterNumber: 1, paragraphIndex: 0, instruction: "짧게" });

    expect(result).toEqual({ kind: "suggestion", reason: "짧게", after: "하린이 문을 열었다." });
    expect(editor.suggestParagraph).toHaveBeenCalledWith(
      expect.objectContaining({ chapters, characters: detail().characters, narrativeStyle: "-했다체", level: "Lv3", chapterNumber: 1, paragraphIndex: 0, instruction: "짧게" }),
    );
  });

  it("형태가 틀린 챕터 입력은 Claude를 부르지 않고 거절한다", async () => {
    const result = await suggestParagraphAction({
      mode: "review", id: "s1", chapters: [{ chapterNumber: "1" }] as unknown as MasterChapter[], chapterNumber: 1, paragraphIndex: 0, instruction: "x",
    });
    expect(result).toHaveProperty("error");
    expect(editor.suggestParagraph).not.toHaveBeenCalled();
  });

  it("게시본 모드는 게시본 설정집을 읽는다", async () => {
    vi.mocked(reviews.getPublishedStoryForEdit).mockResolvedValueOnce({ lang: "ko", detail: detail({ mode: "published", levelGuidance: null }) });
    vi.mocked(editor.reviewStory).mockResolvedValueOnce({ title: "전체 흐름", items: [] });

    const result = await reviewStoryAction({ mode: "published", id: "d1", chapters, kind: "flow" });

    expect(result).toEqual({ result: { title: "전체 흐름", items: [] } });
    expect(reviews.getPublishedStoryForEdit).toHaveBeenCalledWith("d1");
  });

  it("없는 소설이면 에러를 돌려준다", async () => {
    vi.mocked(reviews.getMasterReview).mockResolvedValueOnce(null);
    const result = await suggestParagraphAction({ mode: "review", id: "nope", chapters, chapterNumber: 1, paragraphIndex: 0, instruction: "x" });
    expect(result).toHaveProperty("error");
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
