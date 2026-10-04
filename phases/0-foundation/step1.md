# Step 1: lib-rules

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 1장 "홈 구조"(오늘 할 일, 새 단어 소진), "연속 학습일"
  - 2장 "대화 진행" 7번(입력 1~300자), "레벨별 조절" 표
  - 3장 "오늘의 학습", 4장 "레벨업 테스트", 5장 "플랜, 사용량, 무료 체험"
  - 6-4 "공통 준비 상태 검사", 6-10 "에러 코드"
  - 7장 "`lib/` 단위 테스트"
- 이전 step 산출물: `package.json`, `vitest.config.ts`, `src/test/setup.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/lib/`에 순수 규칙 모듈 10개를 만든다. **모듈마다 같은 폴더에 `*.test.ts`를 먼저 쓰고**(TDD guard가 강제한다) 구현한다. 아래는 인터페이스다. 내부 구현은 재량이지만 규칙은 그대로 지킨다.

공통 규칙: `src/lib`끼리는 import해도 되지만 lib 밖(`app`, `server`, `services`, `components`)과 `next`·`react`·`@supabase/*`·`@anthropic-ai/*`는 import하지 않는다. 환경변수·`fetch`·`Date.now()`/`new Date()` 호출도 하지 않는다. 시각은 인자로 받는다.

### `levels.ts`
```ts
export const LANGUAGES = ['en', 'ja'] as const
export type Language = (typeof LANGUAGES)[number]
export const LANGUAGE_NAMES: Record<Language, string>          // en: '영어', ja: '일본어'
export const LEVELS = [1, 2, 3, 4, 5] as const
export type Level = (typeof LEVELS)[number]
export const LEVEL_INFO: Record<Level, { name: string; description: string }>
export function isLevel(n: number): n is Level
export function showsFurigana(level: Level): boolean            // 1~3
export function opensTranslationByDefault(level: Level): boolean // 1~2
export function allowsKoreanInput(level: Level): boolean         // 1~2
export function canTakeLevelTest(level: Level): boolean          // 1~4
export function showsKana(language: Language, level: Level): boolean  // ja이고 1~2
```
`LEVEL_INFO` 문구:

| 레벨 | name | description |
|---|---|---|
| 1 | 입문 | 인사와 아주 쉬운 표현부터 시작해요 |
| 2 | 초보 | 짧은 문장으로 여행·일상 상황을 해결해요 |
| 3 | 중급 | 일상 대화를 자연스럽게 이어 가요 |
| 4 | 상급 | 업무 상황에서 뉘앙스까지 다듬어요 |
| 5 | 고수 | 원어민처럼 관용구와 격식을 자유롭게 써요 |

### `plan.ts`
```ts
export type Plan = 'free' | 'pro'
export const PLAN_LIMITS: Record<Plan, { chatTurns: number; newWords: number }>  // free 20/10, pro 150/30
export const PRO_PRICE_KRW = 9900
export const TRIAL_DAYS = 7
export function planAt(proUntil: Date | null, now: Date): Plan    // proUntil > now 이면 pro
export type TrialState =
  | { kind: 'available' }                    // trialStartedAt === null
  | { kind: 'active'; daysLeft: number }     // 시작했고 proUntil > now. daysLeft = 남은 시간을 일 단위로 올림
  | { kind: 'ended' }
export function trialState(trialStartedAt: Date | null, proUntil: Date | null, now: Date): TrialState
```

### `usage.ts`
```ts
export function kstDate(at: Date): string           // 한국 날짜 'YYYY-MM-DD' (UTC+9 고정, 서머타임 없음)
export function kstDayStart(day: string): Date      // 그 한국 날짜 00:00(KST)의 시각
export function addDays(day: string, n: number): string
export function remaining(used: number, limit: number): number   // max(0, limit - used)
```
테스트에 넣을 경계: `2026-10-04T14:59:59Z`는 `2026-10-04`, `2026-10-04T15:00:00Z`는 `2026-10-05`다. 한국 시각 23:59:50에 예약하고 다음 날 00:00:10에 성공한 턴은 예약 시각(`created_at`)의 날짜에 속한다(spec 5장). 월말·연말 `addDays`도 넣는다.

