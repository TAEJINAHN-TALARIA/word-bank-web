# 편집 화면 이전 버전 나란히 보기 + 자동 임시 저장 설계

날짜: 2026-11-21 · 대상: `/admin/edit/[sessionId]`(마스터 검토), `/admin/edit/published/[docId]`(게시본 수정) — 둘 다 `MasterEditor`를 쓴다.

## 1. 의도와 이유

편집자가 문단을 **고쳐 쓰는 동안** 이전 버전과 내가 쓰는 글을 나란히 놓고, 어느 부분을 바꾸고 있는지 보고 싶다. 지금 `원본과 비교`는 입력창 아래에 원본을 취소선 한 줄로 보여줄 뿐이라 어디가 어떻게 바뀌었는지 눈으로 짚기 어렵다.

또 하나, 편집 내용을 **임시로 남겨 둘** 방법이 필요하다. 지금은
- 마스터 검토: 수동 `임시 저장` 버튼만 있다(누르지 않고 창을 닫으면 사라진다).
- 게시본 수정: `저장`이 곧바로 게시된 글을 덮어쓴다. 임시 상태가 없어서, 쓰다 만 글을 남기려면 공개해야 한다.

## 2. 목표 / 비목표 / 안티골

**목표**
- 문단 편집 화면에서 **왼쪽 이전 버전(읽기 전용) / 오른쪽 내가 고쳐쓰는 입력창**을 나란히 보여준다. 지운 곳은 왼쪽에 빨강, 새로 쓴 곳은 오른쪽에 초록으로 표시한다. 오른쪽에서는 입력창에 그대로 이어서 쓸 수 있다.
- 입력을 멈추고 몇 초 뒤 **자동으로 서버에 임시 저장**한다. 저장 상태를 칩으로 보여준다.
- 게시본 수정은 **"초안으로 저장 → 게시본에 반영" 두 단계**로 바꾼다. 쓰다 만 글이 저절로 공개되지 않는다.

**비목표** (이번에 하지 않음)
- 문장별 표 대조(목업의 C), 위아래 + 바뀐 곳 미리보기(목업의 B).
- 이 브라우저 로컬 백업/복구(저장 B). 서버 저장이 안 될 때의 대비책이 없다는 뜻이다.
- 문단별 버전 기록(`ParagraphWorkspace`의 `versions`)과 합치기, 버전 기록의 서버 저장.
- 여러 탭·여러 사람이 동시에 편집할 때의 충돌 해결(마지막 저장이 이긴다 — 지금의 수동 저장과 같다).
- 게시본 초안 목록 화면. 초안은 그 소설의 편집 화면을 열 때만 보인다.
- 좁은 화면(`xl` 미만)에서의 좌우 배치. 그 폭에서는 위아래로 쌓는다.

**안티골** (기술적으로 돼도 실패인 경우)
- 게시본 초안이 편집자가 모르는 사이에 공개되는 것.
- 자동 저장이 글을 쓰는 중에 입력창 내용·커서를 바꾸거나 되감는 것(저장 때문에 타이핑이 끊기는 것).
- 입력창과 색칠 층이 어긋나서 글자와 색이 다른 곳에 보이는 것.
- 자동 저장이 조용히 실패하는데 화면은 "저장됨"으로 보이는 것.

## 3. 제약과 기존 구조 (코드로 확인한 것)

