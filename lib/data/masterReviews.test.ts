import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin");

import {
  mapMasterChapters,
  mapCharacters,
  mapLevelGuidance,
  mapPreReview,
  buildMasterReviewDetail,
  mapPublishedDraft,
  getPublishedStoryForEdit,
} from "./masterReviews";
import * as admin from "@/lib/firebase/admin";

const layer4 = {
  output: {
    chapters: [
      { chapterNumber: 2, chapterTitle: "둘째", body: "둘째 첫.\n\n둘째 둘." },
      { chapterNumber: 1, chapterTitle: "첫째", body: "첫째 본문." },
    ],
  },
};

describe("mapMasterChapters", () => {
  it("body를 문단으로 나누고 챕터 번호 순으로 정렬한다", () => {
    expect(mapMasterChapters(layer4.output.chapters)).toEqual([
      { chapterNumber: 1, chapterTitle: "첫째", paragraphs: ["첫째 본문."] },
      { chapterNumber: 2, chapterTitle: "둘째", paragraphs: ["둘째 첫.", "둘째 둘."] },
    ]);
  });

  it("배열이 아니거나 챕터 번호가 없는 항목은 버린다", () => {
    expect(mapMasterChapters(undefined)).toEqual([]);
    expect(mapMasterChapters([{ chapterTitle: "번호 없음", body: "x" }])).toEqual([]);
  });
});

describe("mapCharacters / mapLevelGuidance / mapPreReview", () => {
  it("인물은 이름이 있는 것만, 말투가 없으면 null로 둔다", () => {
    expect(mapCharacters([{ name: "하린", speechStyle: "합쇼체" }, { name: "할아버지" }, { speechStyle: "x" }])).toEqual([
      { name: "하린", speechStyle: "합쇼체" },
      { name: "할아버지", speechStyle: null },
    ]);
  });

  it("레벨 기준은 필드가 모두 맞을 때만 돌려준다", () => {
    expect(mapLevelGuidance({ sentenceLen: 30, unit: "자", stageLabel: "중학생" })).toEqual({
      sentenceLen: 30,
      unit: "자",
      stageLabel: "중학생",
    });
    expect(mapLevelGuidance({ sentenceLen: "30" })).toBeNull();
    expect(mapLevelGuidance(undefined)).toBeNull();
  });

  it("사전 검토 메모는 배열이 아니면 null(미생성), 형태가 틀린 항목은 버린다", () => {
    expect(mapPreReview(undefined)).toBeNull();
    expect(
      mapPreReview([
        { chapterNumber: 2, paragraphIndex: 2, kind: "긴 문장", text: "길어요" },
        { chapterNumber: "2", paragraphIndex: 0, kind: "x", text: "y" },
      ]),
    ).toEqual([{ chapterNumber: 2, paragraphIndex: 2, kind: "긴 문장", text: "길어요" }]);
  });
});

describe("buildMasterReviewDetail", () => {
  const session = {
    targetLevel: "Lv3",
    executionPath: "batch",
    masterReview: {
      confirmedChapters: [1],
      gateNote: "levelFit: 어려움",
      levelGuidance: { sentenceLen: 30, unit: "자", stageLabel: "초등학교 고학년(5~6학년)" },
    },
  };
  const layer1 = { output: { title: "비 오는 날", narrativeStyle: "-했다체", characters: [{ name: "하린", speechStyle: "합쇼체" }] } };

  it("세션·layer1·layer4를 편집 화면 상세로 합친다", () => {
    const detail = buildMasterReviewDetail({ sessionId: "s1", session, layer1, layer4, layer4Original: layer4 });
    expect(detail).toMatchObject({
      mode: "review",
      id: "s1",
      title: "비 오는 날",
      level: "Lv3",
      executionPath: "batch",
      narrativeStyle: "-했다체",
      confirmedChapters: [1],
      gateNote: "levelFit: 어려움",
      preReview: null,
    });
    expect(detail?.chapters).toHaveLength(2);
    expect(detail?.characters).toEqual([{ name: "하린", speechStyle: "합쇼체" }]);
  });

  it("마스터 본문이 없으면 null이다", () => {
    expect(buildMasterReviewDetail({ sessionId: "s1", session, layer1, layer4: null, layer4Original: null })).toBeNull();
  });

  it("원본(layer4Original)이 없으면 현재 본을 원본으로 쓴다", () => {
    const detail = buildMasterReviewDetail({ sessionId: "s1", session, layer1, layer4, layer4Original: null });
    expect(detail?.original).toEqual(detail?.chapters);
  });
});

