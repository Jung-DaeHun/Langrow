# Step 0: db-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 1장 "연속 학습일"(갱신 규칙), "지표 수집"(`user_activity_days`, `onboarded_at`)
  - 5장 "플랜, 사용량, 무료 체험"(체험 시작 규칙)
  - 6-3 "데이터 접근과 보안" 전체(RPC 규칙, 실행 권한, 보안 체크리스트)
  - 6-4 "공통 준비 상태 검사", 6-5 "데이터 모델" 전체(컬럼, 인덱스, 상태 제약)
  - 6-7 "환경과 배포"(마이그레이션 흐름), 6-9, 7장 "DB 통합 테스트"
- phase 0 산출물:
  - `src/lib/readiness.ts`(`ReadinessState`, `checkReadiness`), `src/lib/streak.ts`(`nextStreak`), `src/lib/usage.ts`(UTC+9), `src/lib/plan.ts`(`PLAN_LIMITS`, `TRIAL_DAYS`), `src/lib/levels.ts`(`Language`, `Level`), `src/lib/errors.ts`(`ErrorCode`)
  - `src/services/supabase/{admin,server,browser}.ts`와 각 테스트, `src/services/env.ts`
  - `vitest.config.ts`(기본 테스트에서 `src/server/db/**` 제외), `vitest.db.config.ts`, `src/test/server-only.ts`
- `scripts/hooks/tdd-guard.sh`: `.ts(x)` 구현 파일은 같은 폴더의 `*.test.ts(x)`가 먼저 있어야 쓸 수 있다. 경로에 `test`가 들어간 파일과 `types.ts`, `types/` 폴더는 검사하지 않는다.

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

이 phase(1-data)는 DB 스키마, RPC, DB 접근 함수(`src/server/db/`), 로컬 스크립트를 만든다. API 라우트와 use-case는 2-api에서 만든다. 이 step은 스키마 전체, 계정 RPC, DB 통합 테스트 기반을 만든다. 대화 RPC는 step 1, 학습 RPC는 step 2에서 각자 새 마이그레이션으로 추가한다.

로컬 Supabase는 Docker로 돈다. 이미지는 미리 받아 두었다.

## 작업

### 1. 로컬 Supabase 준비

- `npx supabase init`으로 `supabase/`를 만든다(`config.toml` 기본값 유지). 질문 없이 끝난다. CLI가 만드는 `supabase/.temp/`는 루트 `.gitignore`에 추가한다(`supabase/.branches/`도).
- `npx supabase start`로 띄운다. 몇 분 걸릴 수 있으니 Bash 타임아웃을 넉넉히(10분) 준다. 이미 떠 있으면 그대로 쓴다.
- `npx supabase status -o env`는 `KEY="값"` 줄을 출력한다. 쓸 키는 `API_URL`, `PUBLISHABLE_KEY`, `SECRET_KEY`다(CLI 2.119.0에서 확인함). 키는 로컬 기본값이라 비밀이 아니지만 로그에 찍지는 않는다.
- CLI는 항상 `npx supabase`로 부른다(devDependency 2.119.0).

### 2. 마이그레이션: `npx supabase migration new schema`

생성된 `supabase/migrations/<timestamp>_schema.sql` 하나에 아래를 모두 넣는다. 적용과 확인은 `npx supabase db reset`으로 한다.

**테이블 8개** (spec 6-5). 사용자 테이블의 FK는 모두 `auth.users(id) on delete cascade`.

