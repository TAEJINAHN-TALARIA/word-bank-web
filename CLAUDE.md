@AGENTS.md

# 프로젝트 개요

Word Bank 앱의 소개(랜딩) 페이지 + 개인정보처리방침 페이지. Next.js 16 (App Router, Turbopack) + Tailwind CSS v4 + `next-intl` (한국어/영어 i18n). Vercel에 배포됨.

## 구조

- `app/[locale]/` — 로케일 프리픽스(`/ko`, `/en`) 하위에 랜딩페이지(`page.tsx`)와 개인정보처리방침(`privacy/page.tsx`)이 있음. 문구는 하드코딩하지 않고 `messages/ko.json` / `messages/en.json`의 번역 키로 가져온다 (`useTranslations`가 아니라 `getTranslations`(awaited) — 비동기 서버 컴포넌트에서는 `useTranslations`가 동작하지 않음).
- `i18n/routing.ts` — 지원 로케일(`ko` 기본값, `en`) 정의. 언어 추가 시 이 배열 + `messages/<locale>.json` 파일 하나만 추가하면 되도록 유지할 것 (다른 파일은 건드리지 않는다).
- `proxy.ts` — `middleware.ts`가 아님. 이 Next.js 버전은 v16부터 `middleware` 파일 규약을 `proxy`로 이름을 바꿨다. `/` 및 로케일 프리픽스 없는 요청을 `Accept-Language` 기준으로 `/ko` 또는 `/en`으로 리다이렉트한다.
- `components/LocaleSwitcher.tsx` — 언어 전환 토글 (클라이언트 컴포넌트).

## 설계 문서

`docs/superpowers/specs/`, `docs/superpowers/plans/`에 랜딩페이지 리디자인·다국어화 작업의 스펙과 구현 계획이 있다. 새 기능 작업 시 참고할 것.

## 주의사항

- 영어 번역(특히 `messages/en.json`의 `Privacy` 섹션)은 초벌 번역이며 배포 전 사용자 직접 검수가 필요하다 (법적 문서라 정확도가 중요함).
- 테스트 러너 없음 (jest/vitest 미설치). 검증은 `npm run lint` + `npm run build` + 수동/curl 기반 동작 확인으로 한다.
