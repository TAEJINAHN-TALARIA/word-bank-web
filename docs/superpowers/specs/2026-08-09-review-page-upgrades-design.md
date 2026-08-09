# 검토/게시 화면 개선 — 전문보기·다운로드, 마스터/번역 묶어보기, 일괄 게시 — 설계

**작성일**: 2026-08-09
**저장소**: word-bank-web (`app/admin/(dashboard)/review/**`)
**참고(읽기 전용)**: story-generator(`C:\Users\TAEJIN\Documents\story-generator`) — `src/publishService.js`를 읽어 데이터 모델을 확인했을 뿐, 이번 스펙에서 story-generator 쪽 코드는 변경하지 않는다.
**전제**: `2026-08-09-admin-dashboard-polish-design.md`(로딩/병렬화/페이지네이션/공유 컴포넌트/인디고 테마) 구현 완료 이후 상태를 전제로 한다 — `ReviewTabs.tsx`가 이미 `EmptyTableRow`/`InlineError`/`lib/status.ts`/`LabeledList`를 쓰고, 게시됨 탭에 커서 페이지네이션이 붙어있는 상태에서 작업한다.

## 배경

관리자가 `/admin/review`에서 다음 세 가지를 못 해서 불편함을 겪고 있다:

1. 게시된 소설의 실제 본문(전문)을 확인하거나 다운로드할 방법이 없다 — 제목/언어/레벨/챕터 수 같은 메타데이터만 보인다.
2. 한 파이프라인 세션(레벨+콤보)이 마스터 원고(한국어) + 여러 언어 번역으로 구성되는데, 지금은 이 관계가 화면에 전혀 드러나지 않고 언어별로 뿔뿔이 흩어진 행으로만 보인다.
3. 검토 대기 중인 여러 항목을 한 번에 게시할 방법이 없어 하나씩 눌러야 한다.

story-generator의 `src/publishService.js`를 확인한 결과:

- 게시 시 `stories/{sessionId}_{lang}`(메타: `lang`, `level`, `title`, `chapterCount`, `sessionId`, `target`, `createdAt`)와 `storyContent/{sessionId}_{lang}`(본문: `{ chapters: [{ num, title, paragraphs: string[] }] }`)를 같은 Firestore 프로젝트에 함께 쓴다. word-bank-web은 이미 이 프로젝트의 Admin SDK 클라이언트를 쓰고 있어 **새 Cloud Function 없이 `storyContent`를 직접 읽을 수 있다.**
- `target`은 `'master'`(→ `lang: 'ko'`) 또는 언어 코드다. `listPendingReviews()`가 세션마다 `['master', ...targetLanguages]`를 순회하며 검토 대기 항목을 만들기 때문에, **같은 `sessionId`를 공유하는 항목들이 곧 "한 마스터 원고 + 그 번역들"**이다.
- 검토 **대기 중**(미게시) 항목의 본문은 `storyContent`에 없다 — 파이프라인 내부 레이어 산출물(`getLayerOutput`/`getLayer5Translation`)에서 그때그때 계산되며, 이건 story-generator 내부 구현이라 word-bank-web에서 직접 못 읽는다.
- `sessionId`는 최근 도입된 "마스터→번역" 파이프라인 이전 데이터에는 세션 간 공유 관계가 없거나 필드 자체가 비어있을 수 있다(과거엔 레벨/언어별로 완전히 독립된 세션이 생성되던 시기가 있었음) — 그룹핑 로직이 이런 옛날 데이터에서도 안전해야 한다.

## 방향

- **아키텍처**: `ReviewTabs.tsx`는 탭 전환 + 데이터 페칭/페이지네이션만 담당하는 얇은 셸로 유지하고, 그룹핑 렌더링·선택 상태·일괄 게시는 새로 분리하는 `PendingReviewsTable.tsx`/`PublishedStoriesTable.tsx`로 옮긴다. 두 테이블이 그룹핑 유틸(`lib/reviewGrouping.ts`)과 일괄 게시 액션바(`BulkPublishBar.tsx`)를 공유한다.
- **범위**: 전문보기/다운로드는 **게시됨 탭 항목만** 지원한다. 대기중 탭의 전문보기는 story-generator에 새 admin 엔드포인트가 필요해 이번 범위에서 제외하고 "향후 과제"로 남긴다(아래 참고).
- **그룹핑은 두 탭 모두 적용**하되, 그룹 크기가 1이면 지금과 똑같이 헤더 없는 평범한 행으로 보여 옛날 단일 언어 데이터가 어색해 보이지 않게 한다.
- **일괄 게시는 대기중 탭에 그룹 단위 버튼 + 자유 체크박스 선택 두 가지를 모두 제공**한다.

## 아키텍처 변경 없음

