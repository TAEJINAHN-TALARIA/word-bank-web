import "server-only";

const BASE_URL = process.env.STORY_GENERATOR_FUNCTIONS_BASE_URL;
const SHARED_SECRET = process.env.ADMIN_API_SHARED_SECRET;
const PENDING_REVIEWS_REVALIDATE_SECONDS = 15;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다`);
  return value;
}

export type PendingReviewItem = {
  sessionId: string;
  target: string;
  lang: string;
  level: string;
  title: string | null;
  gateStatus: string;
  ruleBaseWarnings: string[];
  llmEvalReasons: string[];
  // 마스터 검토 게이트 도입 전에 끝난 세션은 false — 목록에서 "마스터 미검토" 배지를 붙인다.
  masterReviewed: boolean;
};

export async function fetchPendingReviews(): Promise<PendingReviewItem[]> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminListPendingReviews`, {
    method: "GET",
    headers: { "x-admin-api-key": secret },
    next: { revalidate: PENDING_REVIEWS_REVALIDATE_SECONDS },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `검토 대기 목록 조회 실패 (${response.status})`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export async function publishStory(sessionId: string, target: string): Promise<void> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminPublishStory`, {
    method: "POST",
    headers: { "x-admin-api-key": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, target }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `게시 실패 (${response.status})`);
  }
}

export async function recallStory(sessionId: string, target: string): Promise<void> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminRecallStory`, {
    method: "POST",
    headers: { "x-admin-api-key": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, target }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `철회 실패 (${response.status})`);
  }
}

// ── 마스터 검토 / 게시본 편집 (story-generator의 adminHandlers.js) ──

async function postAdmin(
  path: string,
  body: unknown,
  failureLabel: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/${path}`, {
    method: "POST",
    headers: { "x-admin-api-key": secret, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // 승인 시 규칙 검사 실패는 failures 목록을 함께 내려준다 — 사유를 그대로 보여준다.
    const failures = Array.isArray(data.failures) ? `: ${data.failures.join(" / ")}` : "";
    throw new Error(`${data.error ?? `${failureLabel} (${response.status})`}${failures}`);
  }
  return data;
}

export type MasterEdit = { chapterNumber: number; chapterTitle: string; body: string };

export async function saveMasterReview(
  sessionId: string,
  edits: MasterEdit[],
  confirmedChapters: number[],
  title?: string,
): Promise<void> {
  const trimmed = title?.trim();
  const data = await postAdmin(
    "adminSaveMasterReview",
    { sessionId, edits, confirmedChapters, ...(trimmed !== undefined && { title: trimmed }) },
    "저장 실패",
  );
  // 제목 저장을 모르는 옛 함수는 title을 조용히 무시한다. 저장된 값이 돌아오지 않으면 저장된 것으로 치지 않는다.
  if (trimmed !== undefined && data.title !== trimmed) {
    throw new Error("서버가 제목 저장을 지원하지 않아요 — 함수 배포를 확인해 주세요");
  }
}

// 편집 창 "품질 점검"의 결과(story-generator의 evaluateMasterForReview). llm이 null이면 규칙 검사 실패로 심사를 건너뛴 것이다.
export type EvaluationItem = { key: string; score: number; reason: string | null; problemPhrases?: string[]; gated: boolean };
export type MasterEvaluation = {
  ruleBase: { pass: boolean; failures: string[]; warnings: string[] };
  llm: null | { error: string } | { pass: boolean; failItems: string[]; items: EvaluationItem[] };
};

// 편집 중인 전 챕터를 보내 Layer 6 마스터 게이트와 같은 점검을 읽기 전용으로 받는다(Gemini 호출 한 번, 수십 초).
export async function evaluateMaster(sessionId: string, edits: MasterEdit[]): Promise<MasterEvaluation> {
  const data = await postAdmin("adminEvaluateMaster", { sessionId, edits }, "점검 실패");
  if (typeof data.ruleBase !== "object" || data.ruleBase === null || !("llm" in data)) {
    throw new Error("점검 결과를 해석하지 못했습니다");
  }
  return { ruleBase: data.ruleBase as MasterEvaluation["ruleBase"], llm: data.llm as MasterEvaluation["llm"] };
}

export type ApproveMasterReviewResult = { resume: "batch" | "onDemand"; warnings: string[] };

export async function approveMasterReview(sessionId: string): Promise<ApproveMasterReviewResult> {
  const data = await postAdmin("adminApproveMasterReview", { sessionId }, "승인 실패");
  return {
    resume: data.resume === "onDemand" ? "onDemand" : "batch",
    warnings: Array.isArray(data.warnings) ? (data.warnings as string[]) : [],
  };
}

const RESUME_ON_DEMAND_WAIT_MS = 5000;

/**
 * 승인된 온디맨드 세션의 나머지 단계(삽화 → 번역 → 게이트)는 수 분~수십 분 걸려서 응답을 기다리지 않는다.
 * 짧게 기다려도 응답이 없으면 "시작됨"으로 본다 — 서버가 클라이언트 연결이 끊긴 뒤에도 끝까지 도는지는
 * 배포 환경에서 확인이 필요하다(스펙 Open Question 1). 확인 전에는 CLI `scripts/resume-now.mjs`가 대체 경로다.
 */
export async function resumeOnDemand(sessionId: string): Promise<"started" | "finished"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESUME_ON_DEMAND_WAIT_MS);
  try {
    await postAdmin("resumeOnDemand", { sessionId }, "재개 실패", controller.signal);
    return "finished";
  } catch (err) {
    if (controller.signal.aborted) return "started";
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type PublishedEdit = { num: number; paragraphs: string[] };
export type EditPublishedStoryResult = { editedNums: number[]; warnings: string[]; contentVersion: number };

export async function editPublishedStory(docId: string, edits: PublishedEdit[]): Promise<EditPublishedStoryResult> {
  const data = await postAdmin("adminEditPublishedStory", { docId, edits }, "게시본 저장 실패");
  return {
    editedNums: Array.isArray(data.editedNums) ? (data.editedNums as number[]) : [],
    warnings: Array.isArray(data.warnings) ? (data.warnings as string[]) : [],
    contentVersion: typeof data.contentVersion === "number" ? data.contentVersion : 0,
  };
}