| 테이블 | 정할 것 |
|---|---|
| `profiles` | `id uuid pk`(= auth.users.id), `current_language` null 허용, `pro_until`·`trial_started_at`·`agreed_at`·`onboarded_at`·`last_study_date` null 허용, `streak int not null default 0`, `created_at` |
| `user_levels` | PK(user_id, language), `level` 1~5 |
| `chat_sessions` | `id uuid default gen_random_uuid()`, user_id, language, level, scenario_id, status, operation_token(uuid), operation_expires_at, feedback_status(default `none`), feedback(jsonb), created_at, ended_at |
| `chat_turns` | `id uuid default gen_random_uuid()`, session_id(→ chat_sessions on delete cascade), user_id, turn_no(1~20), status(pending/done), user_text(1~300자), reply, reply_ko, correction(jsonb), created_at. `unique(session_id, turn_no)` |
| `words` | `id text pk`, language, level, rank, word, reading(null 허용), meaning_ko, example, example_ko, `distractors text[]`(정확히 3개). `unique(language, level, rank)` |
| `user_words` | PK(user_id, word_id), word_id → words(id), status(known/review), first_seen_at, updated_at |
| `events` | id, user_id, name, `props jsonb not null default '{}'`, created_at. name은 `limit_reached`, `pro_clicked`, `kana_studied`, `level_test_submitted`, `chat_failed`만 |
| `user_activity_days` | PK(user_id, activity_date), `activity_date date` |

- 언어는 `('en','ja')`, 레벨은 1~5로 CHECK한다.
- `chat_turns`에서 `done`이면 `reply`·`reply_ko`가 있어야 한다.
- **chat_sessions 상태 제약**(spec 6-5): 토큰과 기한은 둘 다 null이거나 둘 다 값. `active`는 `feedback_status = 'none'`. `ending`은 토큰이 있고 `feedback_status = 'pending'`. `ended`는 토큰이 없고 `ended_at`이 있으며 `feedback_status`가 ready/fallback/skipped 중 하나. `ended_at`은 ended일 때만. ready/fallback은 feedback이 있고, skipped는 feedback이 null.
- **인덱스**(spec 6-5): `chat_turns(user_id, created_at)`, `user_words(user_id, first_seen_at)`, `events(user_id, name, created_at)`, `chat_sessions(user_id, language, status, created_at)`, `chat_sessions(user_id, operation_expires_at)`, 그리고 partial UNIQUE `chat_turns_one_pending ON chat_turns(session_id) WHERE status = 'pending'`.

**RLS와 테이블 권한**
- 모든 테이블에 RLS를 켠다. 정책은 `authenticated`의 자기 행 SELECT만 둔다(`profiles`는 `id`, 나머지는 `user_id`가 `(select auth.uid())`). `words`는 `authenticated` 전체 SELECT. 쓰기 정책은 두지 않는다.
- `anon`은 모든 테이블 권한을 회수한다. `authenticated`는 SELECT만 남기고 INSERT·UPDATE·DELETE를 회수한다. 앞으로 만들 테이블에도 같은 기본 권한(`alter default privileges`)을 건다.

**함수 공통 규칙** (helper 포함, step 1·2의 RPC도 같다)
- `SECURITY INVOKER`, `set search_path = ''`(본문에서는 `public.` 스키마를 붙인다).
- 함수마다 `EXECUTE`를 `PUBLIC`, `anon`, `authenticated`에서 회수하고 `service_role`에만 준다. 함수의 기본 권한도 같게 바꾼다(`alter default privileges ... revoke execute on functions from public, anon, authenticated`).
- 모두 `public` 스키마에 둔다. 테스트가 service_role로 helper를 직접 부를 수 있어야 한다.
- 첫 인자는 `p_user_id uuid`다. 서버가 `getUser()`로 검증한 ID를 넘긴다.
- **응답 형식**: `jsonb`. 성공은 `{"ok": true, ...값}`, 예상된 거부는 `{"ok": false, "code": "<ErrorCode>"}`. 키는 snake_case.
  - 예상된 거부는 `raise`하지 않고 반환한다. 그래야 같은 트랜잭션에서 한 만료 복구·이벤트 기록이 커밋된다(spec 6-3).
  - 예상하지 못한 오류는 그대로 예외로 둔다(트랜잭션 전체 롤백).
- **잠금 순서**: 사용자 상태를 바꾸는 RPC는 먼저 `select ... from public.profiles where id = p_user_id for update`. 그다음 세션·학습 행을 잠근다.
- **시각**: 날짜·플랜·한도는 함수 안의 `now()`로 판정한다. 인자로 날짜나 플랜을 받지 않는다.

