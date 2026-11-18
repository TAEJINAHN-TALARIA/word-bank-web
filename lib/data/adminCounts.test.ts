import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin");

import { getAdminNavCounts, getHomeStageCounts } from "./adminCounts";
import * as adminModule from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";

const mockGetAdminFirestore = vi.mocked(adminModule.getAdminFirestore);

// collection(name).where(field, op, value)....count().get() 체인을 흉내 내고, 호출된 조건을 기록한다.
function fakeDb(counts: Record<string, number | Error>) {
  const calls: string[] = [];
  const db = {
    collection: (name: string) => ({
      where: (field: string, op: string, value: unknown) => {
        const key = `${name}.${field}${op}${String(value)}`;
        calls.push(key);
        return {
          count: () => ({
            get: async () => {
              const result = counts[key];
              if (result instanceof Error) throw result;
              return { data: () => ({ count: result ?? 0 }) };
            },
          }),
        };
      },
    }),
  };
  mockGetAdminFirestore.mockReturnValue(db as unknown as Firestore);
  return calls;
}

describe("getAdminNavCounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("막힘·편집 대기·자동 숨김을 count 집계로 센다 (문서를 읽어 오지 않는다)", async () => {
    const calls = fakeDb({
      "pipelineSessions.status==on_hold": 1,
      "pipelineSessions.status==awaiting_master_review": 3,
      "word_cache.reportCount>=3": 8,
    });

    expect(await getAdminNavCounts()).toEqual({ stuck: 1, editPending: 3, autoHidden: 8 });
    expect(calls).toHaveLength(3);
  });

  it("한 항목의 조회가 실패해도 그 항목만 null이고 나머지는 그대로다 (메뉴가 통째로 깨지지 않게)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb({
      "pipelineSessions.status==on_hold": 1,
      "pipelineSessions.status==awaiting_master_review": new Error("index missing"),
      "word_cache.reportCount>=3": 8,
    });

    expect(await getAdminNavCounts()).toEqual({ stuck: 1, editPending: null, autoHidden: 8 });
  });
});

describe("getHomeStageCounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("진행 중인 세션 수와 게시된 소설 수를 센다", async () => {
    const db = {
      collection: (name: string) => ({
        // stories는 조건 없이 컬렉션 전체를 센다
        count: () => ({ get: async () => ({ data: () => ({ count: name === "stories" ? 148 : 0 }) }) }),
        where: (field: string, _op: string, value: unknown) => ({
          count: () => ({ get: async () => ({ data: () => ({ count: field === "status" && value === "in_progress" ? 2 : 0 }) }) }),
        }),
      }),
    };
    mockGetAdminFirestore.mockReturnValue(db as unknown as Firestore);

    expect(await getHomeStageCounts()).toEqual({ inProgress: 2, published: 148 });
  });

  it("Firestore를 얻는 단계에서 실패해도 던지지 않고 null로 돌려준다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetAdminFirestore.mockImplementation(() => {
      throw new Error("FIREBASE_ADMIN_KEY_BASE64 환경변수가 설정되지 않았습니다");
    });

    expect(await getHomeStageCounts()).toEqual({ inProgress: null, published: null });
    expect(await getAdminNavCounts()).toEqual({ stuck: null, editPending: null, autoHidden: null });
  });
});
