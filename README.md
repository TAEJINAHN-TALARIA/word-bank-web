# Word Bank 랜딩페이지 + 관리자 대시보드

[Word Bank](https://play.google.com/store/apps/details?id=com.taejinahn.wordbank) 앱의 소개(랜딩) 페이지, 개인정보처리방침 페이지, 그리고 내부 관리자 대시보드(`/admin`)를 제공하는 [Next.js](https://nextjs.org) 프로젝트입니다.

## Getting Started

개발 서버 실행:

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) 접속 시 브라우저 언어 설정(`Accept-Language`)에 따라 `/ko` 또는 `/en`으로 자동 리다이렉트됩니다.

랜딩페이지는 `app/[locale]/page.tsx`, 개인정보처리방침은 `app/[locale]/privacy/page.tsx`를 수정하면 됩니다. 두 페이지 모두 문구는 하드코딩하지 않고 `messages/ko.json` / `messages/en.json`에서 번역 키로 가져옵니다.

## 다국어 구조 (i18n)

[`next-intl`](https://next-intl.dev)로 한국어(`ko`, 기본값)/영어(`en`) 2개 언어를 지원합니다.

```
i18n/
  routing.ts       # defineRouting — 지원 로케일 목록
  navigation.ts     # Link, usePathname 등 로케일 인식 네비게이션 헬퍼
  request.ts        # 로케일별 messages 로드
messages/
  ko.json / en.json  # 페이지 문구 (번역 키)
app/[locale]/
  layout.tsx         # <html lang>, 로케일별 메타데이터
  page.tsx            # 랜딩페이지
  privacy/page.tsx     # 개인정보처리방침
proxy.ts              # "/" 요청을 Accept-Language 기준 /ko 또는 /en으로 리다이렉트
components/LocaleSwitcher.tsx  # 언어 전환 토글
```

**언어 추가 시**에는 `i18n/routing.ts`의 `locales` 배열에 로케일 코드를 추가하고 `messages/<locale>.json`을 새로 채우기만 하면 됩니다. 라우팅/미들웨어 구조는 그대로 둡니다.

> **참고:** 이 프로젝트가 사용하는 Next.js 버전은 `middleware.ts` 대신 `proxy.ts` 파일 규약을 씁니다(v16부터 `middleware` → `proxy`로 이름이 바뀜). `middleware.ts`를 새로 만들어도 동작하지 않습니다.

영어 번역(특히 개인정보처리방침)은 초벌 번역이므로 배포 전 검수가 필요합니다.

## 관리자 대시보드 (`/admin`)

Word Bank 소설 생성 파이프라인을 모니터링/운영하는 내부 도구입니다. 로케일 프리픽스가 붙지 않으며, Firebase Auth(Google 로그인 + custom claim `admin: true`)로 접근을 제어합니다.

```
app/admin/
  login/page.tsx                       # Google 로그인 → 세션 쿠키 발급
  (dashboard)/layout.tsx                # 인증 게이트 (getAdminSession() 없으면 로그인으로 리다이렉트)
  (dashboard)/page.tsx                   # 홈 요약
  (dashboard)/generation/                # 파이프라인 세션 목록 + 상세
  (dashboard)/review/                    # 검토 대기 / 게시된 소설, 전문보기, 다운로드, 일괄 게시
  (dashboard)/quality/                   # 주간 품질 분석 리포트, 오신고 단어 복구
  (dashboard)/word-cache/                # 단어캐시 현황
lib/data/        # Firestore 읽기 전용 조회 ("server-only")
lib/actions/     # Server Actions ("use server", 각자 세션 재확인)
lib/admin-functions/  # story-generator 레포의 Cloud Functions 호출
components/admin/     # 대시보드 전용 컴포넌트
```

로컬에서 띄우려면 `.env.example`을 `.env.local`로 복사하고 Firebase Web SDK 설정 + `FIREBASE_ADMIN_KEY_BASE64` + `ADMIN_API_SHARED_SECRET` + `STORY_GENERATOR_FUNCTIONS_BASE_URL`을 채워야 합니다. 사용할 Google 계정에는 Firebase Auth custom claim `admin: true`가 미리 설정돼 있어야 합니다.

**`(dashboard)` 레이아웃 밖의 Route Handler(예: 다운로드 라우트)는 인증이 자동 적용되지 않으므로 자체적으로 `getAdminSession()`을 호출**합니다.

## 스크립트

```bash
npm run dev     # 개발 서버 (Turbopack)
npm run build   # 프로덕션 빌드
npm run lint    # ESLint
npm run test    # Vitest (lib/data, lib/actions의 순수 로직 테스트 — 컴포넌트 렌더링 테스트는 없음)
```

## 배포

[Vercel](https://vercel.com)에 배포됩니다 (`master` 브랜치 push 시 자동 배포).

## 설계 문서

`docs/superpowers/specs/`, `docs/superpowers/plans/`에 랜딩페이지 리디자인·다국어화 및 관리자 대시보드 작업의 스펙/구현 계획이 남아 있습니다.
