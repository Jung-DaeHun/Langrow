# 환경, 배포, 출시 요건

## 환경과 배포

| 환경 | DB | 앱 |
|---|---|---|
| 로컬 | Supabase CLI(`supabase start`, Docker Desktop + WSL2) | `npm run dev` |
| 운영 | Supabase 클라우드 1개 (서울) | Vercel Production (icn1), `main` |

- **마이그레이션**: `supabase migration new` → 로컬에서 `supabase db reset`으로 확인 → 운영에 `supabase db push`
- **단어 seed**: `npm run seed:words`를 로컬에서 실행하고, 운영에는 한 번 실행한다. 언어 × 레벨 10개 파일이 모두 있어야 넣는다. 로컬에서 일부 레벨만 넣어 화면을 볼 때만 `-- --partial`을 붙인다.
- **Vercel Preview는 끈다.** dev DB가 없어서 켜 두면 prod DB를 쓰게 되고, 지표가 오염된다.
- **테스트와 하네스 Stop hook**(lint, build, test)은 Docker 없이 통과해야 한다. 기본 테스트는 가짜 db를 쓴다. 실제 잠금·권한 검증은 `npm run test:db`로 분리하며 로컬 Supabase가 필요하다. RPC·마이그레이션·DB 접근 코드 변경 시와 배포 전에는 이 통합 테스트를 반드시 실행한다.
- **환경변수**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`(로컬과 운영의 키를 나누고, 지출 한도를 설정), `CLAUDE_MODEL`. `services/env.ts`에서 zod로 지연 검증한다. `METRICS_EXCLUDED_USER_IDS`는 로컬 `metrics-report` 전용이다.
- **구글 OAuth**
  - Google 콘솔의 리디렉션 URI에는 앱 주소가 아니라 Supabase의 `/auth/v1/callback`을 넣는다. 운영과 로컬(`http://127.0.0.1:54321/auth/v1/callback`)을 모두 등록한다.
  - 로컬은 `supabase/config.toml`의 `[auth.external.google]`에서 설정한다.
  - `redirectTo`는 `window.location.origin + '/auth/callback'`으로 만든다.
- **버전 고정**: Next.js, supabase-js, Anthropic SDK 버전을 설치할 때 고정하고 `CLAUDE.md`에 적는다. 예를 들어 Next 16이면 `proxy.ts`, async `params`/`cookies()`를 쓴다.

## 출시 최소 요건

- **개인정보처리방침**(`/privacy`)
  - 수집 항목: 구글 이메일·이름, 학습 기록, 대화 내용
  - 목적, 보관 기간, 탈퇴 방법
  - **국외 이전**: 대화 내용이 Anthropic(미국)으로 전송된다. 호스팅 업체(Vercel, Supabase)도 함께 고지한다.
  - 정식 출시 전에 법률 검토를 권장한다.
- **이용약관**(`/terms`): 만 14세 이상만 가입할 수 있다고 명시한다. 온보딩의 필수 체크 1개로 동의를 받고 `agreed_at`에 저장한다.
- **구글 OAuth 동의 화면 "게시"**: 테스트 모드에서는 등록한 사용자만 로그인할 수 있다.
- **회원 탈퇴**: 이메일로 문의를 받아 Supabase 대시보드에서 삭제한다. FK cascade로 기록이 함께 지워진다.
- **비용 안전장치**: Anthropic 지출 한도와 알림, 계정 잠금으로 원자적 사용량 예약, 세션당 작업 하나, 하루 실패 10회 누적 시 새 AI 호출 차단, 입력 300자, 일일 한도. 피드백 생성도 실패 횟수에 포함하며 종료 재요청은 AI를 중복 호출하지 않는다. 출시 전에 Anthropic rate limit 등급도 확인한다.
- **운영 위험**: Supabase 무료 프로젝트는 7일간 요청이 없으면 일시정지된다. 무료 플랜은 백업이 제한적이라 배포 전에 `supabase db dump`를 떠 둔다.
- **상황 첫 마디 검수**: 첫 마디 40개(상황 20개 × en·ja)는 AI 초안이다. 출시 전에 사람이 검수한다.
