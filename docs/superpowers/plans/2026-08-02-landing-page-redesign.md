# Word Bank 랜딩페이지 리디자인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `app/page.tsx`와 `app/layout.tsx`를 최신 앱 기능(READ 탭, 복습 3모드, 카테고리 관리, 14개 언어)을 반영한 스토리텔링형 랜딩페이지로 리디자인한다.

**Architecture:** 단일 Next.js App Router 페이지(`app/page.tsx`)에 섹션을 순서대로 추가/재구성하는 방식. 데이터(문구)는 파일 상단의 배열 상수로 분리해 컴포넌트 JSX는 그 배열을 매핑만 하도록 유지한다(기존 `features` 배열 패턴을 그대로 따름). 재사용되는 다운로드 버튼은 작은 헬퍼 컴포넌트로 추출한다.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4. 테스트 러너는 구성되어 있지 않으므로, 각 태스크의 검증은 `npm run lint` + `npm run build`(정적 빌드 성공) + `npm run dev`로 브라우저 수동 확인으로 대체한다.

## Global Constraints

- 실제 앱 스크린샷은 사용하지 않는다 — 기존처럼 이모지 아이콘 기반 스타일 유지. ([spec](../specs/2026-08-02-landing-page-redesign-design.md) §배경)
- `app/privacy/page.tsx`는 이번 작업 범위에서 제외 — 수정하지 않는다. (spec §범위)
- 지원 언어 수는 **14개**로 표기한다 (10개 아님). (spec §4)
- 핵심 흐름 섹션 순서는 **읽기 → 저장 → 정리 → 복습**. (spec §2)
- Google Play 링크는 기존 URL 그대로 유지: `https://play.google.com/store/apps/details?id=com.taejinahn.wordbank`.
- 다크모드는 기존과 동일하게 Tailwind `dark:` 클래스로만 처리한다 (별도 JS 로직 없음).
- 데스크톱(`sm` 이상)에서 핵심 흐름 섹션은 홀수/짝수마다 좌우로 텍스트 정렬을 교차시키고, 모바일에서는 세로로 중앙 정렬해 쌓는다. (spec §2)

---

## Task 1: Hero 섹션 보강 + Footer 연도 갱신

**Files:**
- Modify: `app/page.tsx` (Hero 섹션 하단, Footer 섹션)

**Interfaces:**
- Produces: 없음 (선행 태스크)

- [ ] **Step 1: Hero 다운로드 버튼 아래에 iOS 안내 문구 추가**

`app/page.tsx`에서 Hero의 `<a>` 다운로드 버튼(현재 51~61번째 줄) 바로 다음, `</section>` 앞에 아래 문단을 추가한다:

```tsx
        <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-3">
          iOS 버전은 준비 중입니다.
        </p>
```

- [ ] **Step 2: Footer 저작권 연도 갱신**

`app/page.tsx`의 Footer에서:

```tsx
        <p className="mb-2">© 2025 Talaria. All rights reserved.</p>
```

를 다음으로 교체한다:

```tsx
        <p className="mb-2">© 2026 Talaria. All rights reserved.</p>
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 두 명령 모두 에러 없이 종료.

- [ ] **Step 4: 커밋**

```bash
git add app/page.tsx
git commit -m "feat: 랜딩페이지 Hero에 iOS 안내 추가, footer 연도 갱신"
```

---

## Task 2: 핵심 흐름 섹션 (읽기 → 저장 → 정리 → 복습) 추가

**Files:**
- Modify: `app/page.tsx` (상단 데이터 배열, Hero와 Features 섹션 사이에 새 섹션 삽입)

**Interfaces:**
- Produces: `journeySteps` 배열 (각 원소 `{ icon: string; title: string; desc: string }`) — 이후 태스크에서 참조하지 않음, 이 태스크 내에서 완결.

- [ ] **Step 1: `journeySteps` 데이터 배열 추가**

`app/page.tsx` 파일 상단, 기존 `const PLAY_STORE_URL = ...` 바로 다음(현재 `const features = [...]` 앞)에 추가:

```tsx
const journeySteps = [
  {
    icon: "📖",
    title: "읽으면서 단어를 만나요",
    desc: "10개 언어, 6단계 레벨의 AI 생성 이야기로 읽기 연습을 해보세요. 모르는 단어가 나오면 탭 한 번으로 바로 뜻을 확인할 수 있어요.",
  },
  {
    icon: "✨",
    title: "탭 한 번으로 저장, AI가 나머지를 채워요",
    desc: "읽다가 발견했든 직접 입력했든, 저장하기만 하세요. AI가 즉시 품사·뜻·발음기호·예문·유의어·반의어까지 찾아드려요.",
  },
  {
    icon: "🗂️",
    title: "나만의 방식으로 정리해요",
    desc: "언어별, 혹은 직접 만든 카테고리별로 단어장을 정리하세요. 색상을 지정하고 검색하고, 필요하면 엑셀로 내보낼 수 있어요.",
  },
  {
    icon: "🃏",
    title: "잊을 만할 때 복습해요",
    desc: "Leitner 5단계 박스로 아는 단어는 간격을 두고, 모르는 단어는 자주 복습해요. 카드 뒤집기·빈칸 채우기·듣고 맞추기 세 모드 중 골라보세요.",
  },
];
```

- [ ] **Step 2: Journey 섹션 JSX 삽입**

`app/page.tsx`에서 Hero `</section>` 닫힘 태그 바로 다음, 기존 `{/* Features */}` 섹션 앞에 삽입:

```tsx
      {/* Journey */}
      <section className="px-6 pb-24 max-w-3xl mx-auto">
        <div className="flex flex-col gap-16">
          {journeySteps.map((step, i) => (
            <div
              key={step.title}
              className={`flex flex-col sm:flex-row items-center gap-6 text-center sm:text-left ${
                i % 2 === 1 ? "sm:flex-row-reverse sm:text-right" : ""
              }`}
            >
              <div className="text-6xl shrink-0">{step.icon}</div>
              <div>
                <h3 className="text-xl font-bold mb-2">{step.title}</h3>
                <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 에러 없이 종료.

- [ ] **Step 4: 브라우저 수동 확인**

Run: `npm run dev`, 브라우저에서 `http://localhost:3000` 접속.
Expected: Hero 아래에 읽기→저장→정리→복습 4개 섹션이 순서대로 보이고, 데스크톱 폭에서 아이콘/텍스트가 섹션마다 좌우로 교차 배치됨. 모바일 폭(브라우저 창 축소)에서는 세로 중앙 정렬로 쌓임.

- [ ] **Step 5: 커밋**

```bash
git add app/page.tsx
git commit -m "feat: 읽기-저장-정리-복습 핵심 흐름 섹션 추가"
```

---

## Task 3: 기타 기능 그리드 데이터 갱신

**Files:**
- Modify: `app/page.tsx` (기존 `features` 배열, Features 섹션 heading, grid 컬럼 수)

**Interfaces:**
- Produces: 없음.

- [ ] **Step 1: `features` 배열을 부가 기능 4종으로 교체**

기존 `app/page.tsx`의 `const features = [...]` 전체(AI 자동 생성, Leitner 플래시카드, 10개 언어 지원, 복습 알람, 알림창 빠른 추가, 엑셀 내보내기 6개 항목)를 아래로 교체한다. 핵심 기능(AI 자동 생성/Leitner/언어 지원)은 Task 2의 Journey 섹션과 Task 4의 언어 섹션으로 이동했으므로 여기서는 뺀다:

```tsx
const features = [
  {
    icon: "🔔",
    title: "복습 알람",
    desc: "원하는 시간에, 원하는 범위(언어/카테고리/모드)로 복습 알림을 받아보세요.",
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
  {
    icon: "🌙",
    title: "다크 모드",
    desc: "라이트/다크/시스템 테마를 지원해요.",
  },
];
```

- [ ] **Step 2: Features 섹션 heading과 grid 컬럼 수 조정**

`app/page.tsx`에서:

```tsx
        <h2 className="text-2xl font-bold text-center mb-12 text-zinc-800 dark:text-zinc-200">
          주요 기능
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
```

를 다음으로 교체한다 (항목이 4개로 줄었으므로 `lg:grid-cols-4`로 변경, heading 문구 변경):

```tsx
        <h2 className="text-2xl font-bold text-center mb-12 text-zinc-800 dark:text-zinc-200">
          더 편리하게
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 에러 없이 종료.

- [ ] **Step 4: 커밋**

```bash
git add app/page.tsx
git commit -m "feat: 부가 기능 그리드를 4종으로 갱신 (알람/빠른추가/엑셀/다크모드)"
```

---

## Task 4: 지원 언어 섹션 신규 추가

**Files:**
- Modify: `app/page.tsx` (상단 데이터 배열, Features 섹션과 CTA 사이에 새 섹션 삽입)

**Interfaces:**
- Produces: `languages` 배열 (`string[]`) — 이 태스크 내에서 완결.

- [ ] **Step 1: `languages` 데이터 배열 추가**

`app/page.tsx`에서 Task 3의 `features` 배열 바로 다음에 추가:

```tsx
const languages = [
  "한국어", "영어", "일본어", "중국어", "독일어", "프랑스어", "스페인어",
  "포르투갈어", "아랍어", "라틴어", "힌디어", "벵골어", "러시아어", "인도네시아어",
];
```

- [ ] **Step 2: Languages 섹션 JSX 삽입**

Features 섹션의 `</section>` 닫힘 태그 바로 다음에 삽입:

```tsx
      {/* Languages */}
      <section className="px-6 pb-24 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl font-bold mb-4 text-zinc-800 dark:text-zinc-200">
          14개 언어 지원
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">
          원하는 언어로 학습하세요.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {languages.map((lang) => (
            <span
              key={lang}
              className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-1.5 text-sm text-zinc-600 dark:text-zinc-300"
            >
              {lang}
            </span>
          ))}
        </div>
      </section>
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 에러 없이 종료.

- [ ] **Step 4: 커밋**

```bash
git add app/page.tsx
git commit -m "feat: 지원 언어(14개) 섹션 추가"
```

---

## Task 5: 다운로드 버튼 컴포넌트 추출 + 하단 CTA 섹션 추가

**Files:**
- Modify: `app/page.tsx` (다운로드 버튼을 `DownloadButton` 컴포넌트로 추출, Hero에서 재사용, Languages와 Footer 사이에 CTA 섹션 삽입)

**Interfaces:**
- Produces: `DownloadButton({ className }: { className?: string })` — Hero 섹션과 CTA 섹션 양쪽에서 사용.

- [ ] **Step 1: `DownloadButton` 컴포넌트 추출**

`app/page.tsx`에서 `languages` 배열 바로 다음, `export default function Home()` 앞에 추가:

```tsx
function DownloadButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-3 rounded-xl font-semibold text-sm hover:opacity-80 transition-opacity ${className}`}
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
        <path d="M3.18 23.76c.3.17.64.24.99.19l13.12-11.95L13.65 8.4 3.18 23.76zm17.3-10.7-3.3-1.9-3.73 3.4 3.73 3.38 3.32-1.92a1.55 1.55 0 0 0 0-2.96zM3 .27a1.55 1.55 0 0 0-.82 1.37v20.72c0 .58.3 1.08.82 1.36L13.3 12 3 .27zm10.65 3.33-9.47 8.64 3.64 3.62 5.83-12.26z" />
      </svg>
      Google Play에서 다운로드
    </a>
  );
}
```

- [ ] **Step 2: Hero의 인라인 `<a>` 버튼을 `<DownloadButton />` 호출로 교체**

Hero 섹션에서 Task 1이 추가한 iOS 안내 문구 바로 위, 기존 인라인 `<a href={PLAY_STORE_URL} ...>...</a>` 블록 전체(아이콘 SVG 포함)를 다음으로 교체:

```tsx
        <DownloadButton />
