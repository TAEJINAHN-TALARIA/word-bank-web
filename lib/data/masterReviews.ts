import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  bodyToParagraphs,
  type CharacterInfo,
  type EditorDetail,
  type LevelGuidance,
  type MasterChapter,
  type PreReviewItem,
} from "@/lib/masterReview";

// story-generator의 MASTER_REVIEW_STATUS(src/pipeline/masterReview.js)와 같은 값.
export const MASTER_REVIEW_STATUS = "awaiting_master_review";

// ── 순수 매핑 (Firestore 문서 → 화면 타입). 형태가 어긋난 항목은 버리고 나머지만 쓴다. ──

export function mapMasterChapters(raw: unknown): MasterChapter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => Number.isInteger(c?.chapterNumber))
    .map((c) => ({
      chapterNumber: c.chapterNumber as number,
      chapterTitle: typeof c.chapterTitle === "string" ? c.chapterTitle : "",
      paragraphs: bodyToParagraphs(typeof c.body === "string" ? c.body : ""),
    }))
    .sort((a, b) => a.chapterNumber - b.chapterNumber);
}

export function mapCharacters(raw: unknown): CharacterInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => typeof c?.name === "string" && c.name)
    .map((c) => ({ name: c.name as string, speechStyle: typeof c.speechStyle === "string" ? c.speechStyle : null }));
}

export function mapLevelGuidance(raw: unknown): LevelGuidance | null {
  const g = raw as Partial<LevelGuidance> | null | undefined;
  if (!g || typeof g.sentenceLen !== "number" || typeof g.unit !== "string" || typeof g.stageLabel !== "string") return null;
  return { sentenceLen: g.sentenceLen, unit: g.unit, stageLabel: g.stageLabel };
}

export function mapPreReview(raw: unknown): PreReviewItem[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(
      (i) =>
        Number.isInteger(i?.chapterNumber) &&
        Number.isInteger(i?.paragraphIndex) &&
        typeof i?.kind === "string" &&
        typeof i?.text === "string",
    )
    .map((i) => ({
      chapterNumber: i.chapterNumber as number,
      paragraphIndex: i.paragraphIndex as number,
      kind: i.kind as string,
      text: i.text as string,
    }));
}

type SessionData = Record<string, unknown> & {
  masterReview?: Record<string, unknown>;
};
type LayerOutput = { output?: Record<string, unknown> } | null | undefined;

export function buildMasterReviewDetail(input: {
  sessionId: string;
  session: SessionData;
  layer1: LayerOutput;
  layer4: LayerOutput;
  layer4Original: LayerOutput;
}): EditorDetail | null {
  const { sessionId, session, layer1, layer4, layer4Original } = input;
  const chapters = mapMasterChapters(layer4?.output?.chapters);
  if (!chapters.length) return null;
  const review = session.masterReview ?? {};
  return {
    mode: "review",
    id: sessionId,
    title: typeof layer1?.output?.title === "string" ? layer1.output.title : null,
    level: String(session.targetLevel ?? ""),
    executionPath: typeof session.executionPath === "string" ? session.executionPath : null,
    chapters,
    // 원본이 없으면(이론상 없음) 현재 본을 원본으로 보여 "수정 없음"으로 처리한다.
    original: mapMasterChapters(layer4Original?.output?.chapters).length
      ? mapMasterChapters(layer4Original?.output?.chapters)
      : chapters,
    characters: mapCharacters(layer1?.output?.characters),
    narrativeStyle: typeof layer1?.output?.narrativeStyle === "string" ? layer1.output.narrativeStyle : null,
    levelGuidance: mapLevelGuidance(review.levelGuidance),
    confirmedChapters: Array.isArray(review.confirmedChapters)
      ? review.confirmedChapters.filter((n): n is number => Number.isInteger(n))
      : [],
    gateNote: typeof review.gateNote === "string" ? review.gateNote : null,
    preReview: mapPreReview(review.preReview),
  };
}

// ── Firestore 읽기 ──

