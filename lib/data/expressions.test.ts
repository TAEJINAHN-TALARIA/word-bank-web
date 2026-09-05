import { describe, it, expect, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase/admin');

import { listExpressions, listExpressionPoolConfigs, listExpressionBatchJobs } from './expressions';
import { getAdminFirestore } from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(getAdminFirestore);

function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

describe('listExpressions', () => {
  it('페이지 크기보다 많으면 nextCursor를 채운다', async () => {
    const docs = Array.from({ length: 51 }, (_, i) => ({
      id: `e${i}`,
      data: () => ({
        text: `expr${i}`, register: 'casual', meanings: {}, similarExpressions: [],
        createdAt: makeTimestamp('2026-08-05T00:00:00.000Z'),
      }),
    }));
    const mockGet = vi.fn().mockResolvedValueOnce({ docs });
    const mockLimit = vi.fn(() => ({ get: mockGet }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockItemsCollection = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection }));
    const mockCollection = vi.fn(() => ({ doc: mockLangDoc }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await listExpressions('en');

    expect(mockCollection).toHaveBeenCalledWith('expressions');
    expect(mockLangDoc).toHaveBeenCalledWith('en');
    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe('e49');
  });

  it('결과가 페이지 크기 이하이면 nextCursor는 null이다', async () => {
    const docs = [{
      id: 'e0',
      data: () => ({
        text: 'break the ice', register: 'casual', meanings: {}, similarExpressions: [],
        createdAt: makeTimestamp('2026-08-05T00:00:00.000Z'),
      }),
    }];
    const mockGet = vi.fn().mockResolvedValueOnce({ docs });
    const mockLimit = vi.fn(() => ({ get: mockGet }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockItemsCollection = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection }));
    const mockCollection = vi.fn(() => ({ doc: mockLangDoc }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await listExpressions('en');

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });
});

describe('listExpressionPoolConfigs', () => {
  it('언어별 targetSize와 현재 count를 함께 반환한다', async () => {
    const mockConfigGet = vi.fn().mockResolvedValue({ exists: true, data: () => ({ targetSize: 50 }) });
    const mockCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 30 }) });
    const mockCount = vi.fn(() => ({ get: mockCountGet }));
    const mockItemsCollection = vi.fn(() => ({ count: mockCount }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection, get: mockConfigGet }));
    const mockCollection = vi.fn(() => ({ doc: mockLangDoc }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await listExpressionPoolConfigs(['en']);

    expect(result).toEqual([{ language: 'en', targetSize: 50, currentCount: 30 }]);
  });

  it('설정 문서가 없으면 targetSize는 0이다', async () => {
    const mockConfigGet = vi.fn().mockResolvedValue({ exists: false });
    const mockCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) });
    const mockCount = vi.fn(() => ({ get: mockCountGet }));
    const mockItemsCollection = vi.fn(() => ({ count: mockCount }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection, get: mockConfigGet }));
    const mockCollection = vi.fn(() => ({ doc: mockLangDoc }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await listExpressionPoolConfigs(['it']);

    expect(result).toEqual([{ language: 'it', targetSize: 0, currentCount: 0 }]);
  });
});

describe('listExpressionBatchJobs', () => {
  it('언어 필터 없이 최근 작업 목록을 반환한다', async () => {
    const docs = [{
      id: 'job1',
      data: () => ({
        language: 'en', count: 10, status: 'succeeded', requestedBy: 'manual',
        createdAt: makeTimestamp('2026-08-05T00:00:00.000Z'),
        completedAt: makeTimestamp('2026-08-05T01:00:00.000Z'),
        error: null,
      }),
    }];
    const mockGet = vi.fn().mockResolvedValueOnce({ docs });
    const mockLimit = vi.fn(() => ({ get: mockGet }));
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy }));
    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await listExpressionBatchJobs();

    expect(result).toEqual([{
      id: 'job1', language: 'en', count: 10, status: 'succeeded', requestedBy: 'manual',
      createdAt: '2026-08-05T00:00:00.000Z', completedAt: '2026-08-05T01:00:00.000Z', error: null,
    }]);
  });
});
