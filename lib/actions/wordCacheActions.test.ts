import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('@/lib/firebase/admin');
vi.mock('@/lib/auth/session');
vi.mock('next/cache');

import { restoreWordCacheEntryAction } from './wordCacheActions';
import * as adminModule from '@/lib/firebase/admin';
import * as sessionModule from '@/lib/auth/session';
import * as cacheModule from 'next/cache';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);
const mockGetAdminSession = vi.mocked(sessionModule.getAdminSession);
const mockRevalidatePath = vi.mocked(cacheModule.revalidatePath);

describe('restoreWordCacheEntryAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('관리자 세션이 없으면 에러를 반환하고 Firestore를 건드리지 않는다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const mockUpdate = vi.fn();
    const mockDoc = vi.fn(() => ({ update: mockUpdate }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));
    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as unknown as Firestore);

    const result = await restoreWordCacheEntryAction('run_en_ko');

    expect(result).toEqual({ error: '관리자 로그인이 필요합니다' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('관리자 세션이 있으면 reportCount를 0으로 리셋하고 페이지를 재검증한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce({ uid: 'admin1' });

    const mockUpdate = vi.fn().mockResolvedValueOnce(undefined);
    const mockDoc = vi.fn(() => ({ update: mockUpdate }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));
    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as unknown as Firestore);

    const result = await restoreWordCacheEntryAction('run_en_ko');

    expect(mockCollection).toHaveBeenCalledWith('word_cache');
    expect(mockDoc).toHaveBeenCalledWith('run_en_ko');
    expect(mockUpdate).toHaveBeenCalledWith({ reportCount: 0 });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/quality');
    expect(result).toEqual({});
  });

  it('Firestore 쓰기가 실패하면 에러 메시지를 반환한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce({ uid: 'admin1' });

    const mockUpdate = vi.fn().mockRejectedValueOnce(new Error('문서를 찾을 수 없습니다'));
    const mockDoc = vi.fn(() => ({ update: mockUpdate }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));
    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as unknown as Firestore);

    const result = await restoreWordCacheEntryAction('nonexistent_en_ko');

    expect(result).toEqual({ error: '문서를 찾을 수 없습니다' });
  });
});
