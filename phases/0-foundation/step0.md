# Step 0: project-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `CLAUDE.md` (기술 스택, 명령어, TDD 규칙)
- `docs/ARCHITECTURE.md` (디렉토리 구조, 환경변수 목록)
- `docs/spec/plan.md` 6-7 "환경과 배포"(버전 고정), 6-9 "TDD hook에 맞춘 파일 규칙"
- `docs/spec/ui.md` "토큰" 절의 첫 줄 (Tailwind v4 기준)
- `scripts/hooks/tdd-guard.sh`: `package.json`이 생기는 순간부터 모든 `.ts(x)` 편집에 같은 폴더의 테스트 파일을 요구한다
- `.claude/settings.json`: Stop hook이 `npm run lint && npm run build && npm run test`를 돌린다
- `.gitignore`, `.env.local`: 값이 출력되지 않게 `sed 's/=.*//' .env.local`로 키 목록과 주석만 본다. 파일을 통째로 읽거나 수정하지 않는다

이 step은 저장소의 첫 코드 step이다. 아직 `package.json`이 없다.

## 작업

### 1. Next.js 스캐폴딩
- 최신 안정 버전 `create-next-app`으로 TypeScript, App Router, Tailwind CSS, ESLint, `src/` 디렉토리, import alias `@/*`를 켠 프로젝트를 만든다. 대화형 질문이 나오지 않게 플래그를 모두 지정한다.
- **임시 폴더(Claude 스크래치 경로 등 저장소 밖)에서 생성한 뒤 필요한 파일만 저장소 루트로 옮긴다.** 옮길 것: `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `src/`. 스캐폴딩의 `.gitignore`·`README.md`는 옮기지 않는다. 기존 `.gitignore`에 빠진 Next.js 항목이 있으면 추가만 한다.
- `package.json`의 `name`은 `langrow`로 둔다.
- 스캐폴딩 기본 화면을 걷어낸다.
  - `src/app/page.tsx`: "Langrow" 한 줄만 그리는 최소 페이지. 랜딩은 `3-ui` phase에서 만든다.
  - `src/app/layout.tsx`: `<html lang="ko">`, metadata title "Langrow". Geist 등 기본 폰트 import를 지운다. 폰트는 `3-ui`에서 Pretendard로 넣는다.
  - `src/app/globals.css`: `@import "tailwindcss";`만 남긴다. 다크 모드 변수와 `prefers-color-scheme` 규칙을 지운다(라이트 모드만 지원).
  - `public/`의 기본 svg와 `src/app/favicon.ico`는 지운다.

### 2. 의존성 (정확한 버전으로 고정)
- 런타임: `@supabase/supabase-js`, `@supabase/ssr`, `@anthropic-ai/sdk`, `zod`, `server-only`
- 개발: `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`, `@testing-library/jest-dom`, `supabase`(CLI), 필요하면 `vite-tsconfig-paths`
- `.npmrc`에 `save-exact=true`를 두고, `package.json`의 모든 버전에서 `^`/`~`를 지운다.
- 위 목록 밖의 패키지(lucide-react, pretendard, tsx, pg 등)는 설치하지 않는다. 그 패키지를 쓰는 step에서 설치한다.
- `CLAUDE.md` "기술 스택"의 `Next.js {버전}, @supabase/supabase-js {버전}, @anthropic-ai/sdk {버전}`을 실제 설치 버전으로 채운다. Next.js가 16 이상이면 그 줄 아래에 "미들웨어 파일은 `src/proxy.ts`, `params`·`cookies()`는 async"를 한 줄 덧붙인다.

### 3. Vitest 설정 2개
- `vitest.config.ts` (`npm run test`)
  - include: `src/**/*.test.{ts,tsx}`, `scripts/**/*.test.ts`
  - exclude: `src/server/db/**`(DB 통합 테스트), `node_modules`
  - `server-only`를 빈 모듈 `src/test/server-only.ts`로 alias한다. 경로에 `test`가 있어 TDD guard 대상이 아니다.
  - `@/*` alias를 해석한다.
  - `*.test.tsx`는 jsdom, `*.test.ts`는 node 환경에서 돈다. jest-dom matcher는 `src/test/setup.ts`에서 등록한다.
  - `passWithNoTests: true` (지금은 테스트가 없다)
- `vitest.db.config.ts` (`npm run test:db`)
  - include: `src/server/db/**/*.test.ts`만, node 환경
  - 같은 로컬 DB를 쓰므로 테스트 파일을 병렬로 돌리지 않는다.
  - `passWithNoTests: true`. DB 연결 설정은 `1-data` phase에서 추가한다.

### 4. npm scripts
`dev`, `build`, `lint`, `test`(`vitest run`), `test:db`(`vitest run -c vitest.db.config.ts`). `seed:words`는 스크립트 파일을 만드는 step에서 추가한다.

### 5. 환경변수 예시 파일
- `.env.example`을 만든다. 키 목록과 주석은 `.env.local`과 같게 하고 비밀값은 비운다. 비밀이 아닌 기본값(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `CLAUDE_MODEL=claude-haiku-4-5-20251001`)은 그대로 둔다.
- `.gitignore`의 `.env*` 아래에 `!.env.example`을 추가해 예시 파일만 추적되게 한다.

## Acceptance Criteria

```bash
npm run lint
npm run build      # env 값이 비어 있어도 통과해야 한다
npm run test       # 테스트 0개로 통과
npm run test:db    # 테스트 0개로 통과 (Docker 불필요)
git check-ignore -q .env.local && ! git check-ignore -q .env.example   # .env.local은 무시, .env.example은 추적
! grep -q "{버전}" CLAUDE.md                                           # 버전 자리표시자가 남지 않음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/app`과 `src/test`만 있고 나머지 폴더는 아직 만들지 않는다)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-foundation/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (설치한 Next.js·supabase-js·Anthropic SDK·zod·Vitest 버전과 Vitest 설정 파일 이름을 포함)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `create-next-app`을 저장소 루트에서 직접 실행하지 마라. 이유: 기존 파일(`CLAUDE.md`, `docs/`, `scripts/`, `.claude/`) 때문에 생성이 거부되거나 `.gitignore`를 덮어쓴다.
- `.env.local`을 수정·삭제하거나 커밋하지 마라. 이유: 사용자가 비밀값을 채우는 파일이다.
- `scripts/execute.py`, `scripts/test_execute.py`, `scripts/hooks/`, `.claude/`를 바꾸지 마라. 이유: 하네스 실행기와 hook이다.
- hook 통과만을 위한 빈 테스트를 만들지 마라. 이유: CLAUDE.md 규칙. 테스트가 없는 상태는 `passWithNoTests`로 통과시킨다.
- `src/lib`, `src/server`, `src/services`, `src/components` 아래에 코드를 만들지 마라. 이유: 다음 step들의 범위다.
- 기존 테스트를 깨뜨리지 마라
