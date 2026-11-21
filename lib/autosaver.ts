// 편집 화면의 자동 임시 저장 타이밍(디바운스·직렬화)과 상태 문구. 컴포넌트와 무관한 순수 모듈이라 가짜 타이머로 테스트한다.

export const AUTOSAVE_DELAY_MS = 3000;

export type AutosaveStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; message: string };

// skipped는 오류가 아니라 "지금은 저장할 수 없는 상태"(예: 제목이 잠깐 빔)라서 따로 둔다.
export type AutosaveResult = { ok: true } | { skipped: string } | { error: string };

export function createAutosaver(options: {
  delayMs: number;
  save: () => Promise<AutosaveResult>;
  onStatus: (status: AutosaveStatus) => void;
}): { notify(): void; flush(): Promise<void>; cancel(): void } {
  let status: AutosaveStatus = { kind: "idle" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let changedWhileSaving = false;
  let cancelled = false;

  function setStatus(next: AutosaveStatus) {
    if (cancelled) return;
    status = next;
    options.onStatus(next);
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, options.delayMs);
  }

  function run(): Promise<void> {
    if (inFlight) return inFlight;
    clearTimer();
    setStatus({ kind: "saving" });
    inFlight = (async () => {
      let result: AutosaveResult;
      try {
        result = await options.save();
      } catch (err) {
        result = { error: err instanceof Error ? err.message : "저장 실패" };
      }
      inFlight = null;
      if (cancelled) return;
      if ("ok" in result) setStatus({ kind: "saved", at: Date.now() });
      else if ("skipped" in result) setStatus({ kind: "skipped", reason: result.skipped });
      else setStatus({ kind: "failed", message: result.error });
      // 저장하는 동안 이어 쓴 글은 아직 저장되지 않았다. 계속 입력 중일 수 있으니 지연을 두고 다시 저장한다.
      if (changedWhileSaving) {
        changedWhileSaving = false;
        setStatus({ kind: "pending" });
        schedule();
      }
    })();
    return inFlight;
  }

  return {
    notify() {
      if (cancelled) return;
      if (inFlight) {
        changedWhileSaving = true;
        return;
      }
      setStatus({ kind: "pending" });
      schedule();
    },

    // 대기 중인 저장을 지금 끝낸다(문단 이동·화면 이탈·승인 직전). 실패·건너뜀 상태면 다시 시도한다.
    async flush() {
      if (cancelled) return;
      const retryLastResult = !inFlight && (status.kind === "failed" || status.kind === "skipped");
      if (inFlight) await inFlight;
      for (let round = 0; round < 2; round++) {
        if (cancelled) return;
        if (status.kind === "pending" || (round === 0 && retryLastResult)) {
          clearTimer();
          await run();
        } else break;
      }
    },

    cancel() {
      cancelled = true;
      clearTimer();
    },
  };
}

export function formatClock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function describeAutosaveStatus(status: AutosaveStatus): {
  text: string;
  tone: "muted" | "busy" | "ok" | "warn" | "error";
  retry: boolean;
} {
  switch (status.kind) {
    case "idle":
      return { text: "", tone: "muted", retry: false };
    case "pending":
      return { text: "저장하지 않은 수정 있음", tone: "warn", retry: false };
    case "saving":
      return { text: "저장 중…", tone: "busy", retry: false };
    case "saved":
      return { text: `✓ 임시 저장됨 · ${formatClock(status.at)}`, tone: "ok", retry: false };
    case "skipped":
      return { text: `자동 저장 건너뜀 · ${status.reason}`, tone: "warn", retry: false };
    case "failed":
      return { text: "자동 저장 실패 · 다시 시도", tone: "error", retry: true };
  }
}
