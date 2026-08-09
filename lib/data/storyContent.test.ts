import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase/admin');

import { getStoryContent } from './storyContent';
import * as adminModule from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);

describe('getStoryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('문서를 챕터 배열로 매핑한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        chapters: [
          { num: 1, title: '1장', paragraphs: ['첫 문단', '둘째 문단'] },
          { num: 2, title: null, paragraphs: [] },
        ],
      }),
    });
    const mockDoc = vi.fn(() => ({ get: mockGet }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));

    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getStoryContent('session1_en');

    expect(mockCollection).toHaveBeenCalledWith('storyContent');
    expect(mockDoc).toHaveBeenCalledWith('session1_en');
    expect(result).toEqual([
      { num: 1, title: '1장', paragraphs: ['첫 문단', '둘째 문단'] },
      { num: 2, title: null, paragraphs: [] },
    ]);
  });

  it('문서가 없으면 null을 반환한다', async () => {
    const mockGet = vi.fn().mockResolvedValue({ exists: false });
    const mockDoc = vi.fn(() => ({ get: mockGet }));
    const mockCollection = vi.fn(() => ({ doc: mockDoc }));

    mockGetAdminFirestore.mockReturnValue({ collection: mockCollection } as unknown as Firestore);

    const result = await getStoryContent('missing');

    expect(result).toBeNull();
  });
});
