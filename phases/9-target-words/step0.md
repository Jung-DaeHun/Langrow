# Step 0: target-data

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md`
  - "배운 단어 써 보기" 절 전체(이 phase의 기준이다)
  - "대화 1턴 처리" 1~6번(예약 RPC → Claude → 확정 RPC의 잠금과 토큰)
- `docs/spec/backend.md` "데이터 모델"(`chat_sessions`·`chat_turns`), "Claude 연동"의 "배운 단어", "데이터 접근과 보안"
- `docs/spec/testing.md`의 "`lib/` 단위 테스트" targetWords 항목, "DB 통합 테스트"의 "배운 단어" 항목
- `docs/ADR.md` ADR-023
- 기존 코드:
  - `supabase/migrations/20261006083621_chat.sql`(`begin_chat_turn`, `kst_today_start`, 권한 부여 방식)
  - `supabase/migrations/20261017100000_breakdown.sql`(지금 `finish_chat_turn`, 인자를 더할 때 drop → create하는 방식)
  - `src/server/db/chat.ts`·`chat.test.ts`, `src/server/db/reads.ts`(`readChatRoom`, `ChatRoomData`)·`reads.test.ts`
  - `src/test/fakes.ts`(가짜 db), `src/lib/breakdown.ts`(lib 파일·주석 모양)

## 배경

대화가 사용자가 배운 단어를 쓰게 유도하는 기능의 데이터 쪽이다(ADR-023). 첫 턴에 예약 RPC가 후보 단어를 주면 AI가 최대 5개를 골라 세션의 목표 단어로 저장하고, 매 턴 사용자가 쓴 목표 단어를 저장한다. 이 step은 순수 규칙(`lib/targetWords`), 마이그레이션, DB 접근 함수, 대화방 읽기를 만든다. 프롬프트·Claude 호출·use-case(step 1)와 화면(step 2)은 하지 않는다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. `src/lib/targetWords.ts` (순수 함수, 새 파일 + `targetWords.test.ts`)

```ts
export type TargetSource = "today" | "recent";
// 예약 RPC가 첫 턴에 주는 후보. usedToday는 오늘 이 계정의 대화에서 이미 쓴 단어인지
export type WordCandidate = { id: string; word: string; reading: string | null; meaningKo: string; usedToday: boolean };
// 세션의 목표 단어와 이 세션에서 썼는지
export type TargetWord = { id: string; word: string; reading: string | null; meaningKo: string; used: boolean };
export const TARGET_WORDS_MAX = 5;
export const TARGET_SOURCE_NAMES: Record<TargetSource, string>; // today: "오늘 단어", recent: "최근 단어"

