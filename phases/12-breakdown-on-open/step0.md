# Step 0: breakdown-data

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md`
  - "문장 뜯어보기" 절 전체와 그 아래 "처음 열 때 만들기"(이 phase의 기준이다)
  - "대화 1턴 처리"·"처리 중단 복구"(작업 기한 90초, 잠금 순서의 이유)
- `docs/spec/backend.md` "데이터 접근과 보안"(문장 뜯어보기 항목, RPC 실행 권한), "데이터 모델"의 `chat_turns`
- `docs/spec/testing.md` "DB 통합 테스트"의 "문장 뜯어보기" 항목
- `docs/ADR.md` ADR-027
- 기존 코드:
  - `supabase/migrations/20261008130000_word_explanations.sql`(가장 가까운 선례: 예약·실패·저장 RPC, `check_readiness`, `chat_failure_limit_reached`, `record_chat_failed`, 권한 부여, 머리 주석 모양)
  - `supabase/migrations/20261017100000_breakdown.sql`(`reply_breakdown` 열과 `correction` jsonb 안의 `breakdown`)
  - `supabase/migrations/20261006083621_chat.sql`(`kst_today_start`, `record_chat_failed`, 대화 RPC의 잠금 순서)
  - `src/server/db/chat.ts`·`chat.test.ts`, `src/server/db/learning.ts`(`beginWordExplanation` 등 RPC 결과를 camelCase로 바꾸는 모양), `src/server/db/rpc.ts`, `src/server/db/types.ts`
  - `src/lib/breakdown.ts`(`Breakdown` 타입), `src/test/fakes.ts`(가짜 db)

## 배경

문장 뜯어보기를 턴마다 만들지 않고, 사용자가 그 문장을 처음 열 때 그 문장 하나만 만들어 저장하도록 바꾼다(ADR-027). 같은 문장을 동시에 요청하면 "만드는 중" 표시(90초 기한)로 하나만 AI를 부른다. 이 step은 데이터 쪽만 만든다. 마이그레이션(열·RPC 3개), DB 접근 함수, 가짜 db, DB 통합 테스트가 범위다. 프롬프트·Claude 호출(step 1), use-case·라우트(step 2), 화면(step 3)은 하지 않는다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. `src/lib/breakdown.ts`에 타입 하나

```ts
// 뜯어보기를 만드는 문장. reply는 AI 말풍선, corrected는 교정 문장이다 (spec/chat.md "처음 열 때 만들기")
export type BreakdownTarget = "reply" | "corrected";
export const BREAKDOWN_TARGETS: readonly BreakdownTarget[] = ["reply", "corrected"];
```

### 2. 마이그레이션 `supabase/migrations/20261020100000_breakdown_on_open.sql`

파일 맨 위에 spec 절(`chat.md` "처음 열 때 만들기")과 ADR-027을 적는 주석을 단다(기존 마이그레이션 모양).

- **열**: `chat_turns.reply_breakdown_until timestamptz`, `chat_turns.corrected_breakdown_until timestamptz`(둘 다 nullable, 기본값 없음). 그 문장의 뜯어보기를 만드는 중인 기한이다. 지난 기한은 없는 것으로 본다.
- **`begin_turn_breakdown(p_user_id uuid, p_session_id uuid, p_turn_no int, p_target text) returns jsonb`**. 아래 순서를 지킨다.
  1. `profiles WHERE id = p_user_id FOR UPDATE`로 잠근다.
  2. `p_target`이 `reply`·`corrected`가 아니면 `INVALID_INPUT`.
  3. 세션을 `id = p_session_id and user_id = p_user_id`로 찾는다. 없으면 `NOT_FOUND`.
  4. `public.check_readiness(p_user_id, 'ready', 세션 언어)`가 코드를 주면 그 코드(`CONSENT_REQUIRED`·`ONBOARDING_REQUIRED`).
  5. 턴을 `session_id = p_session_id and user_id = p_user_id and turn_no = p_turn_no and status = 'done'`으로 찾아 `FOR UPDATE`로 잠근다. 없으면 `NOT_FOUND`. `corrected`인데 `correction`이 null이면 `NOT_FOUND`.
  6. 저장본이 있으면 `{ ok: true, state: 'stored', breakdown }`. 저장본은 `reply`이면 `reply_breakdown`이 SQL null도 jsonb `null`도 아닌 것, `corrected`이면 `correction ? 'breakdown'`이고 그 값이 jsonb `null`이 아닌 것이다. 이 판정은 실패 한도·만드는 중보다 먼저 한다(저장본은 실패 10회·만드는 중이어도 돌려준다).
  7. `public.chat_failure_limit_reached(p_user_id)`이면 `AI_FAILURE_LIMIT`.
  8. 그 문장의 기한 열(`reply_breakdown_until` 또는 `corrected_breakdown_until`)이 `now()`보다 뒤면 `CONFLICT`.
  9. 그 기한 열을 `now() + interval '90 seconds'`로 저장하고 `{ ok: true, state: 'started', sentence, language, level, until }`을 돌려준다. `sentence`는 `reply` 또는 `correction->>'corrected'`(후리가나 표기 그대로), `language`·`level`은 세션의 값, `until`은 저장한 기한이다.
- **`fail_turn_breakdown(p_user_id uuid, p_session_id uuid, p_turn_no int, p_target text, p_until timestamptz, p_reason text) returns jsonb`**
  - `profiles` 잠금 → 이 사용자의 그 턴(`user_id`·`session_id`·`turn_no`)에서 그 문장의 기한 열이 `p_until`과 같을 때만 null로 바꾼다 → 바꾼 행이 있을 때만 `public.record_chat_failed(p_user_id, null, 'breakdown', p_reason)`. 항상 `{ ok: true }`.
  - 두 번 불러도, 다른 기한 값이거나 남의 턴이어도 아무것도 바꾸지 않고 성공한다.
- **`save_turn_breakdown(p_user_id uuid, p_session_id uuid, p_turn_no int, p_target text, p_until timestamptz, p_breakdown jsonb) returns jsonb`**
  - `profiles` 잠금 → 이 사용자의 그 `done` 턴을 찾는다(없으면 `NOT_FOUND`, `corrected`인데 교정이 없으면 `NOT_FOUND`).
  - 값이 아직 없을 때만 저장한다. `reply`이면 `reply_breakdown = p_breakdown`이다. `corrected`이면 `correction`에 `breakdown` 키를 더한다(`jsonb_set` 또는 `||`). `correction`의 다른 키는 바꾸지 않는다. "값이 있음"의 판정은 begin 6과 같다.
  - 그 문장의 기한 열이 `p_until`과 같으면 null로 바꾼다. 다른 값이면 그대로 둔다.
  - `{ ok: true, breakdown: 저장된 값 }`을 돌려준다(먼저 저장된 것이 있으면 그것).
- 세 함수 모두 `language plpgsql security invoker set search_path = ''`, `revoke execute … from public, anon, authenticated` / `grant execute … to service_role`.
- `finish_chat_turn`·`begin_chat_turn`·`reply_breakdown` 열은 바꾸지 않는다.
- 적용은 **Bash로** `npx supabase migration up`, 타입은 **Bash로** `npx supabase gen types typescript --local > src/types/database.ts`로 만든다. `src/types/database.ts`를 손으로 고치지 않는다.

### 3. `src/server/db/chat.ts`

```ts
export type BeginBreakdownResult =
  | { state: "stored"; breakdown: Breakdown }
  | { state: "started"; sentence: string; language: Language; level: Level; until: string };