**helper**
- `kst_today() returns date`: UTC+9 고정으로 계산한 오늘 한국 날짜(`src/lib/usage.ts`와 같은 규칙). 오늘 0시(한국)의 timestamptz가 필요하면 같은 방식으로 helper를 하나 더 만들어도 된다.
- `check_readiness(p_user_id uuid, p_requirement text, p_language text default null) returns text`: `src/lib/readiness.ts`의 `checkReadiness`와 같은 규칙이다. 문제가 없으면 null, 아니면 `'CONSENT_REQUIRED'` 또는 `'ONBOARDING_REQUIRED'`를 돌려준다. **`profiles` 행이 없으면 `CONSENT_REQUIRED`다.** 호출하는 쪽이 이미 profiles를 잠갔다고 가정한다.
- `record_activity(p_user_id uuid) returns void`: `user_activity_days`에 오늘 한국 날짜 행을 `insert … on conflict do nothing`으로 넣는다. `profiles.last_study_date`·`streak`를 `src/lib/streak.ts`의 `nextStreak` 규칙(오늘이면 그대로, 어제면 +1, 그 밖에는 1)으로 갱신한다. 따로 불려도 안전하도록 profiles 행을 직접 `for update`로 잠근다(같은 트랜잭션에서 다시 잠그는 것은 문제없다).

**계정 RPC 6개**

| 함수 | 준비 상태 | 동작 |
|---|---|---|
| `ensure_profile(p_user_id)` | 없음 | `profiles` 행을 `insert … on conflict do nothing`. 항상 ok. `/auth/callback`이 부른다 |
| `agree_terms(p_user_id)` | 없음 | 행이 없으면 만들고, `agreed_at = coalesce(agreed_at, now())`. 최초 시각을 유지한다. 항상 ok |
| `set_first_level(p_user_id, p_language, p_level)` | consent | 해당 언어 레벨이 이미 있으면 `CONFLICT`(레벨 변경 없음). 없으면 insert, `current_language = p_language`, `onboarded_at = coalesce(onboarded_at, now())` |
| `switch_language(p_user_id, p_language)` | consent + 대상 언어 레벨 | `current_language` 변경 |
| `lower_level(p_user_id, p_language, p_level)` | ready + 대상 언어 레벨 | `update … set level = p_level where level > p_level`. 바뀐 행이 없으면 `CONFLICT`. 새 레벨을 돌려준다 |
| `start_trial(p_user_id)` | ready | `update … set trial_started_at = now(), pro_until = now() + 7일 where trial_started_at is null`. 바뀐 행이 없으면 `CONFLICT`. `pro_until`을 돌려준다 |

- 준비 상태 열의 consent/ready는 `check_readiness`의 requirement다. 거부되면 그 코드를 반환하고 아무것도 바꾸지 않는다.
- 체험 일수 7은 SQL에 둔다. 테스트가 `TRIAL_DAYS`로 기대값을 만들어 어긋나면 실패하게 한다.

### 3. 타입 생성과 클라이언트 제네릭

- `npx supabase gen types typescript --local > src/types/database.ts`. **Bash로 실행한다.** PowerShell의 `>`는 UTF-16으로 저장해서 깨진다.
- 생성 파일은 손으로 고치지 않는다. stderr에 "Generated TypeScript is unformatted"라는 안내가 나와도 포맷하지 않는다(AC가 CLI 출력 그대로와 비교한다). 생성 파일은 현재 ESLint 설정을 통과한다.
- `src/services/supabase/{browser,server,admin}.ts`의 클라이언트에 `Database` 제네릭을 붙인다(`SupabaseClient<Database>`). 기존 테스트는 그대로 통과해야 한다.

### 4. DB 통합 테스트 기반

