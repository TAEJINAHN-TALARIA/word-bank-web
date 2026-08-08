import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/firebase/admin');

import { listAutoHiddenWords } from './wordCacheQueue';
import * as adminModule from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);

function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

describe('listAutoHiddenWords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reportCount >= 3인 word_cache 문서를 최근 갱신순으로 조회한다', async () => {
    const mockGet = vi.fn();
    const mockOrderBy = vi.fn(() => ({ get: mockGet }));
    const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockCollection = vi.fn(() => ({ where: mockWhere }));

    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as unknown as Firestore);

    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'run_en_ko',
          data: () => ({
            word: 'run', wordLanguage: 'en', meaningLanguage: 'ko',
            reportCount: 4, updatedAt: makeTimestamp('2026-08-07T00:00:00.000Z'),
          }),
        },
      ],
    });

    const result = await listAutoHiddenWords();

    expect(mockCollection).toHaveBeenCalledWith('word_cache');
    expect(mockWhere).toHaveBeenCalledWith('reportCount', '>=', 3);
    expect(mockOrderBy).toHaveBeenCalledWith('updatedAt', 'desc');
    expect(result).toEqual([
      { cacheKey: 'run_en_ko', word: 'run', wordLanguage: 'en', meaningLanguage: 'ko', reportCount: 4, updatedAt: '2026-08-07T00:00:00.000Z' },
    ]);
  });

  it('대기열이 비어있으면 빈 배열을 반환한다', async () => {
    const mockGet = vi.fn();
    const mockOrderBy = vi.fn(() => ({ get: mockGet }));
    const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockCollection = vi.fn(() => ({ where: mockWhere }));

    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as unknown as Firestore);

    mockGet.mockResolvedValueOnce({ docs: [] });

    const result = await listAutoHiddenWords();

    expect(result).toEqual([]);
  });
});
