"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  saveMasterReview,
  approveMasterReview,
  resumeOnDemand,
  editPublishedStory,
  type MasterEdit,
  type PublishedEdit,
} from "@/lib/admin-functions/storyGenerator";
import { getMasterReview, getPublishedStoryForEdit } from "@/lib/data/masterReviews";
import {
  suggestParagraph,
  reviewStory,
  generatePreReview,
  type EditorContextInput,
  type SuggestionResult,
  type StoryReviewResult,
} from "@/lib/claude/editor";
import type { StoryReviewKind } from "@/lib/claude/editing";
import { isValidChaptersInput, type EditorDetail, type MasterChapter, type PreReviewItem } from "@/lib/masterReview";

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
}): Promise<{ error?: string }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  try {
    await saveMasterReview(input.sessionId, input.edits, input.confirmedChapters);
  } catch (err) {
    return { error: messageOf(err, "저장 실패") };
  }
  revalidatePath("/admin/edit");
  return {};
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
    revalidatePath("/admin/edit");
    return { warnings: result.warnings, contentVersion: result.contentVersion };
  } catch (err) {
    return { error: messageOf(err, "게시본 저장 실패") };
  }
}

// ── Claude 패널 ──
// 설정집(인물 말투, 서술 문체, 레벨 기준)은 클라이언트가 보낸 값을 믿지 않고 서버에서 다시 읽는다.
// 클라이언트가 보내는 건 편집 중인 현재 본문뿐이다.

type ClaudeTarget = { mode: "review" | "published"; id: string; chapters: MasterChapter[] };

async function loadContext(target: ClaudeTarget): Promise<EditorContextInput | { error: string }> {
  if (!isValidChaptersInput(target.chapters)) return { error: "본문 형식이 올바르지 않습니다" };

  let detail: EditorDetail | null;
  if (target.mode === "review") {
    detail = await getMasterReview(target.id);
  } else {
    detail = (await getPublishedStoryForEdit(target.id))?.detail ?? null;
  }
  if (!detail) return { error: "소설을 찾을 수 없습니다" };

  return {
    title: detail.title,
    level: detail.level,
    chapters: target.chapters,
    characters: detail.characters,
    narrativeStyle: detail.narrativeStyle,
    levelGuidance: detail.levelGuidance,
  };
}

export async function suggestParagraphAction(
  input: ClaudeTarget & { chapterNumber: number; paragraphIndex: number; instruction: string },
): Promise<{ error: string } | SuggestionResult> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  try {
    const context = await loadContext(input);
    if ("error" in context) return context;
    return await suggestParagraph({
      ...context,
      chapterNumber: input.chapterNumber,
      paragraphIndex: input.paragraphIndex,
      instruction: input.instruction,
    });
  } catch (err) {
    return { error: messageOf(err, "제안 생성 실패") };
  }
}

export async function reviewStoryAction(
  input: ClaudeTarget & { kind: StoryReviewKind; instruction?: string },
): Promise<{ error?: string; result?: StoryReviewResult }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  try {
    const context = await loadContext(input);
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
