import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase/admin');

import { getPipelineSessionDetail } from './pipelineSessions';
import * as adminModule from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);

function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

describe('getPipelineSessionDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('세션 문서 조회와 layer6Gates 서브컬렉션 조회를 병렬로 실행한다', async () => {
    let resolveDoc!: (value: unknown) => void;
    let resolveGates!: (value: unknown) => void;
    const docPromise = new Promise((resolve) => {
      resolveDoc = resolve;
    });
    const gatesPromise = new Promise((resolve) => {
      resolveGates = resolve;
    });

    const mockDocGet = vi.fn(() => docPromise);
    const mockGatesGet = vi.fn(() => gatesPromise);
    const mockGatesCollection = vi.fn(() => ({ get: mockGatesGet }));
    const mockDoc = vi.fn(() => ({ get: mockDocGet, collection: mockGatesCollection }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));

    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as unknown as Firestore);

    const resultPromise = getPipelineSessionDetail('session_1');

    // 두 호출 모두 첫 await 이전에 동기적으로 나가야 한다. 순차 구현이라면
    // 이 시점에 mockGatesGet은 아직 호출되지 않았을 것이다.
    expect(mockDoc).toHaveBeenCalledTimes(1);
    expect(mockDocGet).toHaveBeenCalledTimes(1);
    expect(mockGatesGet).toHaveBeenCalledTimes(1);

    resolveDoc({
      id: 'session_1',
      exists: true,
      data: () => ({
        status: 'in_progress',
        runId: 'run_1',
        targetLevel: 'A1',
        combo: {},
        targetLanguages: ['en'],
        createdAt: makeTimestamp('2026-08-08T00:00:00.000Z'),
      }),
    });
    resolveGates({
      docs: [
        {
          id: 'ko',
          data: () => ({
            latestStatus: 'pass',
            ruleBaseWarnings: [],
            llmEvalReasons: [],
            retryCount: 0,
          }),
        },
      ],
    });

    const result = await resultPromise;
    expect(result?.id).toBe('session_1');
    expect(result?.layer6Gates).toEqual([
      { target: 'ko', latestStatus: 'pass', ruleBaseWarnings: [], llmEvalReasons: [], retryCount: 0 },
    ]);
  });

  it('세션 문서가 없으면 null을 반환한다', async () => {
    const mockDocGet = vi.fn().mockResolvedValue({ exists: false });
    const mockGatesGet = vi.fn().mockResolvedValue({ docs: [] });
    const mockGatesCollection = vi.fn(() => ({ get: mockGatesGet }));
    const mockDoc = vi.fn(() => ({ get: mockDocGet, collection: mockGatesCollection }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));

    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as unknown as Firestore);

    const result = await getPipelineSessionDetail('missing');

    expect(result).toBeNull();
  });
});
