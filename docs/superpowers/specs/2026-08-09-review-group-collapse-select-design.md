# 검토/게시 화면 세션 그룹 collapsible + 전체선택 Design

## 배경

`/admin/review`의 대기중/게시됨 탭은 마스터 원고(세션) 단위로 언어별 항목을 그룹핑해서 보여준다(`docs/superpowers/plans/2026-08-09-review-page-upgrades.md`에서 구현). 그런데 한 세션이 10개 언어를 가지면 그룹 헤더 아래 10개 행이 항상 펼쳐진 채로 렌더링돼, 세션이 여러 개면 스크롤이 매우 길어진다. 또한 대기중 탭에서 여러 항목을 선택해 일괄 게시하려면 체크박스를 하나씩 눌러야 해서, 세션 전체 또는 페이지 전체를 한 번에 선택할 방법이 없다.

## 목표

1. 마스터 원고(세션) 그룹을 접고 펼 수 있게 한다. 기본 상태는 접힘.
2. 대기중 탭에 페이지 전체선택 체크박스(테이블 헤더)와 세션 그룹별 전체선택 체크박스(그룹 헤더)를 추가한다.
3. 접힌 그룹도 경고가 있으면 헤더에서 바로 보이게 한다.

## 범위

- 대상: `components/admin/PendingReviewsTable.tsx`, `components/admin/PublishedStoriesTable.tsx`.
- collapsible은 두 탭 모두 적용. 전체선택 체크박스는 대기중 탭에만 적용(게시됨 탭은 일괄 액션이 없음).
- 그룹 크기가 1인 항목(헤더 없는 평범한 행)은 대상 아님 — 기존 동작 그대로 유지.
- 새 Firestore 스키마 변경, 새 Server Action 없음 — 순수 클라이언트 UI 상태 변경.

## 아키텍처

접힘/펼침 상태는 각 테이블 컴포넌트의 로컬 state로 관리한다.

```ts
const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
const isExpanded = (key: string) => expandedKeys.has(key);
function toggleGroupExpanded(key: string) {
  setExpandedKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}
```

"펼쳐진 키의 집합"을 추적하는 방식이라 초기값이 빈 Set이면 모든 그룹이 자동으로 기본 접힘 상태가 된다 — 새로 나타나는 세션(예: 새로고침 후 새 데이터)도 항상 접힌 채로 시작한다. 그룹 키는 `lib/reviewGrouping.ts`의 `groupBySession`이 반환하는 `key`(= `sessionId || fallbackId(item)`)를 그대로 재사용하므로, 항목이 부분적으로 게시/철회되어 그룹 내용이 줄어들어도(기존 `removedKeys` 오버레이 패턴과 무관하게) 같은 세션이면 접힘 상태가 유지된다.

## 컴포넌트

### 새 컴포넌트: `components/admin/GroupCollapseToggle.tsx`

셰브런 아이콘(`lucide-react`의 `ChevronRight`/`ChevronDown`)과 라벨을 감싸는 클릭 가능한 버튼. `EmptyTableRow`/`InlineError`/`LabeledList`와 같은 선례를 따라 두 테이블에서 공유한다.

```tsx
export function GroupCollapseToggle({
  expanded,
  onToggle,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 text-left hover:underline"
    >
      {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
      {children}
    </button>
  );
}
```

### `PendingReviewsTable.tsx`

- `expandedKeys` state + `toggleGroupExpanded` 추가.
- 그룹 헤더 행 구조 변경: 현재 `<TableCell colSpan={4}>{라벨 텍스트}</TableCell>` + `<TableCell>{이 세션 전체 게시 버튼}</TableCell>`(2칸)을, 체크박스 칸을 분리해 3칸으로 바꾼다 — `<TableCell>{그룹 체크박스}</TableCell>` + `<TableCell colSpan={3}><GroupCollapseToggle>{라벨 텍스트 + 경고 배지}</GroupCollapseToggle></TableCell>` + `<TableCell>{게시 버튼}</TableCell>`(5칸 헤더와 정합).
- 그룹 항목 행(`groupItems.map(...)`)은 `isExpanded(key)`가 true일 때만 렌더링.
- 그룹 체크박스: 3-state(전체 선택/일부 선택/미선택). `checked`는 그룹 내 모든 항목이 `selected`에 있을 때, `indeterminate`는 일부만 있을 때(ref로 DOM에 직접 세팅 — React가 JSX prop으로 지원하지 않음). `onChange`는 전체 선택이면 그룹 항목 전부 해제, 아니면 전부 선택.
- 경고 배지: `groupItems.some((i) => i.ruleBaseWarnings.length > 0)`이면 그룹 헤더 라벨 옆에 작은 경고 표시(예: 기존 `text-amber-700 dark:text-amber-500` 톤 재사용) — 접힌 상태에서도 경고가 있다는 걸 놓치지 않도록 항상 표시.
- 테이블 헤더 첫 칸(`<TableHead className="w-8" />`, 현재 비어 있음)에 페이지 전체선택 체크박스 추가. 3-state 로직은 그룹 체크박스와 동일하되 대상이 `items`(현재 로드된 전체 대기중 항목, 접힌 그룹 포함) 전체.

### `PublishedStoriesTable.tsx`

- `expandedKeys` state + `toggleGroupExpanded` 추가(체크박스 없이 collapse만).
- 그룹 헤더 행의 기존 `<TableCell colSpan={4}>{라벨 텍스트}</TableCell>`를 `<TableCell colSpan={4}><GroupCollapseToggle>{라벨 텍스트}</GroupCollapseToggle></TableCell>`로 교체.
- 그룹 항목 행은 `isExpanded(key)`일 때만 렌더링.

## 데이터 흐름 / 상태 영향 없음

접힘/선택 상태는 순수 UI 레이어라 `onCountChange`(탭 라벨 숫자), `revalidatePath` 이후의 `removedKeys`/`extraPages` 리셋 로직, 게시/재검증 Server Action 호출 경로에는 전혀 영향을 주지 않는다. 페이지 전체선택은 `selected` state(기존에 이미 있음)를 그대로 채우는 것뿐이라 `handleBulkPublish`/`BulkPublishBar` 쪽 변경은 필요 없다.

## 에러 처리

새로운 실패 케이스 없음 — 이번 변경은 서버 호출이 없는 순수 클라이언트 상태 토글이다.

## 테스트

이 프로젝트엔 컴포넌트 렌더링 테스트 인프라(jsdom/React Testing Library)가 없다(기존 admin 테이블 컴포넌트들도 전부 동일 — `docs/superpowers/plans/2026-08-09-review-page-upgrades.md`의 Global Constraints 참고). 이번 변경도 같은 이유로 자동 테스트를 추가하지 않는다. 검증은 `npm run lint && npm run build`(타입/빌드 확인)와, 실제 관리자 세션으로 curl/브라우저를 통한 수동 확인으로 한다.

## 범위 밖

- 접힘 상태를 localStorage 등에 영속화하는 것은 이번 범위 밖 — 새로고침 시 항상 기본 접힘으로 리셋된다.
- 게시됨 탭에 체크박스/일괄 액션을 추가하는 것은 이번 범위 밖(이 탭엔 게시/재검증 외 일괄 액션이 없다).