### `streak.ts`
```ts
export type StreakState = { lastStudyDate: string | null; streak: number }
export function nextStreak(state: StreakState, today: string): StreakState
export function displayStreak(state: StreakState, today: string): number
```
- 갱신: `lastStudyDate`가 오늘이면 그대로, 어제이면 `streak + 1`, 그 밖(null 포함)이면 1. `lastStudyDate`는 오늘로 바뀐다.
- 표시: `lastStudyDate`가 오늘이나 어제면 `streak`, 아니면 0.
- 이 규칙은 `1-data`에서 SQL로도 구현된다. 두 구현이 같아야 하므로 규칙을 바꾸지 마라.

### `text.ts`
```ts
export const CHAT_INPUT_MAX = 300
export function countChars(s: string): number       // 앞뒤 공백을 지운 뒤 코드 포인트 수 ([...s.trim()].length)
export function isValidChatInput(s: string): boolean  // 1 ≤ countChars(s) ≤ 300
```
클라이언트 글자 수 표시와 서버 zod 검증이 이 함수 하나를 쓴다. 테스트에 공백만 있는 입력, 앞뒤 공백, 한글·일본어, 이모지(코드 포인트 1개로 셈), 300/301자 경계를 넣는다.

### `wordBatch.ts`
```ts
export const BATCH_MAX = 10
export function batchSize(remainingToday: number, unseenCount: number): number   // min(10, 남은 한도, 미학습 수), 음수 없음
export function wordStatus(knew: boolean, correct: boolean): 'known' | 'review'  // 둘 다 true일 때만 known
export function newWordIds(itemIds: readonly string[], existingIds: ReadonlySet<string>): string[]
export function hasValidBatchIds(ids: readonly string[]): boolean               // 1~10개, 중복 없음
```
테스트에 미학습 0개, 1~9개, 남은 한도 0을 넣는다.

### `levelTest.ts`
```ts
export const LEVEL_TEST_SIZE = 20
export const PASS_SCORE = 16
export function hasValidTestIds(ids: readonly string[]): boolean     // 정확히 20개, 중복 없음
export function scoreAnswers(
  answers: readonly { word_id: string; answer: string }[],
  correctById: ReadonlyMap<string, string>,
): { score: number; wrongIds: string[] }      // 정답 표기와 문자열 그대로 비교, 정규화 없음
export function isPassed(score: number): boolean   // score ≥ 16
```
테스트에 15/16 경계를 넣는다.

### `today.ts` (홈 "오늘 할 일")
```ts
export const DAILY_WORD_GOAL = 10
export const VALID_SESSION_TURNS = 3
export function isValidSession(doneTurns: number): boolean   // 성공 턴 3개 이상. 종료 여부와 무관
export type WordGoal = { progress: number; done: boolean; exhausted: boolean }
export function wordGoal(newWordsToday: number, unseenInLevel: number): WordGoal
export function remainingGoalCount(word: WordGoal, chatDone: boolean): number
```
- `progress = min(newWordsToday, 10)`, `done = newWordsToday ≥ 10`, `exhausted = unseenInLevel === 0`. 오늘 10개를 채운 뒤 소진돼도 `done`은 유지한다. 목표는 플랜과 무관하게 10개다.
- `remainingGoalCount`: 단어 목표(완료도 소진도 아님) + 대화 목표(미완료). 소진된 단어 목표는 남은 할 일로 세지 않는다.

### `errors.ts`
```ts
export const ERRORS: Record<ErrorCode, { status: number; message: string }>
export type ErrorCode = 'UNAUTHORIZED' | 'CONSENT_REQUIRED' | 'ONBOARDING_REQUIRED' | 'INVALID_INPUT'
  | 'NOT_FOUND' | 'LIMIT_REACHED' | 'AI_FAILURE_LIMIT' | 'AI_UNAVAILABLE' | 'SESSION_FULL'
  | 'CONFLICT' | 'INTERNAL'
export function isErrorCode(x: unknown): x is ErrorCode
```
HTTP 상태는 spec 6-10 표를 따른다. message(해요체, 사용자에게 그대로 보인다):

