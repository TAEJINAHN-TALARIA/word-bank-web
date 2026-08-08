import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session');
vi.mock('@/lib/data/wordCacheStats');

import { fetchTopWordsAction } from './wordCacheStatsActions';
import * as sessionModule from '@/lib/auth/session';
import * as statsModule from '@/lib/data/wordCacheStats';

const mockGetAdminSession = vi.mocked(sessionModule.getAdminSession);
const mockGetTopWordsForPair = vi.mocked(statsModule.getTopWordsForPair);

describe('fetchTopWordsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('관리자 세션이 없으면 빈 배열을 반환하고 getTopWordsForPair를 호출하지 않는다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const result = await fetchTopWordsAction('en', 'ko');

    expect(result).toEqual([]);
    expect(mockGetTopWordsForPair).not.toHaveBeenCalled();
  });

  it('관리자 세션이 있으면 getTopWordsForPair를 호출하고 그 결과를 반환한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce({ uid: 'admin1' });
    mockGetTopWordsForPair.mockResolvedValueOnce([{ word: 'run', hitCount: 50 }]);

    const result = await fetchTopWordsAction('en', 'ko');

    expect(mockGetTopWordsForPair).toHaveBeenCalledWith('en', 'ko');
    expect(result).toEqual([{ word: 'run', hitCount: 50 }]);
  });
});
