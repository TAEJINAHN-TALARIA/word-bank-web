const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.taejinahn.wordbank";

const features = [
  {
    icon: "✨",
    title: "AI 자동 생성",
    desc: "단어를 입력하면 AI가 즉시 뜻, 발음기호, 예문, 유의어, 반의어까지 찾아드려요.",
  },
  {
    icon: "🃏",
    title: "Leitner 플래시카드",
    desc: "5단계 박스 시스템으로 모르는 단어는 자주, 아는 단어는 간격을 두고 복습해요.",
  },
  {
    icon: "🌍",
    title: "10개 언어 지원",
    desc: "한국어, 영어, 일본어, 중국어, 독일어, 프랑스어, 스페인어 등 다양한 언어로 학습하세요.",
  },
  {
    icon: "🔔",
    title: "복습 알람",
    desc: "원하는 시간에 복습 알림을 받아 학습 습관을 유지하세요.",
  },
  {
    icon: "⚡",
    title: "알림창 빠른 추가",
    desc: "다른 앱에서 단어를 발견했다면 알림창에서 바로 추가할 수 있어요.",
  },
  {
    icon: "📊",
    title: "엑셀 내보내기",
    desc: "저장한 단어장을 .xlsx 파일로 내보내 원하는 방식으로 활용하세요.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-24 pb-20">
        <div className="text-7xl mb-6">📚</div>
        <h1 className="text-5xl font-bold tracking-tight mb-4">Word Bank</h1>
        <p className="text-xl text-zinc-500 dark:text-zinc-400 max-w-md mb-2">
          호기심을 저축하세요.
        </p>
        <p className="text-base text-zinc-400 dark:text-zinc-500 max-w-sm mb-10">
          모르는 단어를 발견했나요? 저장하기만 하세요.
          <br />
          AI가 즉시 뜻, 예문, 유의어까지 찾아드려요.
        </p>
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-3 rounded-xl font-semibold text-sm hover:opacity-80 transition-opacity"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
            <path d="M3.18 23.76c.3.17.64.24.99.19l13.12-11.95L13.65 8.4 3.18 23.76zm17.3-10.7-3.3-1.9-3.73 3.4 3.73 3.38 3.32-1.92a1.55 1.55 0 0 0 0-2.96zM3 .27a1.55 1.55 0 0 0-.82 1.37v20.72c0 .58.3 1.08.82 1.36L13.3 12 3 .27zm10.65 3.33-9.47 8.64 3.64 3.62 5.83-12.26z" />
          </svg>
          Google Play에서 다운로드
        </a>
        <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-3">
          iOS 버전은 준비 중입니다.
        </p>
      </section>

      {/* Features */}
      <section className="px-6 pb-24 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-12 text-zinc-800 dark:text-zinc-200">
          주요 기능
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-6"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-base mb-1">{f.title}</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100 dark:border-zinc-800 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
        <p className="mb-2">© 2026 Talaria. All rights reserved.</p>
        <a
          href="/privacy"
          className="hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          개인정보처리방침
        </a>
      </footer>
    </div>
  );
}
