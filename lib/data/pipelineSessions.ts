import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";

export type PipelineSessionSummary = {
  id: string;
  status: string;
  runId: string;
  targetLevel: string;
  combo: string;
  targetLanguages: string[];
  createdAt: string;
};

export async function listPipelineSessions(): Promise<PipelineSessionSummary[]> {
  const db = getAdminFirestore();
  const snapshot = await db
    .collection("pipelineSessions")
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      status: data.status,
      runId: data.runId,
      targetLevel: data.targetLevel,
      combo: data.combo,
      targetLanguages: data.targetLanguages ?? [],
      createdAt: data.createdAt?.toDate?.().toISOString() ?? "",
    };
  });
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
  const doc = await db.collection("pipelineSessions").doc(sessionId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;

  const gatesSnapshot = await db
    .collection("pipelineSessions")
    .doc(sessionId)
    .collection("layer6Gates")
    .get();

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
    combo: data.combo,
    targetLanguages: data.targetLanguages ?? [],
    createdAt: data.createdAt?.toDate?.().toISOString() ?? "",
    layer6Gates,
  };
}
