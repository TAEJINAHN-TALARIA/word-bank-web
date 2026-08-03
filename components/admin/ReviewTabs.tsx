"use client";

import { useState, useTransition } from "react";
import type { PendingReviewItem } from "@/lib/admin-functions/storyGenerator";
import type { PublishedStory } from "@/lib/data/stories";
import { publishStoryAction, recallStoryAction } from "@/lib/actions/adminStoryActions";

export function ReviewTabs({
  pending,
  published,
}: {
  pending: PendingReviewItem[];
  published: PublishedStory[];
}) {
  const [tab, setTab] = useState<"pending" | "published">("pending");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePublish(sessionId: string, target: string) {
    setError(null);
    startTransition(async () => {
      const result = await publishStoryAction(sessionId, target);
      if (result.error) setError(result.error);
    });
  }

  function handleRecall(sessionId: string, target: string) {
    setError(null);
    startTransition(async () => {
      const result = await recallStoryAction(sessionId, target);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div>
      <div className="mb-4 flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={`px-3 py-2 text-sm ${
            tab === "pending" ? "border-b-2 border-neutral-900 font-medium" : "text-neutral-500"
          }`}
        >
          대기중 ({pending.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("published")}
          className={`px-3 py-2 text-sm ${
            tab === "published" ? "border-b-2 border-neutral-900 font-medium" : "text-neutral-500"
          }`}
        >
          게시됨 ({published.length})
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {tab === "pending" && (
        <ul className="space-y-3">
          {pending.map((item) => (
            <li
              key={`${item.sessionId}_${item.target}`}
              className="rounded border border-neutral-200 p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {item.title ?? "(제목 없음)"} — {item.lang} / {item.level}
                  </div>
                  <div className="text-neutral-500">게이트: {item.gateStatus}</div>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handlePublish(item.sessionId, item.target)}
                  className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50"
                >
                  게시
                </button>
              </div>
              {item.ruleBaseWarnings.length > 0 && (
                <p className="mt-1 text-amber-700">경고: {item.ruleBaseWarnings.join(", ")}</p>
              )}
            </li>
          ))}
          {pending.length === 0 && (
            <p className="text-neutral-500">검토 대기 중인 콘텐츠가 없습니다.</p>
          )}
        </ul>
      )}

      {tab === "published" && (
        <ul className="space-y-3">
          {published.map((story) => (
            <li
              key={story.id}
              className="flex items-center justify-between rounded border border-neutral-200 p-3 text-sm"
            >
              <div>
                <div className="font-medium">
                  {story.title ?? "(제목 없음)"} — {story.lang} / {story.level}
                </div>
                <div className="text-neutral-500">챕터 {story.chapterCount}개</div>
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleRecall(story.sessionId, story.target)}
                className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-50"
              >
                게시 철회
              </button>
            </li>
          ))}
          {published.length === 0 && (
            <p className="text-neutral-500">게시된 콘텐츠가 없습니다.</p>
          )}
        </ul>
      )}
    </div>
  );
}