async function readLayerOutput(sessionId: string, layerId: string): Promise<LayerOutput> {
  const snap = await getAdminFirestore()
    .collection("pipelineSessions")
    .doc(sessionId)
    .collection("layerOutputs")
    .doc(layerId)
    .get();
  return snap.exists ? (snap.data() as LayerOutput) : null;
}

export type MasterReviewSummary = {
  sessionId: string;
  title: string | null;
  level: string;
  executionPath: string | null;
  confirmedCount: number;
  gateNote: string | null;
  createdAt: string;
};

export async function listMasterReviews(): Promise<MasterReviewSummary[]> {
  const snapshot = await getAdminFirestore()
    .collection("pipelineSessions")
    .where("status", "==", MASTER_REVIEW_STATUS)
    .get();

  const summaries = await Promise.all(
    snapshot.docs.map(async (doc) => {
      const data = doc.data() as SessionData;
      const layer1 = await readLayerOutput(doc.id, "layer1");
      const review = data.masterReview ?? {};
      return {
        sessionId: doc.id,
        title: typeof layer1?.output?.title === "string" ? layer1.output.title : null,
        level: String(data.targetLevel ?? ""),
        executionPath: typeof data.executionPath === "string" ? data.executionPath : null,
        confirmedCount: Array.isArray(review.confirmedChapters) ? review.confirmedChapters.length : 0,
        gateNote: typeof review.gateNote === "string" ? review.gateNote : null,
        createdAt: (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? "",
      };
    }),
  );
  // 복합 인덱스 없이 쓰려고 상태로만 조회하고 최신순 정렬은 메모리에서 한다(편집 대기는 소수).
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMasterReview(sessionId: string): Promise<EditorDetail | null> {
  const sessionSnap = await getAdminFirestore().collection("pipelineSessions").doc(sessionId).get();
  if (!sessionSnap.exists) return null;
  const session = sessionSnap.data() as SessionData;
  if (session.status !== MASTER_REVIEW_STATUS) return null;

  const [layer1, layer4, layer4Original] = await Promise.all([
    readLayerOutput(sessionId, "layer1"),
    readLayerOutput(sessionId, "layer4"),
    readLayerOutput(sessionId, "layer4Original"),
  ]);
  return buildMasterReviewDetail({ sessionId, session, layer1, layer4, layer4Original });
}

// 게시된 소설 편집 화면용. 설정집(인물 말투 등)은 마스터에서 만들어진 게시본일 때만 세션에서 가져온다.
export async function getPublishedStoryForEdit(
  docId: string,
): Promise<{ lang: string; detail: EditorDetail } | null> {
  const db = getAdminFirestore();
  const [storySnap, contentSnap] = await Promise.all([
    db.collection("stories").doc(docId).get(),
    db.collection("storyContent").doc(docId).get(),
  ]);
  if (!storySnap.exists || !contentSnap.exists) return null;
  const story = storySnap.data() as Record<string, unknown>;

  const rawChapters = (contentSnap.data()?.chapters ?? []) as {
    num?: number;
    title?: string | null;
    paragraphs?: string[];
  }[];
  const chapters: MasterChapter[] = rawChapters
    .filter((c) => Number.isInteger(c.num))
    .map((c) => ({
      chapterNumber: c.num as number,
      chapterTitle: c.title ?? "",
      paragraphs: Array.isArray(c.paragraphs) ? c.paragraphs : [],
    }))
    .sort((a, b) => a.chapterNumber - b.chapterNumber);

  const sessionId = typeof story.sessionId === "string" ? story.sessionId : null;
  const layer1 = sessionId && story.target === "master" ? await readLayerOutput(sessionId, "layer1") : null;

  return {
    lang: String(story.lang ?? ""),
    detail: {
      mode: "published",
      id: docId,
      title: typeof story.title === "string" ? story.title : null,
      level: String(story.level ?? ""),
      executionPath: null,
      chapters,
      original: chapters,
      characters: mapCharacters(layer1?.output?.characters),
      narrativeStyle: typeof layer1?.output?.narrativeStyle === "string" ? layer1.output.narrativeStyle : null,
      levelGuidance: null,
      confirmedChapters: [],
      gateNote: null,
      preReview: null,
    },
  };
}
