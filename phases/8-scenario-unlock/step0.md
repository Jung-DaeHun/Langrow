# Step 0: unlock-rules

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/ADR.md` ADR-019
- `docs/spec/chat.md` "상황 목록"(앞 세 항목), "대화 진행" 1번
- `docs/spec/usage.md` 플랜 표와 "Pro 상황"
- `docs/spec/backend.md`
  - "데이터 접근과 보안"의 "첫 레벨"·"대화 세션 생성" 항목, 보안 체크리스트 2번·14번
  - "API" 표의 `/api/levels`·`/api/chat/sessions` 행
  - "에러 코드" 표(`PRO_REQUIRED`, `INVALID_INPUT`, `ONBOARDING_REQUIRED`)
- `docs/spec/metrics.md` "수요 검증 기준" 표의 "한도 도달 전 체험 시작" 행과 그 아래 설명
- `docs/spec/testing.md` "`lib/` 단위 테스트"의 scenarios·metrics, "use-case"의 세션 생성, "DB 통합 테스트"의 Pro 상황, "route / 페이지 접근"의 `/api/levels`
- 기존 코드
  - `src/lib/scenarios.ts`(+ test). 상황 35개는 이미 들어 있다(레벨마다 기존 4개 뒤에 새 3개, 검수 완료)
  - `src/lib/errors.ts`(+ test), `src/server/db/types.ts`(`DbErrorCode`), `src/server/db/rpc.ts`
  - `src/server/db/chat.ts`(`createChatSession`), `src/server/chat.ts`(`startChatSession`), `src/server/deps.ts`, `src/test/fakes.ts`
  - `src/app/api/chat/sessions/route.ts`, `src/app/api/levels/route.ts`(+ 각 test)
  - `supabase/migrations/20261006083621_chat.sql`(`create_chat_session`, `current_plan`, 권한 줄)
  - `src/server/db/chat.test.ts`("createChatSession"과 대화·종료 테스트의 도우미), `src/server/db/security.test.ts`
  - `src/lib/metrics.ts`(+ test)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

상황을 레벨당 7개로 늘렸다(ADR-019). 이 step은 판정 규칙, DB, API를 바꾼다.
- 지금 레벨 이하의 상황만 열린다.
- Free는 레벨마다 앞 3개만 새 세션을 만들 수 있다.
- 첫 레벨은 늘 입문(1)이다.

화면(상황 목록, 온보딩)은 step 1·2가 바꾼다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. `src/lib/scenarios.ts`

```ts
export const SCENARIOS_PER_LEVEL = 7;
export const FREE_SCENARIOS_PER_LEVEL = 3;
export function isProScenario(scenario: Scenario): boolean;                 // 그 레벨 목록에서 4번째(순번 4) 이후면 true
export function isScenarioLocked(scenario: Scenario, currentLevel: Level): boolean; // scenario.level > currentLevel
```

- Pro 판정은 `SCENARIOS`의 레벨 안 순서로 정한다. 상황 데이터에 `pro` 같은 필드를 따로 두지 않는다.
  - 이유: spec이 "앞 3개(지금 순서)"로 정했다. 같은 사실을 두 곳에 두면 어긋난다.
- 화면이 쓸 수 있게 레벨 안 순번(1~7)을 구하는 함수가 필요하면 함께 만든다. 이름은 재량이다.
- 테스트: 레벨마다 앞 3개만 Free이고 4~7번째는 Pro다. 잠금은 `scenario.level > currentLevel`일 때만 참이다(같은 레벨·아래 레벨은 열림).
- 기존 상황 데이터(제목·첫 마디·뜯어보기 등)는 고치지 않는다.

### 2. 에러 코드

- `src/lib/errors.ts`
  - `PRO_REQUIRED`를 더한다: 403, 문구 "Pro 상황은 7일 무료 체험이나 Pro에서 할 수 있어요."
  - `ONBOARDING_REQUIRED` 문구를 "학습할 언어를 먼저 골라 주세요."로 바꾼다. 레벨 선택 단계가 없어지기 때문이다.
- `src/server/db/types.ts`: `DbErrorCode`에 `PRO_REQUIRED`를 더한다. 그래야 RPC가 돌려준 코드를 `callRpc`가 받아들인다.
- `apiClient`는 고치지 않는다. 403 이동은 code(`CONSENT_REQUIRED`·`ONBOARDING_REQUIRED`)로만 하므로 `PRO_REQUIRED`는 이동하지 않는다.

### 3. DB: 마이그레이션 `supabase/migrations/20261018100000_pro_scenarios.sql`

```sql
drop function public.create_chat_session(uuid, text, int, text);
-- 마지막에 p_pro_only boolean default false를 더해 다시 만든다
```

- 본문은 `20261006083621_chat.sql`의 `create_chat_session`과 같다. 순서도 그대로다.
  1. `profiles` 잠금
  2. 만료 작업 복구
  3. 준비 상태(`check_readiness`)
  4. 요청 레벨이 실제 레벨인지 확인(아니면 `CONFLICT`)
- 그 **뒤에** `p_pro_only`이고 `public.current_plan(p_user_id) <> 'pro'`이면 세션을 만들지 않고 `{ ok: false, code: 'PRO_REQUIRED' }`를 돌려준다.
  - 플랜은 잠금 뒤 DB 시각으로 판정한다(`current_plan`이 `pro_until > now()`).
- `p_pro_only`는 **마지막 인자이고 `default false`**다.
  - 지금 운영 코드는 인자 4개로 부른다. 마이그레이션을 먼저 적용해도 깨지지 않아야 한다.
  - `security.test.ts`의 권한 검사 호출도 그대로 맞는다.
- 권한은 새 시그니처 `(uuid, text, int, text, boolean)`로 다시 건다.
  - `revoke … from public, anon, authenticated`
  - `grant … to service_role`
- `PRO_REQUIRED` 거부는 `limit_reached`나 다른 이벤트를 남기지 않는다.
- 마이그레이션은 **Bash로** `npx supabase migration up`으로 적용한다.
- 타입은 **Bash로** `npx supabase gen types typescript --local > src/types/database.ts`로 만든다. `src/types/database.ts`를 손으로 고치지 않는다.

### 4. 저장·use-case·라우트

```ts
// src/server/db/chat.ts
export async function createChatSession(userId: string, input: ChatSessionInfo, proOnly: boolean): Promise<DbResult<{ sessionId: string }>>
// src/server/chat.ts — 시그니처 그대로
export async function startChatSession(deps: Deps, userId: string, input: { language: Language; level: Level; scenarioId: string }): Promise<Outcome<ChatSessionCreated>>
```

- **`createChatSession`**: `p_pro_only: proOnly`로 넘긴다. 함수 위 주석(돌려줄 수 있는 코드)에 `PRO_REQUIRED`를 더한다.
- **`startChatSession`**
  - 상황이 없거나 `isScenarioLocked(scenario, input.level)`이면 `INVALID_INPUT`이다. 이때 DB를 부르지 않는다.
  - 그 밖에는 `deps.db.createChatSession(userId, input, isProScenario(scenario))`를 부른다.
  - 세션 레벨은 상황 레벨이 아니라 요청 레벨(지금 레벨)이다. `input.level`을 그대로 넘긴다.
  - 같은 레벨이든 아래 레벨이든 상황이면 허용한다.
  - 주석의 "다른 레벨의 상황은 400"을 "위 레벨의 상황은 400"으로 고친다.
- **`src/test/fakes.ts`**: 바뀐 시그니처에 맞춘다.
- **`/api/levels`**: body는 `z.object({ language: z.enum(LANGUAGES) })`이고, 핸들러는 `setFirstLevel(userId, body.language, 1)`을 부른다.
  - `.strict()`를 쓰지 마라. step 2 전까지 온보딩 화면이 `level`을 함께 보낸다. zod 기본 동작(모르는 키 버림)으로 그 요청도 받아야 한다.
  - `set_first_level` RPC와 `setFirstLevel`의 레벨 인자는 그대로 둔다.
  - 라우트 위 주석에 "첫 레벨은 늘 입문(1)이다(ADR-019)"를 적는다.
- **`/api/chat/sessions` 라우트**: 고칠 것이 없다. 위 주석만 맞으면 된다.

### 5. 지표: `src/lib/metrics.ts`

- `reference("trial_before_limit", "한도 도달 전 체험 시작", count)`를 결과에 더한다. 기존 `pro_after_trial` 뒤에 둔다.
- **분모**: 다른 지표와 같은 대상(모집 기간 안의 온보딩 완료 사용자, 제외 계정 뺌) 중 `trialStartedAt`이 있는 사용자
- **분자**: 그중 `trialStartedAt`보다 앞선 `limit_reached` 이벤트가 하나도 없는 사용자
  - 체험 시작 뒤의 `limit_reached`는 세지 않는다.
  - `plan`·`feature`·`trial_eligible`은 보지 않는다.
- `scripts/metrics-report.ts`는 결과를 모두 출력하므로 고칠 필요가 없다.
  - 출력 테스트가 지표 줄 수를 고정하고 있으면 새 줄에 맞춘다.

### 6. 테스트

`docs/spec/testing.md`의 해당 항목을 따른다.

- **lib**
  - scenarios: Pro 판정, 잠금 판정
  - errors: `PRO_REQUIRED` 403
  - metrics: 체험 전 `limit_reached`가 있으면 분자에서 빠짐, 체험 뒤 것은 무시, 체험 안 한 사용자는 분모에 없음
- **use-case**(`src/server/chat.test.ts`, 가짜 db)
  - 위 레벨 상황은 `INVALID_INPUT`이고 `createChatSession`을 부르지 않는다.
  - 아래 레벨 상황은 요청 레벨을 그대로 넘긴다.
  - 4~7번째 상황이면 `proOnly`가 true, 1~3번째면 false다.
  - `PRO_REQUIRED`를 그대로 돌려준다.
- **route**
  - `/api/levels`: body에 `level: 3`이 있어도 `setFirstLevel`이 레벨 1로 불린다.
  - `level` 없이 `language`만 보내도 200이다.
- **DB 통합**(`src/server/db/chat.test.ts`의 "createChatSession")
  - Free(체험 안 함)가 `proOnly: true`면 `PRO_REQUIRED`이고 세션이 없다.
  - 체험 중(`pro_until` 미래)이면 Pro 상황 세션이 만들어진다.
  - 체험 중 만든 Pro 상황 세션은 `pro_until`을 과거로 바꾼 뒤에도 턴 예약(`beginChatTurn`)과 종료(`beginEnd`)가 된다.
  - `p_pro_only`를 빼고 `callRpc`로 불러도 기존처럼 세션이 만들어진다.
  - 요청 레벨이 실제 레벨과 다르면 `proOnly`와 상관없이 `CONFLICT`다.
  - 기존 테스트의 `createChatSession(user.id, SESSION)` 호출은 새 인자(`false`)를 더해 고친다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run test:db
test -f supabase/migrations/20261018100000_pro_scenarios.sql
grep -q "p_pro_only" src/types/database.ts
grep -q "PRO_REQUIRED" src/lib/errors.ts
! grep -nE "level: z\." src/app/api/levels/route.ts
test -z "$(git status --porcelain data/ public/)"   # 단어 데이터·음성을 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `npm run test:db`는 로컬 Supabase가 켜져 있어야 한다(꺼져 있으면 `blocked`).
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/`는 순수 함수, DB 변경은 `supabase/migrations/`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
     - 플랜은 RPC 안 DB 시각으로 판정한다.
     - body의 userId·플랜을 받지 않는다.
     - 구현 경로에 `test` 문자열이 없다.
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다.
   - 대상
     - `chat.md` "대화 진행" 1번의 400·409·403 문장과 "이미 만든 세션" 문장
     - `usage.md` "Pro 상황"
     - `backend.md`의 "첫 레벨"·"대화 세션 생성" 항목, 보안 14번, API 표 두 행, 에러 코드 `PRO_REQUIRED` 행
     - `metrics.md` "한도 도달 전 체험 시작"
   - step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/8-scenario-unlock/step0-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(export 이름, RPC 시그니처, 에러 코드·문구, 지표 key). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(로컬 Supabase가 꺼짐 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db reset`을 하지 마라. 이유: 로컬 단어 2,000개와 테스트 계정이 지워진다. 마이그레이션은 `npx supabase migration up`으로만 적용한다.
- 옛 4개 인자 `create_chat_session`을 남겨 두거나 같은 이름으로 오버로드를 하나 더 만들지 마라. 이유: 두 시그니처가 있으면 PostgREST가 이름 있는 인자 호출을 어느 쪽으로 보낼지 모호해지고, 권한도 두 벌 관리해야 한다.
- `begin_chat_turn`·종료 RPC에서 Pro 상황이나 플랜을 다시 검사하지 마라. 이유: spec은 새 세션만 막는다. 체험 중 시작한 세션은 체험이 끝나도 이어서 하고 끝낼 수 있다(`usage.md` "Pro 상황").
- `PRO_REQUIRED` 거부에 `limit_reached`나 새 이벤트를 남기지 마라. 이유: 체험 전환 지표의 정의가 바뀐다(`usage.md`).
- 플랜을 use-case나 라우트에서 판정하지 마라(`planAt`을 서버 판정에 쓰는 것 포함). 이유: CLAUDE.md CRITICAL, 플랜은 잠금 뒤 RPC 안의 DB 시각으로 판정한다.
- `set_first_level` RPC를 고치지 마라. 이유: 레벨 1은 라우트가 넘긴다(spec `backend.md`). RPC를 바꾸면 운영 DB에 적용할 마이그레이션이 늘어난다.
- `src/lib/scenarios.ts`의 상황 내용(제목·목표·역할·첫 마디·번역·발음·뜯어보기)과 순서를 바꾸지 마라. 이유: 사람이 검수를 마쳤다. 순서가 Free/Pro를 정한다.
- 화면(`src/components/`, `src/app/(app)/`)을 고치지 마라. 이유: step 1·2의 범위다.
- Anthropic API 같은 외부 API를 부르지 마라. 이유: 유료 호출이고 이 step에 필요 없다.
- `data/words/*.json`을 고치거나 `npm run seed:words`·`words:*`·`audio:generate`를 실행하지 마라. 이유: 이 phase는 단어·음성을 바꾸지 않는다.
- hook 통과용 빈 테스트나 Supabase 쿼리 체인 mock 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
