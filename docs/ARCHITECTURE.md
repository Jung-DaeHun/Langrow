# 아키텍처

상세 동작(RPC 단계, 상태 전이, 복구, 테스트 목록)은 `docs/spec/`(`chat.md`, `words.md`, `usage.md`, `backend.md`, `testing.md` 등)을 따른다.

## 디렉토리 구조
```
src/
├── app/                  # 페이지(읽기) + API 라우트(쓰기)
│   └── api/**/route.ts   # 얇게: route() 래퍼 → use-case 호출 (판단 없는 단일 RPC는 server/db 직접)
├── server/               # use-case: (deps, userId, input) → 결과 | 에러 코드
│   ├── http.ts           # route() 래퍼
│   ├── page.ts           # 보호 페이지 가드: requireUser·requireReady(→ / 또는 /onboarding), React cache
│   └── db/               # DB 접근 함수(트랜잭션 단위 RPC 호출). 모두 userId를 받는다
│       └── reads.ts      # 페이지 읽기: 쿠키 client(RLS)를 인자로 받는다
├── services/             # 외부 I/O: supabase/{browser,server,admin}, claude/{client,prompts,schemas}, env, apiClient
├── lib/                  # 순수 규칙 (I/O·환경변수·fetch 없음)
├── components/           # 화면 단위: OnboardingFlow, ScenarioPicker, ChatRoom, ChatFeedback, WordSession, LevelTestRunner, KanaDeck
│                         # 공용: Flashcard, BlankQuiz, Furigana, LanguageSheet, AppNav, UsageCard, Dialog, Toast, WaitingDots,
│                         #       GoogleLoginButton, TrialButton, ProButton, LimitNotice, LogoutButton
├── site.config.ts        # 운영자 이름·문의 이메일·약관 시행일 (출시 전에 채운다)
├── types/                # database.ts (supabase gen types), api.ts (API 응답 타입)
└── test/                 # fakes.ts (가짜 db·ai)
supabase/migrations/      # 스키마·제약·인덱스·RLS·RPC·실행 권한
scripts/                  # generate-words, seed-words, metrics-report (각각 main(deps)를 export)
data/words/               # {en,ja}-{1..5}.json (검수 후 커밋)
```
- 상수 데이터: 상황 `src/lib/scenarios.ts`(20개, 첫 마디·역할은 en/ja 각각), 가나 `src/lib/kana.ts`.

## 패턴
- Server Components가 기본이다. 입력·진행 상태가 필요한 화면 단위 컴포넌트만 Client Component로 만든다. 정적 UI는 `page.tsx`/`layout.tsx`에 둔다.
- use-case는 `{ db, ai }`를 주입받는다. 기본 테스트는 `src/test/fakes.ts`(함수별 결과를 정하는 가짜)로 분기와 호출 순서를 검증하고, 잠금·RLS·원자성은 `test:db`로 검증한다.
- DB 인터페이스는 트랜잭션 단위로 둔다: `beginChatTurn`, `finishChatTurn`, `beginEnd`, `finishEnd`, `saveWordBatch` 등.
- 현재 시각은 페이지가 표시용으로만 `lib` 함수에 넘긴다. 저장·한도·작업 기한의 실제 판정은 RPC 안의 DB 시각을 쓴다.
- `route()` 래퍼 하나가 로그인(401, `getUser()`), JSON Content-Type 검사, zod 검증(400), 준비 상태(403), 에러 코드 → HTTP 변환, 예외 → 500을 처리한다. `/end`의 처리 중 응답(202)은 에러가 아니다.

