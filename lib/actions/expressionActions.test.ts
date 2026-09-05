import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase/admin');
vi.mock('@/lib/auth/session');
vi.mock('next/cache');
vi.mock('@/lib/admin-functions/expressionPool');
vi.mock('@/lib/data/expressions', () => ({ listExpressions: vi.fn() }));

import {
  updateExpressionAction,
  deleteExpressionAction,
  updateExpressionPoolConfigAction,
  submitExpressionBatchAction,
  fetchMoreExpressionsAction,
} from './expressionActions';
import * as adminModule from '@/lib/firebase/admin';
import * as sessionModule from '@/lib/auth/session';
import * as cacheModule from 'next/cache';
import * as expressionPoolModule from '@/lib/admin-functions/expressionPool';
import * as expressionsDataModule from '@/lib/data/expressions';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);
const mockGetAdminSession = vi.mocked(sessionModule.getAdminSession);
const mockRevalidatePath = vi.mocked(cacheModule.revalidatePath);
const mockSubmitExpressionBatch = vi.mocked(expressionPoolModule.submitExpressionBatch);
const mockListExpressions = vi.mocked(expressionsDataModule.listExpressions);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminSession.mockResolvedValue({ uid: 'admin1' });
});

describe('updateExpressionAction', () => {
  it('허용되지 않은 필드가 있으면 Firestore를 건드리지 않고 에러를 반환한다', async () => {
    const mockUpdate = vi.fn();
    const mockDoc = vi.fn(() => ({ update: mockUpdate }));
    const mockItemsCollection = vi.fn(() => ({ doc: mockDoc }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection }));
    mockGetAdminFirestore.mockReturnValue({ collection: vi.fn(() => ({ doc: mockLangDoc })) } as unknown as Firestore);

    const result = await updateExpressionAction('en', 'e1', { text: 'ok', createdAt: 'hack' } as never);

    expect(result.error).toBeDefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('허용된 필드만 있으면 Firestore를 업데이트하고 페이지를 재검증한다', async () => {
    const mockUpdate = vi.fn().mockResolvedValueOnce(undefined);
    const mockDoc = vi.fn(() => ({ update: mockUpdate }));
    const mockItemsCollection = vi.fn(() => ({ doc: mockDoc }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection }));
    mockGetAdminFirestore.mockReturnValue({ collection: vi.fn(() => ({ doc: mockLangDoc })) } as unknown as Firestore);

    const result = await updateExpressionAction('en', 'e1', { text: 'break the ice' });

    expect(mockUpdate).toHaveBeenCalledWith({ text: 'break the ice' });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/expressions');
    expect(result).toEqual({});
  });

  it('관리자 세션이 없으면 에러를 반환한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const result = await updateExpressionAction('en', 'e1', { text: 'x' });

    expect(result).toEqual({ error: '관리자 로그인이 필요합니다' });
  });
});

describe('deleteExpressionAction', () => {
  it('Firestore 문서를 삭제하고 페이지를 재검증한다', async () => {
    const mockDelete = vi.fn().mockResolvedValueOnce(undefined);
    const mockDoc = vi.fn(() => ({ delete: mockDelete }));
    const mockItemsCollection = vi.fn(() => ({ doc: mockDoc }));
    const mockLangDoc = vi.fn(() => ({ collection: mockItemsCollection }));
    mockGetAdminFirestore.mockReturnValue({ collection: vi.fn(() => ({ doc: mockLangDoc })) } as unknown as Firestore);

    const result = await deleteExpressionAction('en', 'e1');

    expect(mockDelete).toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/expressions');
    expect(result).toEqual({});
  });
});

describe('updateExpressionPoolConfigAction', () => {
  it('targetSize가 양의 정수가 아니면 에러를 반환한다', async () => {
    const result = await updateExpressionPoolConfigAction('en', -1);

    expect(result.error).toBeDefined();
  });

  it('유효하면 expressionPoolConfig 문서를 merge로 저장한다', async () => {
    const mockSet = vi.fn().mockResolvedValueOnce(undefined);
    const mockDoc = vi.fn(() => ({ set: mockSet }));
    mockGetAdminFirestore.mockReturnValue({ collection: vi.fn(() => ({ doc: mockDoc })) } as unknown as Firestore);

    const result = await updateExpressionPoolConfigAction('en', 100);

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ targetSize: 100 }),
      { merge: true },
    );
    expect(result).toEqual({});
  });
});

describe('submitExpressionBatchAction', () => {
  it('성공하면 jobId를 반환하고 페이지를 재검증한다', async () => {
    mockSubmitExpressionBatch.mockResolvedValueOnce({ jobId: 'job1' });

    const result = await submitExpressionBatchAction('en', 10);

    expect(mockSubmitExpressionBatch).toHaveBeenCalledWith('en', 10);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/expressions');
    expect(result).toEqual({ jobId: 'job1' });
  });

  it('실패하면 에러 메시지를 반환한다', async () => {
    mockSubmitExpressionBatch.mockRejectedValueOnce(new Error('Gemini batch submit error'));

    const result = await submitExpressionBatchAction('en', 10);

    expect(result).toEqual({ error: 'Gemini batch submit error' });
  });
});

describe('fetchMoreExpressionsAction', () => {
  it('listExpressions에 위임한다', async () => {
    mockListExpressions.mockResolvedValueOnce({ items: [], nextCursor: null });

    const result = await fetchMoreExpressionsAction('en', 'cursor1');

    expect(mockListExpressions).toHaveBeenCalledWith('en', 'cursor1');
    expect(result).toEqual({ items: [], nextCursor: null });
  });
});
