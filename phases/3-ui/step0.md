# Step 0: page-data

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 1장 "홈 구조", "연속 학습일"(표시 규칙), 3장 "오늘의 학습"·"오답 복습", 4장(출제)
  - 5장 "세는 방법"(한국 날짜, pending 포함), 6-1 "페이지 접근 규칙", 6-3 "데이터 접근과 보안"
  - 6-9 "TDD hook에 맞춘 파일 규칙", 7장 "DB 통합 테스트"
- `docs/spec/ui.md` "화면별 구성"(각 화면이 무엇을 보여 주는지 확인해 읽기 함수의 반환값을 맞춘다)
- 앞 phase 산출물:
  - `supabase/migrations/*.sql`(테이블·RLS 정책), `src/types/database.ts`
  - `src/server/db/account.ts`(`getReadiness`: 같은 모양의 조회를 admin으로 한다), `src/server/db/chat.ts`(`EndResult`), `src/server/db/learning.ts`
  - `src/server/db/learning.test.ts`, `src/server/db/chat.test.ts`(테스트 단어 upsert, 대화 턴 만들기, `created_at` 옮기기), `src/test/db.ts`(`signedInClient`, `createReadyUser`), `src/test/dbGlobalSetup.ts`
  - `src/services/supabase/server.ts`(`getServerSupabase`), `src/lib/readiness.ts`, `src/lib/usage.ts`(`kstDate`, `kstDayStart`, `addDays`), `src/lib/streak.ts`(`StreakState`), `src/services/claude/schemas.ts`(`TurnReply`)
  - `src/server/http.test.ts`(Supabase 서버 클라이언트를 mock하는 방법)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

3-ui의 페이지(Server Component)는 쿠키 기반 server client로 **자기 행만** 읽는다(RLS). 이 step은 모든 화면이 쓸 읽기 함수와 보호 페이지 공통 가드를 만든다. 화면·컴포넌트는 만들지 않는다. 다음 step들은 여기서 정한 함수와 타입만 써서 화면을 그린다.

- 읽기 함수는 클라이언트를 인자로 받는다. 페이지는 `getServerSupabase()`를 넘기고, test:db는 `signedInClient(user)`를 넘겨 실제 RLS로 검증한다.
- 날짜 경계(한국 시간 자정)는 `now`를 받아 `lib/usage`로 계산한다. 표시용 읽기이며, 한도·저장 판정은 여전히 RPC가 DB 시각으로 한다.

로컬 Supabase는 Docker로 돈다. `npx supabase status`가 실패하면 `npx supabase start`로 띄운다(Bash 타임아웃 10분). Docker가 꺼져 있어 띄울 수 없으면 blocked로 보고한다.

## 작업

파일마다 같은 폴더에 테스트를 먼저 쓴다.

### 1. `src/server/db/reads.ts` (+ `reads.test.ts`, test:db)

```ts
import "server-only"
type Sb = SupabaseClient<Database>

export type AccountState = ReadinessState & {
  streak: StreakState               // { lastStudyDate: 'YYYY-MM-DD' | null, streak }
  proUntil: Date | null
  trialStartedAt: Date | null
}
export type TodayUsage = { chatTurns: number; newWords: number }
export type Word = {
  id: string; language: Language; level: Level; rank: number
  word: string; reading: string | null; meaningKo: string
  example: string; exampleKo: string; distractors: string[]
}
export type OpenSession = {
  id: string; scenarioId: string; level: Level; status: "active" | "ending"
  doneTurns: number; lastReply: string | null; createdAt: Date
}
export type ChatTurnView = {
  turnNo: number; userText: string; reply: string; replyKo: string; correction: TurnReply["correction"]
}
export type ChatRoomData = {
  id: string; language: Language; level: Level; scenarioId: string
  status: "active" | "ending" | "ended"
  result: EndResult | null          // ended일 때만 값이 있다
  turns: ChatTurnView[]             // done 턴만, turn_no 오름차순
}

export async function readAccount(sb: Sb, userId: string): Promise<AccountState>
export async function readTodayUsage(sb: Sb, userId: string, now: Date): Promise<TodayUsage>
export async function readBestSessionTurnsToday(sb: Sb, userId: string, now: Date): Promise<number>
export async function readUnseenWords(sb: Sb, userId: string, language: Language, level: Level, limit: number): Promise<{ total: number; words: Word[] }>
export async function readReviewWords(sb: Sb, userId: string, language: Language, limit: number): Promise<{ total: number; words: Word[] }>
export async function readLevelWords(sb: Sb, language: Language, level: Level): Promise<Word[]>
export async function readOpenSessions(sb: Sb, userId: string, language: Language): Promise<OpenSession[]>
export async function readEndedScenarioIds(sb: Sb, userId: string, language: Language): Promise<string[]>
export async function readChatRoom(sb: Sb, userId: string, sessionId: string): Promise<ChatRoomData | null>
```

