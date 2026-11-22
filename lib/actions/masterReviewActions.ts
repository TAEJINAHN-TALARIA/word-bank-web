"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  saveMasterReview,
  evaluateMaster,
  approveMasterReview,
  resumeOnDemand,
  editPublishedStory,
  type MasterEdit,
  type MasterEvaluation,
  type PublishedEdit,
} from "@/lib/admin-functions/storyGenerator";
import { getMasterReview } from "@/lib/data/masterReviews";
import { loadEditorContext, type ClaudeTarget } from "@/lib/claude/editorContext";
import {
  suggestIdeas,
  polishParagraph,
  suggestStructure,
  reviewStory,
  generatePreReview,
  type StoryReviewResult,
} from "@/lib/claude/editor";
import type { Idea, IdeaDirection, PolishChange, RejectedChange, StoryReviewKind, StructureChange } from "@/lib/claude/editing";
import {
  PUBLISHED_DRAFTS_COLLECTION,
  findUnsavableTitle,
  isValidChaptersInput,
  normalizeParagraphs,
  paragraphsToBody,
  type MasterChapter,
  type PreReviewItem,
} from "@/lib/masterReview";

/**
 * Next.js는 프로덕션에서 Server Action이 throw한 에러 메시지를 마스킹한다.
 * 그래서 실패는 예외 대신 `{ error }`로 반환해 화면이 그대로 보여줄 수 있게 한다(adminStoryActions.ts와 같은 규칙).
 */
const LOGIN_REQUIRED = { error: "관리자 로그인이 필요합니다" };

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export async function saveMasterReviewAction(input: {
  sessionId: string;
  edits: MasterEdit[];
  confirmedChapters: number[];
  title?: string;
}): Promise<{ error?: string }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  if (input.title !== undefined) {
    const reason = findUnsavableTitle(input.title);
    if (reason) return { error: reason };
  }
  try {
    if (input.title === undefined) await saveMasterReview(input.sessionId, input.edits, input.confirmedChapters);
    else await saveMasterReview(input.sessionId, input.edits, input.confirmedChapters, input.title);
  } catch (err) {
    return { error: messageOf(err, "저장 실패") };
  }
  revalidatePath("/admin/edit");
  return {};
}

// 편집 중인 글(chapters)에 Layer 6 마스터 게이트와 같은 점검을 돌려 결과만 받는다(읽기 전용, 승인과 무관).
export async function evaluateMasterAction(input: {
  sessionId: string;
  chapters: MasterChapter[];
}): Promise<{ error?: string; result?: MasterEvaluation }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  if (!isValidChaptersInput(input.chapters)) return { error: "본문 형식이 올바르지 않습니다" };
  const edits: MasterEdit[] = input.chapters.map((c) => ({
    chapterNumber: c.chapterNumber,
    chapterTitle: c.chapterTitle,
    body: paragraphsToBody(normalizeParagraphs(c.paragraphs)),
  }));
  try {
    return { result: await evaluateMaster(input.sessionId, edits) };
  } catch (err) {
    return { error: messageOf(err, "품질 점검 실패") };
  }
}

export async function approveMasterReviewAction(
  sessionId: string,
): Promise<{ error?: string; warnings?: string[] }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;

  let result;
  try {
    result = await approveMasterReview(sessionId);
  } catch (err) {
    return { error: messageOf(err, "승인 실패") };
  }
  revalidatePath("/admin/edit");
  revalidatePath("/admin/generation");

  if (result.resume === "onDemand") {
    try {
      await resumeOnDemand(sessionId);
    } catch (err) {
      return {
        error:
          `승인은 완료됐지만 이어서 실행하는 호출이 실패했습니다: ${messageOf(err, "알 수 없는 오류")}. ` +
          `터미널에서 \`node scripts/resume-now.mjs ${sessionId}\`로 이어서 실행할 수 있습니다.`,
      };
    }
  }
  return { warnings: result.warnings };
}

export async function editPublishedStoryAction(input: {
  docId: string;
  edits: PublishedEdit[];
}): Promise<{ error?: string; warnings?: string[]; contentVersion?: number }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  try {
    const result = await editPublishedStory(input.docId, input.edits);
    try {
      await getAdminFirestore().collection(PUBLISHED_DRAFTS_COLLECTION).doc(input.docId).delete();
    } catch {
      // 반영한 글의 초안은 더 필요 없다. 지우기가 실패해도 반영은 이미 끝났으니 되돌리지 않는다
      // (남은 초안은 다음에 열 때 게시 버전이 달라 stale로 취급된다).
    }
    revalidatePath("/admin/edit");
    return { warnings: result.warnings, contentVersion: result.contentVersion };
  } catch (err) {
    return { error: messageOf(err, "게시본 저장 실패") };
  }
}

// ── Claude 패널 ──
// 설정집(인물 말투, 서술 문체, 레벨 기준)은 클라이언트가 보낸 값을 믿지 않고 서버에서 다시 읽는다(loadEditorContext).
// 클라이언트가 보내는 건 편집 중인 현재 본문뿐이다.

