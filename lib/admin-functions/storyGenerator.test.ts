import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// 환경변수는 모듈이 import될 때 읽는다. import는 끌어올려지므로 hoisted로 먼저 정한다.
vi.hoisted(() => {
  process.env.STORY_GENERATOR_FUNCTIONS_BASE_URL = "https://functions.example";
  process.env.ADMIN_API_SHARED_SECRET = "secret";
});

import { saveMasterReview, evaluateMaster } from "./storyGenerator";

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("saveMasterReview", () => {
  it("제목이 없으면 요청에 title을 싣지 않고 응답도 확인하지 않는다", async () => {
    const fetchMock = respond({ success: true });
    await saveMasterReview("s1", [], [1]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ sessionId: "s1", edits: [], confirmedChapters: [1] });
  });

  it("제목을 보내면 요청에 trim한 title을 싣고, 응답 title이 같으면 통과한다", async () => {
    const fetchMock = respond({ success: true, title: "새 제목" });
    await expect(saveMasterReview("s1", [], [1], "  새 제목  ")).resolves.toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).title).toBe("새 제목");
  });

  it("제목을 보냈는데 응답에 title이 없으면(옛 함수) 오류를 던진다", async () => {
    respond({ success: true });
    await expect(saveMasterReview("s1", [], [1], "새 제목")).rejects.toThrow("서버가 제목 저장을 지원하지 않아요");
  });

  it("응답 title이 보낸 값과 다르면 오류를 던진다", async () => {
    respond({ success: true, title: "다른 제목" });
    await expect(saveMasterReview("s1", [], [1], "새 제목")).rejects.toThrow("서버가 제목 저장을 지원하지 않아요");
  });
});

describe("evaluateMaster", () => {
  const edits = [{ chapterNumber: 1, chapterTitle: "첫째", body: "본문" }];
  const result = {
    ruleBase: { pass: true, failures: [], warnings: ["분량 경고"] },
    llm: { pass: true, failItems: [], items: [{ key: "levelFit", score: 4, reason: "좋음", gated: true }] },
  };

  it("adminEvaluateMaster로 sessionId와 edits를 보내고 점검 결과만 돌려준다", async () => {
    const fetchMock = respond({ success: true, ...result });
    expect(await evaluateMaster("s1", edits)).toEqual(result);
    expect(String(fetchMock.mock.calls[0][0]).endsWith("/adminEvaluateMaster")).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sessionId: "s1", edits });
  });

  it("심사가 건너뛰어진 응답(llm: null)도 그대로 돌려준다", async () => {
    respond({ success: true, ruleBase: { pass: false, failures: ["챕터 수 3/10"], warnings: [] }, llm: null });
    expect((await evaluateMaster("s1", edits)).llm).toBeNull();
  });

  it("함수가 오류를 돌려주면 그 메시지로 던진다", async () => {
    respond({ error: "세션이 편집 대기 상태가 아닙니다" }, 400);
    await expect(evaluateMaster("s1", edits)).rejects.toThrow("세션이 편집 대기 상태가 아닙니다");
  });

  it("응답 모양이 어긋나면(ruleBase 없음) 오류를 던진다", async () => {
    respond({ success: true });
    await expect(evaluateMaster("s1", edits)).rejects.toThrow("점검 결과를 해석하지 못했습니다");
  });
});
