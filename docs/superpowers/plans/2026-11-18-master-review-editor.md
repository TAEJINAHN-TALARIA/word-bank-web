# Master Review Editor Implementation Plan (word-bank-web)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** `/admin/edit` 아래에 소설 편집 화면을 만든다 — 편집 대기 목록, 문단 편집, 전체 읽기, Claude 패널, 확인 완료·승인. 같은 화면으로 게시된 한국어 소설의 표현 개선도 한다.

**Spec:** `story-generator/docs/superpowers/specs/2026-11-18-master-review-gate-design.md` (상태 전이, 데이터 모델, API, Claude 패널 규칙). 백엔드는 `story-generator/docs/superpowers/plans/2026-11-18-master-review-gate.md`가 먼저 끝나 있어야 승인·저장 호출이 동작한다.

**UI 기준:** 목업 https://claude.ai/artifact/UHoiDmDUNjSN74rumRVMRf (문단 편집 / 전체 읽기 / Claude 패널 / 승인 바).

**Tech Stack:** Next.js 16 App Router, Tailwind v4, firebase-admin, Vitest, `@anthropic-ai/sdk`.

## Global Constraints

- **코드를 쓰기 전에** `node_modules/next/dist/docs/`에서 이 버전의 Server Actions, Route Segment Config(`maxDuration`), 페이지/레이아웃 규약을 읽는다(`AGENTS.md`: 이 Next.js는 기존 지식과 다르다).
- `/admin` 아래 페이지는 `(dashboard)` 레이아웃의 인증 게이트를 쓰고, **모든 Server Action은 `getAdminSession()`을 다시 확인**한다.
- 읽기는 `lib/data/`(`"server-only"` + `getAdminFirestore()`), 쓰기는 story-generator 함수 호출(`lib/admin-functions/storyGenerator.ts`)을 거친다. 단 `masterReview.preReview` 캐시만 서버 액션이 직접 쓴다.
- Claude 제안은 **본문을 바꾸지 않는다** — 관리자가 "적용"을 눌러야 클라이언트 상태에 반영되고, 저장은 별도 버튼.
- 컴포넌트 렌더 테스트 인프라가 없으므로 `lib/data`·`lib/actions`·`lib/claude`의 **순수 로직만 Vitest**로 테스트하고, 화면은 수동 확인한다.
- 마무리 검증: `npm run lint` + `npm run test` + `npm run build`.

---

### Task 1: 데이터 조회 `lib/data/masterReviews.ts`

**Files:** Create `lib/data/masterReviews.ts`, `lib/data/masterReviews.test.ts`

- [x] 테스트 먼저(순수 변환 함수): `layer4`의 `body` → 문단 배열(`\n\n` 분리) / 문단 배열 → `body`, 원본과 비교해 "수정된 문단" 판정, 레벨·확인 현황·`gateNote`를 합친 `MasterReviewDetail` 타입으로 매핑.
- [x] `listMasterReviews()`(`status == 'awaiting_master_review'` 세션: 제목, 레벨, 실행 경로, 확인 챕터 수, 수정 문단 수) / `getMasterReview(sessionId)`(`layer4`, `layer4Original`, `layer1`의 `characters`·`narrativeStyle`·`title`, `masterReview` 전체).
- [x] 게시본: `getPublishedStoryForEdit(docId)` — `stories`+`storyContent`(`lang === 'ko'`만), `sessionId` 있으면 `layer1` 설정집도 함께.

### Task 2: story-generator 호출 `lib/admin-functions/storyGenerator.ts`

**Files:** Modify `lib/admin-functions/storyGenerator.ts`

- [x] 기존 `publishStory` 패턴 그대로 `saveMasterReview`, `approveMasterReview`(응답의 `resume`, `warnings` 포함), `resumeOnDemand`(짧은 AbortController 타임아웃 — 타임아웃은 "시작됨"으로 취급), `editPublishedStory` 추가.
- [x] `PendingReviewItem`에 `masterReviewed: boolean` 추가.

### Task 3: Claude 호출 `lib/claude/*`