- `vitest.db.config.ts`: `server-only`를 `src/test/server-only.ts`로 alias(`vitest.config.ts`와 같게), `globalSetup: src/test/dbGlobalSetup.ts`, 테스트·hook 타임아웃을 넉넉히(30초). 파일 직렬 실행은 유지한다.
- `src/test/dbGlobalSetup.ts`: `npx supabase status -o env`에서 API URL, secret key, publishable key를 읽어 테스트 프로세스에 넘긴다. 그래서 테스트 안에서 `getAdminSupabase()`와 `getPublicEnv()`가 `.env.local` 없이 동작한다(`process.env`에 넣거나 vitest `provide`/`inject` + setupFile 사용). 로컬 Supabase가 꺼져 있으면 "`npx supabase start`를 먼저 실행하라"는 메시지로 실패한다. Windows에서 `npx`를 child process로 부를 때는 shell이 필요하다.
- `src/test/db.ts` (테스트 보조. 구현은 재량, 아래 기능은 필수):
  - 테스트 사용자 만들기·지우기: `auth.admin.createUser`(무작위 이메일, 비밀번호, `email_confirm: true`), `auth.admin.deleteUser`. 지우면 FK cascade로 모든 행이 지워진다.
  - 준비된 사용자 만들기: 사용자 생성 + `ensure_profile` + `agree_terms` + `set_first_level`(언어·레벨 지정)
  - `anon` 클라이언트(publishable key), 로그인한 `authenticated` 클라이언트(publishable key + `signInWithPassword`)
  - 각 테스트 파일은 만든 사용자를 `afterEach`/`afterAll`에서 지운다.

### 5. `src/server/db/`

```ts
// types.ts (TDD guard 예외)
export type DbErrorCode = Extract<ErrorCode,
  'CONSENT_REQUIRED' | 'ONBOARDING_REQUIRED' | 'INVALID_INPUT' | 'NOT_FOUND' |
  'LIMIT_REACHED' | 'AI_FAILURE_LIMIT' | 'SESSION_FULL' | 'CONFLICT'>
export type DbResult<T> = { ok: true; value: T } | { ok: false; code: DbErrorCode }

// rpc.ts: RPC 호출과 jsonb 응답 → DbResult 변환을 한 곳에서 한다
import 'server-only'
// 시그니처는 재량. supabase 에러(예상하지 못한 SQL 오류)와 DbErrorCode가 아닌 code는 throw한다

// account.ts
import 'server-only'
export async function ensureProfile(userId: string): Promise<void>
export async function agreeTerms(userId: string): Promise<void>
export async function setFirstLevel(userId: string, language: Language, level: Level): Promise<DbResult<null>>
export async function switchLanguage(userId: string, language: Language): Promise<DbResult<null>>
export async function lowerLevel(userId: string, language: Language, level: Level): Promise<DbResult<{ level: Level }>>
export async function startTrial(userId: string): Promise<DbResult<{ proUntil: Date }>>
export async function getReadiness(userId: string): Promise<ReadinessState>
```
- 모든 함수는 안에서 `getAdminSupabase()`를 쓰고 `userId`를 받는다. snake_case 응답을 camelCase로 바꿔 돌려준다.
- `getReadiness`: 2-api의 `route()` 래퍼가 쓴다. `profiles`와 `user_levels`를 `user_id`로 범위를 건 SELECT로 읽는다(읽기라서 RPC가 아니어도 된다). profiles 행이 없으면 `{ agreedAt: null, currentLanguage: null, levels: {} }`.

### 6. 테스트 (`npm run test:db`, 먼저 작성)

