import Link from "next/link";
import { listPipelineSessions } from "@/lib/data/pipelineSessions";

export default async function GenerationPage() {
  const sessions = await listPipelineSessions();

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">소설 생성 진행상황</h1>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">세션 ID</th>
            <th>상태</th>
            <th>레벨</th>
            <th>Combo</th>
            <th>대상 언어</th>
            <th>생성일</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id} className="border-b">
              <td className="py-2">
                <Link href={`/admin/generation/${session.id}`} className="underline">
                  {session.id}
                </Link>
              </td>
              <td>{session.status}</td>
              <td>{session.targetLevel}</td>
              <td>{session.combo}</td>
              <td>{session.targetLanguages.join(", ")}</td>
              <td>{session.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
