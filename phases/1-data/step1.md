# Step 1: db-chat

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 1장 "지표 수집"(`limit_reached` props, `chat_failed`)
  - 2장 "대화 진행" 5~6번, "대화 1턴 처리" 전체, "처리 중단 복구" 전체, "세션 종료 피드백" 전체
  - 5장 "세는 방법"(대화 사용량은 pending 포함, 예약 시각 기준)
  - 6-3 "데이터 접근과 보안"(대화 예약·확정·종료 RPC, partial UNIQUE), 6-5 "데이터 모델"(chat_sessions 상태 제약)
  - 7장 "DB 통합 테스트" 전체
- step 0 산출물:
  - `supabase/migrations/*_schema.sql`(테이블, 상태 제약, helper `kst_today`·`check_readiness`·`record_activity`, 함수 권한 규칙과 응답 형식)
  - `src/server/db/{types,rpc,account}.ts`와 테스트, `src/test/db.ts`, `src/test/dbGlobalSetup.ts`, `vitest.db.config.ts`, `src/types/database.ts`
- phase 0 산출물: `src/lib/plan.ts`(`PLAN_LIMITS`), `src/lib/today.ts`, `src/services/claude/schemas.ts`(`TurnReply`, `Feedback`), `src/services/claude/client.ts`(`AiFailureReason`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라. step 0의 함수 규칙(SECURITY INVOKER, `search_path`, service_role 전용 EXECUTE, jsonb 응답, 예상된 거부는 반환, profiles 먼저 `FOR UPDATE`)을 이 step의 모든 함수에 그대로 적용한다.

## 배경

대화 1턴은 **예약 RPC → (잠금 밖에서) Claude 호출 → 성공 또는 실패 확정 RPC**이고, 종료는 **시작 RPC → Claude 피드백 → 완료 또는 실패 RPC**다. Claude 호출과 HTTP 상태 코드 변환은 2-api use-case가 한다. 이 step은 DB 쪽 상태 전이, 잠금, 복구만 만든다.

## 작업

### 1. 마이그레이션: `npx supabase migration new chat`

step 0 마이그레이션은 고치지 않는다. 바꿀 helper가 있으면 이 파일에서 `create or replace`한다.

**상수** (SQL에 둔다. 테스트가 lib 상수로 기대값을 만든다)
- 플랜 한도: Free 하루 20턴, Pro 150턴(`PLAN_LIMITS`). Pro는 `pro_until > now()`
- 세션당 최대 20턴, 하루 AI 실패 10회, 작업 기한 90초
- 대체 피드백: `{"message": "대화 기록은 저장됐어요. 종합 피드백을 만들지 못했으니 대화 아래의 교정을 확인해 주세요."}`

**helper `recover_expired_operations(p_user_id uuid) returns void`**
- 이 사용자의 세션 중 `operation_expires_at <= now()`인 것을 복구한다.
  - `active`: 그 토큰(= pending 턴 id)의 pending 행만 지우고 토큰·기한을 비운다.
  - `ending`: `status = 'ended'`, `feedback_status = 'fallback'`, 대체 피드백, `ended_at = now()`, 토큰·기한을 비운다.
  - 둘 다 `chat_failed` 이벤트를 작업당 한 번 기록한다. props: `{ operation_token, kind: 'turn' | 'feedback', reason: 'expired' }`.
- 호출하는 쪽이 profiles를 이미 잠갔다고 가정한다.

**RPC** (모두 profiles 잠금 → `recover_expired_operations` → 세션 `where id = p_session_id and user_id = p_user_id for update` 순서. 세션이 없거나 남의 것이면 `NOT_FOUND`이고 아무것도 바꾸지 않는다)

| 함수 | 동작 |
|---|---|
| `create_chat_session(p_user_id, p_language, p_level, p_scenario_id)` | 세션 잠금은 없다. 준비 상태 ready + `p_language`. 그 언어의 실제 레벨이 `p_level`과 다르면 `CONFLICT`. `active` 세션을 만들고 `session_id`를 돌려준다. 상황이 그 레벨의 것인지는 use-case가 `lib/scenarios`로 검사한다 |
| `begin_chat_turn(p_user_id, p_session_id, p_user_text)` | 준비 상태 ready + 세션 언어. 아래 순서로 검사한 뒤 예약한다 |
| `finish_chat_turn(p_user_id, p_session_id, p_token, p_reply, p_reply_ko, p_correction jsonb)` | `active`이고 토큰이 같을 때만 pending → done, 응답 저장, 토큰 해제, `record_activity`. 아니면 `CONFLICT`. `turns_left`(20 − 세션의 done 턴 수)를 돌려준다 |
| `fail_chat_turn(p_user_id, p_session_id, p_token, p_reason)` | `active`이고 토큰이 같을 때만 pending 삭제, 토큰 해제, `chat_failed` 기록(`kind: 'turn'`, `reason: p_reason`). 아니면 `CONFLICT`이고 이벤트를 남기지 않는다 |
| `begin_end(p_user_id, p_session_id)` | 준비 상태 ready + 세션 언어. 아래 분기 |
| `finish_end(p_user_id, p_session_id, p_token, p_feedback jsonb)` | `ending`이고 토큰이 같을 때만 `ended`·`ready`·피드백·`ended_at`, 토큰 해제. 아니면 `CONFLICT` |
| `fail_end(p_user_id, p_session_id, p_token, p_reason)` | `ending`이고 토큰이 같을 때만 `ended`·`fallback`·대체 피드백·`ended_at`, 토큰 해제, `chat_failed`(`kind: 'feedback'`). 아니면 `CONFLICT` |

`begin_chat_turn` 검사 순서 (spec 2장):
1. `status <> 'active'`이거나 토큰이 있으면 `CONFLICT`
2. 오늘(한국 날짜) `chat_failed`가 10개 이상이면 `AI_FAILURE_LIMIT`
3. 세션의 done 턴이 20개면 `SESSION_FULL`
4. 오늘 계정 전체 턴(pending + done, 모든 언어·세션)이 플랜 한도 이상이면 `limit_reached` 이벤트(`{ feature: 'chat', plan: 'free'|'pro', trial_eligible: trial_started_at is null }`)를 기록하고 `LIMIT_REACHED`. pending은 만들지 않는다
5. `turn_no = 세션의 마지막 done turn_no + 1`로 pending 행을 만들고, 그 행의 id를 `operation_token`, `now() + 90초`를 `operation_expires_at`으로 저장한다
6. 응답: `token`, `turn_no`, 세션의 `language`·`level`·`scenario_id`, `history`(done 턴의 `user_text`·`reply`를 turn_no 순서로. pending 제외)

`finish_chat_turn`에서 이 확정으로 오늘 계정의 done 턴 수가 현재 플랜 한도와 **같아지면** 같은 트랜잭션에서 `limit_reached`(feature `chat`)를 기록한다.

`begin_end` 분기 (spec 2장 "세션 종료 피드백"):
- `ended` → 저장된 `feedback_status`·`feedback`을 그대로 돌려준다(`state: 'ended'`)
- `ending` → `state: 'ending'`. Claude를 다시 부르지 않게 하기 위해서다
- `active`이고 토큰이 있으면(턴 처리 중) → `CONFLICT`
- `active`이고 done 턴 0개 → 바로 `ended`, `feedback_status = 'skipped'`, feedback null(`state: 'ended'`)
- `active`이고 오늘 `chat_failed`가 10개 이상 → 바로 `ended`, `fallback`, 대체 피드백. **`chat_failed`를 새로 기록하지 않는다**(`state: 'ended'`)
- 그 밖에는 `ending`, `feedback_status = 'pending'`, 새 UUID 토큰, `now() + 90초` → `state: 'reserved'`, `token`, 세션 정보, `turns`(done 턴의 `user_text`·`reply`·`correction`, turn_no 순서)

늦게 도착한 결과: 확정·실패 RPC도 먼저 `recover_expired_operations`를 돌리므로, 기한이 지난 토큰은 복구된 뒤 토큰 불일치로 `CONFLICT`가 된다. 늦은 결과가 새 작업이나 확정된 종료 결과를 바꾸거나, 같은 실패를 두 번 기록해서는 안 된다.

### 2. 타입 재생성

`npx supabase db reset` 뒤 Bash로 `npx supabase gen types typescript --local > src/types/database.ts`.

### 3. `src/server/db/chat.ts`

```ts
import 'server-only'
export type ChatSessionInfo = { language: Language; level: Level; scenarioId: string }
export type EndResult =
  | { feedbackStatus: 'ready'; feedback: Feedback }
  | { feedbackStatus: 'fallback'; feedback: { message: string } }
  | { feedbackStatus: 'skipped'; feedback: null }
export type BeginEndResult =
  | { state: 'ended'; result: EndResult }
  | { state: 'ending' }
  | { state: 'reserved'; token: string; session: ChatSessionInfo;
      turns: { userText: string; reply: string; correction: TurnReply['correction'] }[] }

export async function createChatSession(userId: string, input: ChatSessionInfo): Promise<DbResult<{ sessionId: string }>>
export async function beginChatTurn(userId: string, sessionId: string, userText: string):
  Promise<DbResult<{ token: string; turnNo: number; session: ChatSessionInfo; history: { userText: string; reply: string }[] }>>
export async function finishChatTurn(userId: string, sessionId: string, token: string, reply: TurnReply): Promise<DbResult<{ turnsLeft: number }>>
export async function failChatTurn(userId: string, sessionId: string, token: string, reason: AiFailureReason): Promise<DbResult<null>>
export async function beginEnd(userId: string, sessionId: string): Promise<DbResult<BeginEndResult>>
export async function finishEnd(userId: string, sessionId: string, token: string, feedback: Feedback): Promise<DbResult<EndResult>>
export async function failEnd(userId: string, sessionId: string, token: string, reason: AiFailureReason): Promise<DbResult<EndResult>>
```
- step 0의 `rpc.ts`로 RPC를 부른다. `sessionId` 형식(uuid) 검증은 2-api 라우트의 zod가 한다.
- `TurnReply`·`Feedback`은 `@/services/claude/schemas`, `AiFailureReason`은 `@/services/claude/client`에서 type import한다.

### 4. 테스트 (`src/server/db/chat.test.ts`, 먼저 작성)

실제 로컬 DB로 검증한다. 순서는 순차 호출(RPC는 커밋 후 응답한다), 동시 실행은 `Promise.all`, 기한 만료는 admin으로 `operation_expires_at`을 과거로 바꿔 재현한다. 한도·턴 상태를 만들 때는 admin으로 `chat_turns`·`events` 행을 직접 넣어도 된다(어제 날짜 행은 `created_at`을 한국 자정 이전으로). 기대값은 `PLAN_LIMITS` 등 lib 상수로 만든다.

- 정상 흐름: 생성 → 예약 → 확정. `turn_no` 증가, `turns_left`, 토큰 해제, 활동일·연속일 갱신. 다음 예약의 `history`에 done 턴만 순서대로
- 생성: 실제 레벨과 다른 `p_level` → `CONFLICT`. 미동의 → `CONSENT_REQUIRED`
- A가 예약(pending 커밋)한 뒤 확정 전에 B가 같은 세션 예약 → B는 `CONFLICT`, pending은 정확히 1개. **turn_no UNIQUE 위반으로 통과하는 테스트를 만들지 마라**: B가 예외가 아니라 `CONFLICT` 코드를 받는지 확인한다
- 같은 계정의 서로 다른 세션 두 개에서 한도 1회를 남기고 `Promise.all`로 동시 예약 → 하나만 성공, 다른 하나는 `LIMIT_REACHED`, 오늘 턴 수 = 한도
- 한도 거부: pending이 생기지 않고 `limit_reached`가 props와 함께 기록됨. Pro(`pro_until` 미래)는 Pro 한도 적용. 어제(한국 날짜) 턴은 오늘 사용량에 안 셈
- 한도를 채우는 마지막 확정에서 `limit_reached` 기록
- `SESSION_FULL`(done 20개), `AI_FAILURE_LIMIT`(오늘 `chat_failed` 10개)
- 실패 확정: pending 삭제, 예약 반환(같은 turn_no로 다시 예약 가능), `chat_failed` 1개
- 턴 예약과 종료 경합: done 턴이 있는 세션에서 `Promise.all(begin_chat_turn, begin_end)` → 정확히 하나만 예약되고 다른 쪽은 `CONFLICT`. 동시 `begin_end` 2개 → 하나는 `reserved`, 다른 하나는 `ending`
- 종료: 0턴 → skipped. 완료 → ready·피드백 저장, 다시 `begin_end` → 같은 결과. 실패 → fallback·대체 피드백·`chat_failed` 1개. 실패 10회 상태의 종료 → fallback이고 `chat_failed`가 늘지 않음
- 만료 복구:
  - pending 만료 뒤 다음 RPC → pending 삭제, `chat_failed`(reason `expired`) 1개, 새 예약 가능. 옛 토큰으로 늦게 온 `finish_chat_turn`·`fail_chat_turn` → `CONFLICT`, 새 작업과 이벤트 수 그대로
  - ending 만료 뒤 `begin_end` → fallback으로 ended, `chat_failed`(kind `feedback`) 1개. 옛 토큰의 `finish_end` → `CONFLICT`, 결과 그대로 fallback
  - 실패 확정과 복구 동시 실행: 만료된 토큰으로 `Promise.all(fail_chat_turn, 다른 세션의 begin_chat_turn)` → pending 삭제와 `chat_failed`가 정확히 한 번
- 남의 세션: 모든 세션 RPC가 `NOT_FOUND`이고 상태가 바뀌지 않음(service_role로 불러도)
- 권한: 이 step의 모든 함수를 anon·authenticated로 부르면 거부(`security.test.ts`에 추가해도 된다)

## Acceptance Criteria

```bash
npx supabase db reset
npx supabase gen types typescript --local | diff -q - src/types/database.ts   # 생성 타입이 최신
npm run lint
npm run build
npm run test
npm run test:db
! grep -riE "security\s+definer" supabase/migrations
for f in src/server/db/*.ts; do case "$f" in *.test.ts|*/types.ts) ;; *) grep -qE "import ['\"]server-only['\"]" "$f" || { echo "server-only 없음: $f"; exit 1; } ;; esac; done
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR-004(예약 → AI → 확정, 토큰 90초, partial UNIQUE, cron 없음), ADR-005(active → ending → ended, fallback)를 따르는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (모든 세션 조회에 user_id, profiles 먼저 잠금, DB 시각 판정)
3. 결과에 따라 `phases/1-data/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 마이그레이션 파일명, RPC 이름, `chat.ts`의 export, 각 함수가 돌려줄 수 있는 에러 코드를 포함한다(2-api use-case가 그대로 쓴다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (Docker 꺼짐 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- step 0 마이그레이션 파일을 고치지 마라. 이유: 마이그레이션은 추가만 한다는 규칙을 운영 배포 전부터 지킨다. 바꿀 helper는 새 파일에서 `create or replace`한다.
- 예약이나 종료 시작 RPC 안에서 AI 호출을 기다리거나 잠금을 쥔 채 반환하지 마라. 이유: CLAUDE.md CRITICAL. RPC는 짧은 트랜잭션으로 끝난다.
- 정리용 cron이나 pg_cron 작업을 만들지 마라. 이유: spec 2장. 만료 작업은 다음 요청에서 복구한다.
- `unique(session_id, turn_no)` 위반(예외)에 기대어 동시 전송을 막지 마라. 이유: spec 2장. 토큰과 세션 잠금으로 `CONFLICT`를 반환해야 한다.
- 만료·불일치 토큰으로 온 확정·실패 요청이 행을 바꾸거나 `chat_failed`를 추가하게 하지 마라. 이유: 늦은 응답이 새 작업과 실패 횟수를 망친다.
- 대화 내용을 이벤트 props나 로그에 넣지 마라. 이유: 보안 체크리스트 10.
- 테스트에서 실제 Anthropic API를 부르지 마라. 이유: AI 단계는 RPC 사이의 간격으로 대신한다.
- `npx supabase stop`을 하지 마라. 이유: 다음 step이 같은 로컬 DB를 쓴다.
- 기존 테스트를 깨뜨리지 마라
