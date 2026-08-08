# 관리자 대시보드 UI 다듬기 + 로딩 속도 최적화 — 설계

**작성일**: 2026-08-08
**저장소**: word-bank-web (`app/admin/**`)
**전제**: Phase 1(로그인/레이아웃/생성진행상황/검토·게시)은 이미 완료·배포되어 실사용 검증까지 끝난 상태. 이번 작업은 새 기능 추가가 아니라 기존 4개 화면(`/admin`, `/admin/generation`, `/admin/generation/[sessionId]`, `/admin/review`)의 체감 속도와 시각적 완성도를 높이는 리팩터링 성격.

## 현재 상태 재확인

코드를 다시 훑어본 결과 Phase 1은 생각보다 깔끔하게 끝나 있다:

- shadcn/ui(`components.json`, style `base-nova`, baseColor `neutral`)가 4개 화면 전체에 일관 적용돼 있고, 라이브 코드에 raw HTML 테이블/버튼이 남아있지 않음.
- 데이터 페이지는 전부 서버 컴포넌트(RSC + Admin SDK)이고, 불필요한 `"use client"`가 없음. `/admin`, `/admin/review`는 이미 `Promise.all`로 병렬 fetch.
- Firestore 쿼리에 `.limit()` 캡이 이미 있음(generation 50건, review 발행 100건) — 무제한 스캔은 없음.

즉 이번 스펙은 "망가진 걸 고치는" 게 아니라, 이미 튼튼한 기반 위에서 남은 거친 부분들을 다듬는 작업이다:

1. `app/admin/**` 어디에도 `loading.tsx`/Suspense/스켈레톤이 없어 — 네비게이션마다 데이터가 다 올 때까지 빈 화면
2. `lib/data/pipelineSessions.ts`의 `getPipelineSessionDetail()`이 세션 문서 → 게이트 서브컬렉션을 순차로 fetch(병렬화 가능한데 안 하고 있음)
3. `generation`(50건 캡)·`review` 발행 탭(100건 캡)에 더 보기/페이지네이션 UI가 없어 그 이상 데이터가 조용히 안 보임. 캡 자체가 없는 `fetchPendingReviews()`도 마찬가지로 무한정 늘어날 수 있음.
4. `statusBadgeVariant()`가 `generation/page.tsx`와 `generation/[sessionId]/page.tsx`에 각각 복붙돼 있고, `review` 페이지의 게이트 배지는 이 로직을 아예 안 써서 **성공/실패/경고 상관없이 항상 같은 회색(`outline`)** — 사실상 버그. 빈 상태 행, 인라인 에러 박스 스타일도 3곳에서 복붙됨.
5. 전체적으로 색이 하나도 없는 완전 무채색(shadcn neutral, 채도 0) 테마라 "대시보드"라기보다 문서에 가까운 인상

## 시각 방향 (비주얼 컴패니언으로 확정)

- **액센트 컬러: 인디고/블루** (`#4f46e5` 계열). 성공/경고/실패 상태 배지는 액센트와 분리해서 항상 초록/노랑/빨강으로 고정 — 브랜드색과 상태색이 섞이지 않게.
- 홈 카드에 왼쪽 액센트 보더(4px) 추가, 테이블 행에 호버 배경 추가.
- `loading.tsx`는 실제 콘텐츠와 같은 행 수·너비의 펄스 스켈레톤 — 로드 후 레이아웃이 튀지 않게.
- **차트/추이 그래프는 이번 범위에서 제외.** 차트 라이브러리가 지금 설치돼 있지 않고(recharts 등 없음), 새 의존성 + 데이터 집계 로직을 새로 짜야 해서 비용 대비 실익이 낮다고 판단 — 카드+테이블 개선 수준에서 마무리.

## 작업 항목

### 1. 로딩 스켈레톤 (`loading.tsx`)

- `app/admin/(dashboard)/loading.tsx`, `app/admin/(dashboard)/generation/loading.tsx`, `app/admin/(dashboard)/generation/[sessionId]/loading.tsx`, `app/admin/(dashboard)/review/loading.tsx` 4개 추가
- 각 화면의 실제 레이아웃(카드 2개, 테이블 N행 등)과 동일한 뼈대를 회색 펄스 블록으로 표현하는 공유 스켈레톤 프리미티브(`components/admin/Skeleton.tsx` 또는 `components/ui/skeleton.tsx`, shadcn 표준 컴포넌트 추가) 사용