Firestore 스키마(`stories`, `storyContent`)나 Cloud Functions, 인증 로직은 건드리지 않는다 — word-bank-web 쪽에 읽기 전용 데이터 조회(`storyContent`)와 UI만 추가한다. `publishStory`/`recallStory` 개별 서버 액션은 그대로 두고, 여러 건을 묶어 호출하는 `publishStoriesAction`만 추가한다.

## 작업 항목

### 1. 전문보기 + 다운로드 (게시됨 탭 전용)

- `lib/data/storyContent.ts` 신규:
  ```ts
  export type StoryChapterContent = { num: number; title: string | null; paragraphs: string[] };
  export async function getStoryContent(docId: string): Promise<StoryChapterContent[] | null>
  ```
  `storyContent/{docId}` 문서를 읽어 `chapters` 배열을 반환, 문서가 없으면 `null`.
- `app/admin/(dashboard)/review/[docId]/page.tsx` 신규 — 전문보기 페이지. `(dashboard)` 레이아웃 하위라 기존 `getAdminSession()` 인증 게이트를 그대로 상속받는다(별도 인증 코드 불필요). `stories/{docId}`(메타)와 `storyContent/{docId}`(본문)를 `Promise.all`로 병렬 조회해 챕터별 제목+문단을 순서대로 렌더링한다. 어느 한쪽이라도 없으면 `notFound()`. 상단에 "다운로드" 버튼과 "목록으로"(`/admin/review`) 링크.
- `app/admin/(dashboard)/review/[docId]/download/route.ts` 신규 — `.txt` 다운로드 Route Handler. **레이아웃 밖이라 자체적으로 `getAdminSession()`을 호출해 인증을 확인**해야 한다(빠뜨리면 세션 없이도 다운로드되는 구멍이 생긴다). 인증되면 `stories`+`storyContent`를 조회해 다음 형식의 문자열로 합친다:
  ```
  {title} ({lang})

  {num}챕. {chapterTitle}

  {문단1}

  {문단2}

  {num}챕. {다음 챕터 제목}
  ...
  ```
  응답 헤더에 `Content-Type: text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="{docId}.txt"`.
  - 문서 없음 → `404` JSON, 세션 없음 → `401` JSON, 조회 실패 → `500` JSON(페이지 렌더가 아니므로 `error.tsx`가 못 잡는다 — 직접 처리).
- 게시됨 탭 테이블의 각 행에도 다운로드 아이콘을 추가 — 위 Route Handler URL로 바로 연결되는 `<a href=... download>`라 별도 JS 없이 브라우저가 처리.

### 2. 마스터/번역 묶어보기 (대기중 + 게시됨 탭)

- `lib/reviewGrouping.ts` 신규:
  ```ts
  export function groupBySession<T extends { sessionId?: string }>(
    items: T[],
    fallbackId: (item: T) => string,
  ): { key: string; items: T[] }[]

  export function getGroupLabel<T extends { target: string; lang: string; level: string; title: string | null }>(
    group: T[],
  ): { title: string; level: string; languageCount: number }
  ```
  - 그룹 키 = `item.sessionId || fallbackId(item)`. 게시됨 탭은 `fallbackId = (story) => story.id`(문서 자기 id), 대기중 탭은 `sessionId`가 항상 있어 사실상 fallback이 안 쓰인다. **`sessionId`가 비어있는 옛날 문서들끼리 빈 문자열 키로 잘못 한 그룹에 뭉치는 걸 막는 게 이 fallback의 목적이다.**
  - 원래 정렬 순서(최신순) 안에서 같은 키를 처음 만난 위치에 그룹 전체가 놓인다 — 그룹 단위로 정렬을 다시 흔들지 않는다.
  - `getGroupLabel`은 `target === "master"`(또는 `lang === "ko"`) 항목의 title을 우선 쓰고 없으면 그룹의 첫 항목 title을 쓴다. `level`과 `languageCount`(그룹 크기)도 함께 반환.
- 렌더링 규칙: 그룹 크기가 1이면 지금과 동일하게 헤더 없는 평범한 테이블 행 하나. 2개 이상이면 그룹 헤더 행(제목 · 레벨 · "N개 언어") 아래 언어별 행들을 들여쓰기해서 나열.

### 3. 일괄 게시 (대기중 탭)

- `lib/actions/adminStoryActions.ts`에 추가:
  ```ts
  export async function publishStoriesAction(
    items: { sessionId: string; target: string }[],
  ): Promise<{ sessionId: string; target: string; error?: string }[]>
  ```
  `getAdminSession()` 확인 후 `Promise.allSettled(items.map(i => callPublishStory(i.sessionId, i.target)))`로 병렬 게시, 건별 성공/실패를 배열로 반환(한 건의 실패가 나머지를 막지 않는다). 끝나면 `revalidatePath("/admin/review")`를 한 번만 호출.
