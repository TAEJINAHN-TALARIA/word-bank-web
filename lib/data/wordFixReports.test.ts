import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock the admin module without factory to avoid TDZ
vi.mock('@/lib/firebase/admin');

import { listUserFeedback } from './wordFixReports';
import { getAdminFirestore } from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(getAdminFirestore);

function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

function makeDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      word: 'run', wordLanguage: 'en', meaningLanguage: 'ko',
      userFeedback: '뜻이 이상해요', createdAt: makeTimestamp('2026-08-05T00:00:00.000Z'),
      ...overrides,
    }),
  };
}

describe('listUserFeedback', () => {
  let mockGet: ReturnType<typeof vi.fn>;
  let mockLimit: ReturnType<typeof vi.fn>;
  let mockStartAfter: ReturnType<typeof vi.fn>;
  let mockOrderBy: ReturnType<typeof vi.fn>;
  let mockWhere: ReturnType<typeof vi.fn>;
  let mockDocGet: ReturnType<typeof vi.fn>;
  let mockDoc: ReturnType<typeof vi.fn>;
  let mockCollection: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGet = vi.fn();
    mockLimit = vi.fn(() => ({ get: mockGet }));
    mockStartAfter = vi.fn(() => ({ limit: mockLimit }));
    mockOrderBy = vi.fn(() => ({ limit: mockLimit, startAfter: mockStartAfter }));
    mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
    mockDocGet = vi.fn();
    mockDoc = vi.fn(() => ({ get: mockDocGet }));
    mockCollection = vi.fn(() => ({ where: mockWhere, doc: mockDoc }));

    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as any);
  });

  it('userFeedback != null 조건으로 최신순 페이지를 가져오고, 다음 페이지가 있으면 nextCursor를 채운다', async () => {
    // pageSize=1 요청 시 pageSize+1개를 가져와 "더 있는지" 판단한다
    mockGet.mockResolvedValueOnce({ docs: [makeDoc('f1'), makeDoc('f2')] });

    const result = await listUserFeedback(undefined, 1);

    expect(mockWhere).toHaveBeenCalledWith('userFeedback', '!=', null);
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mockLimit).toHaveBeenCalledWith(2); // pageSize + 1
    expect(result.items).toEqual([
      { id: 'f1', word: 'run', wordLanguage: 'en', meaningLanguage: 'ko', userFeedback: '뜻이 이상해요', createdAt: '2026-08-05T00:00:00.000Z' },
    ]);
    expect(result.nextCursor).toBe('f1');
  });

  it('남은 항목이 pageSize 이하이면 nextCursor는 null이다', async () => {
    mockGet.mockResolvedValueOnce({ docs: [makeDoc('f1')] });

    const result = await listUserFeedback(undefined, 1);

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('cursor가 주어지면 해당 문서 이후부터 조회한다', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: true, id: 'f1' });
    mockGet.mockResolvedValueOnce({ docs: [makeDoc('f2')] });

    await listUserFeedback('f1', 20);

    expect(mockDoc).toHaveBeenCalledWith('f1');
    expect(mockStartAfter).toHaveBeenCalled();
  });

  it('결과가 없으면 빈 items와 null cursor를 반환한다', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] });

    const result = await listUserFeedback();

    expect(result).toEqual({ items: [], nextCursor: null });
  });
});
