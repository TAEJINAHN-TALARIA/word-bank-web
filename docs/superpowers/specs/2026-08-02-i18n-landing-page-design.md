# Word Bank 랜딩페이지 다국어화 (한국어/영어)

## 배경

`word-bank-web`은 현재 한국어 단일 페이지로만 제공되는 Word Bank 앱의 랜딩/소개 사이트다. 앱은 14개 언어를 지원하는 글로벌 지향 제품([2026-08-02-landing-page-redesign-design.md](2026-08-02-landing-page-redesign-design.md) 참고)이지만, 랜딩페이지는 한국어 사용자만 대상으로 하고 있어 영어권 사용자(예: Google Play 심사, 해외 사용자)에게는 진입장벽이 있다.

이번 작업은 랜딩페이지와 개인정보처리방침 페이지를 한국어/영어 2개 언어로 먼저 제공하고, 이후 언어를 추가할 때 구조 변경 없이 번역 파일만 추가하면 되는 형태로 만든다.

## 목표

- `/ko`, `/en` 경로로 랜딩페이지(`/`)와 개인정보처리방침(`/privacy`)을 각각 제공한다.
- 루트 경로(`/`) 접속 시 브라우저 언어 설정에 따라 `/ko` 또는 `/en`으로 자동 리다이렉트한다.
- 페이지 우상단(또는 footer)에 언어 전환 UI를 제공해 사용자가 직접 언어를 바꿀 수 있게 한다.
- 향후 언어 추가 시 라우팅/미들웨어 구조를 다시 짜지 않고 번역 파일만 추가하면 되는 구조를 만든다.

## 전제조건

이 작업은 [2026-08-02-landing-page-redesign-design.md](2026-08-02-landing-page-redesign-design.md) 스펙 기반 구현 계획(`docs/superpowers/plans/2026-08-02-landing-page-redesign.md`)이 **먼저 실행 완료된 뒤** 시작한다. 리디자인이 끝난 시점의 한국어 최종 문구를 그대로 `messages/ko.json`의 원본으로 사용하기 위함이며, 순서를 바꾸면 번역을 두 번 해야 한다.

## 범위

- `app/page.tsx`, `app/layout.tsx`, `app/privacy/page.tsx`를 `app/[locale]/` 하위로 이동하고 로케일 라우팅 구조로 재구성
- 페이지 내 하드코딩된 한국어 문구를 `messages/ko.json` / `messages/en.json`으로 분리
- 영어 번역 작성 (Claude가 초벌 번역 제공, **배포 전 사용자 직접 검수 필수** — 특히 개인정보처리방침은 법적 문서이므로 정확도 검수가 더 중요함)
- 언어 전환 UI 컴포넌트 추가
- **범위 제외**: 한국어/영어 외 다른 언어 추가는 이번 작업에 포함하지 않는다 (구조만 확장 가능하게 만들어둠). 앱 자체(React Native)의 다국어화는 이미 완료되어 있으므로 대상 아님.

## 디자인

### 1. 의존성

`next-intl` 패키지를 추가한다. Next.js App Router 공식 문서 수준으로 널리 쓰이는 i18n 라이브러리로, 미들웨어 기반 로케일 감지/리다이렉트와 서버 컴포넌트 번역(`useTranslations`, `getTranslations`)을 지원한다.

### 2. 파일 구조

```
i18n/
  routing.ts       # defineRouting({ locales: ["ko", "en"], defaultLocale: "ko" })
  request.ts        # next-intl의 getRequestConfig — 로케일별 messages 로드
middleware.ts        # createMiddleware(routing) — "/" 요청을 Accept-Language 기준으로 /ko 또는 /en으로 리다이렉트
messages/
  ko.json
  en.json
app/
  [locale]/
    layout.tsx       # <html lang={locale}>, NextIntlClientProvider, generateMetadata (로케일별 title/description/OG)
    page.tsx          # 랜딩페이지, useTranslations()로 문구 조회
    privacy/
      page.tsx         # 개인정보처리방침, 동일하게 번역 키 사용
next.config.ts        # next-intl 플러그인 적용 (createNextIntlPlugin)
```

기존 `app/page.tsx`, `app/layout.tsx`, `app/privacy/page.tsx`는 `app/[locale]/` 하위로 이동한다. 데이터 배열(`journeySteps`, `features`, `languages` 등, 리디자인 작업에서 만들어짐)은 하드코딩된 한글 문자열 대신 번역 키를 참조하도록 바꾼다.

### 3. 로케일 감지 및 리다이렉트

`middleware.ts`는 `/` 및 로케일 프리픽스가 없는 모든 경로 요청에 대해 브라우저의 `Accept-Language` 헤더를 파싱해 `ko` 또는 `en`으로 매칭한다. 매칭되는 언어가 없으면 기본값 `ko`로 리다이렉트한다. 예: `/` → `/ko` 또는 `/en`, `/privacy` → `/ko/privacy` 또는 `/en/privacy`.

### 4. 언어 전환 UI

랜딩페이지와 개인정보처리방침 페이지 우상단에 "한국어 / English" 텍스트 링크 토글을 추가한다. 현재 로케일이 아닌 쪽 링크를 누르면 **현재 보고 있는 경로를 유지한 채 로케일만 바뀐다** (예: `/ko/privacy` → `/en/privacy`).

### 5. 번역 콘텐츠

- `messages/ko.json`: 리디자인 작업 완료 시점의 최종 한국어 문구를 그대로 옮긴다 (신규 번역 아님, 이관).
- `messages/en.json`: `ko.json`을 기준으로 영어 번역을 작성한다. 마케팅 카피의 톤을 살리는 것을 우선하되, 온보딩 문구("호기심을 저축하세요" 등)와 일관된 어조를 유지한다.
- 개인정보처리방침의 영어 번역은 원문의 법적 의미를 왜곡하지 않는 것을 최우선으로 한다.
- **번역 검수**: 이 스펙에 따라 생성된 영어 번역은 초벌 번역이며, 배포 전 사용자가 직접 검수해야 한다. 이 작업의 완료 기준에 "영어 번역 정확성 보장"은 포함하지 않는다 — 구조와 초벌 번역 제공까지가 이번 작업의 범위다.

### 6. 확장성

이후 언어를 추가할 때는 `i18n/routing.ts`의 `locales` 배열에 로케일 코드를 추가하고 `messages/<locale>.json` 파일을 새로 채우기만 하면 된다. 미들웨어, 라우팅 구조, 페이지 컴포넌트는 변경할 필요가 없다.

## 에러 처리 / 예외

- 지원하지 않는 로케일 프리픽스로 접근하면(next-intl 기본 동작) 404를 반환한다.
- `Accept-Language`가 없거나 매칭되는 로케일이 없으면 기본 로케일(`ko`)로 처리한다.

## 테스트

- `npm run lint`, `npm run build` 성공 확인 (두 로케일 모두 정적 생성되는지 빌드 로그로 확인)
- `npm run dev`로 다음을 수동 확인:
  - `/` 접속 시 브라우저 언어 설정에 따라 `/ko` 또는 `/en`으로 리다이렉트되는지
  - `/ko`, `/en` 각각에서 랜딩페이지 문구가 올바른 언어로 표시되는지
  - 언어 전환 토글 클릭 시 같은 페이지의 다른 로케일로 정상 이동하는지 (랜딩페이지 ↔ 랜딩페이지, privacy ↔ privacy)
  - `/ko/privacy`, `/en/privacy` 각각 정상 렌더링되는지
  - 존재하지 않는 로케일(`/fr` 등) 접근 시 404 처리되는지