- **마스터 검토의 `임시 저장`은 이미 서버 저장이다.** `saveMasterReview` → story-generator가 `pipelineSessions/{id}/layerOutputs/layer4`의 편집본을 덮어쓴다. 원본은 `layer4Original`에 그대로 남는다(`EditorDetail.original`). 그래서 자동 저장은 이 저장을 자동으로 부르는 것이고 **새 저장 공간이 필요 없다.**
- 마스터 저장은 **검증에 걸리면 거절한다**: 바뀐 챕터의 제목이나 본문이 비어 있으면 안 된다(`validateMasterReviewSave`). 글을 쓰다 보면 잠깐 비는 순간이 있으므로 자동 저장은 이 경우를 오류가 아니라 "건너뜀"으로 다룬다.
- **게시본**: `editPublishedStory`는 규칙 검사 후 `storyContent`를 바로 덮어쓰고 `contentVersion`을 올리며 `storyContentRevisions`에 기록한다. 초안 저장소가 없다. 게시본 편집 화면의 `original`은 열 당시의 게시본(= `chapters`)이다.
- word-bank-web은 Firestore에 직접 쓰는 선례가 있다(`masterReviewActions.ts`의 `masterReview.preReview`). 서버 액션은 `getAdminSession()`으로 로그인을 확인한다.
- `save()`는 저장 뒤 `setChapters(normalized)`로 화면 글을 정규화한다(문단 안 빈 줄 → 문단 나눔, 빈 문단 제거). **자동 저장이 이걸 하면 타이핑 중에 입력창 내용이 바뀐다** — 자동 저장은 화면 글을 건드리지 않는다.
- 컴포넌트 렌더링 테스트 인프라가 없다 — 순수 로직과 서버 액션만 Vitest로 테스트한다. 화면은 브라우저로 직접 확인한다(관리자 Google 로그인 필요).
- Tailwind v4. 가운데 열은 `lg`에서 `minmax(0,1fr)`(15rem 챕터 목록·21rem Claude 패널 사이)이라 `xl` 미만에서는 두 칸으로 나누기에 좁다.

## 4. 접근 방식과 선택

**① 입력창에 색을 입히는 방법**
- **(가) 입력창 뒤에 색 층을 까는 방식 — 선택.** 입력창 글자는 그대로 두고, 같은 글꼴·여백·줄바꿈 규칙으로 그린 층을 입력창 뒤에 겹친다. 층에는 글은 투명하게, 새로 쓴 곳만 초록 배경으로 그린다. 입력창 높이는 글 길이에 맞춰 늘려서(`scrollHeight`) 안쪽 스크롤이 없게 하므로 스크롤 동기화가 필요 없다. 목업 A와 같은 모습이 나오는 대신 글꼴·여백이 한 글자라도 다르면 어긋나므로 스타일을 한 곳에서 공유한다.
- (나) 입력창은 그대로 두고 색은 아래 미리보기에만 입힘. 만들기 쉽지만 "나란히" 느낌이 약하다. (가)가 브라우저 확인에서 어긋나면 (나)로 후퇴한다.
- 바뀐 곳 비교는 새 라이브러리 없이 **어절(공백) 단위 최장 공통 부분 수열(LCS)** 로 직접 짠다. 입력 크기는 문단 하나라 충분히 빠르고, 순수 함수라 테스트로 고정한다.

**② 게시본 초안 저장소**
- **(가) 웹이 `publishedDrafts/{docId}`에 직접 저장 — 선택.** 초안은 웹 전용 데이터. `게시본에 반영`은 기존 `editPublishedStory`를 그대로 불러서 규칙 검사·수정 기록이 지금과 같다. story-generator는 건드리지 않는다.
- (나) story-generator에 초안 함수 추가. 두 저장소를 배포해야 하는데 얻는 게 없다.

**③ 자동 저장을 어디서 돌리는가**
- 시간·재시도·동시 실행 규칙을 `createAutosaver`(프레임워크 없는 순수 모듈)로 빼서 가짜 타이머로 테스트한다. 컴포넌트는 변화를 알리고 상태를 보여주기만 한다.

## 5. 설계

### 5.1 비교 로직 — `lib/textDiff.ts`
- `diffWords(before: string, after: string): DiffSegment[]` — `DiffSegment = { type: "same" | "del" | "ins"; text: string }`. 공백을 포함한 토큰(`/(\s+)/`로 나눔)을 LCS로 맞추고, 같은 종류가 이어지면 하나로 합친다.
- `before`만 보면 `same`+`del`을 이으면 `before`가 되고, `after`는 `same`+`ins`를 이으면 `after`가 된다(왕복 성질을 테스트로 고정).
- 토큰 수 곱이 25만을 넘으면(비정상적으로 긴 문단) 비교를 생략하고 통째로 `del` 1개 + `ins` 1개를 돌려준다.
- 빈 문자열, 같은 문자열, 완전히 다른 문자열, 한쪽만 빈 경우를 처리한다.

