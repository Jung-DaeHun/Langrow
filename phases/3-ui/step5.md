# Step 5: study-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 1장 "예외 흐름"(단어 회차 도중 이탈, 오늘 단어 한도를 채움, 레벨 5 소진, 단어 저장 응답 유실)
  - 3장 전체(오늘의 학습, 새 단어 소진, 오답 복습), 3-1 "가나 익히기", 4장 "레벨업 테스트"
  - 6-10 "에러 코드", 7장 "컴포넌트" 테스트 항목
- `docs/spec/ui.md`: "플래시카드", "빈칸 퀴즈", "세그먼트", "진행 표시", "한도 도달 안내", "상태 패턴"(저장 중, 빈 상태, 새 단어 소진, 인라인 오류), "애니메이션"(뒤집기 450ms, reduced motion), "화면별 구성"의 `/words`·`/level-up`·`/kana` 행
- step 0~4 산출물:
  - `src/server/page.ts`, `src/server/db/reads.ts`(`readUnseenWords`, `readReviewWords`, `readLevelWords`, `Word`)
  - `src/services/apiClient.ts`
  - `src/components/`: `Furigana`, `WaitingDots`, `LimitNotice`, `ChatRoom`(집중 모드·인라인 오류 처리 예)와 테스트
  - `src/lib/today.ts`(`exhaustedActions`, `DAILY_WORD_GOAL`), `src/app/(app)/home/page.tsx`(소진 안내 그리는 방식)
