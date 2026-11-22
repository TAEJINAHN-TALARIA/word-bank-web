import { describe, it, expect } from "vitest";
import { formatGateReasons } from "./gateReasons";

describe("formatGateReasons", () => {
  it("없거나 비어 있으면 빈 목록이다", () => {
    expect(formatGateReasons(undefined)).toEqual([]);
    expect(formatGateReasons(null)).toEqual([]);
    expect(formatGateReasons([])).toEqual([]);
    expect(formatGateReasons({})).toEqual([]);
  });

  it("이미 문자열 목록이면 그대로 둔다", () => {
    expect(formatGateReasons(["사유 하나", "사유 둘"])).toEqual(["사유 하나", "사유 둘"]);
  });

  it("항목 키별 사유 객체(게이트가 저장하는 모양)는 한국어 항목 이름과 함께 한 줄씩 펼친다", () => {
    expect(formatGateReasons({ levelFit: "어려움", comboFit: "반영 안 됨" })).toEqual(["레벨 적합성: 어려움", "설정 반영: 반영 안 됨"]);
  });

  it("levelFit처럼 문제 구절이 딸린 사유는 구절까지 보여 준다", () => {
    expect(formatGateReasons({ levelFit: { reason: "어려움", problemPhrases: ["어려운 구절", "다른 구절"] } })).toEqual([
      "레벨 적합성: 어려움 (문제 구절: “어려운 구절”, “다른 구절”)",
    ]);
    expect(formatGateReasons({ levelFit: { reason: "어려움", problemPhrases: [] } })).toEqual(["레벨 적합성: 어려움"]);
  });

  it("항목 이름이 아닌 키(apiError·batchError)는 키를 그대로 쓴다", () => {
    expect(formatGateReasons({ apiError: "RATE_LIMIT" })).toEqual(["apiError: RATE_LIMIT"]);
    expect(formatGateReasons({ batchError: "배치 요청 실패" })).toEqual(["batchError: 배치 요청 실패"]);
  });

  it("사유가 비어 있는 항목은 이름만 남기고, 목록 안의 비문자열도 던지지 않고 문자열로 바꾼다", () => {
    expect(formatGateReasons({ levelFit: null })).toEqual(["레벨 적합성"]);
    expect(formatGateReasons(["사유", { levelFit: "x" }, 3])).toEqual(["사유", "레벨 적합성: x", "3"]);
  });

  it("문자열 하나도 한 줄이다", () => {
    expect(formatGateReasons("통과하지 못했어요")).toEqual(["통과하지 못했어요"]);
  });
});