## 데이터 흐름
```
읽기: 페이지(Server Component) → server/page.ts 가드 → server/db/reads.ts(쿠키 기반 server client, RLS: 자기 행 읽기) → 렌더
쓰기: Client Component → services/apiClient → /api route → server use-case → server/db → RPC(admin client)
     성공 뒤 화면 갱신은 router.refresh()로 페이지를 다시 읽는다

대화 1턴: 예약 RPC(계정 잠금, 만료 작업 복구, 한도·상태 확인, pending 행 + 작업 토큰 90초) → 커밋
        → Claude 호출(잠금 밖, 호출당 20초, 직접 재시도 1번)
        → 성공 확정 RPC(토큰·기한 확인, 저장·활동일·연속일) 또는 실패 확정 RPC(pending 삭제, chat_failed)
종료:   시작 RPC(active → ending + 토큰) → Claude 피드백 → 완료 RPC(ended, ready) / 실패·기한 만료 시 fallback
        처리 중 재요청은 202, 완료 후 재요청은 저장된 결과
```

## 상태 관리
- 서버 상태는 Server Components에서 읽는다. 별도 클라이언트 캐시 라이브러리는 쓰지 않는다.
- 클라이언트 상태는 진행 중인 입력과 회차만 `useState`로 둔다. 단어 회차는 끝날 때 한 번 저장하고, 중간에 나가면 버린다.
- 대화 입력은 표시된 남은 사용량으로 막지 않고, 서버의 429 응답 뒤에만 막는다.

## 페이지 접근
- 공개: `/`, `/privacy`, `/terms`, `/auth/callback`. 보호: `/onboarding`, `/home`, `/chat/**`, `/words`, `/level-up`, `/kana`, `/account` (비로그인 → `/`).
- `/onboarding`을 뺀 보호 페이지는 동의와 현재 언어의 레벨이 없으면 `/onboarding`으로 보낸다(`(app)` route group의 레이아웃과 페이지가 `requireReady()`를 부른다).
- `/api/**`는 리디렉션하지 않고 JSON 401/403을 반환한다. `/_next/**`와 정적 파일은 인증 가드에서 제외한다.

## API
| Method | Path | 하는 일 |
|---|---|---|
| GET | `/auth/callback` | OAuth 코드 교환, `profiles`가 없으면 생성. `next` 파라미터를 받지 않는다 |
| POST | `/api/me/consent` | 약관 동의 (`agreed_at`, 최초 시각 유지) |
| PUT | `/api/me/language` | 레벨이 있는 언어로 전환 |
| POST | `/api/levels` | 언어의 첫 레벨 + 언어 전환 + 최초 `onboarded_at`. 이미 있으면 409 |
| PATCH | `/api/levels/[language]` | 레벨 내리기 |
| POST | `/api/chat/sessions` | 세션 생성 (Claude 호출 없음, 다른 레벨의 상황은 400) |
| POST | `/api/chat/sessions/[id]/messages` | 대화 1턴 |
| POST | `/api/chat/sessions/[id]/end` | 종료. 완료 200, 처리 중 202, 턴 처리 중 409 |
| POST | `/api/words/batch` | 회차 저장. 기존 단어는 200, 신규분만 한도 확인 |
| POST | `/api/words/review` | 복습 결과 저장 |
| POST | `/api/level-up` | 서버 채점, 합격 시 `where level = from_level`로 +1 |
| POST | `/api/trial` | 체험 시작 (`where trial_started_at is null`, 계정당 1번) |
| POST | `/api/events` | `pro_clicked`, `kana_studied`만 (가나는 활동일·연속일도 갱신) |

- 기본 준비 상태: 로그인 + 동의 + 현재 언어 레벨. 예외는 3개뿐: consent(로그인), levels(로그인 + 동의), language(로그인 + 동의 + 대상 언어 레벨). 부족하면 403이며 학습 데이터 변경·AI 호출을 하지 않는다.
- 에러 형식은 `{ code, message }`(한국어 문구): `UNAUTHORIZED` 401, `CONSENT_REQUIRED`/`ONBOARDING_REQUIRED` 403, `INVALID_INPUT` 400, `NOT_FOUND` 404, `LIMIT_REACHED`/`AI_FAILURE_LIMIT` 429, `AI_UNAVAILABLE` 503, `SESSION_FULL`/`CONFLICT` 409, `INTERNAL` 500.