- `PendingReviewsTable.tsx`가 `Set<string>`(키: `${sessionId}_${target}`)으로 체크된 항목을 관리. 각 행에 체크박스, 그룹 헤더에는 "이 세션 전체 게시" 버튼(체크 여부와 무관하게 그 그룹의 모든 target을 즉시 게시 대상으로 삼는다).
- `BulkPublishBar.tsx`(공용) — "N건 선택됨 · 선택 게시" 버튼. "선택 게시"와 "그룹 전체 게시" 둘 다 같은 `publishStoriesAction`을 호출하고, 인자로 넘기는 target 목록만 다르다.
- 응답 처리: 성공한 항목은 로컬 `pending` state에서 제거. 실패한 항목은 목록에 남기고 해당 행에 `InlineError`(게이트 배지 옆)로 실패 사유 표시. 상단에 "N건 중 M건 게시 완료, K건 실패" 요약 한 줄(성공 0건이면 요약 생략하고 에러만 표시).
- 기존 행별 개별 "게시" 버튼은 그대로 남긴다 — 1건만 게시할 땐 체크박스 없이 지금처럼 즉시 처리.

## 파일 구조

**신규:**
- `lib/data/storyContent.ts`, `lib/data/storyContent.test.ts`
- `lib/reviewGrouping.ts`, `lib/reviewGrouping.test.ts`
- `app/admin/(dashboard)/review/[docId]/page.tsx`
- `app/admin/(dashboard)/review/[docId]/download/route.ts`
- `components/admin/PendingReviewsTable.tsx`
- `components/admin/PublishedStoriesTable.tsx`
- `components/admin/BulkPublishBar.tsx`

**수정:**
- `components/admin/ReviewTabs.tsx` — 탭 셸로 축소, 두 테이블 컴포넌트를 렌더링하도록 변경.
- `lib/actions/adminStoryActions.ts` — `publishStoriesAction` 추가, `lib/actions/adminStoryActions.test.ts` 신규.

## 에러 처리

- 전문 페이지: `stories`/`storyContent` 중 하나라도 없으면 `notFound()`. Firestore 조회 자체 실패는 기존 `(dashboard)/error.tsx` 바운더리가 처리(다른 페이지와 동일).
- 다운로드 라우트: 세션 없음 `401`, 문서 없음 `404`, 조회 실패 `500` — 모두 JSON 에러 바디로 직접 응답(페이지 렌더가 아니라 `error.tsx`가 못 잡는다).
- 일괄 게시: `publishStoriesAction`의 건별 결과로 처리되며, 전체를 던지는 예외는 없다(개별 실패가 서로를 막지 않는다).
- 그룹핑 함수(`groupBySession`, `getGroupLabel`)는 순수 함수라 예외를 던지지 않는다. 빈 배열이 들어오면 빈 배열을 반환한다.

## 테스트

- `lib/reviewGrouping.test.ts`: `groupBySession`이 (a) 같은 `sessionId`끼리 묶는지, (b) `sessionId`가 없을 때 fallback id로 각각 독립 그룹이 되는지(서로 다른 옛날 항목들이 잘못 한 그룹으로 뭉치지 않는지), (c) 원래 순서를 유지하는지. `getGroupLabel`이 master 항목의 title/level을 우선 쓰는지, master가 없으면 첫 항목을 쓰는지.
- `lib/data/storyContent.test.ts`: 기존 `lib/data/*.test.ts` 관례대로 Firestore mock으로 문서 조회 + `chapters` 매핑 확인, 문서 없을 때 `null` 반환 확인.
- `lib/actions/adminStoryActions.test.ts`: `publishStoriesAction`이 여러 건 중 일부만 실패하는 케이스에서 반환 배열에 성공/실패가 올바르게 섞여 나오는지.
- 전문 페이지/다운로드 라우트, 그룹 렌더링, 일괄 게시 UI는 기존 방침대로 수동 확인(스토리북/비주얼 테스트 인프라 신규 구축 없음).

## 향후 과제 (이번 범위 밖)

- **대기중 탭 전문보기**: story-generator에 `resolveTitleAndChapters(sessionId, target)`를 노출하는 새 admin Cloud Function(예: `adminGetPendingContent`)이 추가되면, 이번에 만든 `lib/data/storyContent.ts`/전문 페이지 구조를 그대로 재사용해 대기중 탭에도 붙일 수 있다. story-generator 레포 쪽 별도 작업 필요.
- 일괄 게시는 "게시"만 다루고 "일괄 철회(recall)"는 이번 범위에 포함하지 않는다 — 필요해지면 같은 패턴(`recallStoriesAction`)으로 확장 가능.
