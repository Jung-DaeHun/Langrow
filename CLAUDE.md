# 프로젝트: Langrow (가칭)

한국인 학습자를 위한 AI 언어 학습 웹 서비스(영어·일본어). MVP의 목적은 수요 검증이다.
- 요약 규칙: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ADR.md`, `docs/UI_GUIDE.md`
- 상세 동작: `docs/spec/`. 요약 문서와 다르면 spec이 기준이며, 요약 문서를 고친다. 작업에 필요한 파일만 읽는다.
  - `journey.md` 유저 저니, 홈 구조, 연속 학습일, 예외 흐름, 화면 목록, 페이지 접근
  - `metrics.md` 이벤트·지표 수집, 수요 검증 기준
  - `chat.md` AI 대화: 턴 처리, 처리 중단 복구, 레벨별 조절·후리가나, 종료 피드백
  - `words.md` 단어 학습, 오답 복습, AI 정답 설명, 가나 익히기, 레벨업 테스트
  - `usage.md` 플랜 한도, 사용량 세는 법, 무료 체험, 비용 추정
  - `backend.md` 레이어, 데이터 접근과 보안(RPC·잠금·권한), API, 데이터 모델, Claude 연동, 에러 코드
  - `ops.md` 환경과 배포, 출시 최소 요건
  - `testing.md` TDD hook 파일 규칙, 테스트 목록
  - `ui.md` UI 상세 규격(토큰 값, 컴포넌트 클래스, 화면별 구성). 화면·컴포넌트 step에서 읽는다.

## 기술 스택
- Next.js (App Router), TypeScript strict mode, Tailwind CSS
- Supabase: Auth(구글), Postgres, RLS, RPC(DB 함수)
- Anthropic SDK: 기본 모델 `claude-sonnet-5-5` (환경변수 `CLAUDE_MODEL`로 변경, `output_config.effort`를 받는 모델이어야 함)
- zod, Vitest, Vercel(icn1)
- 버전은 프로젝트 셋업 때 고정하고 여기에 적는다: Next.js 16.3.8, @supabase/supabase-js 2.117.2, @anthropic-ai/sdk 0.131.0
- 미들웨어 파일은 `src/proxy.ts`, `params`·`cookies()`는 async

## 아키텍처 규칙
- CRITICAL: 쓰기와 Claude 호출은 `src/app/api/**/route.ts` → `src/server/` use-case에서만 한다. 페이지(Server Components)는 읽기만 하고, 브라우저는 로그인·로그아웃에만 Supabase를 직접 쓴다.
- CRITICAL: admin(secret key) 클라이언트로 하는 모든 조회·변경에 `user_id`를 건다. 남의 리소스는 404다. 사용자 ID는 `getUser()`로 얻고 body의 userId는 받지 않는다.
- CRITICAL: 여러 행의 판정과 변경(한도, 세션 상태, 레벨, 활동일·연속일)은 RPC 한 번으로 묶는다. 쓰기 RPC는 먼저 `profiles WHERE id = userId FOR UPDATE`를 잡는다. Claude 호출 중에는 DB 잠금을 잡지 않는다.
- CRITICAL: 날짜·플랜·한도·작업 기한은 RPC 안의 DB 시각으로 판정한다(한국 날짜 = UTC+9). 클라이언트가 보낸 날짜·플랜·사용량을 믿지 않는다.
- CRITICAL: `dangerouslySetInnerHTML`을 쓰지 않는다. AI 출력은 텍스트로만 그리고, 후리가나는 React `<ruby>` 요소로 만든다.
- CRITICAL: secret에 `NEXT_PUBLIC_`을 붙이지 않는다. admin 클라이언트는 `import 'server-only'`로 막고 함수 안에서 지연 생성한다(env 없이도 `next build`가 통과해야 함).
- 의존 방향은 app → server → services, lib다. `src/lib/`는 순수 함수만 둔다(I/O·환경변수·fetch 없음).
- 구현 파일 경로에 `test`라는 문자열을 넣지 않는다(예: 레벨업 테스트는 `/level-up`). TDD guard가 그런 경로를 검사하지 않기 때문이다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- TDD guard는 예외(설정·타입·`page`/`layout` 등)를 뺀 모든 `.ts(x)`에 같은 폴더의 `*.test.ts(x)`를 요구한다. hook 통과용 빈 테스트나 Supabase 쿼리 체인 mock 테스트는 만들지 않는다.
- `src/server/db/*.test.ts`는 실제 DB 통합 테스트다. `npm run test`에서 제외하고 `npm run test:db`에서 실행한다. RPC·마이그레이션·DB 접근 코드를 바꾸면 반드시 `test:db`를 돌린다.
- Stop hook이 lint·build·test를 돌린다. 이 셋은 Docker와 env 없이 통과해야 한다.
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev         # 개발 서버
npm run build       # 프로덕션 빌드
npm run lint        # ESLint
npm run test        # 테스트 (가짜 db, Docker 불필요)
npm run test:db     # DB 통합 테스트 (로컬 Supabase 필요: supabase start)
npm run words:generate -- --language ja --level 1 [--model <id>]  # 단어 생성 (Anthropic API, 새 파일만 씀. 검수 후 커밋)
npm run seed:words  # 단어 seed (data/words/*.json → Supabase)
npm run metrics [-- --launch 2026-11-01]  # 수요 검증 지표 (분자/분모, METRICS_EXCLUDED_USER_IDS 제외)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
