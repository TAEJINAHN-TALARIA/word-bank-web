@AGENTS.md

# 프로젝트 개요

Word Bank 앱의 소개(랜딩) 페이지 + 개인정보처리방침 페이지, 그리고 `/admin` 아래의 내부 관리자 대시보드(소설 생성 파이프라인 모니터링, 검토/게시, 품질 리포트, 단어캐시 현황). Next.js 16 (App Router, Turbopack) + Tailwind CSS v4 + `next-intl` (한국어/영어 i18n, 공개 페이지만 해당). Firebase(Auth + Firestore, `firebase-admin`)로 관리자 인증 및 데이터 조회. Vercel에 배포됨.

## 구조 — 공개 페이지 (i18n)

- `app/[locale]/` — 로케일 프리픽스(`/ko`, `/en`) 하위에 랜딩페이지(`page.tsx`)와 개인정보처리방침(`privacy/page.tsx`)이 있음. 문구는 하드코딩하지 않고 `messages/ko.json` / `messages/en.json`의 번역 키로 가져온다 (`useTranslations`가 아니라 `getTranslations`(awaited) — 비동기 서버 컴포넌트에서는 `useTranslations`가 동작하지 않음).
- `i18n/routing.ts` — 지원 로케일(`ko` 기본값, `en`) 정의. 언어 추가 시 이 배열 + `messages/<locale>.json` 파일 하나만 추가하면 되도록 유지할 것 (다른 파일은 건드리지 않는다).
- `proxy.ts` — `middleware.ts`가 아님. 이 Next.js 버전은 v16부터 `middleware` 파일 규약을 `proxy`로 이름을 바꿨다. `/` 및 로케일 프리픽스 없는 요청을 `Accept-Language` 기준으로 `/ko` 또는 `/en`으로 리다이렉트한다.
- `components/LocaleSwitcher.tsx` — 언어 전환 토글 (클라이언트 컴포넌트).

## 구조 — 관리자 대시보드 (`/admin`, i18n 미적용)

- `app/admin/(dashboard)/` — 인증 게이트가 걸린 라우트 그룹. 레이아웃(`layout.tsx`)이 `getAdminSession()`으로 세션을 확인하고 없으면 `/admin/login`으로 리다이렉트한다. 하위 페이지: `/admin`(홈 요약), `/admin/generation`(파이프라인 세션 목록) + `/admin/generation/[sessionId]`(상세), `/admin/review`(검토 대기/게시된 소설, 세션 그룹 collapsible + 대기중 탭 일괄 게시) + `/admin/review/[docId]`(전문보기) + `/admin/review/[docId]/download`(txt 다운로드 Route Handler), `/admin/quality`(주간 품질 분석 리포트, 오신고 단어 복구), `/admin/word-cache`(단어캐시 현황).
- `app/admin/login/page.tsx` — Google 로그인(Firebase Auth popup) 후 `/api/auth/session`에 idToken을 보내 세션 쿠키를 발급받는다. 관리자 권한은 Firebase Auth custom claim `admin: true`로 판별(`lib/auth/session.ts`).
- **`(dashboard)` 레이아웃 밖의 Route Handler는 인증이 자동 적용되지 않는다** — 예: 다운로드 라우트는 자체적으로 `getAdminSession()`을 호출해 401을 반환해야 한다. 새 Route Handler를 `(dashboard)` 밖에 추가할 때 반드시 확인할 것.
- `lib/data/` — Firestore 읽기 전용 조회 함수들(`"server-only"` + `getAdminFirestore()` 패턴). `lib/actions/` — `"use server"` Server Actions, 쓰기 작업은 각자 내부에서 `getAdminSession()`을 재확인한다(레이아웃의 게이트는 Server Action 직접 호출을 막지 못하므로).
- `lib/admin-functions/storyGenerator.ts` — 외부 `story-generator` 레포의 Cloud Functions를 `x-admin-api-key` 공유 시크릿으로 호출(대기중 리뷰 목록 조회, 게시/철회). `ADMIN_API_SHARED_SECRET`/`STORY_GENERATOR_FUNCTIONS_BASE_URL` 필요.
- `components/admin/` — 대시보드 전용 클라이언트/서버 컴포넌트. 공유 UI 패턴: `EmptyTableRow`, `InlineError`, `LabeledList`, `GroupCollapseToggle`(세션 그룹 접기/펼치기). 목록 컴포넌트는 서버가 내려주는 `initial*` prop을 기반으로 로컬 오버레이(`removedKeys`/`extraPages`) 상태를 얹는 패턴을 쓴다 — `revalidatePath` 이후 prop 참조가 바뀌면 렌더 중(render-time) 상태 조정으로 오버레이를 리셋해 stale 데이터를 방지한다.

## 설계 문서

`docs/superpowers/specs/`, `docs/superpowers/plans/`에 랜딩페이지 리디자인·다국어화 및 관리자 대시보드 작업의 스펙과 구현 계획이 있다. 새 기능 작업 시 참고할 것.

## 주의사항

- 영어 번역(특히 `messages/en.json`의 `Privacy` 섹션)은 초벌 번역이며 배포 전 사용자 직접 검수가 필요하다 (법적 문서라 정확도가 중요함).
- Vitest가 설치돼 있다(`npm run test`). 검증은 `npm run lint` + `npm run test` + `npm run build`로 하고, 관리자 대시보드처럼 실제 로그인/Firestore 데이터가 필요한 화면은 수동/curl 기반 동작 확인을 추가한다. 이 프로젝트엔 컴포넌트 렌더링 테스트 인프라(jsdom/React Testing Library)가 없다 — `lib/data/`·`lib/actions/`의 순수 로직만 Vitest로 테스트한다.
- 관리자 대시보드를 로컬에서 띄우려면 `.env.local`에 Firebase Web SDK 설정 4개, `FIREBASE_ADMIN_KEY_BASE64`, `ADMIN_API_SHARED_SECRET`, `STORY_GENERATOR_FUNCTIONS_BASE_URL`이 모두 필요하다(`.env.example` 참고). 관리자 권한 부여는 Firebase Auth custom claim `admin: true`를 해당 계정에 직접 설정해야 한다(콘솔/Admin SDK).
