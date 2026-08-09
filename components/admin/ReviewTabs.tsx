"use client";

import { useState } from "react";
import type { PendingReviewItem } from "@/lib/admin-functions/storyGenerator";
import type { PublishedStory } from "@/lib/data/stories";
import { PendingReviewsTable } from "@/components/admin/PendingReviewsTable";
import { PublishedStoriesTable } from "@/components/admin/PublishedStoriesTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ReviewTabs({
  pending,
  initialPublished,
  initialPublishedCursor,
}: {
  pending: PendingReviewItem[];
  initialPublished: PublishedStory[];
  initialPublishedCursor: string | null;
}) {
  const [tab, setTab] = useState<"pending" | "published">("pending");
  const [pendingCount, setPendingCount] = useState(pending.length);
  const [publishedCount, setPublishedCount] = useState(initialPublished.length);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as "pending" | "published")}
      className="flex flex-col gap-4"
    >
      <TabsList variant="line" className="border-b border-border">
        <TabsTrigger value="pending">대기중 ({pendingCount})</TabsTrigger>
        <TabsTrigger value="published">게시됨 ({publishedCount})</TabsTrigger>
      </TabsList>

      <TabsContent value="pending">
        <PendingReviewsTable initialItems={pending} onCountChange={setPendingCount} />
      </TabsContent>

      <TabsContent value="published">
        <PublishedStoriesTable
          initialStories={initialPublished}
          initialCursor={initialPublishedCursor}
          onCountChange={setPublishedCount}
        />
      </TabsContent>
    </Tabs>
  );
}
