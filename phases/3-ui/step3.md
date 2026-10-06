# Step 3: onboarding-home

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 1장: "단계별 저니", "화면 이동", "홈 구조"(1~4), "연속 학습일"(표시), "예외 흐름"(온보딩 도중 이탈, 언어 바꿈, 단어 소진), "화면 목록"의 `/onboarding` 행과 그 아래 준비 상태 규칙
  - 3장 "새 단어 소진", 6-4 "공통 준비 상태 검사"(consent·levels·language 예외)
- `docs/spec/ui.md`: "선택 타일", "진행 표시"(바·링), "목록 묶음", "칩·태그", "안내 (Notice)", "상태 패턴"(첫날·목표 완료·새 단어 소진·빈 상태), "화면별 구성"의 `/onboarding`·`/home` 행
- step 0~2 산출물:
  - `src/server/page.ts`(`loadAccount`, `requireReady`, `loadTodayUsage`)
  - `src/server/db/reads.ts`(`readBestSessionTurnsToday`, `readUnseenWords`, `readReviewWords`, `readOpenSessions`)
  - `src/services/apiClient.ts`
  - `src/components/`: `UsageCard`, `LimitNotice`, `Furigana`와 각 테스트
  - `src/app/(app)/layout.tsx`, `src/app/(app)/account/page.tsx`(페이지 작성 예)
- 앞 phase 산출물:
  - `src/lib/levels.ts`(`LEVEL_INFO`, `showsKana`, `canTakeLevelTest`), `src/lib/today.ts`(`wordGoal`, `isValidSession`, `remainingGoalCount`), `src/lib/readiness.ts`, `src/lib/plan.ts`, `src/lib/usage.ts`, `src/lib/scenarios.ts`(`findScenario`), `src/lib/furigana.ts`(`stripFurigana`)
  - `src/app/api/me/consent/route.ts`, `src/app/api/levels/route.ts`(body·409)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

로그인 직후의 온보딩(동의 → 언어 → 레벨)과 매일 들어오는 홈을 만든다. 페이지의 분기 규칙은 테스트할 수 있게 `lib/`의 순수 함수로 둔다(spec 6-9). 페이지 파일에는 그 결과를 그리는 코드만 둔다.

**첫날**은 학습 기록이 한 번도 없는 사용자다(`account.streak.lastStudyDate === null`). 첫날에는 **대화 카드**를 "여기서 시작하세요"로 강조한다. 저니 ④ "첫 롤플레이 → 교정"과 첫 세션 완료율 지표에 맞춘 것이다. 카드 순서는 spec대로 단어 → 대화다.

## 작업

모듈·컴포넌트마다 같은 폴더에 테스트를 먼저 쓴다.

### 1. lib

**`src/lib/onboarding.ts`** (+ `onboarding.test.ts`)

```ts
export type OnboardingStart =
  | { kind: "home" }
  | { kind: "consent"; language?: Language }                      // 동의 뒤 language가 있으면 레벨 단계로
  | { kind: "language" }
  | { kind: "level"; language: Language; mode: "first" | "add" }
export function onboardingStart(state: ReadinessState, languageParam: string | undefined): OnboardingStart
```

규칙(spec 1장 `/onboarding`, "온보딩 도중 이탈", "언어 바꿈"):
- `languageParam`이 `LANGUAGES`에 없는 값이면 없는 것으로 본다.
- 미동의 → `consent`(유효한 `languageParam`이 있으면 그 언어를 담는다).
- 유효한 `languageParam`이 있을 때:
  - 그 언어의 레벨이 이미 있으면 `home`이다. 전환은 언어 시트가 한다.
  - 레벨이 없으면 `level`이다. 다른 언어의 레벨이 하나라도 있으면 `mode: "add"`, 없으면 `"first"`다.
- `languageParam`이 없을 때:
  - `checkReadiness(state, "ready") === "ok"`면 `home`이다.
  - 아니면 `language`다.

**`src/lib/today.ts`에 추가** (+ 기존 `today.test.ts`에 테스트)

```ts
export type ExhaustedAction = "level-up" | "review" | "chat"
export function exhaustedActions(level: Level, reviewCount: number): ExhaustedAction[]
```

새 단어 소진 안내 버튼이다(spec 3장 "새 단어 소진", D9). 홈과 단어 화면이 같이 쓴다.

| level | 오답 있음 | 오답 0개 |
|---|---|---|
| 1~4 | `["level-up", "review"]` | `["level-up", "chat"]` |
| 5 | `["review", "chat"]` | `["chat"]` |

### 2. `src/components/OnboardingFlow.tsx` (`"use client"`, + 테스트)

```ts
type Props = { start: Exclude<OnboardingStart, { kind: "home" }> }
```

