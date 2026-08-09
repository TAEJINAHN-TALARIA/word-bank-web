import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export type ComboInfo = {
  mainPremise: string;
  subMotif: string;
  genreTone: string;
  setting: string;
  relationship: string;
  viewpoint: string;
  ending: string;
  conflictResolution: string;
};

function normalizeCombo(combo: Partial<ComboInfo> | undefined): ComboInfo {
  return {
    mainPremise: combo?.mainPremise ?? "",
    subMotif: combo?.subMotif ?? "",
    genreTone: combo?.genreTone ?? "",
    setting: combo?.setting ?? "",
    relationship: combo?.relationship ?? "",
    viewpoint: combo?.viewpoint ?? "",
    ending: combo?.ending ?? "",
    conflictResolution: combo?.conflictResolution ?? "",
  };
}

export type PipelineSessionSummary = {
  id: string;
  status: string;
  runId: string;
  targetLevel: string;
  combo: ComboInfo;
  targetLanguages: string[];
  createdAt: string;
};

const SESSIONS_PAGE_SIZE = 50;

export type PipelineSessionsPage = {
  sessions: PipelineSessionSummary[];
  nextCursor: string | null;
};

export async function listPipelineSessions(cursorId?: string): Promise<PipelineSessionsPage> {
  const db = getAdminFirestore();
  let query = db
    .collection("pipelineSessions")
    .orderBy("createdAt", "desc")
    .limit(SESSIONS_PAGE_SIZE);

  if (cursorId) {
    const cursorDoc = await db.collection("pipelineSessions").doc(cursorId).get();
    // 커서 문서가 삭제된 경우 startAfter 없이 조회하면 1페이지를 중복으로 반환하게 된다.
    // 중복 대신 빈 페이지를 반환해 "더 보기"가 조용히 종료되도록 한다.
    if (!cursorDoc.exists) {
      return { sessions: [], nextCursor: null };
    }
    query = query.startAfter(cursorDoc);
  }

  const snapshot = await query.get();
  const sessions = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      status: data.status,
      runId: data.runId,
      targetLevel: data.targetLevel,
      combo: normalizeCombo(data.combo),
      targetLanguages: data.targetLanguages ?? [],
      createdAt: data.createdAt?.toDate?.().toISOString() ?? "",
    };
  });

  return {
    sessions,
    nextCursor:
      snapshot.docs.length === SESSIONS_PAGE_SIZE
        ? snapshot.docs[snapshot.docs.length - 1].id
        : null,
  };
}

export type LayerGateResult = {
  target: string;
  latestStatus: string;
  ruleBaseWarnings: string[];
  llmEvalReasons: string[];
  retryCount: number;
};

export type PipelineSessionDetail = PipelineSessionSummary & {
  layer6Gates: LayerGateResult[];
};

export async function getPipelineSessionDetail(
  sessionId: string,
): Promise<PipelineSessionDetail | null> {
  const db = getAdminFirestore();
  const sessionRef = db.collection("pipelineSessions").doc(sessionId);

  const [doc, gatesSnapshot] = await Promise.all([
    sessionRef.get(),
    sessionRef.collection("layer6Gates").get(),
  ]);

  if (!doc.exists) return null;
  const data = doc.data()!;

  const layer6Gates: LayerGateResult[] = gatesSnapshot.docs.map((gateDoc) => {
    const gateData = gateDoc.data();
    return {
      target: gateDoc.id,
      latestStatus: gateData.latestStatus,
      ruleBaseWarnings: gateData.ruleBaseWarnings ?? [],
      llmEvalReasons: gateData.llmEvalReasons ?? [],
      retryCount: gateData.retryCount ?? 0,
    };
  });

  return {
    id: doc.id,
    status: data.status,
    runId: data.runId,
    targetLevel: data.targetLevel,
    combo: normalizeCombo(data.combo),
    targetLanguages: data.targetLanguages ?? [],
    createdAt: data.createdAt?.toDate?.().toISOString() ?? "",
    layer6Gates,
  };
}
