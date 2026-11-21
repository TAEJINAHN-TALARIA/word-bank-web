import { describe, it, expect } from "vitest";
import { NAV_GROUPS, HOME_ITEM, activeNavHref, navBadge, type NavCounts } from "./adminNav";

describe("NAV_GROUPS", () => {
  it("소설 제작은 작업 순서(1~4)대로, 언어 데이터는 단계 번호 없이 묶는다", () => {
    const [story, data] = NAV_GROUPS;
    expect(story.label).toBe("소설 제작");
    expect(story.items.map((i) => [i.step, i.label])).toEqual([
      [1, "생성 현황"],
      [2, "편집"],
      [3, "검토·게시"],
      [4, "게시본 관리"],
    ]);
    expect(data.label).toBe("언어 데이터");
    expect(data.items.map((i) => i.label)).toEqual(["단어 신고·품질", "단어 캐시", "표현 풀"]);
    expect(data.items.every((i) => i.step === undefined)).toBe(true);
  });

  it("모든 메뉴의 주소가 서로 다르다", () => {
    const hrefs = [HOME_ITEM, ...NAV_GROUPS.flatMap((g) => g.items)].map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("activeNavHref", () => {
  it("홈은 정확히 /admin일 때만 활성이다 (다른 모든 주소가 /admin으로 시작해도)", () => {
    expect(activeNavHref("/admin")).toBe("/admin");
    expect(activeNavHref("/admin/edit")).toBe("/admin/edit");
    expect(activeNavHref("/administrator")).toBeNull();
  });

  it("하위 주소는 가장 가까운 메뉴로 매긴다", () => {
    expect(activeNavHref("/admin/edit/session-1")).toBe("/admin/edit");
    expect(activeNavHref("/admin/generation/2026-11_Lv3")).toBe("/admin/generation");
    expect(activeNavHref("/admin/review")).toBe("/admin/review");
    expect(activeNavHref("/admin/published/doc1/download")).toBe("/admin/published");
    expect(activeNavHref("/admin/quality")).toBe("/admin/quality");
  });

  it("게시본 표현 수정 화면(/admin/edit/published/…)은 편집이 아니라 게시본 관리가 활성이다", () => {
    expect(activeNavHref("/admin/edit/published/doc1")).toBe("/admin/published");
  });

  it("메뉴에 없는 주소는 활성 메뉴가 없다", () => {
    expect(activeNavHref("/admin/nowhere")).toBeNull();
  });
});

describe("navBadge", () => {
  const counts: NavCounts = { stuck: 1, editPending: 3, autoHidden: 8 };

  it("편집 대기는 강조색, 막힘은 경고색, 자동 숨김은 회색이다", () => {
    expect(navBadge(counts, "editPending")).toEqual({ text: "3", tone: "accent" });
    expect(navBadge(counts, "stuck")).toEqual({ text: "막힘 1", tone: "warning" });
    expect(navBadge(counts, "autoHidden")).toEqual({ text: "8", tone: "gray" });
  });

  it("0건이거나 조회에 실패(null)했거나 배지 종류가 없으면 배지를 달지 않는다", () => {
    expect(navBadge({ stuck: 0, editPending: 0, autoHidden: 0 }, "editPending")).toBeNull();
    expect(navBadge({ stuck: null, editPending: null, autoHidden: null }, "stuck")).toBeNull();
    expect(navBadge(counts, undefined)).toBeNull();
  });
});