// AI가 준 번호(1부터)를 ids의 id로 바꾼다. 정수가 아니거나 범위 밖인 번호와 중복은 버리고 AI가 준 순서를 지킨다. 앞에서 5개까지
export function pickTargetIds(candidateIds: readonly string[], numbers: readonly number[]): string[];
// listIds 기준 번호를 id로 바꾸고(같은 버림 규칙) targetIds 안의 것만 남긴다
export function pickUsedIds(listIds: readonly string[], numbers: readonly number[], targetIds: readonly string[]): string[];
```

- 첫 턴은 `listIds`가 후보 id, `targetIds`가 `pickTargetIds` 결과다. 그 뒤 턴은 둘 다 목표 단어 id다.
- 테스트: `docs/spec/testing.md`의 targetWords 항목(번호 → id, 정수가 아닌·0·음수·범위 밖 번호와 중복 버림, 목표 5개까지, 쓴 단어는 목표 안의 것만, 빈 배열은 빈 결과).

### 2. 마이그레이션 `supabase/migrations/20261019200000_target_words.sql`

파일 맨 위에 spec 절과 ADR을 적는 주석을 단다(기존 마이그레이션 모양).

- **컬럼**
  - `chat_sessions.target_word_ids text[]`, `chat_sessions.target_source text`. 제약: `target_source in ('today','recent')`, 둘 다 null이거나 둘 다 값이 있음, 값이 있으면 `cardinality(target_word_ids)`가 1~5.
  - `chat_turns.used_word_ids text[]`.
- **`begin_chat_turn`** (`create or replace`, 시그니처·검사·예약 순서는 그대로). 성공 응답 jsonb에 키 3개를 더한다:
  - `candidates`: 이번 턴이 세션의 첫 턴(성공한 턴 0개)이고 `v_session.target_word_ids is null`이면 배열, 아니면 `null`. 원소는 `{ id, word, reading, meaning_ko, used_today }`.
    - 이 사용자의 `user_words`와 `words`를 이어, `words.language = 세션 언어`이고 `first_seen_at >= public.kst_today_start()`인 단어(출처 `today`). 하나도 없으면 `first_seen_at >= public.kst_today_start() - interval '6 days'`인 단어(출처 `recent`). 그것도 없으면 빈 배열이고 출처는 `null`.
    - `used_today`: 이 사용자의 `done` 턴 중 `created_at >= public.kst_today_start()`인 턴들의 `used_word_ids`에 그 id가 있는지(모든 세션).
    - 순서: `used_today`가 거짓인 것 먼저, 그 안에서 `first_seen_at` 내림차순, 같으면 `words.id` 오름차순. 앞에서 20개.
    - 단어의 레벨과 `user_words.status`는 따지지 않는다.
  - `candidate_source`: `'today'`·`'recent'`·`null`.
  - `targets`: `v_session.target_word_ids`가 있으면 그 순서대로 `{ id, word, reading, meaning_ko, used }` 배열, 없으면 `null`. `used`는 이 세션의 `done` 턴들의 `used_word_ids`에 그 id가 있는지다.
  - 날짜는 반드시 `public.kst_today_start()`(DB 시각)로 정한다.
- **`finish_chat_turn`**: 지금 함수를 `drop`하고 끝에 `p_target_word_ids text[] default null, p_target_source text default null, p_used_word_ids text[] default null`을 더해 다시 만든다. 잠금 순서, 토큰·기한 검사, 활동일·`limit_reached` 기록, `turns_left`는 그대로다.
  - pending → done으로 바꿀 때 그 턴의 `turn_no`도 받는다.
  - 세션에 목표 단어가 없고, 이 턴이 `turn_no = 1`이고, `p_target_word_ids`가 null이 아니면 목표 단어를 저장한다.
    - 저장할 id는 받은 순서를 지키고 중복을 뺀다. 이 사용자의 `user_words`에 있으면서 `words.language = 세션 언어`인 것만 남기고, 앞에서 5개까지만 둔다.
    - 남은 것이 있고 `p_target_source`가 `today`·`recent`이면 `target_word_ids`·`target_source`를 저장한다. 그 밖에는 저장하지 않는다.
  - 세션에 목표 단어가 이미 있으면 바꾸지 않는다.
  - 쓴 단어: (이번에 저장한 것을 포함한) 세션 목표 단어가 있으면, `p_used_word_ids` 중 목표 단어 안의 것만 중복 없이 이 턴의 `used_word_ids`에 저장한다. 없으면 빈 배열이다. 세션에 목표 단어가 없으면 `null`로 둔다.
  - 성공 응답에 `target_words`(위 `targets`와 같은 모양으로, 이번 턴까지의 `used`. 목표 단어가 없으면 `null`)와 `target_source`를 더한다.
  - 새 시그니처에 맞춰 `revoke … from public, anon, authenticated` / `grant … to service_role`을 다시 한다.
- `begin_chat_turn`도 같은 권한을 다시 적는다(바뀌지 않아도 된다).
- 적용은 **Bash로** `npx supabase migration up`, 타입은 **Bash로** `npx supabase gen types typescript --local > src/types/database.ts`로 만든다. `src/types/database.ts`를 손으로 고치지 않는다.

### 3. `src/server/db/chat.ts`

```ts
beginChatTurn(userId, sessionId, userText): Promise<DbResult<{
  token; turnNo; session; history;          // 그대로
  candidates: WordCandidate[] | null;       // 첫 턴이고 목표 단어가 없을 때만 배열(빈 배열 가능)
  candidateSource: TargetSource | null;
  targets: TargetWord[] | null;
}>>
finishChatTurn(userId, sessionId, token, reply: TurnReply,
  words?: { targetWordIds?: string[]; targetSource?: TargetSource; usedWordIds?: string[] },
): Promise<DbResult<{ turnsLeft: number; targetWords: TargetWord[] | null; targetSource: TargetSource | null }>>
```

- RPC의 snake_case를 위 camelCase로 바꾼다(`meaning_ko` → `meaningKo`, `used_today` → `usedToday`).
- `words`가 없거나 값이 `undefined`인 키는 인자를 빼서 기본값 null로 둔다(지금 `p_reply_pron_ko` 처리와 같다).
- 이 step에서는 use-case(`src/server/chat.ts`)가 새 값을 쓰지 않는다. 지금 호출(`finishChatTurn(userId, sessionId, token, generated.value)`)이 그대로 컴파일되게 둔다.

### 4. `src/server/db/reads.ts` — `readChatRoom`

- `ChatRoomData`에 `targetWords: TargetWord[] | null`(목표 단어 순서)과 `targetSource: TargetSource | null`을 더한다.
- 세션의 `target_word_ids`·`target_source`와 턴의 `used_word_ids`를 함께 읽는다. 단어 내용은 `words`에서 `id`로 읽고(로그인 사용자 읽기 정책), `used`는 `done` 턴들의 `used_word_ids` 합집합이다. pending 턴은 세지 않는다.
- 목표 단어가 없으면 단어를 읽는 쿼리를 하지 않는다.

### 5. 가짜 db와 기존 테스트

- `src/test/fakes.ts`의 `beginChatTurn`은 `candidates: null, candidateSource: null, targets: null`, `finishChatTurn`은 `targetWords: null, targetSource: null`을 더해 돌려준다. 기존 use-case 테스트 의도는 바꾸지 않는다.

### 6. DB 통합 테스트 (`src/server/db/chat.test.ts`, `reads.test.ts`)

`docs/spec/testing.md` "DB 통합 테스트"의 "배운 단어" 항목을 모두 쓴다.
- `begin_chat_turn`: 첫 턴에만 후보(세션 언어로 오늘 배운 이 사용자의 단어만, 다른 언어·다른 사용자 단어 없음, 출처 `today`), 오늘 없으면 7일 안(한국 날짜로 6일 전은 포함·7일 전은 제외, 출처 `recent`), 그것도 없으면 빈 배열, 오늘 대화에서 쓴 단어(다른 세션 포함)는 뒤로 가고 `used_today`가 참, 20개까지, 목표 단어가 있는 세션과 두 번째 턴부터는 `candidates`가 `null`, 목표 단어가 있으면 `targets`와 `used`.
- `finish_chat_turn`: 첫 턴에만 목표 단어 저장·이미 있으면 바꾸지 않음, 이 사용자의 `user_words`에 없거나 다른 언어인 단어는 버림(모두 버려지면 목표 단어 없음), 쓴 단어는 목표 단어 안의 것만, 응답의 `target_words`·`target_source`, 새 인자를 빼고 불러도 기존처럼 동작.
- 첫 턴이 실패(`fail_chat_turn`)한 뒤 다시 예약하면 후보를 다시 준다.
- `readChatRoom`: 목표 단어 순서·출처·쓴 여부(`done` 턴의 합집합), 목표 단어가 없으면 `null`.
- `first_seen_at`·턴 `created_at` 같은 시각은 테스트에서 admin 클라이언트로 바꿔 재현한다. 한국 날짜 경계는 DB의 `kst_today_start()` 기준으로 계산한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run test:db
test -f supabase/migrations/20261019200000_target_words.sql
grep -q "used_word_ids" src/types/database.ts
grep -q "target_word_ids" src/types/database.ts
test -z "$(git status --porcelain data/ public/)"   # 단어 데이터·음성을 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`lib`는 순수 함수, DB 접근은 `server/db`, 판정은 RPC 안)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (admin 클라이언트 조회·변경에 `user_id`, 날짜는 RPC 안의 DB 시각, 쓰기 RPC는 `profiles` 잠금부터)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "배운 단어 써 보기"의 "후보 단어", "고르기"의 저장·실패·목표 단어 없음 문장, "검사", "저장", "응답"(대화방 읽기 부분), `backend.md` "데이터 모델"과 "Claude 연동"의 "배운 단어" 중 RPC 부분이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/9-target-words/step0-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(lib 함수·타입, RPC가 돌려주는 키, db 함수 시그니처, ChatRoomData 필드). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (로컬 Supabase가 꺼져 있는 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db reset`을 하지 마라. 이유: 로컬 단어 2,000개와 테스트 계정이 지워진다. 마이그레이션은 `npx supabase migration up`으로만 적용한다.
- 옛 `finish_chat_turn`을 남겨 두거나 같은 이름으로 오버로드를 하나 더 만들지 마라. 이유: 두 시그니처가 있으면 PostgREST가 이름 있는 인자 호출을 어느 쪽으로 보낼지 모호해지고, 권한도 두 벌 관리해야 한다.
- 새 인자에 기본값 없이 만들거나 `begin_chat_turn`의 시그니처를 바꾸지 마라. 이유: 운영 DB에 마이그레이션을 먼저 적용하고 코드는 나중에 배포한다. 지금 운영 코드가 새 함수로도 그대로 동작해야 한다.
- 세션 생성 시각으로 후보를 막는 조건을 넣지 마라. 이유: spec은 기능 전에 만들었어도 턴이 없는 세션은 첫 턴에 고른다고 정했다.
- 클라이언트나 앱 코드가 계산한 날짜를 RPC에 넘기지 마라. 이유: CLAUDE.md CRITICAL(날짜는 RPC 안의 DB 시각).
- 프롬프트·zod 스키마·`client.ts`·use-case(`src/server/chat.ts`)·`src/types/api.ts`·화면을 고치지 마라. 이유: step 1·2의 범위다. 이 step의 새 값은 아직 아무도 쓰지 않아도 된다.
- Anthropic API 같은 외부 API를 부르지 마라. 이유: 유료 호출이고 step 안에서 하지 않는 규칙이다.
- `data/words/*.json`을 고치거나 `npm run seed:words`·`words:*`를 실행하지 마라. 이유: 이 phase는 단어 데이터를 바꾸지 않는다.
- hook 통과용 빈 테스트나 Supabase 쿼리 체인 mock 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
