"use server";

import { getAdminSession } from "@/lib/auth/session";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { isValidDraftEdits, PUBLISHED_DRAFTS_COLLECTION, type DraftEdit } from "@/lib/masterReview";

/**
 * 게시본 초안(publishedDrafts/{docId}): 고치던 글을 게시본에 반영하기 전까지 남겨 두는 웹 전용 데이터.
 * 반영은 기존 editPublishedStoryAction(규칙 검사·수정 기록)이 하고, 여기서는 게시된 글을 건드리지 않는다.
 * 실패는 throw 대신 `{ error }`로 돌려준다(masterReviewActions.ts와 같은 규칙).
 */

const LOGIN_REQUIRED = { error: "관리자 로그인이 필요합니다" };

// Firestore 문서 경로로 쓰이므로 비어 있거나 "/"가 들어간 id는 받지 않는다.
function isDocId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("/");
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export async function savePublishedDraftAction(input: {
  docId: string;
  edits: DraftEdit[];
  baseContentVersion: number;
}): Promise<{ error?: string }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  if (!isDocId(input.docId) || !isValidDraftEdits(input.edits) || !Number.isInteger(input.baseContentVersion) || input.baseContentVersion < 0) {
    return { error: "초안 형식이 올바르지 않습니다" };
  }
  try {
    const db = getAdminFirestore();
    const [story, content] = await Promise.all([
      db.collection("stories").doc(input.docId).get(),
      db.collection("storyContent").doc(input.docId).get(),
    ]);
    if (!story.exists || !content.exists || story.data()?.lang !== "ko") {
      return { error: "게시된 한국어 소설을 찾을 수 없습니다" };
    }
    const draftRef = db.collection(PUBLISHED_DRAFTS_COLLECTION).doc(input.docId);
    // 고친 곳을 모두 되돌렸으면 남길 초안이 없다.
    if (input.edits.length === 0) await draftRef.delete();
    else await draftRef.set({ edits: input.edits, baseContentVersion: input.baseContentVersion, updatedAt: new Date() });
    return {};
  } catch (err) {
    return { error: messageOf(err, "초안 저장 실패") };
  }
}

export async function discardPublishedDraftAction(docId: string): Promise<{ error?: string }> {
  if (!(await getAdminSession())) return LOGIN_REQUIRED;
  if (!isDocId(docId)) return { error: "초안 형식이 올바르지 않습니다" };
  try {
    await getAdminFirestore().collection(PUBLISHED_DRAFTS_COLLECTION).doc(docId).delete();
    return {};
  } catch (err) {
    return { error: messageOf(err, "초안 삭제 실패") };
  }
}
