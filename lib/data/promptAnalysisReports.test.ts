import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/firebase/admin');

import { listPromptAnalysisReports } from './promptAnalysisReports';
import * as adminModule from '@/lib/firebase/admin';

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);

function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

describe('listPromptAnalysisReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prompt_analysis_reports를 periodStart 오름차순으로 조회한다', async () => {
    const mockGet = vi.fn();
    const mockOrderBy = vi.fn(() => ({ get: mockGet }));
    const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy }));

    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as any);

    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'r1',
          data: () => ({
            periodStart: makeTimestamp('2026-08-01T00:00:00.000Z'),
            periodEnd: makeTimestamp('2026-08-08T00:00:00.000Z'),
            reportCount: 5,
            fieldBreakdown: { meanings: 3, phonetic: 2 },
            languageBreakdown: { en: 4, ko: 1 },
            feedbackCount: 2,
            analysis: '## Key Patterns\n...',
            createdAt: makeTimestamp('2026-08-08T00:05:00.000Z'),
          }),
        },
      ],
    });

    const result = await listPromptAnalysisReports();

    expect(mockCollection).toHaveBeenCalledWith('prompt_analysis_reports');
    expect(mockOrderBy).toHaveBeenCalledWith('periodStart', 'asc');
    expect(result).toEqual([
      {
        id: 'r1',
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-08-08T00:00:00.000Z',
        reportCount: 5,
        fieldBreakdown: { meanings: 3, phonetic: 2 },
        languageBreakdown: { en: 4, ko: 1 },
        feedbackCount: 2,
        analysis: '## Key Patterns\n...',
        createdAt: '2026-08-08T00:05:00.000Z',
      },
    ]);
  });

  it('리포트가 하나도 없으면 빈 배열을 반환한다', async () => {
    const mockGet = vi.fn();
    const mockOrderBy = vi.fn(() => ({ get: mockGet }));
    const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy }));

    mockGetAdminFirestore.mockReturnValue({
      collection: mockCollection,
    } as any);

    mockGet.mockResolvedValueOnce({ docs: [] });

    const result = await listPromptAnalysisReports();

    expect(result).toEqual([]);
  });
});
