import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('submitExpressionBatch', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.STORY_GENERATOR_FUNCTIONS_BASE_URL = 'https://us-central1-wordbank-6284f.cloudfunctions.net';
    process.env.ADMIN_API_SHARED_SECRET = 'test-secret';
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('jobId를 응답으로 받으면 그대로 반환한다', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jobId: 'job1' }),
    });

    const { submitExpressionBatch } = await import('./expressionPool');
    const result = await submitExpressionBatch('es', 10);

    expect(result).toEqual({ jobId: 'job1' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://us-central1-wordbank-6284f.cloudfunctions.net/adminSubmitExpressionBatch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-admin-api-key': 'test-secret' }),
        body: JSON.stringify({ language: 'es', count: 10 }),
      }),
    );
  });

  it('응답이 실패하면 에러 메시지를 던진다', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'language와 count(1-50)가 필요합니다' }),
    });

    const { submitExpressionBatch } = await import('./expressionPool');

    await expect(submitExpressionBatch('es', 0)).rejects.toThrow('language와 count(1-50)가 필요합니다');
  });
});