`src/server/db/rpc.test.ts`, `account.test.ts`, `security.test.ts`(구현 파일 없는 보안·스키마 테스트). 실제 로컬 DB로 검증하고 쿼리 체인을 mock하지 않는다.
- ensureProfile 두 번 → 행 1개, `created_at` 유지
- agreeTerms: profiles가 없어도 동작, 두 번째 호출이 `agreed_at`을 바꾸지 않음
- setFirstLevel: 미동의 → `CONSENT_REQUIRED`. 성공 시 레벨·`current_language`·`onboarded_at`. 같은 언어 두 번째 → `CONFLICT`이고 레벨 그대로. 다른 언어 추가는 허용되고 `onboarded_at`은 처음 값 유지
- switchLanguage: 레벨 없는 언어 → `ONBOARDING_REQUIRED`, 있으면 전환
- lowerLevel: 낮추기 성공, 같거나 높은 값 → `CONFLICT`, 레벨 없는 언어 → `ONBOARDING_REQUIRED`
- startTrial: 성공 시 `pro_until` ≈ 지금 + `TRIAL_DAYS`일, 두 번째 → `CONFLICT`. `Promise.all`로 동시 2번 → 정확히 하나만 성공
- getReadiness: profiles 없음, 동의만, 동의 + 레벨 상태가 맞게 나옴
- 준비 상태: profiles 행이 없는 사용자의 `start_trial` → `CONSENT_REQUIRED`
- record_activity(service_role로 직접 호출): 처음 1, 같은 날 그대로, `last_study_date`를 어제로 바꾸면 +1, 그제로 바꾸면 1. `Promise.all` 동시 호출 뒤 오늘 활동일 행은 1개
- 보안(spec 7장, 보안 체크리스트 5·11·13):
  - anon: 모든 테이블 SELECT·INSERT 거부
  - authenticated: 자기 행만 읽힘, 다른 사용자 행 0건. 모든 테이블 INSERT·UPDATE·DELETE 거부. `words` SELECT는 가능
  - 이 step의 모든 함수(helper 포함)를 anon·authenticated로 부르면 거부되고 상태가 바뀌지 않음
  - auth 사용자를 지우면 그 사용자의 모든 테이블 행이 사라짐
- 스키마 제약(admin으로 직접 insert): 같은 세션 pending 2개, 토큰만 있고 기한 없음, ended인데 `ended_at` 없음, skipped인데 feedback 있음, `distractors` 2개 → 모두 실패

## Acceptance Criteria

```bash
npx supabase db reset
npx supabase gen types typescript --local | diff -q --strip-trailing-cr - src/types/database.ts   # 생성 타입이 최신
npm run lint
npm run build
npm run test
npm run test:db
! grep -riE "security\s+definer" supabase/migrations
! grep -rnE "getSession\(" src
for f in src/server/db/*.ts; do case "$f" in *.test.ts|*/types.ts) ;; *) grep -qE "import ['\"]server-only['\"]" "$f" || { echo "server-only 없음: $f"; exit 1; } ;; esac; done
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`supabase/migrations/`, `src/server/db/`, `src/types/database.ts`)
   - ADR 기술 스택을 벗어나지 않았는가? (ADR-003: 계정 잠금 + RPC 트랜잭션)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (admin 조회에 user_id, 쓰기 RPC는 profiles `FOR UPDATE` 먼저, DB 시각으로 판정, secret에 `NEXT_PUBLIC_` 없음)
3. 결과에 따라 `phases/1-data/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 마이그레이션 파일명, helper·RPC 이름과 인자, `rpc.ts` 사용법, `src/test/db.ts`의 보조 함수 이름, `status -o env`에서 쓴 키 이름을 포함한다(step 1·2가 그대로 쓴다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (Docker 꺼짐, 이미지 pull 실패 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `SECURITY DEFINER` 함수를 만들지 마라. 이유: spec 6-3. 권한 우회 범위가 넓어지고, service_role 전용 INVOKER로 충분하다.
- RPC 인자로 날짜·플랜·사용량·현재 시각을 받지 마라. 이유: CLAUDE.md CRITICAL. DB 시각으로만 판정한다.
- 예상된 거부(`CONFLICT` 등)를 `raise exception`으로 처리하지 마라. 이유: 같은 트랜잭션의 만료 복구·이벤트 기록까지 롤백된다.
- RLS 쓰기 정책을 만들지 마라. 이유: 쓰기는 service_role RPC로만 한다.
- 대화·학습 RPC(세션, 턴, 단어 저장 등)를 이 step에서 만들지 마라. 이유: step 1·2의 범위다.
- `src/types/database.ts`를 손으로 고치지 마라. 이유: 다시 생성하면 덮어써진다. AC가 생성 결과와 비교한다.
- `.env.local`을 읽거나 고치지 마라. 이유: 비밀값이 있을 수 있다. 테스트는 `supabase status`에서 값을 얻는다.
- Supabase 쿼리 체인을 mock하거나 hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md. DB 접근은 실제 DB로 검증한다.
- `npx supabase stop`을 하지 마라. 이유: 다음 step이 같은 로컬 DB를 쓴다.
- 기존 테스트를 깨뜨리지 마라
