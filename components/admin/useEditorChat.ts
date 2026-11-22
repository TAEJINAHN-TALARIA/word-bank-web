"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readChatError, readChatStream } from "@/lib/chatClient";
import {
  applyChatEvent,
  manuscriptEdited,
  manuscriptKey,
  trimHistory,
  withFocus,
  type ChatFocus,
  type ChatMessage,
} from "@/lib/chatProtocol";
import type { MasterChapter } from "@/lib/masterReview";

// content는 API에 보내는 그대로다 — user 턴에는 "지금 보는 곳" 줄이 앞에 붙어 있다(화면에서는 stripFocus로 뺀다).
export type ChatTurn = { role: "user" | "assistant"; content: string; error?: string };

/**
 * 편집 화면 Claude 대화의 상태. 화면이 열려 있는 동안만 기억한다(저장하지 않음).
 * 이벤트 처리·기록 자르기는 lib/chatProtocol.ts, 응답 읽기는 lib/chatClient.ts에서 테스트한다.
 */
export function useEditorChat({ mode, id }: { mode: "review" | "published"; id: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  // 스트림 콜백이 항상 최신 턴 위에서 고치도록 ref에도 둔다.
  const turnsRef = useRef<ChatTurn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // 마지막으로 보낸 시점의 원고 열쇠. 다음 전송에서 달라졌으면 메시지에 "원고가 수정됐어요" 줄을 박는다. 대화를 지우면 비운다.
  const lastKeyRef = useRef<string | null>(null);

  const commit = useCallback((next: ChatTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const patchLast = useCallback(
    (patch: (turn: ChatTurn) => ChatTurn) => {
      const list = turnsRef.current;
      commit([...list.slice(0, -1), patch(list[list.length - 1])]);
    },
    [commit],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string, context: { chapters: MasterChapter[]; focus: ChatFocus; title?: string }) => {
      const trimmed = text.trim();
      if (!trimmed || abortRef.current) return;

      const key = manuscriptKey(context.chapters, context.title);
      const edited = manuscriptEdited(lastKeyRef.current, key);
      lastKeyRef.current = key;

      const userTurn: ChatTurn = { role: "user", content: withFocus(trimmed, context.focus, { manuscriptEdited: edited }) };
      // 답을 받지 못해 비어 있는 이전 assistant 턴은 요청에서 뺀다.
      const history: ChatMessage[] = [...turnsRef.current, userTurn]
        .filter((turn) => turn.content.trim() !== "")
        .map(({ role, content }) => ({ role, content }));
      commit([...turnsRef.current, userTurn, { role: "assistant", content: "" }]);

      const controller = new AbortController();
      abortRef.current = controller;
      // clear()로 대화가 비워진 뒤에는 이 요청의 늦은 이벤트·오류·정리가 새 대화나 새 요청을 건드리지 않게 한다.
      const isCurrent = () => abortRef.current === controller;
      setSending(true);
      try {
        const response = await fetch("/admin/editor-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            id,
            chapters: context.chapters,
            messages: trimHistory(history),
            ...(context.title !== undefined && { title: context.title }),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = await readChatError(response);
          if (isCurrent()) patchLast((turn) => ({ ...turn, error }));
          return;
        }
        const finished = await readChatStream(response, (event) => {
          if (!isCurrent()) return;
          if (event.t === "error") patchLast((turn) => ({ ...turn, error: event.message }));
          else patchLast((turn) => ({ ...turn, content: applyChatEvent(turn.content, event) }));
        });
        // done도 error도 없이 연결이 닫힌 것은 중간에 끊긴 답변이다(300초 종료, 프록시 단절 등).
        if (!finished && !controller.signal.aborted && isCurrent()) {
          patchLast((turn) => ({ ...turn, error: "응답이 중간에 끊겼습니다. 다시 시도해 주세요" }));
        }
      } catch {
        // 멈추기로 끊은 것은 오류가 아니다. 받은 글은 그대로 둔다.
        if (!controller.signal.aborted && isCurrent()) patchLast((turn) => ({ ...turn, error: "연결에 문제가 생겨 답을 받지 못했습니다" }));
      } finally {
        if (isCurrent()) {
          abortRef.current = null;
          setSending(false);
        }
      }
    },
    [mode, id, commit, patchLast],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // 대화를 모두 지운다. 진행 중인 응답은 끊고, 지운 뒤 곧바로 새로 보낼 수 있게 abortRef도 바로 비운다.
  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    lastKeyRef.current = null;
    commit([]);
    setSending(false);
  }, [commit]);

  return { turns, sending, send, stop, clear };
}