> **변경(2026-11-18, 작업 공간 반영):** 아래의 "문단 제안"(`suggestParagraph`, 현재/제안 한 장짜리 카드)은 **"방향 제시"(`suggestIdeas`)와 "다듬기"(`polishParagraph`)로 나뉘어 대체**됐다. 방향 제시는 완성 글이 아닌 스케치 3개(줄거리를 바꾸는 제안 허용, 마스터 검토에서만), 다듬기는 통째로 바꾼 글이 아니라 `{before, after, reason}` 목록이며 수정은 항목별 수락/거절이다. 화면은 `ParagraphWorkspace`(방향 → 쓰기 → 다듬기 + 버전 기록 + 문단 추가·삭제·이동), 오른쪽은 `ClaudePanel`(사전 검토 메모·전체 점검)과 `ReferenceCards`(문장 길이·인물 말투)다. 목업: https://claude.ai/artifact/UHoiDmDUNjSN74rumRVMRf

**Files:** Create `lib/claude/client.ts`, `lib/claude/suggest.ts`, `lib/claude/reviewStory.ts`, `lib/claude/preReview.ts`(+ 각 `.test.ts`); Modify `package.json`(`@anthropic-ai/sdk`), `.env.example`(`ANTHROPIC_API_KEY`)

- [x] 구현 전에 `claude-api` 스킬을 읽는다(모델 ID, `output_config.format` 구조화 출력, prompt caching, `fallbacks` 규칙이 바뀌는 영역).
- [x] 모델 `claude-sonnet-5-5`. `thinking`은 생략(또는 adaptive), 제안은 `effort: medium`, 전체 점검·사전 검토는 `high`. `temperature` 등 샘플링 파라미터는 보내지 않는다.
- [x] 소설 본문+설정집을 프롬프트 앞부분에 두고 `cache_control`로 캐시한다(같은 소설을 여러 요청이 재사용). 서버 측 `fallbacks`(`server-side-fallback-2026-07-01`, `"default"`)를 켜고, 켰다는 사실을 최종 보고에 적는다.
- [x] 세 함수의 프롬프트 공통 지시: 줄거리·사실 관계·인물·시점·서술 문체 불변, 인물별 말투 유지, `levelGuidance`의 문장 길이 기준 준수. 출력은 JSON 스키마(제안: `{reason, after}` / 전체 점검: `{title, items[]}` / 사전 검토: `items[{chapterNumber, paragraphIndex, kind, text}]`).
- [x] 순수 로직 테스트(SDK mock): 응답 파싱·검증(없는 문단 위치 거절, `after`가 비었으면 거절), 프롬프트 조립에 설정집·레벨 지시가 들어가는지, `stop_reason: "refusal"` 처리.

### Task 4: Server Actions `lib/actions/masterReviewActions.ts`

**Files:** Create `lib/actions/masterReviewActions.ts`(+ `.test.ts`)

- [x] 각 액션 첫 줄에 `getAdminSession()` 확인(실패는 `{ error }` 반환 — 프로덕션에서 throw 메시지가 가려지기 때문, `adminStoryActions.ts`와 같은 규칙).
- [x] `saveMasterReviewAction`, `approveMasterReviewAction`(온디맨드면 이어서 `resumeOnDemand`), `suggestParagraphAction`, `reviewStoryAction`, `ensurePreReviewAction`(캐시 없을 때만 생성·저장), `editPublishedStoryAction`. 성공 시 `revalidatePath('/admin/edit')`.
- [x] 전체 점검·사전 검토를 부르는 페이지/액션에 `maxDuration`을 설정한다(Task 0에서 읽은 규약대로; 플랜 한도는 스펙 Open Question 3).

### Task 5: 편집 대기 목록 `/admin/edit`

**Files:** Create `app/admin/(dashboard)/edit/page.tsx`, `loading.tsx`, `components/admin/MasterReviewList.tsx`; Modify 관리자 네비게이션

