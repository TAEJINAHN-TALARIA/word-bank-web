export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">개인정보처리방침</h1>
        <p className="text-sm text-zinc-400 mb-10">최종 수정일: 2025년 6월</p>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">수집하는 정보</h2>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed text-sm">
            Word Bank 앱은 다음 정보를 수집합니다:
          </p>
          <ul className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-1 leading-relaxed">
            <li>사용자가 직접 입력한 단어 데이터 (Firebase Firestore에 저장)</li>
            <li>앱 오류 및 성능 정보 (Sentry를 통한 익명 수집)</li>
            <li>광고 서비스 제공을 위한 광고 식별자 (Google AdMob)</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">정보 이용 목적</h2>
          <ul className="text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-1 leading-relaxed">
            <li>단어장 동기화 및 서비스 제공</li>
            <li>앱 안정성 개선</li>
            <li>무료 서비스 운영을 위한 광고 표시</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">제3자 서비스</h2>
          <ul className="text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-1 leading-relaxed">
            <li>Google Firebase (데이터 저장 및 인증)</li>
            <li>Google AdMob (광고)</li>
            <li>Sentry (오류 수집)</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">정보 보관 및 삭제</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
            사용자 데이터는 앱 삭제 또는 계정 삭제 시 함께 삭제됩니다.
            설정 화면에서 계정 삭제를 요청할 수 있습니다.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">문의</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            개인정보 관련 문의:{" "}
            <a
              href="mailto:ahntaejin4816@gmail.com"
              className="text-zinc-900 dark:text-zinc-100 underline"
            >
              ahntaejin4816@gmail.com
            </a>
          </p>
        </section>

        <a
          href="/"
          className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          ← 홈으로
        </a>
      </div>
    </div>
  );
}
