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

import { getSearchVolumeByLanguagePair } from './wordCacheStats';

describe('getSearchVolumeByLanguagePair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovered wordLanguage들에 대해서만 언어쌍 조합의 hitCount 합계를 조회한다', async () => {
    const mockWhere2 = vi.fn((_field: string, _op: string, meaningLanguage: string) => ({
      aggregate: () => ({
        get: () =>
          Promise.resolve({
            data: () => ({ total: meaningLanguage === 'ko' ? 42 : 0 }),
          }),
      }),
    }));
    const mockWhere1 = vi.fn(() => ({ where: mockWhere2 }));
    const mockCollection = vi.fn(() => ({ where: mockWhere1 }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getSearchVolumeByLanguagePair([{ wordLanguage: 'en', count: 10 }]);

    expect(mockWhere1).toHaveBeenCalledWith('wordLanguage', '==', 'en');
    expect(result).toEqual([{ wordLanguage: 'en', meaningLanguage: 'ko', hitCount: 42 }]);
  });

  it('discovered가 비어있으면 쿼리 없이 빈 배열을 반환한다', async () => {
    const mockCollection = vi.fn();
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getSearchVolumeByLanguagePair([]);

    expect(result).toEqual([]);
    expect(mockCollection).not.toHaveBeenCalled();
  });
});

import { getTopWordsForPair } from './wordCacheStats';

describe('getTopWordsForPair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('언어쌍으로 필터링하고 hitCount 내림차순 limit개를 조회한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      docs: [
        { data: () => ({ word: 'run', hitCount: 50 }) },
        { data: () => ({ word: 'walk', hitCount: 20 }) },
      ],
    });
    const mockLimit = vi.fn(() => ({ get: mockGet }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockWhere2 = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockWhere1 = vi.fn(() => ({ where: mockWhere2 }));
    const mockCollection = vi.fn(() => ({ where: mockWhere1 }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getTopWordsForPair('en', 'ko', 5);

    expect(mockWhere1).toHaveBeenCalledWith('wordLanguage', '==', 'en');
    expect(mockWhere2).toHaveBeenCalledWith('meaningLanguage', '==', 'ko');
    expect(mockOrderBy).toHaveBeenCalledWith('hitCount', 'desc');
    expect(mockLimit).toHaveBeenCalledWith(5);
    expect(result).toEqual([
      { word: 'run', hitCount: 50 },
      { word: 'walk', hitCount: 20 },
    ]);
  });

  it('limitCount 생략 시 기본값 10을 사용한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({ docs: [] });
    const mockLimit = vi.fn(() => ({ get: mockGet }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockWhere2 = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockWhere1 = vi.fn(() => ({ where: mockWhere2 }));
    const mockCollection = vi.fn(() => ({ where: mockWhere1 }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    await getTopWordsForPair('en', 'ko');

    expect(mockLimit).toHaveBeenCalledWith(10);
  });
});

import { getSearchFailureRates } from './wordCacheStats';

describe('getSearchFailureRates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('word_search_failures를 읽어 대응하는 hitCount와 합쳐 실패 비율을 계산한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      docs: [
        { id: 'en_ko', data: () => ({ wordLanguage: 'en', meaningLanguage: 'ko', failCount: 10 }) },
        { id: 'ja_en', data: () => ({ wordLanguage: 'ja', meaningLanguage: 'en', failCount: 5 }) },
      ],
    });
    const mockCollection = vi.fn(() => ({ get: mockGet }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getSearchFailureRates([
      { wordLanguage: 'en', meaningLanguage: 'ko', hitCount: 90 },
    ]);

    expect(mockCollection).toHaveBeenCalledWith('word_search_failures');
    expect(result).toEqual([
      { wordLanguage: 'ja', meaningLanguage: 'en', failCount: 5, hitCount: 0, failureRatio: 1 },
      { wordLanguage: 'en', meaningLanguage: 'ko', failCount: 10, hitCount: 90, failureRatio: 0.1 },
    ]);
  });

  it('word_search_failures가 비어있으면 빈 배열을 반환한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({ docs: [] });
    const mockCollection = vi.fn(() => ({ get: mockGet }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getSearchFailureRates([]);

    expect(result).toEqual([]);
  });
});

import { getLocaleDistribution } from './wordCacheStats';

describe('getLocaleDistribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('최근 문서의 locale 필드를 세어 내림차순으로 반환하고, locale이 없으면 "알 수 없음"으로 묶는다', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      docs: [
        { data: () => ({ locale: 'ko-KR' }) },
        { data: () => ({ locale: 'ko-KR' }) },
        { data: () => ({ locale: 'en-US' }) },
        { data: () => ({}) },
      ],
    });
    const mockSelect = vi.fn(() => ({ get: mockGet }));
    const mockLimit = vi.fn(() => ({ select: mockSelect }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getLocaleDistribution();

    expect(mockCollection).toHaveBeenCalledWith('word_cache');
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mockSelect).toHaveBeenCalledWith('locale');
    expect(result).toEqual([
      { locale: 'ko-KR', count: 2 },
      { locale: 'en-US', count: 1 },
      { locale: '알 수 없음', count: 1 },
    ]);
  });
});