```

- [ ] **Step 3: 하단 CTA 섹션 삽입**

Languages 섹션의 `</section>` 다음, `{/* Footer */}` 주석 앞에 삽입:

```tsx
      {/* CTA */}
      <section className="flex flex-col items-center text-center px-6 pb-24">
        <h2 className="text-2xl font-bold mb-6 text-zinc-800 dark:text-zinc-200">
          지금 바로 시작해보세요
        </h2>
        <DownloadButton />
      </section>
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 에러 없이 종료.

- [ ] **Step 5: 브라우저 수동 확인**

Run: `npm run dev`, 브라우저에서 페이지 전체를 라이트/다크 모드 양쪽으로 스크롤하며 확인.
Expected: Hero와 하단 CTA 두 곳 모두 동일한 스타일의 Google Play 버튼이 정상 렌더링되고 클릭 시 새 탭으로 Play 스토어 링크가 열림(href 확인으로 충분, 실제 이동은 선택).

- [ ] **Step 6: 커밋**

```bash
git add app/page.tsx
git commit -m "feat: 다운로드 버튼 컴포넌트 추출 및 하단 CTA 섹션 추가"
```

---

## Task 6: `app/layout.tsx` 메타데이터 갱신

**Files:**
- Modify: `app/layout.tsx:15-23`

