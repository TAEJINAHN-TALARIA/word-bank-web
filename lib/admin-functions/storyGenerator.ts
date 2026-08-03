import "server-only";

const BASE_URL = process.env.STORY_GENERATOR_FUNCTIONS_BASE_URL;
const SHARED_SECRET = process.env.ADMIN_API_SHARED_SECRET;

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
};

export async function fetchPendingReviews(): Promise<PendingReviewItem[]> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminListPendingReviews`, {
    method: "GET",
    headers: { "x-admin-api-key": secret },
    cache: "no-store",
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
