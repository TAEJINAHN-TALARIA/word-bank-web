import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase/admin');

import { getCacheLoadByLanguage } from './wordCacheStats';
import * as adminModule from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);

describe('getCacheLoadByLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('언어별 count()를 조회해 0보다 큰 것만 count 내림차순으로 반환한다', async () => {
    const mockWhere = vi.fn((_field: string, _op: string, value: string) => ({
      count: () => ({
        get: () =>
          Promise.resolve({
            data: () => ({ count: value === 'en' ? 10 : value === 'ko' ? 30 : 0 }),
          }),
      }),
    }));
    const mockCollection = vi.fn(() => ({ where: mockWhere }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getCacheLoadByLanguage();

    expect(mockCollection).toHaveBeenCalledWith('word_cache');
    expect(result).toEqual([
      { wordLanguage: 'ko', count: 30 },
      { wordLanguage: 'en', count: 10 },
    ]);
  });

  it('모든 언어의 count가 0이면 빈 배열을 반환한다', async () => {
    const mockWhere = vi.fn(() => ({
      count: () => ({ get: () => Promise.resolve({ data: () => ({ count: 0 }) }) }),
    }));
    const mockCollection = vi.fn(() => ({ where: mockWhere }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getCacheLoadByLanguage();

    expect(result).toEqual([]);
  });
});
