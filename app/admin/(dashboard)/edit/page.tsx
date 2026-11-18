import Link from "next/link";
import { listMasterReviews } from "@/lib/data/masterReviews";
import { MasterReviewTable } from "@/components/admin/MasterReviewTable";

export default async function EditPage() {
  const pending = await listMasterReviews();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">편집</h1>
        <p className="text-sm text-muted-foreground">
          한국어 마스터를 읽고 다듬어 승인하면 번역이 시작돼요. 이미 게시된 소설의 표현 수정은{" "}
          <Link href="/admin/published" className="underline underline-offset-4">
            게시본 관리
          </Link>
          에서 해요.
        </p>
      </div>
      <MasterReviewTable items={pending} />
    </div>
  );
}
