# 환경, 배포, 출시 요건

## 환경과 배포

| 환경 | DB | 앱 |
|---|---|---|
| 로컬 | Supabase CLI(`supabase start`, Docker Desktop + WSL2) | `npm run dev` |
| 운영 | Supabase 클라우드 1개 (서울) | Vercel Production (icn1), `main` |

- **마이그레이션**: `supabase migration new` → 로컬에서 `supabase db reset`으로 확인 → 운영에 `supabase db push`
- **단어 seed**: `npm run seed:words`를 로컬에서 실행하고, 운영에는 한 번 실행한다. 언어 × 레벨 10개 파일이 모두 있어야 넣는다. 로컬에서 일부 레벨만 넣어 화면을 볼 때만 `-- --partial`을 붙인다.
- **음성 생성**: `npm run audio:generate`를 로컬에서 실행하고 `public/audio/`와 `data/audio-manifest.json`을 커밋한다(`audio.md`). 단어 데이터를 고친 커밋에는 다시 만든 음성도 함께 넣는다. 운영에는 배포만 하면 되고 따로 올리는 단계가 없다. Azure 무료 체험 구독은 30일 뒤 종량제로 올려야 계속 만들 수 있다(F0 리소스만 두면 과금 없음).
- **Vercel Preview는 끈다.** dev DB가 없어서 켜 두면 prod DB를 쓰게 되고, 지표가 오염된다.
- **테스트와 하네스 Stop hook**(lint, build, test)은 Docker 없이 통과해야 한다. 기본 테스트는 가짜 db를 쓴다. 실제 잠금·권한 검증은 `npm run test:db`로 분리하며 로컬 Supabase가 필요하다. RPC·마이그레이션·DB 접근 코드 변경 시와 배포 전에는 이 통합 테스트를 반드시 실행한다.
- **환경변수**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`(로컬과 운영의 키를 나누고, 지출 한도를 설정), `CLAUDE_MODEL`. `services/env.ts`에서 zod로 지연 검증한다. `METRICS_EXCLUDED_USER_IDS`는 로컬 `metrics-report` 전용이다. `AZURE_SPEECH_KEY`·`AZURE_SPEECH_REGION`은 로컬 `generate-audio` 전용이며 운영 env에 넣지 않는다.
- **구글 OAuth**
  - Google 콘솔의 리디렉션 URI에는 앱 주소가 아니라 Supabase의 `/auth/v1/callback`을 넣는다. 운영과 로컬(`http://127.0.0.1:54321/auth/v1/callback`)을 모두 등록한다.
  - 로컬은 `supabase/config.toml`의 `[auth.external.google]`에서 설정한다. 클라이언트 ID와 secret은 `supabase/.env.local`의 `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`·`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`에 둔다(CLI가 읽고 git은 무시한다). 값이 없어도 `supabase start`는 되고 구글 로그인만 실패한다. 값을 바꾸면 `supabase stop` → `supabase start`로 다시 띄운다.
  - `redirectTo`는 `window.location.origin + '/auth/callback'`으로 만든다. Supabase Auth는 `site_url`과 호스트가 같거나 `additional_redirect_urls`에 있는 주소로만 돌려보낸다. 로컬은 `127.0.0.1`(site_url)과 `http://localhost:3000/auth/callback`을 허용하고, 운영은 대시보드의 Site URL을 운영 주소로 둔다.
- **버전 고정**: Next.js, supabase-js, Anthropic SDK 버전을 설치할 때 고정하고 `CLAUDE.md`에 적는다. 예를 들어 Next 16이면 `proxy.ts`, async `params`/`cookies()`를 쓴다.

## 출시 최소 요건

- **개인정보처리방침**(`/privacy`)
  - 수집 항목: 구글 이메일·이름, 학습 기록, 대화 내용
  - 목적, 보관 기간, 탈퇴 방법
  - **국외 이전**: 대화 내용이 Anthropic(미국)으로 전송된다. 호스팅 업체(Vercel, Supabase)도 함께 고지한다.
  - 정식 출시 전에 법률 검토를 권장한다.
- **이용약관**(`/terms`): 만 14세 이상만 가입할 수 있다고 명시한다. 온보딩의 필수 체크 1개로 동의를 받고 `agreed_at`에 저장한다.
- **합성 음성 고지**: Azure 이용 규정에 따라 `/words`·`/kana` 안내 문구에 "발음은 합성 음성이에요"를 둔다. 문제 신고 창구는 약관·개인정보처리방침의 문의 이메일이다.
- **구글 OAuth 동의 화면 "게시"**: 테스트 모드에서는 등록한 사용자만 로그인할 수 있다.
- **회원 탈퇴**: 이메일로 문의를 받아 Supabase 대시보드에서 삭제한다. FK cascade로 기록이 함께 지워진다.
- **비용 안전장치**: Anthropic 지출 한도와 알림, 계정 잠금으로 원자적 사용량 예약, 세션당 작업 하나, 하루 실패 10회 누적 시 새 AI 호출 차단, 입력 300자, 일일 한도. 피드백 생성도 실패 횟수에 포함하며 종료 재요청은 AI를 중복 호출하지 않는다. 출시 전에 Anthropic rate limit 등급도 확인한다.
- **운영 위험**: Supabase 무료 프로젝트는 7일간 요청이 없으면 일시정지된다. 무료 플랜은 백업이 제한적이라 배포 전에 `supabase db dump`를 떠 둔다.
- **상황 첫 마디 검수**: 첫 마디 40개(상황 20개 × en·ja)는 AI 초안이다. 출시 전에 사람이 검수한다.