### 5.2 나란히 보기 화면
- `원본과 비교` 버튼을 `나란히 보기`로 바꾸고 **기본값은 켜짐**. 문단 편집 화면의 `내가 쓰기` 구역에서만 보인다.
- `xl` 이상: 두 칸(`grid-cols-2`) — 왼쪽 **이전 버전**(읽기 전용, `del` 빨강 표시), 오른쪽 **내가 쓰는 중**(입력창 + 뒤쪽 `ins` 초록 색 층). `xl` 미만: 위(이전 버전)/아래(입력창)로 쌓는다.
- 입력창 아래 글자 수는 그대로 둔다. 비교 칸 아래에 `수정 n곳` 같은 요약은 넣지 않는다(이미 아래쪽 바에 `수정 N곳`이 있다).
- 바뀐 곳이 없으면 왼쪽에 "아직 바꾼 곳이 없어요"를 보여준다. 문단 수가 원본과 달라 짝이 맞지 않으면(지금 `originalText`가 `undefined`가 되는 경우) 왼쪽 칸에 "문단을 추가·삭제·이동해서 원본과 짝을 맞출 수 없어요"를 보여주고 입력창은 평소대로 쓴다.
- **이전 버전 선택창은 마스터 검토에서, 열 때부터 이미 원본과 다른 저장본이 있을 때만** 보인다: `원본`(기본, `layer4Original`) / `열었을 때`(화면을 연 시점의 저장본). 게시본에서는 둘이 같아서 선택창이 없다.
- `ParagraphWorkspace`의 props `originalText`/`showOriginal`을 `compareText`(이전 버전 문단 | undefined)·`compareLabel`·`showCompare`로 바꾸고, 기존 취소선 한 줄 UI는 없앤다. 문단별 버전 기록 구역은 그대로 둔다.
- 구현은 입력창+색 층을 하나의 컴포넌트(`HighlightedTextarea`)로 묶는다. 글꼴·여백·줄 간격·`white-space: pre-wrap`·`overflow-wrap`을 한 상수로 공유한다. 한글 조합 입력 중에도 `value` 기준으로 층을 다시 그린다.

### 5.3 자동 저장 모듈 — `lib/autosaver.ts`
```ts
createAutosaver({ delayMs, save, onStatus }): { notify(): void; flush(): Promise<void>; cancel(): void }
type AutosaveStatus =
  | { kind: "idle" } | { kind: "pending" } | { kind: "saving" }
  | { kind: "saved"; at: number } | { kind: "skipped"; reason: string } | { kind: "failed"; message: string };
// save(): Promise<{ ok: true } | { skipped: string } | { error: string }>
```
- `notify()`는 변경이 있을 때마다 부른다. `delayMs`(3000) 동안 변경이 없으면 `save()`를 한 번 부른다(디바운스). 다시 `notify()`가 오면 타이머를 다시 센다.
- 저장 중에 `notify()`가 오면, 끝난 뒤 변경분이 있으면 한 번 더 저장한다(동시에 두 저장이 돌지 않는다).
- `flush()`: 대기 중이거나 저장 중인 것을 즉시 끝까지 처리한다(문단 이동·화면 이탈·승인 직전에 사용).
- `save()`가 `skipped`/`error`를 돌려주면 상태를 `skipped`/`failed`로 바꾸고 다음 변경 때 다시 시도한다(자동 재시도 루프 없음). `failed`일 때 칩의 `다시 시도`는 `flush()`.
- 저장 실패가 입력을 막지 않는다. `cancel()`은 타이머를 끄고 진행 중인 저장 결과를 버리지 않는다(이미 서버에 갔다).

### 5.4 마스터 검토: 자동 저장
- 변경 감지: `buildSaveEdits(chapters, baseline).length > 0 || 확인 챕터 변경`(지금의 `dirty`)이 참이 되는 변경마다 `notify()`.
- 저장 함수는 기존 `save()`와 같은 서버 액션(`saveMasterReviewAction`)을 쓰되:
  - 전송 전에 `findUnsavableReason(edits)`로 빈 제목/빈 본문을 검사해 있으면 `{ skipped: "3장 본문이 비어 있어요" }`로 건너뛴다.
  - 성공하면 `baseline`을 **보낸 시점의 정규화본**으로, `savedConfirmed`를 보낸 확인 목록으로 올린다. **`chapters`는 건드리지 않는다**(`baseline`과의 비교가 정규화에 둔감해서 `dirty`는 맞게 풀린다).
