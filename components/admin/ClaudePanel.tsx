"use client";

import { useState } from "react";
import { reviewStoryAction } from "@/lib/actions/masterReviewActions";
import type { StoryReviewKind } from "@/lib/claude/editing";
import type { CharacterInfo, LevelGuidance, PreReviewItem, MasterChapter } from "@/lib/masterReview";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/admin/InlineError";
import { ReferenceCards } from "@/components/admin/ReferenceCards";
import { EditorChat, type ChatTarget } from "@/components/admin/EditorChat";
import { useEditorChat } from "@/components/admin/useEditorChat";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { ChatFocus } from "@/lib/chatProtocol";

const READ_CHIPS: { label: string; kind: StoryReviewKind }[] = [
  { label: "전체 흐름 점검", kind: "flow" },
  { label: "복선 회수 확인", kind: "seeds" },
  { label: "말투 일관성 점검", kind: "voice" },
];

type ReviewResponse =
  | { type: "review"; title: string; items: { chapterNumber: number; paragraphIndex: number; text: string }[] }
  | { type: "error"; message: string };

// 오른쪽 패널. 사전 검토 메모는 항상 보이고, 편집 화면에서는 쓸 때 참고할 정보(문장 길이·인물 말투)를,
// 전체 읽기 화면에서는 원고 전체 점검을 보여준다. 문단 단위 제안(방향 제시·다듬기)은 작업 공간(ParagraphWorkspace)이 맡는다.
export function ClaudePanel({
  mode,
  id,
  view,
  chapters,
  currentText,
  level,
  levelGuidance,
  characters,
  narrativeStyle,
  memos,
  memosLoading,
  memosError,
  disabled,
  focus,
  novelTitle,
  onJump,
}: {
  mode: "review" | "published";
  id: string;
  view: "edit" | "read";
  chapters: MasterChapter[];
  currentText: string;
  level: string;
  levelGuidance: LevelGuidance | null;
  characters: CharacterInfo[];
  narrativeStyle: string | null;
  memos: PreReviewItem[];
  memosLoading: boolean;
  memosError: string | null;
  disabled: boolean;
  // 편집 화면에서 보고 있는 문단(대화에 함께 보낸다). 전체 읽기 화면이면 null.
  focus: ChatFocus;
  // 편집 중인 소설 제목(검토 모드). 대화에 함께 보내 Claude가 고치는 중의 제목을 보게 한다.
  novelTitle?: string;
  onJump: (chapterNumber: number, paragraphIndex: number) => void;
}) {
  const [response, setResponse] = useState<ReviewResponse | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // 대화는 탭·화면 전환에도 유지되도록 탭 패널 밖(이 컴포넌트)에서 들고 있는다.
  const chat = useEditorChat({ mode, id });
  const [chatDraft, setChatDraft] = useState("");
  const [chatTarget, setChatTarget] = useState<ChatTarget>("paragraph");
  // 문단을 보고 있을 때만 제목 대상을 고를 수 있다(전체 읽기 화면은 지금처럼 전체 원고).
  const canTarget = mode === "review" && focus !== null && "paragraphIndex" in focus;
  const chatFocus: ChatFocus =
    canTarget && chatTarget === "novelTitle"
      ? { novelTitle: true }
      : canTarget && chatTarget === "chapterTitle"
        ? { chapterNumber: (focus as { chapterNumber: number }).chapterNumber, chapterTitle: true }
        : focus;

  async function runReview(label: string, kind: StoryReviewKind, instruction?: string) {
    setPendingLabel(label);
    setResponse(null);
    const result = await reviewStoryAction({ mode, id, chapters, kind, instruction });
    setPendingLabel(null);
    if (result.error || !result.result) {
      setResponse({ type: "error", message: result.error ?? "점검 결과가 없습니다" });
    } else {
      setResponse({ type: "review", title: result.result.title, items: result.result.items });
    }
  }

  function sendDraft() {
    const text = draft.trim();
    if (!text || pendingLabel) return;
    setDraft("");
    void runReview(text, "custom", text);
  }

  const busy = pendingLabel !== null || disabled;

  return (
    <aside aria-label="편집 도우미" className="flex flex-col gap-3">
      <Tabs defaultValue="notes">
        <TabsList className="w-full">
          <TabsTrigger value="notes">메모·참고</TabsTrigger>
          <TabsTrigger value="chat">대화</TabsTrigger>
        </TabsList>
        <TabsContent value="notes" className="flex flex-col gap-3">
          {mode === "review" && (
            <section aria-label="사전 검토 메모" className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <h3 className="text-sm font-semibold">Claude 사전 검토 메모 · 남은 {memos.length}건</h3>
              {memosLoading && <p className="text-sm text-muted-foreground">Claude가 먼저 읽고 있어요…</p>}
              {memosError && <InlineError message={memosError} />}
              {!memosLoading && !memosError && memos.length === 0 && (
                <p className="text-sm text-muted-foreground">남은 메모가 없어요.</p>
              )}
              {memos.map((m) => (
                <button
                  key={`${m.chapterNumber}-${m.paragraphIndex}-${m.kind}`}
                  type="button"
                  onClick={() => onJump(m.chapterNumber, m.paragraphIndex)}
                  className="min-h-11 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm leading-snug text-amber-900 hover:bg-amber-100"
                >
                  <strong className="font-semibold">
                    {m.chapterNumber}장 {m.paragraphIndex + 1}문단 · {m.kind}
                  </strong>
                  <span className="block">{m.text}</span>
                </button>
              ))}
            </section>
          )}

          {view === "edit" ? (
            <ReferenceCards text={currentText} level={level} levelGuidance={levelGuidance} characters={characters} narrativeStyle={narrativeStyle} />
          ) : (
            <section aria-label="원고 전체 점검" className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <h3 className="text-sm font-semibold">원고 전체 점검</h3>
              <div className="flex flex-wrap gap-1.5">
                {READ_CHIPS.map((chip) => (
                  <Button key={chip.label} type="button" variant="outline" className="h-11 px-3.5 text-sm" disabled={busy} onClick={() => runReview(chip.label, chip.kind)}>
                    {chip.label}
                  </Button>
                ))}
              </div>

              {pendingLabel && (
                <p role="status" className="text-sm text-muted-foreground">
                  “{pendingLabel}” 요청 중… 전체 점검은 1분 가까이 걸릴 수 있어요.
                </p>
              )}

              {!response && !pendingLabel && (
                <p className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                  원고 전체를 대상으로 점검을 요청할 수 있어요. 결과는 본문을 바꾸지 않고, 항목을 누르면 해당 문단의 편집 화면으로 이동합니다.
                </p>
              )}

              {response?.type === "error" && <InlineError message={response.message} />}

              {response?.type === "review" && (
                <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
                  <p className="text-sm font-semibold">{response.title}</p>
                  {response.items.length === 0 && <p className="text-sm text-muted-foreground">짚을 만한 항목이 없어요.</p>}
                  {response.items.map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onJump(item.chapterNumber, item.paragraphIndex)}
                      className="min-h-11 rounded-lg border border-border px-3 py-2 text-left text-sm leading-snug hover:bg-muted"
                    >
                      <strong className="font-semibold">
                        {item.chapterNumber}장 {item.paragraphIndex + 1}문단
                      </strong>{" "}
                      · {item.text}
                    </button>
                  ))}
                  <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setResponse(null)}>
                    닫기
                  </Button>
                </div>
              )}

              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendDraft();
                }}
              >
                <input
                  aria-label="Claude에게 보낼 점검 요청"
                  placeholder="예: 결말이 급한지 봐줘"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={busy}
                  className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                />
                <Button type="submit" className="h-11 px-4 text-sm" disabled={busy || !draft.trim()}>
                  보내기
                </Button>
              </form>
            </section>
          )}
        </TabsContent>
        <TabsContent value="chat">
          <EditorChat
            turns={chat.turns}
            sending={chat.sending}
            disabled={disabled}
            focus={chatFocus}
            target={chatTarget}
            onTargetChange={setChatTarget}
            showTargets={canTarget}
            draft={chatDraft}
            onDraftChange={setChatDraft}
            onSend={(text) => void chat.send(text, { chapters, focus: chatFocus, ...(novelTitle?.trim() && { title: novelTitle }) })}
            onStop={chat.stop}
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