- **화면**: `max-w-form`이다.
- **상단**:
  - 왼쪽: 처음 보이는 단계에는 워드마크를 둔다. 레벨 단계에서 언어 단계로 돌아갈 수 있으면 [이전] pill을 둔다. `mode: "add"`면 [취소] pill(`/home` 링크)을 둔다.
  - `n / 3`과 진행 바(동의 1, 언어 2, 레벨 3)를 둔다. `add`에서는 진행 표시를 두지 않는다.
- **① 동의**:
  - 제목, 국외 이전 설명(`text-sm`: 대화 내용이 Anthropic(미국)으로 전송됨).
  - 카드 안 체크박스(ui.md "체크박스"): "[필수] 만 14세 이상이며, 이용약관과 개인정보처리방침(국외 이전 포함)에 동의합니다". 이용약관·개인정보처리방침은 새 탭 링크다.
  - [동의하고 계속](primary, `w-full`)은 체크 전에는 비활성화다.
  - 누르면 `api("POST", "/api/me/consent")`를 부른다. 성공하면 `start.language`가 있으면 레벨 단계로, 없으면 언어 단계로 간다.
- **② 언어**:
  - 제목 "어떤 언어를 배울까요?". 선택 타일 2개(EN 영어 / JA 일본어, `role="radiogroup"`).
  - 타일을 누르면 그 언어의 레벨 단계로 간다.
- **③ 레벨**:
  - 제목 "{언어} 레벨을 골라 주세요". 선택 타일 5개: 번호 원, `LEVEL_INFO` 이름·설명.
  - `showsKana(language, level)`인 타일에는 "가나 익히기 포함" 태그를 단다.
  - 안내 "이후 올리기는 레벨업 테스트로, 내리기는 상단 언어 메뉴에서 할 수 있어요"를 둔다.
  - [학습 시작](primary, `w-full`)은 고르기 전에는 비활성화다.
  - 누르면 `api("POST", "/api/levels", { language, level })`를 부르고, 성공하면 `router.replace("/home")`다.
- **공통**:
  - 실패는 그 자리 오류 Notice(`role="alert"`, 서버 `message`)로 보여 주고 선택을 유지한다. 409(이미 그 언어 레벨 있음) 포함이다.
  - 요청 중에는 버튼을 비활성화한다. 단계를 바꾸면 스크롤을 맨 위로 올린다.
- **테스트**:
  - 체크 전 비활성화, 동의 호출 후 언어 단계, `start.language`가 있으면 레벨 단계로 바로 감
  - 레벨 선택 후 `/api/levels` body, `/home` 이동, 오류 표시와 선택 유지
  - `add`의 [취소]와 진행 표시 없음, 일본어 1·2 타일의 가나 태그

### 3. `/onboarding`: `src/app/onboarding/page.tsx`

- `(app)` 밖에 둔다(셸 없음, 준비 상태 이동 없음 — spec 6-1).
- `const { account } = await loadAccount()`(비로그인이면 `/`로 이동)로 상태를 읽고, async `searchParams`의 `language`를 받는다.
- `onboardingStart(account, language)`가 `home`이면 `redirect("/home")`, 아니면 `<OnboardingFlow start={...} />`를 그린다.

### 4. `/home`: `src/app/(app)/home/page.tsx` (ui.md `/home` 행, spec 1장 "홈 구조")

데이터:

```ts
const { supabase, userId, account, language, level, now } = await requireReady()
const usage = await loadTodayUsage()
// readBestSessionTurnsToday, readUnseenWords(…, 0)의 total, readReviewWords(…, 0)의 total, readOpenSessions를 병렬로 읽는다
```

위에서부터:
1. **머리**: `text-sm` "영어 · 중급" + 체험 태그. 체험 중이면 골드 "체험 n일 남음", 끝났으면 회색 "체험이 끝났어요", 체험 가능이면 없다.
2. **제목**: `remainingGoalCount(goal, chatDone)`가 0보다 크면 "오늘 할 일 n개 남았어요", 0이면 "오늘 목표를 끝냈어요"다.
   - `goal = wordGoal(usage.newWords, unseenTotal)`, `chatDone = isValidSession(best)`.
