"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUTOSAVE_DELAY_MS, createAutosaver, type AutosaveResult, type AutosaveStatus } from "@/lib/autosaver";

/**
 * createAutosaver를 컴포넌트에 붙인다. save는 매 렌더의 최신 함수를 쓰므로 호출 시점의 화면 상태를 읽는다.
 * 언마운트하면 대기 중인 저장을 취소한다.
 */
export function useAutosave(save: () => Promise<AutosaveResult>): {
  status: AutosaveStatus;
  notify: () => void;
  flush: () => Promise<void>;
} {
  const [status, setStatus] = useState<AutosaveStatus>({ kind: "idle" });
  const saveRef = useRef(save);
  const autosaverRef = useRef<ReturnType<typeof createAutosaver> | null>(null);

  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    const autosaver = createAutosaver({ delayMs: AUTOSAVE_DELAY_MS, save: () => saveRef.current(), onStatus: setStatus });
    autosaverRef.current = autosaver;
    return () => {
      autosaver.cancel();
      autosaverRef.current = null;
    };
  }, []);

  const notify = useCallback(() => autosaverRef.current?.notify(), []);
  const flush = useCallback(() => autosaverRef.current?.flush() ?? Promise.resolve(), []);
  return { status, notify, flush };
}