- 수동 `임시 저장` 버튼과 `승인`은 지금처럼 `chapters`를 정규화해 저장한다. 둘 다 진행 중인 자동 저장을 `flush()`로 먼저 기다린 뒤 실행해서 서로 겹치지 않는다. `locked`(저장·승인 중) 동안은 자동 저장을 걸지 않는다.
- 서버 쪽(story-generator)은 바꾸지 않는다.

### 5.5 게시본 수정: 초안 저장 → 반영
**저장소**: `publishedDrafts/{docId}` = `{ edits: { num: number; paragraphs: string[] }[]; baseContentVersion: number; updatedAt: Timestamp }`. `edits`는 `buildPublishedEdits(정규화한 chapters, 게시본)`와 같은 모양(게시본과 달라진 챕터만)이다.

**서버 액션** (`lib/actions/publishedDraftActions.ts`, `"use server"`, 모두 `getAdminSession()` 확인):
- `savePublishedDraftAction({ docId, edits, baseContentVersion })`: 모양·크기를 검사한다(`num` 정수, `paragraphs`는 문자열 배열, 전체 글자 수 ≤ 250,000 — Firestore 문서 1MiB 한도 안에서 한글 3바이트 기준). `stories/{docId}`·`storyContent/{docId}`가 있고 `lang === "ko"`인 문서에만 저장한다. `edits`가 비면 초안 문서를 지운다.
- `discardPublishedDraftAction(docId)`: 초안 문서를 지운다.
- `editPublishedStoryAction`(기존)은 성공하면 초안 문서를 **함께 지운다**(지우기 실패는 반영 성공을 되돌리지 않고 무시 — 남은 초안은 다음에 열 때 `stale`로 처리된다).

**읽기**: `getPublishedStoryForEdit`가 `detail.contentVersion`(현재 게시 `contentVersion ?? 0`)과 `detail.draft`(`{ edits, baseContentVersion, updatedAt }` | null)를 함께 돌려준다. `EditorDetail`에 이 두 선택 필드를 추가한다(마스터 검토에서는 없음).

**화면**:
- 열 때 초안이 있고 `baseContentVersion === contentVersion`이면 초안을 `chapters`에 적용해서(`applyPublishedEdits(chapters, edits)`) 열고, 칩에 "초안 14:32를 불러왔어요 · 아직 게시본에는 반영되지 않았어요"와 `초안 버리기`를 보여준다. 초안을 적용한 글이 `baseline`(마지막 저장 기준)이고, 게시본은 `liveBaseline`(새 상태)이다.
- 초안이 있는데 `baseContentVersion !== contentVersion`(초안을 만든 뒤 게시본이 바뀜)이면 적용하지 않고 경고를 띄운다: "초안을 만든 뒤 게시본이 바뀌었어요. 불러오면 초안에 든 장의 문단이 초안 내용으로 바뀝니다." `불러오기` / `초안 버리기`.
- 머리줄 버튼: `임시 저장`(수동 초안 저장 — 마스터 검토와 같은 버튼). 아래쪽 큰 버튼: `게시본에 저장` → **`게시본에 반영`**. 안내문: "저장하면 게시된 본문이 바로 바뀌고…" → "`게시본에 반영`을 누르기 전까지는 초안으로만 남고, 게시된 글은 바뀌지 않아요. 반영하면 바로 공개되고 수정 전 내용은 기록으로 남아요."
- `반영`은 **초안 자동 저장 상태와 상관없이** 지금 화면의 글을 `liveBaseline`과 비교해 `editPublishedStoryAction`을 부른다(= 지금의 게시본 저장과 같은 동작). 성공하면 `liveBaseline`·`baseline`·`detail.contentVersion` 상태를 새 값으로 올리고 초안 칩을 지운다.
- 자동 저장은 `chapters`가 `baseline`과 달라질 때마다 `notify()`. 저장 함수는 `savePublishedDraftAction`을 `edits = buildPublishedEdits(정규화본, liveBaseline)`로 부른다. `edits`가 비면(모두 되돌림) 서버가 초안을 지운다. `chapters`는 건드리지 않는다.
- `dirty`를 둘로 나눈다: `unsaved`(`baseline`과 다름, `beforeunload` 경고와 칩 기준)와 `canApply`(`liveBaseline`과 다름, `게시본에 반영` 활성 기준).

