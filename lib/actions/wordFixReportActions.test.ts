import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session');
vi.mock('@/lib/data/wordFixReports');

import { fetchNextFeedbackPageAction } from './wordFixReportActions';
import * as sessionModule from '@/lib/auth/session';
import * as wordFixReportsModule from '@/lib/data/wordFixReports';

const mockGetAdminSession = vi.mocked(sessionModule.getAdminSession);
const mockListUserFeedback = vi.mocked(wordFixReportsModule.listUserFeedback);

describe('fetchNextFeedbackPageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('관리자 세션이 없으면 빈 페이지를 반환하고 listUserFeedback을 호출하지 않는다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const result = await fetchNextFeedbackPageAction('cursor1');

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(mockListUserFeedback).not.toHaveBeenCalled();
  });

  it('관리자 세션이 있으면 listUserFeedback을 호출하고 그 결과를 반환한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce({ uid: 'admin1' });
    const page = {
      items: [
        {
          id: 'f1',
          word: 'run',
          wordLanguage: 'en',
          meaningLanguage: 'ko',
          userFeedback: '뜻이 이상해요',
          createdAt: '2026-08-05T00:00:00.000Z',
        },
      ],
      nextCursor: 'f1',
    };
    mockListUserFeedback.mockResolvedValueOnce(page);

    const result = await fetchNextFeedbackPageAction('cursor1');

    expect(mockListUserFeedback).toHaveBeenCalledWith('cursor1');
    expect(result).toEqual(page);
  });
});
