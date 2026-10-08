# Step 0: explain-db

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/superpowers/plans/2026-10-08-word-explanation.md`: "Global Constraints", "파일 구조", "### Task 1: DB — 테이블·RPC·DB 접근 함수" 전체. **이 step은 Task 1만 한다.** Task 2~5는 읽지 않아도 된다.
- `docs/spec/words.md` "AI 정답 설명"의 "생성과 저장", "한도", "API" 1~5번과 그 아래 두 줄
- `docs/spec/usage.md` "세는 방법"
- `docs/spec/backend.md` "데이터 접근과 보안", "데이터 모델"의 `events`·`word_explanations`
- `docs/spec/metrics.md` "지표 수집"의 `word_explained`·`chat_failed`
- `docs/spec/testing.md` DB 통합 테스트의 "AI 정답 설명" 항목
- 기존 코드:
  - `supabase/migrations/20261006081704_schema.sql`(머리말의 함수 규칙, `events` 테이블의 이름 check, `check_readiness`·`current_plan`·`kst_today_start`)
  - `supabase/migrations/20261006083621_chat.sql`(`chat_failure_limit_reached`, `record_chat_failed`)
  - `supabase/migrations/20261006084708_learning.sql`(RPC가 `profiles`를 잠그고 jsonb `{ ok, code }`를 돌려주는 방식)
  - `src/server/db/rpc.ts`(`callRpc`, `DbResult`), `src/server/db/learning.ts`, `src/server/db/learning.test.ts`, `src/server/db/security.test.ts`, `src/test/fakes.ts`, `src/lib/plan.ts`, `src/services/claude/client.ts`(`AiFailureReason` 타입만)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

AI 정답 설명은 단어 학습 빈칸(채점 뒤)과 오답 복습 카드 뒷면에서 요청하는 짧은 한국어 설명이다. 설명은 (단어, 고른 보기)별로 `word_explanations`에 저장해 모든 사용자가 다시 쓴다. 한도는 Free 하루 10회, Pro 무제한이다. 이 phase는 DB(이 step) → AI·API(step 1) → 화면(step 2) 순서로 만든다.

이 step은 DB만 만든다.
- 마이그레이션: 이벤트 이름 `word_explained`, `word_explanations` 테이블, `word_hash` helper, 예약·실패·저장 RPC
- DB 접근 함수 4개
- 가짜 db 기본값

구현 계획 Task 1에 테스트와 코드가 이미 다 있다. 그대로 따르되, 계획의 코드가 실제 코드(helper 이름, 테스트 파일의 기존 helper 등)와 다르면 실제 코드에 맞추고 아래 핵심 규칙은 지켜라.

## 작업

계획 Task 1의 Step 0~10을 순서대로 한다. Step 11(Commit)은 하지 말고, 커밋은 이 프롬프트의 작업 규칙대로 한다.

1. 로컬 Supabase 확인: `npx supabase status`. 꺼져 있으면 `npx supabase start`(Bash 타임아웃 10분). Docker가 꺼져 있거나 start가 실패하면 blocked로 끝낸다.
2. `src/lib/plan.ts`에 `FREE_DAILY_EXPLANATIONS = 10`을 추가한다.
3. 테스트를 먼저 쓴다: `learning.test.ts`의 "AI 정답 설명" describe, `security.test.ts`의 권한 테스트 2개. 실패하는 것을 확인한다.
4. 마이그레이션 `supabase/migrations/20261008130000_word_explanations.sql`을 쓴다.
5. Bash로 적용하고 타입을 만든다.
   - `npx supabase migration up`
   - `npx supabase gen types typescript --local > src/types/database.ts`
   - `git diff --stat src/types/database.ts`로 새 테이블과 함수 4개만 늘었는지 본다.
6. `src/server/db/learning.ts`에 아래를 추가한다.
   - `ExplainWord`, `getWord`
   - `BeginExplanationResult`, `beginWordExplanation`
   - `failWordExplanation`, `saveWordExplanation`
7. `src/test/fakes.ts`의 `defaultDb()`에 위 4개 함수의 기본 가짜를 추가한다. 빠지면 `Db` 타입 때문에 `next build`가 깨진다.

```ts
export type ExplainWord = { id: string; language: Language; level: Level; meaningKo: string; example: string; exampleKo: string; distractors: string[] }
export function getWord(id: string): Promise<ExplainWord | null>
export type BeginExplanationResult = { state: "cached"; explanation: string } | { state: "reserved"; eventId: number }
export function beginWordExplanation(userId: string, wordId: string, choice: string): Promise<DbResult<BeginExplanationResult>> // 복습은 choice ""
export function failWordExplanation(userId: string, eventId: number, reason: AiFailureReason): Promise<DbResult<null>>
export function saveWordExplanation(wordId: string, choice: string, explanation: string): Promise<DbResult<null>>
```

### 지켜야 할 핵심 규칙

- **RPC 공통**
  - `SECURITY INVOKER`, `set search_path = ''`로 만든다.
  - EXECUTE는 `public`·`anon`·`authenticated`에서 회수하고 `service_role`에만 준다. `word_hash` helper도 마찬가지다.
- **잠금**
  - 예약·실패 RPC는 먼저 `profiles WHERE id = p_user_id FOR UPDATE`를 잡는다.
  - 저장 RPC는 사용자와 무관한 공용 행만 바꾸므로 `p_user_id`를 받지 않고 잠그지 않는다. spec `backend.md` "데이터 모델"이 이 테이블에 `user_id`가 없다고 정했다.
- **예약 RPC 판정 순서**는 spec `words.md` "API" 2번과 같다.
  1. 단어가 없으면 `NOT_FOUND`
  2. `check_readiness(p_user_id, 'ready', 단어 언어)`
  3. Free이고 오늘(`kst_today_start()`) `word_explained`가 10개 이상이면 `LIMIT_REACHED`
  4. 지금 단어의 해시와 같은 저장본이 있으면 `cached`
  5. 저장본이 없고 `chat_failure_limit_reached`이면 `AI_FAILURE_LIMIT`
  6. 그 밖에는 `reserved`
- **한도**
  - 한도는 계정 단위(언어 합산)다.
  - 저장본 응답도 세며, 같은 (단어, 보기)를 다시 요청해도 다시 센다.
  - 한도 거부는 `limit_reached` 이벤트를 남기지 않는다.
- **`word_explained` props**
  - 정확히 `{ language, word_id, kind: "quiz"|"review", cached }`이다.
  - 고른 보기와 설명 내용은 넣지 않는다. `kind`는 choice가 빈 문자열이면 `review`다.
- **실패 RPC**
  - 그 사용자의 그 `word_explained` 행을 지운다.
  - 지운 행이 있을 때만 `chat_failed`(`operation_token: null`, `kind: "explain"`, `reason`)를 남긴다.
  - 두 번 불러도, 남의 id여도 한 번만 반영되거나 아무것도 바뀌지 않는다.
- **저장 RPC**
  - 해시는 그 시점의 단어 행(예문·`example_ko`·뜻)으로 RPC가 계산한다.
  - 같은 키가 있으면 해시가 다를 때만 바꾸고, 같으면 먼저 저장된 설명을 둔다.
- **테이블 권한**
  - `word_explanations`는 RLS를 켜고 정책을 두지 않는다.
  - `anon`·`authenticated`의 테이블 권한도 회수해 서버 RPC로만 읽게 한다.
- **활동일·연속일**: 예약·실패·저장 어느 것도 바꾸지 않는다.
- **`getWord`**: `words`가 공용 카탈로그라 기존 `getWordsByIds`처럼 `user_id` 조건 없이 읽는다.

## Acceptance Criteria

```bash
npx supabase status           # 로컬 Supabase가 떠 있음
npm run test:db               # 새 테스트 포함 DB 통합 테스트 전부 통과
npm run lint
npm run build
npm run test
grep -q "word_explained" supabase/migrations/20261008130000_word_explanations.sql
grep -q "word_explanations" src/types/database.ts
grep -q "FREE_DAILY_EXPLANATIONS = 10" src/lib/plan.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (DB 접근은 `src/server/db/`, 상수는 `src/lib/plan.ts`)
   - ADR-013(설명은 처음 요청 때 만들어 (단어, 보기)별로 저장)을 따르는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (쓰기 RPC의 `profiles` 잠금, 날짜·플랜·한도는 RPC 안의 DB 시각, admin 조회·변경의 `user_id` 범위)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `words.md` "AI 정답 설명"의 "생성과 저장"·"한도"·"API" 2·4·5번, `metrics.md`의 `word_explained`, `backend.md`의 `word_explanations` 권한이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/4-word-explain/step0-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(만든 함수 시그니처, 에러 코드, fakes 기본값). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(Docker 꺼짐, `supabase start` 실패 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `npx supabase db reset`을 실행하지 마라. 이유: 로컬에 seed한 단어 2,000개와 화면 확인용 테스트 계정이 지워진다. 새 마이그레이션은 `npx supabase migration up`으로 적용한다.
- 기존 마이그레이션 파일을 고치지 마라. 이유: 이미 적용된 마이그레이션은 다시 돌지 않아 로컬·운영 DB와 파일이 어긋난다. 이벤트 이름 check는 새 마이그레이션에서 drop 후 다시 만든다.
- PowerShell로 `gen types ... > src/types/database.ts`를 실행하지 마라. 이유: PowerShell의 `>`는 UTF-16으로 저장해 파일이 깨진다. Bash로 실행한다.
- `PLAN_LIMITS`의 모양을 바꾸지 마라. 이유: UsageCard 등이 대화·단어 두 항목만 쓴다. 설명 한도는 별도 상수다.
- Claude 프롬프트·클라이언트, use-case, API 라우트, 화면을 만들지 마라. 이유: step 1·2의 범위다.
- Supabase 쿼리 체인을 mock하는 테스트나 hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md. DB 동작은 `test:db` 통합 테스트로 증명한다.
- 기존 테스트를 깨뜨리지 마라
