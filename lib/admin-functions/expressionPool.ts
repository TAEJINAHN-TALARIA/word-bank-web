import "server-only";

const BASE_URL = process.env.STORY_GENERATOR_FUNCTIONS_BASE_URL;
const SHARED_SECRET = process.env.ADMIN_API_SHARED_SECRET;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다`);
  return value;
}

export async function submitExpressionBatch(language: string, count: number): Promise<{ jobId: string }> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminSubmitExpressionBatch`, {
    method: "POST",
    headers: { "x-admin-api-key": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ language, count }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `표현 풀 생성 요청 실패 (${response.status})`);
  }
  return response.json();
}

export async function submitExpressionSeedCampaign(
  language: string,
  count: number,
): Promise<{ jobId: string; campaignId: string }> {
  const baseUrl = requireEnv(BASE_URL, "STORY_GENERATOR_FUNCTIONS_BASE_URL");
  const secret = requireEnv(SHARED_SECRET, "ADMIN_API_SHARED_SECRET");

  const response = await fetch(`${baseUrl}/adminSubmitExpressionSeedCampaign`, {
    method: "POST",
    headers: { "x-admin-api-key": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ language, count }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `시딩 캠페인 요청 실패 (${response.status})`);
  }
  return response.json();
}