### 5.6 저장 상태 칩 (머리줄, 두 화면 공통)
`저장하지 않은 수정 있음`(pending) · `저장 중…` · `✓ 임시 저장됨 · 14:32` · `자동 저장 건너뜀 · {이유}` · `자동 저장 실패 · 다시 시도`(failed). `aria-live="polite"` 영역에 두되, 같은 상태가 반복될 때마다 읽지 않도록 상태가 바뀔 때만 글을 바꾼다. 실패는 입력창 위 오류 배너(`InlineError`)가 아니라 칩에만 보인다(수동 `임시 저장` 실패는 지금처럼 배너).

### 5.7 순수 함수 추가 (`lib/masterReview.ts`)
- `findUnsavableReason(edits: { chapterNumber: number; chapterTitle: string; body: string }[]): string | null` — 첫 번째 문제(빈 제목/빈 본문)를 `"3장 제목이 비어 있어요"` 꼴로.
- `applyPublishedEdits(chapters: MasterChapter[], edits: { num: number; paragraphs: string[] }[]): MasterChapter[]` — 해당 번호 챕터의 문단만 교체하고, 없는 번호는 무시한다.

## 6. 테스트
- `lib/textDiff.test.ts`: 위 5.1의 경우들과 왕복 성질, 한글·여러 공백·줄바꿈 토큰.
- `lib/autosaver.test.ts`(가짜 타이머): 디바운스, 재`notify`로 타이머 재설정, 저장 중 변경 시 직렬 재저장(동시 실행 없음), `flush`, `skipped`/`error` 상태와 다음 변경 때 재시도, `cancel`.
- `lib/masterReview.test.ts`에 `findUnsavableReason`, `applyPublishedEdits` 추가.
- `lib/actions/publishedDraftActions.test.ts`: 로그인 없음 → 거절, 잘못된 모양/크기 → 거절, 게시본이 없거나 `ko`가 아님 → 거절, 정상 저장, 빈 `edits` → 삭제, 초안 버리기. 기존 `masterReviewActions.test.ts`의 `editPublishedStoryAction` 성공 시 초안 삭제 호출 추가.
- `lib/data/masterReviews`의 게시본 읽기 테스트에 `contentVersion`·`draft` 케이스 추가.
- 화면(색 층 정렬, 한글 조합 입력, 칩 문구, 초안 불러오기/버리기 배너)은 브라우저에서 직접 확인한다.

## 7. 빌더에게 남기는 것
- `HighlightedTextarea`의 정확한 스타일 공유 방법과 높이 자동 조절 구현.
- 칩·배너의 정확한 문구·배치(위 문구는 기준안이다).
- 자동 저장 지연(3초)은 `AUTOSAVE_DELAY_MS` 상수로 두고, 몇 초가 적당한지는 써 보고 조정한다.
- `publishedDrafts`를 Firestore 보안 규칙에서 클라이언트 접근 불가로 두는 것(Admin SDK만 접근). 저장소의 규칙 파일을 확인해서 기본이 거부가 아니면 명시한다.

## 8. 내가 정한 것 (확인해 주세요)
- **이전 버전 선택창을 `원본`/`마지막 저장본`이 아니라 `원본`/`열었을 때`로 바꿨다.** 자동 저장이 3초마다 "마지막 저장본"을 갱신하므로 그건 거의 항상 지금 글과 같아져서 비교 대상이 되지 못한다. 선택창은 마스터 검토에서만, 열 때 이미 저장본이 원본과 다를 때만 보인다.
- 게시본 초안은 열 때 **자동으로 불러온다**(별도 복구 배너 없이). 쓰던 글을 이어 쓰는 것이 의도라서. 게시본이 그사이 바뀐 초안만 확인을 묻는다.
- 자동 저장 실패/건너뜀은 칩에만 보이고 입력을 막지 않는다.
- 자동 저장은 `chapters`를 정규화하지 않는다(커서 보호). 정규화는 수동 저장·승인·반영에서만 한다.
- 자동 저장 지연 3초, 초안 크기 상한 250,000자.
