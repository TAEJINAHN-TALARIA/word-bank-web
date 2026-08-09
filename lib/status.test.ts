// lib/status.test.ts
import { describe, it, expect } from "vitest";
import { statusBadgeVariant, statusBorderClass } from "./status";

describe("statusBadgeVariant", () => {
  it.each([
    ["pass", "success"],
    ["completed", "success"],
    ["done", "success"],
    ["fail", "destructive"],
    ["failed", "destructive"],
    ["error", "destructive"],
    ["warn", "warning"],
    ["warning", "warning"],
    ["in_progress", "secondary"],
    ["pending", "secondary"],
    ["unknown_status", "outline"],
  ] as const)("%s -> %s", (status, expected) => {
    expect(statusBadgeVariant(status)).toBe(expected);
  });
});

describe("statusBorderClass", () => {
  it("success는 emerald 보더를 반환한다", () => {
    expect(statusBorderClass("success")).toBe("border-l-emerald-500");
  });

  it("warning은 amber 보더를 반환한다", () => {
    expect(statusBorderClass("warning")).toBe("border-l-amber-500");
  });

  it("destructive는 destructive 보더를 반환한다", () => {
    expect(statusBorderClass("destructive")).toBe("border-l-destructive");
  });

  it("그 외(secondary/outline)는 기본 보더를 반환한다", () => {
    expect(statusBorderClass("outline")).toBe("border-l-border");
    expect(statusBorderClass("secondary")).toBe("border-l-border");
  });
});