- 앞 phase 산출물:
  - `src/lib/blank.ts`(`parseBlank`, `buildOptions`, `isCorrectChoice`), `src/lib/levelTest.ts`(`LEVEL_TEST_SIZE`, `PASS_SCORE`), `src/lib/wordBatch.ts`(`BATCH_MAX`, `batchSize`, `wordStatus`), `src/lib/kana.ts`(`KANA`, `KANA_ROWS`, `KanaScript`), `src/lib/levels.ts`(`showsFurigana`, `canTakeLevelTest`, `LEVEL_INFO`), `src/lib/plan.ts`, `src/lib/usage.ts`
  - `src/types/api.ts`(`WordBatchResponse`, `WordReviewResponse`, `LevelUpResponse`), `src/app/api/words/batch/route.ts`, `src/app/api/words/review/route.ts`, `src/app/api/level-up/route.ts`, `src/app/api/events/route.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

단어 학습(`/words`), 레벨업 테스트(`/level-up`), 가나 익히기(`/kana`)를 만든다. 세 화면 모두 회차가 진행되는 동안 **집중 모드**다(루트 `data-focus-mode`). 회차 결과는 끝날 때 한 번만 저장하고, 중간에 나가면 버린다(ARCHITECTURE "상태 관리"). 나갈 때 확인 대화상자는 띄우지 않는다. 회차 시작 카드에서 미리 알린다.

- 레벨업 테스트의 **정답은 클라이언트로 보내지 않는다**(spec 4장). 페이지는 `word_id`·빈칸 예문·`example_ko`·섞은 보기만 넘긴다.
- 단어 데이터는 아직 seed 전일 수 있다. 단어가 없으면 단어 화면은 "소진" 상태로, 레벨업은 "문제 준비 전" 안내로 보인다.

## 작업

모듈·컴포넌트마다 같은 폴더에 테스트를 먼저 쓴다. 컴포넌트 테스트는 `@/services/apiClient`와 `next/navigation`만 mock한다.

### 1. lib

**`src/lib/blank.ts`에 추가**

```ts
export type BlankQuestion = { wordId: string; before: string; after: string; exampleKo: string; options: string[] }
export function toBlankQuestion(
  word: { id: string; example: string; exampleKo: string; distractors: readonly string[] },
  random?: () => number,
): BlankQuestion | null
```

- `parseBlank(example)`가 실패하면 `null`이다.
- 보기는 `buildOptions(answer, distractors, random)`로 섞는다.
- **결과에 정답 필드가 없다.** 테스트에서 `not.toHaveProperty("answer")`로 확인한다.

**`src/lib/levelTest.ts`에 추가**

```ts
export function pickTestWords<T>(words: readonly T[], random?: () => number): T[] | null
```

`LEVEL_TEST_SIZE`(20)개를 중복 없이 무작위로 고른다. 20개 미만이면 `null`이다.

### 2. 공용 컴포넌트

**`src/components/Flashcard.tsx`** (`"use client"`)

```ts
type Props = { front: ReactNode; back: ReactNode; onAnswer: (knew: boolean) => void }
```

- 카드는 ui.md "플래시카드" 모양이다(`max-w-[440px] aspect-[4/3.4] rounded-xl bg-card shadow-raised`, 가운데 정렬).
- 카드 전체가 `<button>`이라 Space·Enter로 뒤집힌다. 뒤집기는 `rotateY` 450ms이고, reduced motion이면 회전 없이 면만 바꾼다.
- 아래에 [모르겠어요](outline)와 [알아요](primary)를 `flex-1`로 나란히 둔다. 누르면 `onAnswer`를 부른다.
- 다음 카드로 넘어갈 때 부모가 `key`로 새로 만든다. 그래서 앞면부터 시작한다.

**`src/components/BlankQuiz.tsx`** (`"use client"`, 단어 학습·레벨업 공용)

```ts
type Props = {
  question: BlankQuestion
  language: Language; showFurigana: boolean
  stepLabel: string; index: number; total: number          // 위 진행: 단계 이름 + i / n + 바
  mode: "learn" | "test"
  answer?: string; meaningKo?: string                        // learn에서만 넘긴다
  isLast: boolean
  onNext: (choice: string) => void
}
```

- **문제 카드**(`p-6`):
  - 문장(`text-quiz`, `lang`, `Furigana`)과 빈칸(`inline-block min-w-18 border-b-2 border-accent`).
  - 아래에 `exampleKo`를 둔다.
- **보기 4개**: 세로로 쌓은 버튼이다. 일본어는 `Furigana show={showFurigana}`로 그린다.
- **`learn`**:
  - 고르면 잠그고 바로 채점한다(`isCorrectChoice`). 정답은 `ring-2 ring-accent bg-ok-wash` + CircleCheck, 고른 오답은 `ring-2 ring-danger bg-danger-wash` + CircleX다.
  - 문구는 "정답이에요." 또는 "오답이에요. 정답은 **X** (뜻)"이다. 색만으로 알리지 않고 아이콘과 문구를 함께 쓴다.
  - 그다음 [다음 문제] 또는 [결과 보기](`isLast`, primary `w-full`) → `onNext(choice)`.
- **`test`**: 고르면 정답 여부를 보여 주지 않고 바로 `onNext(choice)`를 부른다.

### 3. `/words`: `src/app/(app)/words/page.tsx` + `src/components/WordSession.tsx`

**페이지** (async `searchParams`의 `tab === "review"`면 오답 복습 탭)
- **데이터**:
  - `requireReady()`, `loadTodayUsage()`.
  - `rem = remaining(usage.newWords, 단어 한도)`.
  - `readUnseenWords(…, language, level, BATCH_MAX)`, `size = batchSize(rem, unseen.total)`.
  - `readReviewWords(…, language, BATCH_MAX)`.
- **머리**: 제목 "단어" → 세그먼트 링크 2개(`/words`, `/words?tab=review`; `role="tablist"`·`role="tab"`·`aria-selected`). 라벨은 "오늘의 학습", "오답 복습 n"이다.
- **오늘의 학습 탭**:
  - `size > 0`이면 `<WordSession mode="learn" … words={unseen.words.slice(0, size)} todayCount={usage.newWords} trial={trial} />`를 그린다.
  - **소진**(`unseen.total === 0`, 아래보다 먼저 판단):
    - "이 레벨의 새 단어를 모두 학습했어요"(레벨 5는 "고수 단계의 새 단어를 모두 학습했어요")를 보여 준다.
    - 버튼은 `exhaustedActions(level, review.total)`대로 둔다. 오답이 0개면 "복습할 오답이 없어요"를 함께 적는다.
    - 체험 안내는 두지 않는다.
  - **한도 도달**(`rem === 0`):
    - 성공 Notice "오늘 단어 완료" + 대화 안내([대화하러 가기], `/chat`).
    - `<LimitNotice feature="words" trial={trial} />`.
- **오답 복습 탭**:
  - `review.total === 0`이면 정보 Notice(Inbox) "아직 틀린 단어가 없어요" / "오늘의 학습에서 틀린 단어가 여기에 모여요".
  - 아니면 `<WordSession mode="review" … words={review.words} trial={trial} />`.

**`WordSession`** (`"use client"`)

```ts
type Props = { mode: "learn" | "review"; language: Language; level: Level; words: Word[]; todayCount?: number; trial: TrialState }
```

- **시작 카드**(집중 모드 아님):
  - `learn`:
    - 눈썹 "영어 · 중급", "오늘 n / 10"(`min(todayCount, DAILY_WORD_GOAL)`).
    - 28px "새 단어 n개", 안내 "끝까지 풀면 한 번에 저장돼요. 중간에 나가면 저장되지 않아요.", [시작하기].
  - `review`:
    - 단어 회색 태그 목록 + "복습은 하루 사용량에 포함되지 않아요." + [복습 시작].
- **회차**(집중 모드, 왼쪽 위 [그만하기] pill → 저장 없이 시작 카드로):
  - 위에 진행(단계 이름 + `i / n` + `h-1` 바)을 둔다.
  - `learn`은 플래시카드 전부 → 같은 단어들로 빈칸 퀴즈 전부, `review`는 플래시카드만이다.
  - 단어 앞면:
    - 단어(`text-word`, `brand`, `lang`) + "탭해서 뜻 보기"(RotateCw 13px).
    - 일본어이고 `showsFurigana(level)`이며 `reading`이 단어와 다르면 단어 전체 위에 읽기를 `<ruby>`로 단다(`Furigana`에 `[단어|읽기]`를 넘겨도 된다).
  - 단어 뒷면: 뜻(28px 700), `{{ }}`를 정답으로 채운 예문(`Furigana`, `lang`), `exampleKo`(`text-sm text-ink-muted`).
  - 빈칸 퀴즈: 보기는 퀴즈 단계에 들어갈 때 단어마다 한 번 `toBlankQuestion`으로 만들어 고정한다. 정답은 `parseBlank(example).answer`다.
- **저장**(마지막에 한 번, `language`는 회차 시작 때 고정):
  - `learn`: `api<WordBatchResponse>("POST", "/api/words/batch", { language, items: [{ word_id, knew, correct }] })`.
  - `review`: `api<WordReviewResponse>("POST", "/api/words/review", { language, items: [{ word_id, knew }] })`.
  - 저장 중에는 버튼을 비활성화하고 "저장 중…"으로 표시한다.
- **결과**(집중 모드):
  - `learn`:
    - "n개 중 m개 맞혔어요".
    - 성공 Notice: `insertedCount > 0`이면 "새 단어 k개를 저장했어요", 0이면 "이미 저장한 단어예요. 사용량은 늘지 않았어요".
    - 복습으로 간 단어 목록(`wordStatus(knew, correct) === "review"`).
  - `review`: "n개 중 m개 알았어요" + 성공 Notice "복습 결과를 저장했어요".
  - 버튼: [홈으로](primary) + [단어 화면으로](outline → `router.refresh()` 후 시작 카드).
- **저장 실패**: 결과(답)를 보존한다. 자동으로 다시 보내지 않는다.
  - 429 `LIMIT_REACHED`: `<LimitNotice feature="words" trial={trial} onTrialStarted={…} />` + [다시 시도].
  - 그 밖(네트워크 포함): 오류 Notice(서버 `message`) + [다시 시도](같은 items로 재전송).
  - 중복 저장은 서버가 200·`insertedCount: 0`으로 처리한다(spec 3장).

### 4. `/level-up`: `src/app/(app)/level-up/page.tsx` + `src/components/LevelTestRunner.tsx`

**페이지**
- `!canTakeLevelTest(level)`이면 정보 Notice "이미 최고 레벨이에요" + [홈으로]를 보여 준다.
- 문제 만들기:
  - `readLevelWords(…, language, level)` → `pickTestWords` → 단어마다 `toBlankQuestion`.
  - 20문제를 만들지 못하면 정보 Notice "아직 문제를 준비하지 못했어요" + [홈으로]를 보여 준다.
- `<LevelTestRunner key={문제 id를 이은 문자열} language={language} fromLevel={level} questions={questions} />`.
- 정답(`example`의 `{{ }}` 안, `parseBlank().answer`)을 props로 넘기지 않는다.

**`LevelTestRunner`** (`"use client"`)

```ts
type Props = { language: Language; fromLevel: Level; questions: BlankQuestion[] }
```

- **시작**(집중 모드 아님):
  - `text-sm` 언어 + 제목 "중급 → 상급 레벨업 테스트".
  - 규칙 카드 3줄: ListChecks "중급 단어 빈칸 20문제", Target "16개 이상 맞히면 레벨 +1", Repeat "재응시 제한 없음 · 사용량에 포함되지 않아요".
  - "제출하면 서버가 채점해요" + [테스트 시작].
- **문제**(집중 모드, [그만하기] → 답을 버리고 시작으로):
  - `BlankQuiz mode="test"`, 단계 이름 "레벨업 테스트", `i / 20`.
  - 마지막 답을 고르면 제출한다.
- **채점 중**: 가운데 정렬로 "채점하고 있어요" + `WaitingDots`.
- **제출**: `api<LevelUpResponse>("POST", "/api/level-up", { language, from_level: fromLevel, answers: [{ word_id, answer }] })`. 답은 문제 순서대로 보낸다.
- **결과**(집중 모드):
  - "20문제 중 n개 정답 · 기준 16개" + 제목 + 바. 바는 합격이면 `accent`, 불합격이면 `ink-muted`이고 빨강은 쓰지 않는다.
  - **합격**: 보상 Notice(Award) "새 상황 4개가 열렸어요" + [새 상황 보기](primary) + [홈으로](outline). 셸의 레벨 표시도 새로 읽게 둘 다 `window.location.assign`(`/chat`, `/home`)으로 이동한다.
  - **불합격**: 제목 "이번엔 아쉽게 통과하지 못했어요"와 정보 Notice "n개만 더 맞히면 통과예요"(`PASS_SCORE - score`). 버튼은 [다시 보기](primary → 시작 상태로 되돌리고 `router.refresh()`로 새 문제) + [홈으로](outline)다.
  - 틀린 문제 목록(`wrong`): 문제 문장에 서버가 준 정답(`answer`)을 채워 보여 준다.
- **실패**:
  - 409 `CONFLICT`(레벨이 이미 바뀜·재제출): 오류 Notice(서버 `message`) + [홈으로](`window.location.assign("/home")`).
  - 그 밖(네트워크 포함): 오류 Notice + [다시 시도](같은 답 재제출).

### 5. `/kana`: `src/app/(app)/kana/page.tsx` + `src/components/KanaDeck.tsx`

- **페이지**: `requireReady()`, 제목 "가나 익히기" + "사용량에 포함되지 않아요" → `<KanaDeck />`.
- **`KanaDeck`**(`"use client"`, props 없음, `KANA`·`KANA_ROWS` 상수만 사용):
  - **선택**:
    - 세그먼트(히라가나/가타카나, `role="tablist"`) + [71자 전체](outline sm).
    - 섹션 "기본 46자"와 "탁음·반탁음 25자"에 행 타일을 둔다(모바일 1열, `md` 2열). 타일은 글자 22px `house` + "あ행 · 5자"다.
  - **카드**(집중 모드, 왼쪽 위 [행 선택] pill):
    - `Flashcard`. 앞면은 글자(`text-kana`, `lang="ja"`), 뒷면은 글자(56px)와 `a · 아`(32px 700 `brand`, 로마자 · 한글)다.
    - [모르겠어요]를 누른 글자는 회차 끝에 다시 넣는다(알아요를 누를 때까지).
    - 진행은 아는 글자 수 / 전체로 보여 준다.
  - **완료**(집중 모드):
    - 제목 "あ행 5자 완료"(전체면 "히라가나 71자 완료"), 성공 Notice, 글자 5열 격자.
    - 버튼은 [한 번 더](primary, 같은 글자로 다시) + [다른 행](outline, 선택으로)이다.
  - **기록**:
    - 회차를 마칠 때마다 `api("POST", "/api/events", { name: "kana_studied" })`를 **한 번** 보낸다. 활동일·연속일은 서버가 갱신한다.
    - 실패하면 완료 화면은 그대로 두고 오류 Notice + [다시 시도]를 보여 준다.

### 6. 테스트 (먼저 작성)

**lib**
- `toBlankQuestion`: 결과에 정답 필드 없음, 보기 4개에 정답 포함, 깨진 예문 → `null`.
- `pickTestWords`: 20개·중복 없음, 19개 → `null`, `random` 주입으로 결정적.

**`Flashcard`**: 클릭·Enter로 뒤집기, 두 버튼의 `onAnswer` 값.

**`BlankQuiz`**
- `learn`: 정답·오답 표시(아이콘 + 문구, 오답이면 정답과 뜻), 선택 뒤 잠김, `isLast` 라벨.
- `test`: 정답 여부 표시 없이 바로 `onNext`.

**`WordSession`**
- 플래시카드 → 퀴즈 → 저장 body(`knew`·`correct`, 시작 때 언어).
- `insertedCount: 0` 문구.
- 429 → `LimitNotice` + [다시 시도], 결과 보존.
- 네트워크 실패 → [다시 시도]가 같은 items로 재전송.
- [그만하기] → 저장 호출 없음.
- `review` 모드는 퀴즈 없이 `/api/words/review`.

**`LevelTestRunner`**
- 20문제 동안 정답 표시 없음, 제출 body(`from_level`, 문제 순서).
- 채점 중 표시.
- 합격(보상 Notice) / 불합격("n개만 더", 틀린 문제에 서버 정답) 결과.
- 409 → [홈으로].
- [그만하기] → 제출 없음.

**`KanaDeck`**
- 행 선택 → 카드.
- [모르겠어요] 글자가 끝에 다시 나옴.
- 완료 때 `kana_studied` 정확히 1번, 실패 → [다시 시도].
- 히라가나/가타카나 전환, 71자 전체.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -rn "dangerouslySetInnerHTML" src
! grep -rn "getSession(" src --include=*.ts --include=*.tsx
! grep -rnE "(bg|text|border|ring|fill|stroke|from|to)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}" src/app src/components
! grep -rnE "backdrop-blur|bg-gradient|bg-linear|bg-radial|animate-(pulse|bounce|spin|ping)" src/app src/components
! grep -rnE "#[0-9a-fA-F]{3,8}\b" src/app src/components --include=*.tsx | grep -v "GoogleLoginButton"
for f in $(find src/components -name "*.tsx" ! -name "*.test.tsx"); do [ -f "${f%.tsx}.test.tsx" ] || { echo "테스트 없음: $f"; exit 1; }; done
for f in WordSession LevelTestRunner KanaDeck; do grep -q "data-focus-mode" "src/components/$f.tsx" || { echo "집중 모드 없음: $f"; exit 1; }; done
! grep -n "parseBlank" src/components/LevelTestRunner.tsx "src/app/(app)/level-up/page.tsx"
test -f "src/app/(app)/words/page.tsx" && test -f "src/app/(app)/level-up/page.tsx" && test -f "src/app/(app)/kana/page.tsx"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md "상태 관리"를 따르는가? (회차는 `useState`, 끝날 때 한 번 저장, 중간에 나가면 버림)
   - spec 4장: 레벨업 정답이 페이지 props·클라이언트 번들에 없는가? 채점은 서버가 하는가?
   - UI_GUIDE: 빈칸 퀴즈는 학습이면 바로 정답, 레벨업이면 정답 숨김, 불합격에 빨강 없음, 색만으로 정답·오답을 알리지 않음
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (클라이언트가 보낸 날짜·플랜·사용량을 믿지 않음, 후리가나는 `<ruby>` 요소)
3. 결과에 따라 `phases/3-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 만든 컴포넌트·lib 함수와 화면별 상태를 넣는다
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 레벨업 테스트의 정답을 페이지 props·클라이언트 상태로 넘기거나 클라이언트에서 채점하지 마라. 이유: spec 4장(서버 채점, 정답은 제출 뒤 `wrong`으로만).
- 회차 도중에 단어·복습 결과를 나눠 저장하거나, 중간에 나갈 때 저장하지 마라. 이유: spec 3장 4~5번(회차 끝에 한 번, 이탈하면 버림). 회차 이어하기는 MVP 제외다.
- 나갈 때 확인 대화상자를 띄우지 마라. 이유: ui.md "집중 모드"(시작 카드에서 미리 알림).
- 회차 크기를 클라이언트에서 다시 계산해 늘리거나, body에 날짜·플랜·사용량을 넣지 마라. 이유: 한도는 RPC가 DB 시각으로 판정한다(CLAUDE.md). 페이지의 `batchSize`는 표시용이다.
- 저장 실패를 자동으로 다시 보내지 마라. 이유: spec 6-10(재시도 버튼으로 확인).
- 빈칸 직접 입력, 가나 진행도 저장, 가나 퀴즈·쓰기 연습을 만들지 마라. 이유: MVP 제외(S2, spec 3-1).
- 소진 상태에서 체험 안내나 "새 단어 10개" 목표를 보이지 마라. 이유: spec 3장 "새 단어 소진", D9.
- step 0~4의 공용 모듈·컴포넌트 동작을 바꾸지 마라. 이유: 다른 화면이 그 계약을 쓴다. 꼭 필요하면 테스트와 함께 고치고 summary에 적는다.
- 기존 테스트를 깨뜨리지 마라