// 작업 스레드(고른 방향, 거절한 제안, 지시)는 화면이 들고 있다가 요청마다 함께 보낸다. 서버는 크기만 제한한다.
const MAX_TEXT = 500;
const MAX_REJECTED = 20;

function tooLong(...texts: (string | undefined)[]): boolean {
  return texts.some((t) => (t?.length ?? 0) > MAX_TEXT);
}

// ① 방향 제시. 줄거리를 바꾸는 제안도 하므로 게시된 소설(표현 수정만 허용)에서는 받지 않는다.
export async function suggestIdeasAction(
  input: ClaudeTarget & { chapterNumber: number; paragraphIndex: number; instruction?: string },
): Promise<{ error?: string; ideas?: Idea[] }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  if (input.mode !== "review") return { error: "게시된 소설은 표현 수정만 할 수 있어 방향 제안을 받을 수 없습니다" };
  if (tooLong(input.instruction)) return { error: "지시가 너무 깁니다" };
  try {
    const context = await loadEditorContext(input);
    if ("error" in context) return context;
    const ideas = await suggestIdeas({
      ...context,
      chapterNumber: input.chapterNumber,
      paragraphIndex: input.paragraphIndex,
      instruction: input.instruction,
    });
    return { ideas };
  } catch (err) {
    return { error: messageOf(err, "방향 제안 실패") };
  }
}

// ③ 다듬기. 현재 편집 중인 본문에서 고칠 곳 목록만 돌려준다(본문은 바꾸지 않는다).
export async function polishParagraphAction(
  input: ClaudeTarget & {
    chapterNumber: number;
    paragraphIndex: number;
    direction?: IdeaDirection | null;
    rejected?: RejectedChange[];
    instruction?: string;
  },
): Promise<{ error?: string; changes?: PolishChange[] }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  const rejected = input.rejected ?? [];
  if (
    rejected.length > MAX_REJECTED ||
    rejected.some((r) => tooLong(r.before, r.after)) ||
    tooLong(input.instruction, input.direction?.title, input.direction?.sketch)
  ) {
    return { error: "요청 내용이 너무 깁니다" };
  }
  try {
    const context = await loadEditorContext(input);
    if ("error" in context) return context;
    const changes = await polishParagraph({
      ...context,
      chapterNumber: input.chapterNumber,
      paragraphIndex: input.paragraphIndex,
      direction: input.direction,
      rejected,
      instruction: input.instruction,
    });
    return { changes };
  } catch (err) {
    return { error: messageOf(err, "다듬기 실패") };
  }
}

// ④ 문단 구성 제안. 문단 경계를 바꾸는 제안이라 게시된 소설(표현 수정만 허용)에서는 받지 않는다.
export async function suggestStructureAction(
  input: ClaudeTarget & { chapterNumber: number; instruction?: string },
): Promise<{ error?: string; changes?: StructureChange[] }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  if (input.mode !== "review") return { error: "게시된 소설은 문단 구조를 바꿀 수 없습니다" };
  if (tooLong(input.instruction)) return { error: "지시가 너무 깁니다" };
  try {
    const context = await loadEditorContext(input);
    if ("error" in context) return context;
    const changes = await suggestStructure({ ...context, chapterNumber: input.chapterNumber, instruction: input.instruction });
    return { changes };
  } catch (err) {
    return { error: messageOf(err, "문단 구성 제안 실패") };
  }
}

export async function reviewStoryAction(
  input: ClaudeTarget & { kind: StoryReviewKind; instruction?: string },
): Promise<{ error?: string; result?: StoryReviewResult }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  try {
    const context = await loadEditorContext(input);
    if ("error" in context) return context;
    return { result: await reviewStory({ ...context, kind: input.kind, instruction: input.instruction }) };
  } catch (err) {
    return { error: messageOf(err, "점검 실패") };
  }
}

// 사전 검토 메모는 편집 화면을 처음 열 때 한 번 만들어 세션에 저장한다(다음부터는 캐시).
export async function ensurePreReviewAction(sessionId: string): Promise<{ error?: string; items?: PreReviewItem[] }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  try {
    const detail = await getMasterReview(sessionId);
    if (!detail) return { error: "편집 대기 중인 세션을 찾을 수 없습니다" };
    if (detail.preReview) return { items: detail.preReview };

    const items = await generatePreReview({
      title: detail.title,
      level: detail.level,
      chapters: detail.chapters,
      characters: detail.characters,
      narrativeStyle: detail.narrativeStyle,
      levelGuidance: detail.levelGuidance,
    });
    // 파이프라인이 읽지 않는 필드만 갱신한다(점 표기법으로 masterReview의 다른 값은 건드리지 않음).
    await getAdminFirestore().collection("pipelineSessions").doc(sessionId).update({ "masterReview.preReview": items });
    return { items };
  } catch (err) {
    return { error: messageOf(err, "사전 검토 생성 실패") };
  }
}