- [x] 탭 2개 — "편집 대기"(`listMasterReviews`), "게시된 소설"(한국어 게시본 목록, 기존 `listPublishedStories` 재사용 + `lang === 'ko'` 필터). 기존 `ReviewTabs` 패턴과 공유 UI(`EmptyTableRow`, `InlineError`)를 따른다.
- [x] 항목에 제목·레벨·실행 경로·"확인 n/10"·`gateNote` 배지(게이트 실패로 돌아온 경우). ("수정 n곳"은 목록에서 빼고 편집 화면에만 표시 — 목록마다 `layer4Original`을 추가로 읽지 않으려는 선택)

### Task 6: 편집 화면 `/admin/edit/[sessionId]` (목업 구현)

**Files:** Create `app/admin/(dashboard)/edit/[sessionId]/page.tsx`, `components/admin/MasterEditor.tsx`, `ClaudePanel.tsx`, `FullReadView.tsx`

- [x] 상태는 `MasterEditor`(클라이언트)가 들고, 서버가 내려준 `initial*` prop 위에 로컬 편집 상태를 얹는 기존 패턴을 쓴다(`revalidatePath` 뒤 prop 참조가 바뀌면 렌더 중 상태 조정으로 초기화).
- [x] 문단 편집 / 전체 읽기 전환, 원본과 비교, 챕터별 확인 완료, 임시 저장(`saveMasterReviewAction`), 승인 바(모든 챕터 확인 시 활성, `autoCheck` 위반·경고 표시).
- [x] Claude 패널: 사전 검토 메모(클릭 시 해당 문단으로 이동), 요청 버튼+자유 입력, 제안 카드(현재/제안/적용/닫기), 전체 읽기 모드에서는 전체 점검 3종과 항목 이동.
- [x] 화면 폭이 좁으면 3단 레이아웃이 쌓이도록 `flex-wrap`(목업과 동일).
- [x] 키보드·접근성: 실제 `button`/`textarea`, 아이콘 버튼엔 `aria-label`.

### Task 7: 게시본 편집 `/admin/edit/published/[docId]`

**Files:** Create `app/admin/(dashboard)/edit/published/[docId]/page.tsx`; 재사용 `MasterEditor`(모드: `published`)

- [x] `published` 모드: 확인 완료·승인 바 대신 "저장"만. 저장 응답의 경고(문단 수 변화, 하이라이트 제거)를 화면에 표시.
- [x] 한국어가 아닌 게시본은 편집 진입을 막고 이유를 안내한다.
- [x] 기존 `PublishedStoriesTable`의 한국어 항목에 "편집" 링크 추가.

### Task 8: 기존 검토 화면 연결

**Files:** Modify `components/admin/PendingReviewsTable.tsx`

- [x] `masterReviewed === false` 항목에 "마스터 미검토" 배지(차단은 하지 않음 — 스펙 §8, Open Question 4).

### Task 9: 문서와 검증

> **구현 노트(2026-11-18):** 실제 로그인·Firestore 없이 고정 데이터 미리보기 페이지로 편집기를 Playwright로 확인했다(메모 클릭→문단 편집, 수정 표시, 원본 비교, 전체 읽기, 장별 확인→승인 버튼 활성화, 모바일 폭 가로 넘침 없음, 로그인 없는 Claude 요청의 에러 표시). **Anthropic API 호출 자체와 story-generator 함수 호출은 키·배포 환경이 없어 실행하지 못했다**(SDK 타입 검사와 모킹한 단위 테스트까지만). 아래 수동 확인 항목은 그래서 열어 둔다.

- [x] `CLAUDE.md`의 관리자 대시보드 구조에 `/admin/edit`, `lib/claude/`, 필요한 환경 변수(`ANTHROPIC_API_KEY`)를 추가한다.
- [x] `npm run lint` + `npm run test` + `npm run build` 통과 확인.
- [ ] 수동 확인(Firebase 에뮬레이터 또는 개발 프로젝트): 정지된 세션 열기 → 문단 수정·Claude 제안 적용 → 확인 완료 → 승인 → 상태 전환, 게시본 편집 저장 후 `storyContent`·리비전 확인. 실제 로그인·Firestore가 필요한 부분은 가능한 범위까지만 확인하고, 못 한 항목은 그대로 보고한다.