**Interfaces:**
- Produces: 없음.

- [ ] **Step 1: `metadata` 객체 문구 갱신**

`app/layout.tsx`에서:

```tsx
export const metadata: Metadata = {
  title: "Word Bank — AI 단어장",
  description: "단어를 저장하면 AI가 즉시 뜻, 예문, 유의어까지 찾아드려요. Leitner 시스템으로 효율적으로 복습하세요.",
  openGraph: {
    title: "Word Bank — AI 단어장",
    description: "단어를 저장하면 AI가 즉시 뜻, 예문, 유의어까지 찾아드려요.",
    type: "website",
  },
};
```

를 다음으로 교체한다:

```tsx
export const metadata: Metadata = {
  title: "Word Bank — AI 단어장 & 리딩",
  description: "AI가 단어 뜻과 예문을 자동으로 채워주고, 읽기 콘텐츠와 Leitner 복습으로 완벽하게 익혀요. 14개 언어 지원.",
  openGraph: {
    title: "Word Bank — AI 단어장 & 리딩",
    description: "AI가 단어 뜻과 예문을 자동으로 채워주고, 읽기 콘텐츠와 Leitner 복습으로 완벽하게 익혀요.",
    type: "website",
  },
};
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 에러 없이 종료.

- [ ] **Step 3: 커밋**

```bash
git add app/layout.tsx
git commit -m "feat: 메타데이터 문구를 최신 기능 기준으로 갱신"
```

---

## Task 7: 최종 통합 검증

**Files:**
- 없음 (검증 전용 태스크)

**Interfaces:**
- Consumes: Task 1~6에서 완성된 `app/page.tsx`, `app/layout.tsx` 전체.

- [ ] **Step 1: 전체 린트/빌드 재확인**

Run: `npm run lint && npm run build`
Expected: 에러 없이 종료, `out/` 또는 `.next/` 정적 산출물 생성 확인.

- [ ] **Step 2: 개발 서버로 전체 페이지 시나리오 확인**

Run: `npm run dev`, 브라우저에서 다음을 확인한다:
- Hero → 읽기/저장/정리/복습 4섹션 → 기타 기능 4카드 → 지원 언어 14개 배지 → 하단 CTA → Footer 순서로 표시되는지
- OS 다크모드 토글 시 전체 섹션이 라이트/다크 양쪽에서 깨지지 않는지
- 브라우저 창을 모바일 폭으로 줄였을 때 Journey 섹션이 세로로 정상적으로 쌓이는지
- `/privacy` 링크가 여전히 정상 동작하는지 (Task 범위 외이므로 미변경 확인 목적)

Expected: 위 항목 모두 정상.

- [ ] **Step 3: 스펙 대조**

`docs/superpowers/specs/2026-08-02-landing-page-redesign-design.md`의 각 섹션(1~6)을 다시 읽고 페이지에 반영되었는지 하나씩 확인한다.
Expected: 모든 섹션이 반영됨. 누락 발견 시 해당 태스크로 돌아가 보완.
