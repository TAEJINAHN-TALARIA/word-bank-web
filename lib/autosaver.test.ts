import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AUTOSAVE_DELAY_MS,
  createAutosaver,
  describeAutosaveStatus,
  formatClock,
  type AutosaveResult,
  type AutosaveStatus,
} from "./autosaver";

const DELAY = 1000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(save: () => Promise<AutosaveResult>) {
  const statuses: AutosaveStatus[] = [];
  const autosaver = createAutosaver({ delayMs: DELAY, save, onStatus: (s) => statuses.push(s) });
  return { autosaver, statuses, kinds: () => statuses.map((s) => s.kind) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 21, 14, 32));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createAutosaver", () => {
  it("기본 지연은 3초다", () => {
    expect(AUTOSAVE_DELAY_MS).toBe(3000);
  });

  it("변경을 알린 뒤 지연이 지나야 저장하고, pending → saving → saved 순으로 알린다", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { autosaver, kinds, statuses } = setup(save);

    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY - 1);
    expect(save).not.toHaveBeenCalled();
    expect(kinds()).toEqual(["pending"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(kinds()).toEqual(["pending", "saving", "saved"]);
    expect(statuses[2]).toEqual({ kind: "saved", at: Date.now() });
  });

  it("지연 안에 계속 변경하면 타이머를 다시 세어 한 번만 저장한다", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { autosaver } = setup(save);

    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY - 100);
    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY - 100);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("저장하는 동안 변경이 와도 두 저장이 겹치지 않고, 끝난 뒤 지연을 두고 한 번 더 저장한다", async () => {
    const first = deferred<AutosaveResult>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
    const { autosaver, kinds } = setup(save);

    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(save).toHaveBeenCalledTimes(1);

    autosaver.notify(); // 첫 저장이 가는 동안 이어 씀
    await vi.advanceTimersByTimeAsync(DELAY * 3);
    expect(save).toHaveBeenCalledTimes(1);

    first.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(kinds().slice(-1)).toEqual(["pending"]);

    await vi.advanceTimersByTimeAsync(DELAY);
    expect(save).toHaveBeenCalledTimes(2);
    expect(kinds().slice(-1)).toEqual(["saved"]);
  });

  it("저장하는 동안 변경이 없었으면 더 저장하지 않는다", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { autosaver } = setup(save);
    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("건너뜀·오류·예외는 각각 skipped/failed로 알리고 자동 재시도하지 않으며, 다음 변경 때 다시 시도한다", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ skipped: "3장 본문이 비어 있어요" })
      .mockResolvedValueOnce({ error: "서버 오류" })
      .mockRejectedValueOnce(new Error("연결 끊김"))
      .mockRejectedValueOnce("문자열")
      .mockResolvedValue({ ok: true });
    const { autosaver, statuses } = setup(save);
    const last = () => statuses[statuses.length - 1];

    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY * 3);
    expect(last()).toEqual({ kind: "skipped", reason: "3장 본문이 비어 있어요" });
    expect(save).toHaveBeenCalledTimes(1);

    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(last()).toEqual({ kind: "failed", message: "서버 오류" });

    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(last()).toEqual({ kind: "failed", message: "연결 끊김" });

    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(last()).toEqual({ kind: "failed", message: "저장 실패" });

    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(last().kind).toBe("saved");
    expect(save).toHaveBeenCalledTimes(5);
  });

  describe("flush", () => {
    it("대기 중이면 기다리지 않고 바로 저장한다", async () => {
      const save = vi.fn().mockResolvedValue({ ok: true });
      const { autosaver, kinds } = setup(save);

      autosaver.notify();
      await autosaver.flush();
      expect(save).toHaveBeenCalledTimes(1);
      expect(kinds().slice(-1)).toEqual(["saved"]);

      await vi.advanceTimersByTimeAsync(DELAY * 3);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("저장 중이면 그 저장이 끝날 때까지 기다린다", async () => {
      const first = deferred<AutosaveResult>();
      const save = vi.fn().mockReturnValueOnce(first.promise);
      const { autosaver } = setup(save);

      autosaver.notify();
      await vi.advanceTimersByTimeAsync(DELAY);
      let done = false;
      const flushing = autosaver.flush().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);

      first.resolve({ ok: true });
      await flushing;
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("저장 중에 변경이 있었으면 끝난 뒤 지연 없이 한 번 더 저장한다", async () => {
      const first = deferred<AutosaveResult>();
      const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
      const { autosaver } = setup(save);

      autosaver.notify();
      await vi.advanceTimersByTimeAsync(DELAY);
      autosaver.notify();
      const flushing = autosaver.flush();
      first.resolve({ ok: true });
      await flushing;
      expect(save).toHaveBeenCalledTimes(2);
    });

    it("실패하거나 건너뛴 상태면 즉시 다시 시도한다", async () => {
      const save = vi.fn().mockResolvedValueOnce({ error: "서버 오류" }).mockResolvedValue({ ok: true });
      const { autosaver, kinds } = setup(save);

      autosaver.notify();
      await vi.advanceTimersByTimeAsync(DELAY);
      expect(kinds().slice(-1)).toEqual(["failed"]);

      await autosaver.flush();
      expect(save).toHaveBeenCalledTimes(2);
      expect(kinds().slice(-1)).toEqual(["saved"]);
    });

    it("할 일이 없으면(idle, saved) 아무것도 하지 않는다", async () => {
      const save = vi.fn().mockResolvedValue({ ok: true });
      const { autosaver } = setup(save);

      await autosaver.flush();
      autosaver.notify();
      await vi.advanceTimersByTimeAsync(DELAY);
      await autosaver.flush();
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  describe("dispose", () => {
    it("대기 중인 저장을 끝낸 뒤 취소한다(화면을 떠나도 이어 쓴 글을 잃지 않는다)", async () => {
      const save = vi.fn().mockResolvedValue({ ok: true });
      const { autosaver } = setup(save);

      autosaver.notify();
      await autosaver.dispose();
      expect(save).toHaveBeenCalledTimes(1);

      autosaver.notify();
      await vi.advanceTimersByTimeAsync(DELAY * 3);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("저장하는 동안 이어 쓴 글도 마저 저장한다", async () => {
      const first = deferred<AutosaveResult>();
      const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
      const { autosaver } = setup(save);

      autosaver.notify();
      await vi.advanceTimersByTimeAsync(DELAY);
      autosaver.notify();
      const disposing = autosaver.dispose();
      first.resolve({ ok: true });
      await disposing;
      expect(save).toHaveBeenCalledTimes(2);
    });
  });

  it("cancel 뒤에는 저장도 상태 알림도 없다", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { autosaver, statuses } = setup(save);

    autosaver.notify();
    autosaver.cancel();
    const count = statuses.length;
    await vi.advanceTimersByTimeAsync(DELAY * 3);
    expect(save).not.toHaveBeenCalled();
    expect(statuses).toHaveLength(count);

    autosaver.notify();
    await vi.advanceTimersByTimeAsync(DELAY * 3);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("formatClock", () => {
  it("로컬 시간을 두 자리 HH:MM으로 적는다", () => {
    expect(formatClock(new Date(2026, 10, 21, 9, 5).getTime())).toBe("09:05");
    expect(formatClock(new Date(2026, 10, 21, 14, 32).getTime())).toBe("14:32");
  });
});

describe("describeAutosaveStatus", () => {
  it("상태마다 문구와 색을 정한다", () => {
    const at = new Date(2026, 10, 21, 14, 32).getTime();
    expect(describeAutosaveStatus({ kind: "idle" })).toEqual({ text: "", tone: "muted", retry: false });
    expect(describeAutosaveStatus({ kind: "pending" })).toEqual({ text: "저장하지 않은 수정 있음", tone: "warn", retry: false });
    expect(describeAutosaveStatus({ kind: "saving" })).toEqual({ text: "저장 중…", tone: "busy", retry: false });
    expect(describeAutosaveStatus({ kind: "saved", at })).toEqual({ text: "✓ 임시 저장됨 · 14:32", tone: "ok", retry: false });
    expect(describeAutosaveStatus({ kind: "skipped", reason: "3장 본문이 비어 있어요" })).toEqual({
      text: "자동 저장 건너뜀 · 3장 본문이 비어 있어요",
      tone: "warn",
      retry: false,
    });
    expect(describeAutosaveStatus({ kind: "failed", message: "x" })).toEqual({
      text: "자동 저장 실패 · 다시 시도",
      tone: "error",
      retry: true,
    });
  });
});