| code | message |
|---|---|
| UNAUTHORIZED | 로그인이 필요해요. |
| CONSENT_REQUIRED | 약관에 동의한 뒤 이용할 수 있어요. |
| ONBOARDING_REQUIRED | 학습할 언어와 레벨을 먼저 골라 주세요. |
| INVALID_INPUT | 입력한 내용을 다시 확인해 주세요. |
| NOT_FOUND | 찾을 수 없어요. |
| LIMIT_REACHED | 오늘 사용량을 모두 썼어요. |
| AI_FAILURE_LIMIT | 오늘은 응답 오류가 많아 대화를 잠시 쉬어요. 내일 다시 시도해 주세요. |
| AI_UNAVAILABLE | 응답을 받지 못했어요. 턴은 차감되지 않았어요. |
| SESSION_FULL | 이 대화는 20턴을 모두 채웠어요. |
| CONFLICT | 다른 요청과 겹쳤어요. 화면을 새로 고친 뒤 다시 시도해 주세요. |
| INTERNAL | 잠시 후 다시 시도해 주세요. |

### `readiness.ts` (API·페이지 공통 준비 상태 판정)
```ts
export type ReadinessState = {
  agreedAt: Date | null
  currentLanguage: Language | null
  levels: Partial<Record<Language, Level>>
}
export type Requirement = 'login' | 'consent' | 'ready'
export function checkReadiness(
  state: ReadinessState, requirement: Requirement, language?: Language,
): 'ok' | 'CONSENT_REQUIRED' | 'ONBOARDING_REQUIRED'
```
- `login`: 항상 ok
- `consent`: 동의 없으면 CONSENT_REQUIRED. `language`가 주어졌는데 그 언어의 레벨이 없으면 ONBOARDING_REQUIRED
- `ready`: 동의 없으면 CONSENT_REQUIRED. 현재 언어가 없거나 현재 언어의 레벨이 없으면 ONBOARDING_REQUIRED. `language`가 주어졌는데 그 언어의 레벨이 없어도 ONBOARDING_REQUIRED
- 판정 순서는 동의 → 레벨이다(둘 다 없으면 CONSENT_REQUIRED).
- 쓰는 곳(다음 phase에서 연결): consent API는 `login`, levels API는 `consent`, language API는 `consent` + 대상 언어, 나머지 API와 보호 페이지는 `ready`(요청·세션 언어가 있으면 함께 넘김).

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
# lib 순수성: lib 밖 모듈·프레임워크·I/O를 쓰지 않는다
! grep -rnE "from ['\"](@/|\.\./)(app|server|services|components)" src/lib
! grep -rnE "from ['\"](next|react|@supabase|@anthropic-ai)" src/lib
! grep -rnE "process\.env|fetch\(|Date\.now\(\)|new Date\(\)" src/lib --include=*.ts --exclude=*.test.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-foundation/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (모듈 10개 이름과 핵심 export를 포함)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 함수 안에서 현재 시각을 읽지 마라. 이유: 한도·날짜의 실제 판정은 RPC의 DB 시각이 하고, lib는 인자로 받은 시각으로 표시·테스트용 계산만 한다.
- 위 시그니처의 이름과 의미를 바꾸지 마라. 이유: 이후 phase의 step 파일이 이 이름으로 작성된다. 보조 함수 추가는 괜찮다.
- 위 10개 밖의 모듈(furigana, blank, kana, scenarios 등)을 만들지 마라. 이유: 다음 step의 범위다.
- 한도·가격·합격 기준 숫자를 다른 곳에 중복으로 적지 마라. 이유: 상수 하나만 고치면 되게 한다.
- 기존 테스트를 깨뜨리지 마라