## 데이터 모델
| 테이블 | 주요 컬럼 |
|---|---|
| `profiles` | id(=auth.users.id), current_language, pro_until, trial_started_at, agreed_at, onboarded_at, last_study_date, streak, created_at |
| `user_levels` | user_id, language, level(1~5) — PK(user_id, language) |
| `chat_sessions` | id, user_id, language, level, scenario_id, status(active/ending/ended), operation_token, operation_expires_at, feedback_status(none/pending/ready/fallback/skipped), feedback, created_at, ended_at |
| `chat_turns` | id, session_id, user_id, turn_no, status(pending/done), user_text, reply, reply_ko, correction, created_at — unique(session_id, turn_no), 세션당 pending 1개(partial unique) |
| `words` | id(`en-1-001`), language, level, rank, word, reading, meaning_ko, example(`{{정답}}`), example_ko, distractors(3개) |
| `user_words` | user_id, word_id, status(known/review), first_seen_at, updated_at — PK(user_id, word_id) |
| `events` | id, user_id, name, props, created_at (`limit_reached`, `pro_clicked`, `kana_studied`, `level_test_submitted`, `chat_failed`) |
| `user_activity_days` | user_id, activity_date(한국 날짜) — 학습 성공이 있는 날만 행 |

- 사용량은 별도 카운터 없이 센다: 대화 = 오늘 생성된 `chat_turns`(pending 포함), 단어 = 오늘 `first_seen_at`인 `user_words`.
- 모든 사용자 테이블의 FK는 `auth.users(id) on delete cascade`.

## 보안
- RLS는 모든 public 테이블에 켜고 "자기 행 읽기" 정책만 둔다(`words`는 로그인 사용자 전체 읽기). 쓰기 정책은 두지 않는다.
- RPC는 `SECURITY INVOKER`로 만들고, `EXECUTE`를 `PUBLIC`·`anon`·`authenticated`에서 회수한 뒤 `service_role`에만 준다(기본 권한도 같게).
- CSRF는 SameSite=Lax 쿠키 + JSON Content-Type만 허용으로 막는다. 로그에는 에러 코드·user id·경로·응답 시간만 남기고 대화 내용·이메일은 남기지 않는다.
- 모든 body는 zod로 검증한다: 대화 300자, 답안 50자, 테스트 20개, 단어 회차 10개 이하, 언어·이벤트 이름은 enum.

## Claude 연동
- `client.messages.create()` + zod 스키마(`output_config.format`)로 구조화 출력을 받는다. `stop_reason`을 먼저 보고 직접 파싱한다(`messages.parse()`는 잘린 응답도 파싱 실패로 throw한다). refusal·`max_tokens` 도달·파싱 실패는 실패로 처리하고, env 설정 오류는 API를 부르지 않고 `config`로 실패한다.
- SDK 자동 재시도는 끄고(`maxRetries: 0`) 직접 1번만 재시도한다. 호출당 20초, 전체 약 40초, 라우트 `maxDuration = 60`.
- `max_tokens` 4096(thinking 포함), `output_config.effort`는 `low`. 프롬프트 빌더는 순수 함수(`services/claude/prompts.ts`). 스트리밍·프롬프트 캐싱은 쓰지 않는다.

## 환경
- 로컬: Supabase CLI(Docker) + `npm run dev`. 운영: Supabase 클라우드(서울) 1개 + Vercel Production(icn1, `main`). Vercel Preview는 끈다(prod DB 오염 방지).
- 마이그레이션: `supabase migration new` → 로컬 `supabase db reset` → 운영 `supabase db push`.
- 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (`services/env.ts`에서 zod로 지연 검증). `METRICS_EXCLUDED_USER_IDS`는 로컬 `metrics-report` 전용.
