import { describe, it, expect } from "vitest";
import { levelRubric } from "./levelRubric";

describe("levelRubric", () => {
  it.each(["Lv1", "Lv2", "Lv3", "Lv4", "Lv5", "Lv6"])("%s는 독자와 어휘·문장구조 기준을 가진다", (level) => {
    const rubric = levelRubric(level);
    expect(rubric).not.toBeNull();
    expect(rubric!.reader.length).toBeGreaterThan(0);
    expect(rubric!.vocabulary.length).toBeGreaterThan(0);
  });

  it("Lv6은 대학생·성인 숙련 독자이고 절 4개 이하·은유 한 문장에 하나를 담는다", () => {
    expect(levelRubric("Lv6")).toMatchObject({ reader: "대학생·성인 숙련 독자" });
    expect(levelRubric("Lv6")!.vocabulary).toContain("절 4개 이하");
    expect(levelRubric("Lv6")!.vocabulary).toContain("은유는 한 문장에 하나");
  });

  it.each(["Lv7", "Lv0", "", "A1", "lv6", "Lv6 "])("모르는 레벨 %j은 null", (level) => {
    expect(levelRubric(level)).toBeNull();
  });
});
