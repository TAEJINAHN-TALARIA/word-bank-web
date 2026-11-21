import { describe, it, expect } from "vitest";
import { sessionStage } from "./sessionStage";

describe("sessionStage", () => {
  it("편집 대기: 사람 차례라 강조색이고, 바로 편집 화면으로 가는 링크가 붙는다", () => {
    expect(sessionStage("awaiting_master_review", "s1")).toEqual({
      label: "편집 대기",
      variant: "default",
      next: { label: "편집하기", href: "/admin/edit/s1" },
    });
  });

  it("막힘(on_hold)은 경고색이고 사유를 볼 생성 상세로 보낸다", () => {
    expect(sessionStage("on_hold", "s2")).toEqual({
      label: "막힘",
      variant: "warning",
      next: { label: "사유 보기", href: "/admin/generation/s2" },
    });
  });

  it("진행 중은 사람이 할 일이 없다", () => {
    expect(sessionStage("in_progress", "s3")).toEqual({ label: "진행 중", variant: "secondary", next: null });
  });

  it("완료된 세션은 검토·게시 화면으로 보낸다", () => {
    expect(sessionStage("done", "s4")).toEqual({
      label: "완료",
      variant: "success",
      next: { label: "검토하기", href: "/admin/review" },
    });
  });

  it("알 수 없는 상태는 원문 그대로 보여주고 링크는 달지 않는다", () => {
    const stage = sessionStage("something_new", "s5");
    expect(stage.label).toBe("something_new");
    expect(stage.next).toBeNull();
  });
});