함수별 규칙:
- **`readAccount`**: `profiles`와 `user_levels`. 행이 없으면 `agreedAt: null, currentLanguage: null, levels: {}, streak: { lastStudyDate: null, streak: 0 }, proUntil: null, trialStartedAt: null`이다. `checkReadiness(account, ...)`에 그대로 넘길 수 있어야 한다.
- **`readTodayUsage`**: 구간은 `[오늘 한국 0시, 내일 한국 0시)`다.
  - 대화 턴: 이 구간에 생성된 `chat_turns`(pending 포함, 언어 합산).
  - 새 단어: 이 구간의 `first_seen_at`인 `user_words`.
  - 개수만 센다(`count: "exact", head: true`).
- **`readBestSessionTurnsToday`**: 오늘 구간에 생성된 done 턴을 세션별로 셌을 때 가장 큰 값이다. 없으면 0이다. 홈의 대화 목표 진행(`best / 3`)과 완료 판정(`isValidSession`)에 쓴다. 언어는 합산한다.
- **`readUnseenWords`**: 그 언어·레벨의 단어 중 이 사용자의 `user_words`에 없는 단어다(상태 무관).
  - `words`는 `rank` 오름차순으로 앞에서 `limit`개다. `limit`이 0이면 빈 배열이다.
  - `total`은 전체 미학습 개수다.
- **`readReviewWords`**: 그 언어의 `status = 'review'`인 단어다.
  - `first_seen_at` 오름차순(같으면 `word_id`)으로 앞에서 `limit`개다. `total`은 전체 개수다.
  - 단어 내용은 `words`에서 함께 읽는다(임베드 조인이든 두 번 조회든 재량).
- **`readLevelWords`**: 그 언어·레벨의 단어 전부(rank 순서)다. 레벨업 출제용이다. `words`는 공용 카탈로그라 `user_id` 조건이 없다.
- **`readOpenSessions`**: 그 언어의 `active`·`ending` 세션을 `created_at` 내림차순으로 돌려준다.
  - `doneTurns`는 done 턴 수다(pending 제외).
  - `lastReply`는 마지막 done 턴의 `reply`(원문 그대로, 후리가나 표기 포함)다. 없으면 `null`이다.
- **`readEndedScenarioIds`**: 그 언어에서 `ended` 세션이 하나라도 있는 `scenario_id` 목록이다(중복 없음).
- **`readChatRoom`**:
  - `sessionId`가 uuid가 아니면 쿼리 없이 `null`이다(Postgres uuid 캐스트 오류로 500이 나지 않게). zod `z.uuid()` 등으로 검사한다.
  - `id`와 `user_id`로 찾고, 없으면 `null`이다.
  - `result`는 `ended`일 때 `{ feedbackStatus, feedback }`(`EndResult`), 그 밖에는 `null`이다.
  - `turns`는 done 턴만이다. pending 턴은 화면에 그리지 않는다.

공통:
- 사용자 행을 읽는 모든 쿼리에 `.eq("user_id", userId)`(profiles는 `id`)를 건다. RLS가 있어도 범위를 명시하고 인덱스를 탄다.
- Supabase 오류는 `account.ts`처럼 "`<테이블> 조회 실패: <code> <message>`" 메시지의 `Error`로 던진다. 페이지가 `error.tsx`로 보여 준다.
- DB의 snake_case를 위 camelCase 타입으로 바꿔 돌려준다. `Date`로 바꿀 컬럼은 `proUntil`, `trialStartedAt`, `agreedAt`, `createdAt`이다. `lastStudyDate`는 `'YYYY-MM-DD'` 문자열 그대로 둔다.

### 2. `src/server/page.ts` (+ `page.test.ts`, 일반 unit 테스트)

```ts
import "server-only"
export type PageUser = { userId: string; email: string | null; supabase: SupabaseClient<Database> }
export type ReadyPage = PageUser & { account: AccountState; language: Language; level: Level; now: Date }

export const requireUser: () => Promise<PageUser>                                      // 비로그인 → redirect("/")
export const loadAccount: () => Promise<PageUser & { account: AccountState }>          // /onboarding용. 이동하지 않는다
export const requireReady: () => Promise<ReadyPage>                                     // 준비 안 됨 → redirect("/onboarding")
export const loadTodayUsage: () => Promise<TodayUsage>                                  // requireReady().now 기준
```

- 네 함수 모두 React `cache()`로 감싼다. `(app)` 레이아웃과 페이지가 한 요청에서 같이 불러도 조회는 한 번만 일어난다.
- **`requireUser`**: `getServerSupabase()`의 `auth.getUser()`로 판단한다. `getSession()`은 쓰지 않는다. `email`은 `user.email ?? null`이다.
- **`requireReady`**:
  - `checkReadiness(account, "ready")`가 `"ok"`가 아니면 `redirect("/onboarding")`이다.
  - `language`는 `account.currentLanguage`, `level`은 그 언어의 레벨이다.
  - `now`는 이 요청에서 한 번 만든 `new Date()`다. 페이지는 표시 계산에 이 값만 쓴다.
