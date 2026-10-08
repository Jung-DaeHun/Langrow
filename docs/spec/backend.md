# 백엔드: 레이어, 데이터 접근, API, 데이터 모델

## 시스템 구성

```
[브라우저] ──▶ [Vercel (icn1): Next.js]
                ├─ 미들웨어: 세션 갱신, 명시된 보호 페이지의 비로그인 요청만 / 로
                ├─ 페이지 (Server Components): 읽기
                └─ /api 라우트: 쓰기 + Claude 호출
                      ▼                        ▼
             [Supabase (서울)]            [Anthropic API]
             Auth(구글) · Postgres        Claude Sonnet 5.5

[로컬 스크립트] generate-words → data/words/*.json (검수 후 커밋) → seed-words → Supabase
               metrics-report ← Supabase (지표 분자/분모 출력)
```

페이지 접근 규칙(공개·보호 경로)은 `journey.md` "페이지 접근 규칙"에 있다.

## 레이어

```
src/app/api/**/route.ts   얇게: route() 래퍼 → use-case 호출 (판단 없는 단일 RPC는 server/db 직접)
src/server/*.ts           use-case: (deps, userId, input) → 결과 | 에러 코드   ← 비즈니스 테스트의 중심
src/server/page.ts        보호 페이지 가드(requireUser·requireReady, React cache)
src/server/db/*.ts        DB 접근 함수: 모두 userId를 받는다. reads.ts는 페이지 읽기(쿠키 client를 인자로, RLS)
src/services/             supabase/{browser,server,admin}.ts, claude/{client,prompts,schemas}.ts, env.ts, apiClient.ts(브라우저 → /api)
src/lib/                  순수 규칙 (I/O 없음. 환경변수 읽기와 fetch도 하지 않는다)
```

- 앱 코드는 모두 `src/` 아래에 둔다. `docs/spec/` 문서에서 `src/`를 생략한 `app/`, `server/`, `services/`, `lib/`, `components/`, `types/`, `test/` 경로도 `src/` 기준이다. `scripts/`, `data/`, `supabase/`는 저장소 루트에 둔다.
- 의존 방향은 app → server → services, lib다. `lib`는 프로젝트 안의 다른 모듈을 import하지 않는다.
- use-case는 `{ db, ai }`를 주입받고, 함수별 결과를 정하는 가짜 구현(`src/test/fakes.ts`)으로 분기와 호출 순서를 테스트한다. RPC 규칙(잠금·한도·상태 전이)을 가짜에 다시 구현하지 않는다. DB 인터페이스는 `beginChatTurn`, `finishChatTurn`, `beginEnd`, `finishEnd`, `saveWordBatch` 같은 트랜잭션 단위로 둔다. 잠금·RLS·원자성은 로컬 DB 통합 테스트로 따로 확인한다.
- 현재 시각은 페이지가 표시용으로만 `lib` 함수에 넘기며, 저장·한도·작업 기한의 실제 판정은 RPC 내부 DB 시각을 사용한다.
- `route()` 래퍼(`server/http.ts`) 하나가 다음을 처리한다: 로그인 확인(401), JSON Content-Type 검사, zod 검증(400), 경로별 동의·온보딩 검사(403), 에러 코드 → HTTP 변환, 예외 → 500. `/end`의 처리 중 응답(202)은 에러로 변환하지 않는다.

## 데이터 접근과 보안 (CRITICAL)

| 누가 | 무엇을 | 클라이언트 |
|---|---|---|
| 브라우저 | 로그인, 로그아웃만 | browser client (publishable key) |
| 페이지 | 읽기 | 쿠키 기반 server client. RLS(자기 행 읽기)가 적용된다 |
| route → use-case | 쓰기, Claude 호출 | admin client (secret key). RLS를 우회하므로 반드시 userId로 범위를 제한한다 |