describe("mapPublishedDraft", () => {
  const raw = { edits: [{ num: 2, paragraphs: ["고친 문단"] }], baseContentVersion: 3, updatedAt: new Date(1_700_000_000_000) };

  it("없거나 모양이 틀리면 null이다", () => {
    expect(mapPublishedDraft(undefined, 3)).toBeNull();
    expect(mapPublishedDraft(null, 3)).toBeNull();
    expect(mapPublishedDraft({ ...raw, edits: "x" }, 3)).toBeNull();
    expect(mapPublishedDraft({ ...raw, baseContentVersion: "3" }, 3)).toBeNull();
  });

  it("초안을 만든 때의 게시 버전이 지금과 같으면 stale이 아니다", () => {
    expect(mapPublishedDraft(raw, 3)).toEqual({ edits: raw.edits, baseContentVersion: 3, updatedAt: 1_700_000_000_000, stale: false });
  });

  it("그 사이 게시본이 바뀌었거나(버전 다름) 반영 뒤 남은 초안이면 stale이다", () => {
    expect(mapPublishedDraft(raw, 4)?.stale).toBe(true);
  });

  it("updatedAt은 Timestamp(toMillis)·Date·그 밖(0)을 ms로 바꾼다", () => {
    expect(mapPublishedDraft({ ...raw, updatedAt: { toMillis: () => 42 } }, 3)?.updatedAt).toBe(42);
    expect(mapPublishedDraft({ ...raw, updatedAt: undefined }, 3)?.updatedAt).toBe(0);
  });
});

describe("getPublishedStoryForEdit", () => {
  function fakeDb(docs: Record<string, unknown>) {
    vi.mocked(admin.getAdminFirestore).mockReturnValue({
      collection: (c: string) => ({
        doc: (id: string) => ({ get: async () => ({ exists: `${c}/${id}` in docs, data: () => docs[`${c}/${id}`] }) }),
      }),
    } as never);
  }
  const base = {
    "stories/d1": { lang: "ko", title: "제목", level: "Lv3", contentVersion: 5 },
    "storyContent/d1": { chapters: [{ num: 1, title: "첫째", paragraphs: ["가", "나"] }] },
  };

  it("현재 게시 버전과 이어 쓰던 초안을 상세에 담는다", async () => {
    const edits = [{ num: 1, paragraphs: ["가", "고침"] }];
    fakeDb({ ...base, "publishedDrafts/d1": { edits, baseContentVersion: 5, updatedAt: new Date(1000) } });
    const story = await getPublishedStoryForEdit("d1");
    expect(story?.detail.contentVersion).toBe(5);
    expect(story?.detail.draft).toEqual({ edits, baseContentVersion: 5, updatedAt: 1000, stale: false });
    expect(story?.detail.chapters[0].paragraphs).toEqual(["가", "나"]);
  });

  it("초안이 없으면 draft는 null이고, 게시 버전이 없으면 0이다", async () => {
    fakeDb({ ...base, "stories/d1": { lang: "ko", title: "제목", level: "Lv3" } });
    const story = await getPublishedStoryForEdit("d1");
    expect(story?.detail.draft).toBeNull();
    expect(story?.detail.contentVersion).toBe(0);
  });
});
