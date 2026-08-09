import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session');
vi.mock('@/lib/admin-functions/storyGenerator');
vi.mock('next/cache');

import { publishStoriesAction } from './adminStoryActions';
import * as sessionModule from '@/lib/auth/session';
import * as storyGeneratorModule from '@/lib/admin-functions/storyGenerator';
import * as cacheModule from 'next/cache';

const mockGetAdminSession = vi.mocked(sessionModule.getAdminSession);
const mockPublishStory = vi.mocked(storyGeneratorModule.publishStory);
const mockRevalidatePath = vi.mocked(cacheModule.revalidatePath);

describe('publishStoriesAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('관리자 세션이 없으면 모든 항목에 에러를 채워 반환하고 publishStory를 호출하지 않는다', async () => {
    mockGetAdminSession.mockResolvedValueOnce(null);

    const result = await publishStoriesAction([{ sessionId: 's1', target: 'en' }]);

    expect(result).toEqual([
      { sessionId: 's1', target: 'en', error: '관리자 로그인이 필요합니다' },
    ]);
    expect(mockPublishStory).not.toHaveBeenCalled();
  });

  it('일부만 실패해도 각 건의 성공/실패를 모두 반환한다', async () => {
    mockGetAdminSession.mockResolvedValueOnce({ uid: 'admin1' });
    mockPublishStory
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('타임아웃'));

    const result = await publishStoriesAction([
      { sessionId: 's1', target: 'en' },
      { sessionId: 's1', target: 'ja' },
    ]);

    expect(result).toEqual([
      { sessionId: 's1', target: 'en' },
      { sessionId: 's1', target: 'ja', error: '타임아웃' },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/review');
  });
});