// NOT_FOUND·CONSENT_REQUIRED·ONBOARDING_REQUIRED·AI_FAILURE_LIMIT·CONFLICT(만드는 중)·INVALID_INPUT
export function beginTurnBreakdown(userId: string, sessionId: string, turnNo: number, target: BreakdownTarget): Promise<DbResult<BeginBreakdownResult>>;
// 기한이 until일 때만 지우고 chat_failed(kind breakdown)를 남긴다. 아니면 아무것도 바꾸지 않고 성공한다
export function failTurnBreakdown(userId: string, sessionId: string, turnNo: number, target: BreakdownTarget, until: string, reason: AiFailureReason): Promise<DbResult<null>>;
// 값이 없을 때만 저장하고, 저장된 값(먼저 저장된 것 포함)을 돌려준다. NOT_FOUND
export function saveTurnBreakdown(userId: string, sessionId: string, turnNo: number, target: BreakdownTarget, until: string, breakdown: Breakdown): Promise<DbResult<{ breakdown: Breakdown }>>;
```

- `until`은 begin이 돌려준 문자열을 그대로 넘긴다. 다시 만들거나 형식을 바꾸지 마라(기한 값이 같아야 지운다).
- 기존 함수(`finishChatTurn` 포함)는 이 step에서 바꾸지 않는다.

### 4. 가짜 db (`src/test/fakes.ts`)

`defaultDb()`에 세 함수의 기본값을 더한다. `beginTurnBreakdown`은 `started`(짧은 영어 문장, `en`, 레벨 1, 아무 ISO 시각), `failTurnBreakdown`은 `{ ok: true, value: null }`, `saveTurnBreakdown`은 받은 `breakdown`을 그대로 돌려준다. 기존 use-case 테스트 의도는 바꾸지 않는다.

### 5. DB 통합 테스트 (`src/server/db/chat.test.ts`)

`docs/spec/testing.md` "DB 통합 테스트"의 "문장 뜯어보기" 중 "처음 열 때 만들기(ADR-027)" 문장을 모두 테스트로 쓴다:
- 시작 RPC
  - 저장본이면 돌려준다. 실패 10회·만드는 중이어도 돌려준다.
  - 저장본이 없으면 문장(표기 그대로)·언어·레벨·기한 값을 돌려주고 기한을 저장한다.
  - not found: 남의 세션, 없는 턴, `pending` 턴, 교정 없는 `corrected`.
  - 오늘 `chat_failed`가 10개면 실패 한도. `ended` 세션의 턴도 된다. 미동의·세션 언어 레벨 없음은 거부된다.
  - 같은 문장으로 동시에 시작한 2개(`Promise.all`)는 하나만 `started`이고 다른 하나는 `CONFLICT`다. 말풍선과 교정 문장은 서로 막지 않는다.
  - 기한이 지나면 다시 시작된다. 기한 열을 admin 클라이언트로 과거로 바꿔 재현한다.
- 저장 RPC
  - 값이 없을 때만 저장하고 저장된 값을 돌려준다. 두 번 불러도 처음 값이다.
  - 그 작업의 기한만 지우고, 기한 값이 다르면 그대로 둔다.
  - 교정은 `correction`의 다른 키(`corrected`·`explanation_ko`·`corrected_pron_ko`)를 바꾸지 않는다.
  - 남의 턴은 바꾸지 않는다.
- 실패 RPC
  - 기한이 그 값일 때만 지우고 그때만 `chat_failed`(`kind: breakdown`)를 남긴다. 두 번 호출하거나 기한 값이 다르면 아무것도 바꾸지 않는다.
  - 뜯어보기 실패도 대화의 실패 10회 차단에 들어간다(이어서 `begin_chat_turn`이 `AI_FAILURE_LIMIT`).
- anon/authenticated는 세 함수를 호출할 수 없다(기존 권한 테스트 모양을 따른다).

`done` 턴은 기존 테스트 helper처럼 `begin_chat_turn` → `finish_chat_turn`으로 만든다. `reply_breakdown`이 없는 턴은 `p_reply_breakdown`을 빼고 확정하면 된다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run test:db
test -f supabase/migrations/20261020100000_breakdown_on_open.sql
grep -q "reply_breakdown_until" src/types/database.ts
grep -q "begin_turn_breakdown" src/types/database.ts
grep -q "save_turn_breakdown" src/types/database.ts
grep -q "fail_turn_breakdown" src/types/database.ts
test -z "$(git status --porcelain data/ public/)"   # 단어 데이터·음성을 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`lib`는 순수 타입·함수, DB 접근은 `server/db`, 판정은 RPC 안)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (모든 조회·변경에 `user_id`, 쓰기 RPC는 `profiles` 잠금부터, 날짜·기한은 RPC 안의 DB 시각)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "처음 열 때 만들기"의 1·3·4번 중 RPC 부분과 그 아래 기한·한도 문장, "저장"이다. 그리고 `backend.md` "데이터 접근과 보안"의 문장 뜯어보기 항목과 "데이터 모델"의 `chat_turns`도 대조한다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/12-breakdown-on-open/step0-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(RPC 3개가 돌려주는 키·코드, db 함수 시그니처, `BreakdownTarget`, 가짜 db 기본값). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (로컬 Supabase가 꺼져 있는 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db reset`을 하지 마라. 이유: 로컬 단어 2,000개와 테스트 계정이 지워진다. 마이그레이션은 `npx supabase migration up`으로만 적용한다.
- `finish_chat_turn`을 다시 만들거나 `p_reply_breakdown` 인자를 지우지 마라. 이유: 운영 DB에 마이그레이션을 먼저 적용하고 코드는 나중에 배포한다. 지금 운영 코드가 그 인자로 부른다(`backend.md` "Claude 연동").
- 새 열에 NOT NULL·기본값을 두거나, 기존 열·제약을 바꾸지 마라. 이유: 지금 운영 코드와 함께 돌아가야 한다.
- 기한을 앱 코드에서 계산해 RPC에 넘기지 마라. 이유: CLAUDE.md CRITICAL(기한은 RPC 안의 DB 시각). 앱은 begin이 준 값을 되돌려줄 뿐이다.
- 시작 RPC를 잠금 없는 읽기로 만들지 마라. 이유: 같은 문장 동시 요청을 하나만 통과시키는 것이 이 설계의 핵심이다(ADR-027, 설계 검토에서 나온 문제).
- 이벤트(`events`)에 새 이름을 더하지 마라. 이유: spec은 뜯어보기에 이벤트를 남기지 않는다. 실패는 기존 `chat_failed`(`kind: breakdown`)다.
- 프롬프트·zod 스키마·`client.ts`·use-case(`src/server/chat.ts`)·라우트·`src/types/api.ts`·화면을 고치지 마라. 이유: step 1~3의 범위다. 이 step의 새 함수는 아직 아무도 쓰지 않아도 된다.
- Anthropic API 같은 외부 API를 부르지 마라. 이유: 유료 호출이고 step 안에서 하지 않는 규칙이다.
- hook 통과용 빈 테스트나 Supabase 쿼리 체인 mock 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