3. **첫날**이면 성공 Notice "첫날이에요"를 두고, 대화부터 해 보라고 안내한다.
4. **할 일 카드 2개**(모바일 1열, `md` 2열). 각 카드는 아이콘, 제목, 보조, 진행 링(64px, `conic-gradient`, 완료면 Check), 버튼 또는 "완료" 태그다.
   - **오늘의 단어**: 링 `min(x,10)/10`.
     - 버튼은 `/words`로 가는 [시작하기](x = 0) 또는 [계속하기]다. 완료면 "완료" 태그다.
     - `goal.exhausted`면 카드 내용을 "이 레벨의 새 단어를 모두 학습했어요"로 바꾼다(레벨 5는 "고수 단계의 새 단어를 모두 학습했어요").
     - 소진 카드의 버튼은 `exhaustedActions(level, reviewTotal)`대로 둔다. level-up → `/level-up`, review → `/words?tab=review`, chat → `/chat`. 오답이 0개면 "복습할 오답이 없어요"를 함께 적는다.
     - 오늘 이미 10개를 채웠으면 소진이어도 "완료" 표시를 유지한다. 분모 10인 미완료 목표는 보이지 않는다.
   - **대화 1세션**: 링 `min(best,3)/3`, 보조 "3턴 이상 대화하기".
     - 완료면 "완료" 태그다.
     - 아니면 진행 중 세션이 있을 때 [계속하기](`/chat/{id}`), 없을 때 [시작하기](`/chat`)다.
     - 첫날이면 `ring-2 ring-accent`와 "여기서 시작하세요" 태그를 단다.
   - primary 버튼은 화면에 하나다. 강조 카드(첫날이면 대화, 아니면 아직 안 끝난 첫 카드)의 버튼만 primary이고 나머지는 outline이다.
5. **한도 안내**:
   - 대화: `remaining(usage.chatTurns, 대화 한도) === 0`이면 `<LimitNotice feature="chat" trial={trial} />`.
   - 단어: `remaining(usage.newWords, 단어 한도) === 0`이고 미학습 단어가 남았으면 `<LimitNotice feature="words" trial={trial} />`. 소진이면 체험 안내를 하지 않는다(spec 3장).
6. **이어서 대화하기**: 현재 언어의 가장 최근 `active` 세션 1개를 타일로 보여 준다.
   - 상황 제목, 그리고 `n / 20턴 · "마지막 문장"`을 한 줄로 말줄임한다.
   - 마지막 문장은 `lastReply`를 `stripFurigana`한 값이고, 없으면 그 언어 첫 마디다. 학습 언어 `lang`을 단다.
   - `ending` 세션이 있으면 "피드백 확인" 링크(`/chat/{id}`)를 따로 둔다.
7. **섹션 "더 학습하기"**(목록 묶음):
   - 오답 복습 n개(RotateCcw, `/words?tab=review`): 0개면 비활성 행 + "아직 틀린 단어가 없어요".
   - 레벨업 테스트(TrendingUp, `/level-up`, "중급 → 상급 · 20문제 중 16개"): `canTakeLevelTest(level)`일 때만.
   - 가나 익히기(Languages, `/kana`): `showsKana(language, level)`일 때만.
8. **섹션 "오늘 남은 사용량"**: `<UsageCard usage plan showNote />`.

- 플랜·체험은 `planAt`·`trialState`에 `now`를 넣어 표시용으로만 계산한다.
- 비활성 행은 링크가 아닌 요소로 그리고 `aria-disabled="true"`를 단다.

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
test -f src/lib/onboarding.test.ts && test -f src/app/onboarding/page.tsx && test -f "src/app/(app)/home/page.tsx"
grep -q "export function exhaustedActions" src/lib/today.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (분기 규칙은 `lib/`, 페이지는 읽기와 그리기만)
   - UI_GUIDE 원칙: 홈은 "오늘 할 일"과 진행률부터, primary는 화면에 하나, 강조색은 영역마다 하나
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (쓰기는 `/api`로만, 페이지는 읽기만)
3. 결과에 따라 `phases/3-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. `onboardingStart`·`exhaustedActions` 시그니처와 홈이 링크하는 경로(`/words?tab=review` 등)를 넣는다
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 레벨을 올리는 UI를 만들지 마라. 이유: 올리기는 레벨업 테스트로만 한다(spec 0장). 온보딩의 레벨 선택은 그 언어를 처음 시작할 때만 있다.
- 표시된 남은 사용량으로 대화·단어 시작 버튼을 막지 마라. 이유: 입력은 서버의 429 뒤에만 막는다(ADR-007). 홈은 안내만 한다.
- 소진 상태에서 "새 단어 10개" 같은 이룰 수 없는 목표나 새 단어를 약속하는 체험 안내를 보이지 마라. 이유: spec 3장 "새 단어 소진", D9.
- 페이지(Server Component)에서 `/api`를 호출하거나 쓰기를 하지 마라. 이유: 페이지는 읽기만 한다(CLAUDE.md).
- `OnboardingFlow`에서 body에 `userId`·`agreed_at`·날짜를 보내지 마라. 이유: 서버가 `getUser()`와 DB 시각으로 정한다.
- 홈에서 방문 기록·이벤트를 남기지 마라. 이유: 방문 추적은 MVP 제외다(ADR-009).
- step 0~2의 공용 모듈·컴포넌트 동작을 바꾸지 마라. 이유: 다른 화면이 그 계약을 쓴다. 꼭 필요하면 테스트와 함께 고치고 summary에 적는다.
- 기존 테스트를 깨뜨리지 마라