- RLS는 모든 public 테이블에 켜고, "자기 행 읽기" 정책만 둔다 (`words`는 로그인 사용자 전체가 읽을 수 있다. `word_explanations`는 읽기 정책도 두지 않아 서버 RPC로만 읽는다). 쓰기 정책은 두지 않는다.
- admin 클라이언트는 `import 'server-only'`로 클라이언트 번들에 들어가지 않게 하고, 함수 안에서 지연 생성한다. 하네스 Stop hook이 매번 `next build`를 돌리는데, env가 없어도 빌드가 깨지지 않게 하기 위해서다.
- **여러 행의 판정과 변경은 DB 함수(RPC) 한 번으로 묶는다.** HTTP로 분리된 조회·변경을 하나의 트랜잭션으로 간주하지 않는다. RPC 구성과 실행 권한은 [Supabase DB 함수 문서](https://supabase.com/docs/guides/database/functions)를 따른다.
  - 계정의 사용량·레벨·활동일·대화 상태를 변경하는 RPC는 먼저 `profiles WHERE id = userId FOR UPDATE`를 잡고, 필요한 세션·학습 행을 잠근다. 모든 경로가 같은 순서를 사용한다.
  - 대화 예약: 만료 작업 복구 + 세션 상태·실패 횟수·한도 확인 + pending와 작업 토큰 저장
  - 대화 확정: 토큰 검증 + 결과 또는 실패 저장 + 토큰 해제 + 필요한 활동일/연속일 갱신
  - 종료: `active → ending` 예약과 `ending → ended` 확정은 각각 짧은 트랜잭션이다. AI 호출 중에는 DB 잠금을 유지하지 않는다.
  - 단어 회차: 기존 단어 제외 + 신규 개수로 한도 확인 + 신규 삽입 + 활동일/연속일 갱신
  - 복습·가나·레벨업 테스트: 결과/이벤트 저장과 활동일/연속일 갱신을 함께 처리한다.
  - AI 정답 설명: 예약은 설명 한도 확인 + 저장본 조회(없으면 실패 횟수 확인) + `word_explained` 저장, 실패는 그 예약 행 삭제 + `chat_failed` 기록, 저장은 설명을 만든 단어 내용이 지금 단어와 같을 때만 해시를 계산해 `word_explanations`에 넣기다. AI 호출 중에는 잠금을 유지하지 않는다.
  - 첫 레벨: 동의 확인 후 언어별 PK insert, `current_language` 전환, 최초 `onboarded_at` 설정을 함께 처리한다. 이미 해당 언어의 레벨이 있으면 409이며 다른 언어를 처음 추가하는 것은 허용한다.
  - 체험 시작은 `trial_started_at is null`, 레벨업은 `level = from_level`, 레벨 내리기는 `level > new` 조건을 유지한다. 모두 해당 계정 잠금 규칙을 따른다.
  - 한도 초과 등 예상된 거부는 결과 코드로 반환해 이미 수행한 만료 복구·이벤트 기록을 커밋한다. 예상하지 못한 SQL 오류는 트랜잭션 전체를 롤백한다.
- **RPC 실행 권한**: `SECURITY INVOKER`로 만들고 함수별 `EXECUTE`를 `PUBLIC`, `anon`, `authenticated`에서 회수한 뒤 `service_role`에만 부여한다. 새 함수에도 같은 기본 권한을 적용한다. HTTP에서 검증한 사용자 ID를 서버가 전달하며 body의 userId는 받지 않는다. 내부 helper에도 같은 권한 규칙을 적용한다.
- **세션당 pending 1개를 DB에서도 보장한다.** 작업 토큰과 세션 잠금이 전송·종료 간 경합을 막고, 아래 [부분 UNIQUE 인덱스](https://www.postgresql.org/docs/18/indexes-partial.html)가 여러 pending 생성을 추가로 막는다.
  ```sql
  CREATE UNIQUE INDEX chat_turns_one_pending
    ON public.chat_turns (session_id)
    WHERE status = 'pending';
  ```
  기존 `unique(session_id, turn_no)`도 유지한다. 만료된 pending은 `chat.md` "처리 중단 복구"의 규칙으로 제거하므로 영구적으로 다음 턴을 막지 않는다.

### 보안 체크리스트

| # | 위협 | 규칙 |
|---|---|---|
| 1 | 남의 리소스 접근 (IDOR) | admin 클라이언트로 하는 모든 조회·변경에 `id`와 `user_id`를 함께 건다. 남의 리소스는 404를 돌려준다. use-case 테스트와 수동 점검으로 확인한다 |
| 2 | 첫 레벨 API로 레벨업 우회 | 이미 그 언어의 레벨이 있으면 409를 돌려준다 |
| 3 | 위조된 인증 | 서버에서는 `getUser()`로 판단한다. `getSession()`은 토큰을 검증하지 않으므로 쓰지 않는다 |
| 4 | CSRF | Supabase 쿠키가 SameSite=Lax이고, 래퍼가 JSON Content-Type만 받는다. Origin 검사는 하지 않는다 |
| 5 | RLS 누락 | 모든 테이블에 RLS를 켜고, 배포 전에 Supabase Security Advisor로 확인한다 |
| 6 | secret 유출 | `.gitignore`에 `.env*`를 둔다 (추가 완료). secret에는 `NEXT_PUBLIC_`을 붙이지 않는다 |
| 7 | XSS | `dangerouslySetInnerHTML`을 쓰지 않는다. AI 출력은 텍스트로만 그린다 |
| 8 | 오픈 리디렉트 | `/auth/callback`은 `next` 파라미터를 받지 않는다 |
| 9 | 입력 남용 | 모든 body를 zod로 검증한다. 대화 300자, 답안·설명 요청 보기 50자, 테스트 20개, 단어 회차 10개 이하, 언어와 이벤트 이름은 enum만 허용한다 |
| 10 | 로그의 개인정보 | 로그에는 에러 코드, user id, 경로, 응답 시간만 남긴다. 대화 내용과 이메일은 남기지 않는다 |
| 11 | 계정 삭제 | `user_activity_days`를 포함해 모든 사용자 테이블의 FK를 `auth.users(id) on delete cascade`로 건다 |
| 12 | 동의·온보딩 우회 | API별 준비 상태를 래퍼와 쓰기 RPC에서 검사한다. 미동의는 403 `CONSENT_REQUIRED`, 학습 준비 미완료는 403 `ONBOARDING_REQUIRED` |
| 13 | RPC 직접 호출 | anon/authenticated의 함수 EXECUTE를 회수하고 실제 해당 역할로 호출 거부를 확인한다. RLS 쓰기 정책 부재만으로 함수 호출을 막았다고 가정하지 않는다 |

## API

모든 읽기는 페이지에서 한다. 라우트는 쓰기와 Claude 호출을 맡으며, 재요청 시 저장 결과를 반환하는 것은 쓰기 API의 멱등 동작에 포함한다.

| Method | Path | 하는 일 |
|---|---|---|
| GET | `/auth/callback` | 공개 OAuth 콜백. 코드 교환 후 `profiles`가 없으면 생성 |
| POST | `/api/me/consent` | 약관 동의 (`agreed_at`, 최초 시각 유지) |
| PUT | `/api/me/language` | 대상 언어에 레벨이 있을 때 전환 |
| POST | `/api/levels` | 언어의 첫 레벨 설정 + 해당 언어 전환 + 최초 온보딩 완료 시각. 이미 레벨이 있으면 409 |
| PATCH | `/api/levels/[language]` | 레벨 내리기 |
| POST | `/api/chat/sessions` | 만료 작업 복구 + 세션 생성 (Claude 호출 없음) |
| POST | `/api/chat/sessions/[id]/messages` | 대화 1턴 (예약 RPC → Claude → 확정 RPC) |
| POST | `/api/chat/sessions/[id]/end` | 종료 예약·피드백 확정/대체 결과. 완료 200, 처리 중 202, 턴 처리 중 409 |
| POST | `/api/words/batch` | language + items. 신규분만 한도 확인하고 원자적으로 저장, 중복은 200 |
| POST | `/api/words/review` | language + items. 유효한 복습 결과·활동일 저장 |
| POST | `/api/words/explain` | word_id + choice?. AI 정답 설명 (예약 RPC가 저장본을 주면 끝, 없으면 Claude → 성공 시 저장 / 실패 시 예약 반환, `words.md`) |
| POST | `/api/level-up` | 서버 채점, 합격하면 레벨 +1, 응시·활동일 저장 |
| POST | `/api/trial` | 체험 시작 (계정당 1번) |
| POST | `/api/events` | `pro_clicked`, `kana_studied`만 받는다. 가나는 활동일·연속일도 갱신 |

### 공통 준비 상태 검사
- 모든 `/api/**`는 먼저 `getUser()`로 인증한다. 기본은 동의 완료 + 현재 언어에 저장된 레벨이 있는 계정만 허용한다. 요청 언어나 세션 언어를 쓰는 작업은 그 언어의 레벨 존재도 확인한다.
- 예외는 아래 3개뿐이다. 이벤트 이름에 따라 준비 상태 검사를 생략하지 않는다.

| API | 필수 상태 | 예외 이유 |
|---|---|---|
| `POST /api/me/consent` | 로그인 | 최초 동의를 받을 수 있어야 함 |
| `POST /api/levels` | 로그인 + 동의 | 최초 또는 새 언어의 레벨 생성이 가능해야 함 |
| `PUT /api/me/language` | 로그인 + 동의 + 대상 언어 레벨 | 현재 언어가 미설정이어도 이미 설정한 언어로 복구 가능 |

- 조건 부족은 `CONSENT_REQUIRED` 또는 `ONBOARDING_REQUIRED`(403)이며, 거부 시 학습 데이터 변경이나 AI 호출을 하지 않는다. 클라이언트는 `/onboarding`으로 이동한다.
- 민감한 상태 판정은 쓰기 RPC에서도 사용자 행을 잠근 뒤 다시 확인한다. 첫 언어 설정 전의 `profiles.current_language`, `onboarded_at`은 null을 허용한다.

## 데이터 모델

| 테이블 | 주요 컬럼 |
|---|---|
| `profiles` | id(=auth.users.id), current_language(nullable), pro_until, trial_started_at, agreed_at, onboarded_at(nullable, 최초 완료 시각), last_study_date, streak, created_at |
| `user_levels` | user_id, language, level(1~5) — PK(user_id, language) |
| `chat_sessions` | id, user_id, language, level, scenario_id, status(active/ending/ended), operation_token(uuid, nullable), operation_expires_at(nullable), feedback_status(none/pending/ready/fallback/skipped), feedback(jsonb), created_at, ended_at |
| `chat_turns` | id, session_id, user_id, turn_no, status(pending/done), user_text, reply, reply_ko, correction(jsonb), created_at — unique(session_id, turn_no) |
| `words` | id(text, 예: `en-1-001`), language, level, rank, word, reading, meaning_ko, example, example_ko, distractors(text[]) — unique(language, level, rank) |
| `user_words` | user_id, word_id, status(known/review), first_seen_at, updated_at — PK(user_id, word_id) |
| `events` | id, user_id, name, props(jsonb), created_at |
| `word_explanations` | word_id(→ words), choice(text, 복습은 빈 문자열), explanation, word_hash, created_at — PK(word_id, choice). 사용자와 무관한 공용 저장본이라 user_id가 없다 |
| `user_activity_days` | user_id, activity_date(date, 한국 날짜) — PK(user_id, activity_date). 학습 성공이 있는 날만 행이 있다 |

- **인덱스**: `chat_turns(user_id, created_at)`, `user_words(user_id, first_seen_at)`, `events(user_id, name, created_at)`, `chat_sessions(user_id, language, status, created_at)`, `chat_sessions(user_id, operation_expires_at)` 및 위 partial UNIQUE. 활동일은 복합 PK로 사용자별 날짜를 조회한다.
- **상태 제약**: 작업 토큰과 기한은 둘 다 null 또는 둘 다 값이 있어야 한다. `active`는 `feedback_status = none`, `ending`은 토큰이 있고 `feedback_status = pending`, `ended`는 토큰이 없고 `ended_at`과 ready/fallback/skipped 중 하나를 가진다. `ended_at`은 ended일 때만 존재한다. ready/fallback에는 저장된 결과가 있어야 하며 skipped는 feedback이 null이다.
- **활동일**: 학습 성공 RPC가 DB 시각의 한국 날짜로 `insert … on conflict do nothing` 한다. 날짜를 클라이언트가 지정하지 않는다.
- **대화 첫 마디**는 저장하지 않고, `scenario_id`와 언어로 코드에서 다시 만든다.
- **단어 ID**는 생성할 때 부여하고 재사용하지 않는다. seed를 다시 돌려도 학습 기록이 깨지지 않는다.
- **파일 배치**
  - 마이그레이션(`supabase/migrations/`): 스키마, 제약, 인덱스, RLS, RPC 및 실행 권한
  - 단어: `scripts/seed-words.ts`가 upsert한다 (`onConflict: id`)
  - DB 타입: `supabase gen types`로 `types/database.ts`에 생성

## Claude 연동

- **구조화 출력**: SDK의 구조화 출력을 쓴다 (`client.messages.create()` + zod 스키마, `output_config.format`). Sonnet 5.5가 지원한다. deprecated된 `output_format`은 쓰지 않는다. `stop_reason`을 먼저 본 뒤 첫 text 블록을 zod로 파싱한다. `messages.parse()`는 `stop_reason`을 보기 전에 파싱하다 throw해서 실패 사유를 구분하지 못하므로 쓰지 않는다.
- **실패로 처리하는 경우**(`chat_failed`의 실패 사유): refusal, `max_tokens` 도달, 파싱·스키마 검증 실패(`invalid_output`), 타임아웃, API 오류. env가 없거나 비어 있으면 API를 부르지 않고 재시도 없이 `config`로 실패하며, 키 이름만 에러 로그로 남긴다
- **타임아웃과 재시도**: 호출당 타임아웃 20초. SDK 자동 재시도는 끄고(`maxRetries: 0`) 직접 1번만 재시도한다. 메시지·종료·설명 라우트 모두 `maxDuration = 60`이며, 재시도 포함 AI 호출 전체 예산은 최대 약 40초다. 두 호출 모두 같은 작업 토큰을 사용한다. 중복 HTTP 요청이나 DB 확정 재시도 때문에 AI 호출을 새로 시작하지 않는다.
- **토큰 상한과 effort**: `max_tokens`는 4096으로 둔다. Sonnet 5.5는 adaptive thinking이 기본이고 thinking 토큰도 `max_tokens`에 들어가므로 응답(약 500토큰 이하)보다 넉넉히 잡는다. `output_config.effort`는 `low`라서 쉬운 턴은 thinking 없이 답한다.
- **프롬프트**: 빌더는 순수 함수(`services/claude/prompts.ts`)로 단위 테스트하고, 스키마는 `schemas.ts`에 둔다. AI 정답 설명(`words.md`)도 같은 모델·effort·재시도 규칙으로 부르고, 스키마는 `{ explanation }` 하나다. 입력은 DB의 예문(정답을 채운 문장), `example_ko`, 정답, 뜻, 단어 레벨, 고른 보기(없으면 복습)다.
- **대화 기록**: 고정 user 턴("대화를 시작합니다") → 첫 마디 → `done` 턴들 → 이번 입력 순서로 보낸다. `pending` 턴은 넣지 않는다.
- **프롬프트 캐싱은 아직 쓰지 않는다.** Sonnet 5.5의 최소 캐시 길이(약 512토큰)는 넘으므로, 실제 결제를 붙이기 전에 적용하고 실측한다.

## 에러 코드

응답 형식은 `{ code, message }`이고, `message`는 사용자에게 보여 줄 한국어 문구다. AI 정답 설명의 `AI_UNAVAILABLE`·`AI_FAILURE_LIMIT`는 같은 code에 설명용 문구를 쓴다(`words.md` "AI 정답 설명").

| code | HTTP | 언제 | 클라이언트 동작 |
|---|---|---|---|
| `UNAUTHORIZED` | 401 | 로그인 안 됨·만료 | `/`로 이동 |
| `CONSENT_REQUIRED` | 403 | 약관 동의 없음 | `/onboarding` 동의 단계로 이동 |
| `ONBOARDING_REQUIRED` | 403 | 필요한 언어·레벨 미설정 | `/onboarding` 레벨 단계로 이동 |
| `INVALID_INPUT` | 400 | zod 실패, 다른 레벨의 상황, 잘못된 시험 제출 | 문구 표시 |
| `NOT_FOUND` | 404 | 없거나 남의 리소스 | 홈으로 이동 |
| `LIMIT_REACHED` | 429 | 플랜 한도 초과 | 체험 또는 Pro 안내 |
| `AI_FAILURE_LIMIT` | 429 | 하루 실패 10회 | 대화 입력·AI 설명 버튼 비활성화 |
| `AI_UNAVAILABLE` | 503 | 메시지·AI 설명 생성 실패 | 입력 유지, 다시 보내기 (종료 피드백 실패는 대체 결과로 200, 설명은 [다시 시도]) |
| `SESSION_FULL` | 409 | 20턴 초과 | `/end` 호출 |
| `CONFLICT` | 409 | 진행 중인 턴, 종료 중/끝난 세션에 전송, 만료·교체된 작업 토큰, 레벨이 이미 있음·바뀜, 체험 사용함 | 입력을 보존하고 상태를 새로 읽음. 전송/종료를 자동 반복하지 않고 필요한 재시도 버튼 표시 |
| `INTERNAL` | 500 | 예상하지 못한 예외 (로그 남김) | "잠시 후 다시 시도" |

- 클라이언트는 fetch 래퍼 하나(`services/apiClient`)에서 처리한다. `/end`의 202는 성공한 처리 중 응답으로 구분해 `retryAfterSeconds` 이후 다시 확인한다.
  - 401은 `/`로, 403(`CONSENT_REQUIRED`·`ONBOARDING_REQUIRED`)은 `/onboarding`으로 래퍼가 이동시킨다.
  - `fetch` 자체가 실패하면(네트워크 끊김) 클라이언트 전용 코드 `NETWORK`로 돌려준다. 503 문구("턴은 차감되지 않았어요")를 네트워크 오류에 쓰지 않기 위해서다. JSON이 아닌 응답은 `INTERNAL`로 본다.
- 네트워크 오류는 해당 작업의 입력·결과를 보존한다. 메시지는 수동 재전송, 단어 저장과 `/end`는 재시도 버튼으로 확인한다. 단어 중복 저장은 200이며 활동일·사용량을 다시 늘리지 않는다.
- 페이지에는 `error.tsx`와 `not-found.tsx`를 둔다. Supabase 장애는 페이지 에러로 보여 준다.
- Anthropic이 장애여도 단어, 가나, 레벨업 테스트는 계속 쓸 수 있다.