### 2. 워터폴 병렬화

- `lib/data/pipelineSessions.ts`의 `getPipelineSessionDetail()` — 세션 문서 조회와 `layer6Gates` 서브컬렉션 조회를 `Promise.all`로 동시 실행하도록 변경 (후자는 `sessionId` 파라미터만 있으면 되므로 전자의 결과를 기다릴 필요 없음)

### 3. 페이지네이션

- `generation`(현재 `.limit(50)`)과 `review` 발행 탭(현재 `.limit(100)`)에 커서 기반 "더 보기" 버튼 추가 (Firestore `startAfter()` 커서 방식 — 전체 count가 필요 없는 단순 무한 스크롤형 페이지네이션이 이 규모의 관리자 도구엔 적합)
- `fetchPendingReviews()`(story-generator 쪽 외부 Cloud Function 호출)에 응답 캡이 없는 문제는 **word-bank-web만으로는 못 고침** — story-generator 레포의 함수 시그니처를 바꿔야 하므로, 이번 스펙에서는 "알려진 제약"으로 남기고 페이지네이션 대상에서 제외. 필요해지면 story-generator 쪽에 별도 작업으로 분리.

### 4. 공유 컴포넌트 정리 + 배지 버그 수정

- `lib/status.ts`(또는 `components/admin/StatusBadge.tsx`)로 `statusBadgeVariant()` 로직을 단일화하고, `generation/page.tsx`·`generation/[sessionId]/page.tsx`·`ReviewTabs.tsx` 세 곳 모두 이걸 사용하도록 교체 — **review 페이지의 게이트 배지가 실제 pass/fail/warn 상태에 따라 색이 바뀌도록 수정** (지금은 버그로 항상 `outline`)
- `components/admin/EmptyTableRow.tsx` — 3곳에 복붙된 빈 상태 행 패턴 통합
- `components/admin/InlineError.tsx` — `login/page.tsx`·`ReviewTabs.tsx`에 복붙된 에러 박스 스타일 통합
- `generation/[sessionId]/page.tsx`의 `gateBorderClass()`(왼쪽 보더 색)도 같은 상태값 소스(`lib/status.ts`)를 참조하도록 정리

### 5. 시각 스타일 적용

- `app/globals.css`의 `--primary`, `--ring`, `--sidebar-primary` 등을 인디고 계열 oklch 값으로 교체(neutral → indigo 액센트)
- 홈 카드에 상태별 왼쪽 보더(4px) 추가
- 테이블 행 호버 배경(`hover:bg-muted/50` 등 기존 shadcn 토큰 활용) 추가 — `generation`, `review` 두 테이블 모두

## 아키텍처/데이터 변경 없음

이번 작업은 **UI 레이어와 클라이언트 쿼리 방식만** 바꾼다 — Firestore 스키마, Cloud Functions, 인증 로직은 손대지 않는다. `getPipelineSessionDetail()`의 병렬화도 반환값 형태는 그대로 유지.

## 에러 처리

- 스켈레톤은 로딩 전용이라 별도 에러 처리 불필요 — 기존 `(dashboard)/error.tsx`가 계속 에러 바운더리 역할.
- 페이지네이션 "더 보기" 버튼 클릭 시 실패하면 버튼 자체에 인라인 에러 메시지(신규 `InlineError` 컴포넌트) 표시, 이미 로드된 목록은 유지.

## 테스트

- 시각적 회귀는 자동화 대신 수동 확인(스크린샷 비교) — 관리자 대시보드는 별도 스토리북/비주얼 테스트 인프라가 없으므로 새로 구축하지 않음.
- `getPipelineSessionDetail()` 병렬화는 두 Firestore 호출이 실제로 동시에 나가는지 유닛 테스트(mock Firestore 호출 순서/타이밍 검증)로 확인.
- `StatusBadge`/`lib/status.ts`는 pass/fail/warn 각 입력에 대해 올바른 variant를 반환하는지 유닛 테스트.

## 열린 리스크

- `fetchPendingReviews()`의 무제한 응답 문제는 이번 스펙에서 해결 안 됨 — story-generator 쪽 검토 대기열이 실제로 커지면 별도로 다뤄야 함.
- 인디고 액센트로 바꾸면 `globals.css`의 라이트/다크 두 테마 블록을 모두 갱신해야 함 — 다크모드 쪽 대비(contrast) 확인 필요(구현 단계에서 확인).
