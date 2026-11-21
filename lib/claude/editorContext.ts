import "server-only";
import { getMasterReview, getPublishedStoryForEdit } from "@/lib/data/masterReviews";
import type { EditorContextInput } from "@/lib/claude/editor";
import { isValidChaptersInput, type EditorDetail, type MasterChapter } from "@/lib/masterReview";

// 설정집(인물 말투, 서술 문체, 레벨 기준)은 클라이언트가 보낸 값을 믿지 않고 서버에서 다시 읽는다.
// 클라이언트가 보내는 건 편집 중인 현재 본문뿐이다. 서버 액션과 대화 라우트가 함께 쓴다.

export type ClaudeTarget = { mode: "review" | "published"; id: string; chapters: MasterChapter[] };

export async function loadEditorContext(target: ClaudeTarget): Promise<EditorContextInput | { error: string }> {
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