- **테스트**: `@/services/supabase/server`, `@/server/db/reads`, `next/navigation`(`redirect`가 throw하게)만 mock한다. 시나리오:
  - 비로그인 → `/`로 이동.
  - `getUser` 에러 → `/`로 이동.
  - 미동의 → `/onboarding`으로 이동.
  - 현재 언어의 레벨 없음 → `/onboarding`으로 이동.
  - 준비됨 → `language`·`level`·`email`을 돌려준다.
  - `loadAccount`는 미동의여도 이동하지 않는다.
  - `loadTodayUsage`는 `readTodayUsage`에 `requireReady`의 `userId`와 `now`를 넘긴다.
  - vitest(react 클라이언트 빌드)에서 `cache`는 그냥 함수를 부르는 래퍼라서 테스트끼리 결과가 섞이지 않는다.

### 3. `reads.test.ts` 시나리오 (실제 DB)

- 테스트 단어는 rank 9201+로 admin upsert하고 `afterAll`에서 지운다(`learning.test.ts`는 9101+를 쓴다).
- 로컬 DB에 실제 단어가 seed돼 있어도 통과해야 한다. 단어 결과는 테스트 단어 id만 걸러 비교한다. 순서·`limit`은 걸러낸 결과의 순서(rank 오름차순)와 길이로 확인한다.
- 대화 턴은 `src/server/db/chat.ts`의 실제 RPC로 만든다. 날짜 경계는 admin으로 `created_at`·`first_seen_at`을 옮겨 재현한다.

| 함수 | 확인할 것 |
|---|---|
| `readAccount` | profiles 행 없음 → 빈 상태 / 준비된 사용자(두 언어 레벨) → 값 / A의 client로 B의 id를 읽으면 빈 상태(RLS) |
| `readTodayUsage` | pending 포함 / 두 언어 합산 / 어제 한국 23:59:59 행 제외, 오늘 00:00:00 행 포함 / 남의 행 제외 |
| `readBestSessionTurnsToday` | 세션 둘(done 2개, 3개) → 3 / pending·어제 턴 제외 / 없음 → 0 |
| `readUnseenWords` | known·review 모두 제외 / rank 순서 / `limit` / `total` / 다른 언어·레벨 제외 |
| `readReviewWords` | review만 / 그 언어만 / 순서 / `limit` / `total` / 컬럼 매핑(`meaningKo`, `distractors` 배열) |
| `readLevelWords` | 그 레벨 단어 전부, rank 순서 |
| `readOpenSessions` | active·ending만 / 언어 필터 / 최신순 / `doneTurns`는 pending 제외 / `lastReply`는 마지막 done 턴, 턴 없으면 `null` |
| `readEndedScenarioIds` | ended만, 중복 없음 |
| `readChatRoom` | 내 세션 → done 턴만 순서대로 / ended(skipped·ready) → `result` / 남의 세션 → `null` / 없는 uuid → `null` / uuid가 아닌 문자열 → `null` |

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run test:db
grep -qE "import ['\"]server-only['\"]" src/server/db/reads.ts && grep -qE "import ['\"]server-only['\"]" src/server/page.ts
! grep -nE "getAdminSupabase|getSession\(" src/server/db/reads.ts src/server/page.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(`test:db`는 로컬 Supabase가 떠 있어야 한다).
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (읽기 함수는 `src/server/db/reads.ts`, 페이지 가드는 `src/server/page.ts`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (페이지 읽기는 쿠키 client + RLS, `getUser()`만 사용, `user_id` 범위)
3. 결과에 따라 `phases/3-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 다음 step이 쓰도록 export한 타입·함수 시그니처와 동작 차이(있다면)를 넣는다
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (Docker 꺼짐 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 읽기 함수에서 admin 클라이언트(`getAdminSupabase`)를 쓰지 마라. 이유: 페이지 읽기는 쿠키 client + RLS가 원칙이다(ARCHITECTURE "데이터 흐름"). 테스트도 `signedInClient`로 RLS를 함께 검증한다.
- 읽기 함수 안에서 `new Date()`를 부르지 마라. 이유: 한 요청 안의 표시 시각을 하나로 맞추고 테스트에서 시각을 주입하기 위해서다. `now`는 `requireReady`가 한 번 만든다.
- 읽기 함수에서 쓰기(insert·update·rpc)를 하지 마라. 이유: 쓰기는 `/api` → use-case → RPC로만 한다(CLAUDE.md).
- 새 마이그레이션·RPC·뷰를 만들지 마라. 이유: 기존 테이블과 RLS로 충분하다. 필요해 보이면 만들지 말고 error로 보고한다.
- Supabase 쿼리 체인을 mock하는 테스트를 만들지 마라. 이유: CLAUDE.md. `reads.ts`는 실제 DB로만 테스트한다.
- 화면·컴포넌트·`page.tsx`를 만들지 마라. 이유: 다음 step들의 범위다.
- `src/server/db/account.ts`·`chat.ts`·`learning.ts`·`src/server/http.ts`의 동작을 바꾸지 마라. 이유: 앞 phase에서 검증한 계약이다.
- 기존 테스트를 깨뜨리지 마라
