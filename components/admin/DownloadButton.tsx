"use client";

import { useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 툴바의 "내려받기" 메뉴. 기본 <details>로 만들어 별도 의존성이 없다.
export function DownloadButton({ onSelect }: { onSelect: (format: "txt" | "pdf") => void }) {
  const menu = useRef<HTMLDetailsElement>(null);

  function pick(format: "txt" | "pdf") {
    if (menu.current) menu.current.open = false;
    onSelect(format);
  }

  return (
    <details ref={menu} className="relative">
      <summary className={cn(buttonVariants({ variant: "outline", size: "lg" }), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
        내려받기
      </summary>
      <div className="absolute right-0 z-10 mt-1 flex w-60 flex-col gap-1 rounded-lg border border-border bg-card p-2 shadow-md">
        <Button type="button" variant="ghost" className="h-11 justify-start px-3 text-sm" onClick={() => pick("txt")}>
          텍스트(.txt)
        </Button>
        <Button type="button" variant="ghost" className="h-11 justify-start px-3 text-sm" onClick={() => pick("pdf")}>
          PDF
        </Button>
        <p className="px-2 pb-1 text-xs leading-snug text-muted-foreground">
          지금 화면의 원고(저장하지 않은 수정 포함)를 받아요. PDF는 인쇄 창이 열리니 대상을 &lsquo;PDF로 저장&rsquo;으로 고르세요.
        </p>
      </div>
    </details>
  );
}
