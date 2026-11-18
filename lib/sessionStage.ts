import { statusBadgeVariant, type StatusBadgeVariant } from "@/lib/status";

export type SessionStage = {
  label: string;
  variant: StatusBadgeVariant | "default";
  /** 사람이 다음에 할 일로 가는 링크. 자동으로 진행 중이면 null. */
  next: { label: string; href: string } | null;
};

// 파이프라인 세션 상태(내부 영문 값)를 사람 기준의 "단계"와 다음 할 일로 바꾼다.
// 사람이 움직여야 하는 상태(편집 대기, 막힘)는 눈에 띄는 색으로, 자동 진행 중인 건 중립색으로 둔다.
export function sessionStage(status: string, sessionId: string): SessionStage {
  switch (status) {
    case "awaiting_master_review":
      return { label: "편집 대기", variant: "default", next: { label: "편집하기", href: `/admin/edit/${sessionId}` } };
    case "on_hold":
      return { label: "막힘", variant: "warning", next: { label: "사유 보기", href: `/admin/generation/${sessionId}` } };
    case "in_progress":
      return { label: "진행 중", variant: "secondary", next: null };
    case "done":
      return { label: "완료", variant: "success", next: { label: "검토하기", href: "/admin/review" } };
    default:
      return { label: status, variant: statusBadgeVariant(status), next: null };
  }
}
