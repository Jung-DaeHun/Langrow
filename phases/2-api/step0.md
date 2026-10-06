# Step 0: api-foundation

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 1장 "예외 흐름"의 구글 로그인 취소·실패
  - 6-1 "페이지 접근 규칙", 6-2 "레이어"
  - 6-3 보안 체크리스트 3(getUser)·4(CSRF)·8(오픈 리디렉트)·10(로그)·12(준비 상태)
  - 6-4 "공통 준비 상태 검사", 6-9 "TDD hook에 맞춘 파일 규칙", 6-10 "에러 코드"
  - 7장 "route / 페이지 접근"
- Next.js 16 문서(설치된 버전 그대로):
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` (matcher, "Unit testing")
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` (`RouteContext`, params는 Promise)
- 앞 phase 산출물:
  - `src/lib/errors.ts`(`ErrorCode`, `ERRORS`), `src/lib/readiness.ts`(`Requirement`, `checkReadiness`), `src/lib/levels.ts`
  - `src/server/db/types.ts`(`DbResult`), `src/server/db/{account,chat,learning}.ts`(함수 목록과 각 함수의 에러 코드 주석)
  - `src/services/supabase/server.ts`(`getServerSupabase`), `src/services/env.ts`(`getPublicEnv`), `src/services/claude/client.ts`(`Ai`, `createAi`)
  - `vitest.config.ts`(`server-only` alias, node/dom 프로젝트), `src/test/server-only.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

2-api는 서버 쪽 API 계약을 만든다. 이 step은 모든 API가 함께 쓰는 기반을 만든다. route 래퍼, use-case 의존성, 테스트용 가짜, proxy, OAuth 콜백이 여기에 들어간다. 실제 `/api/**` 라우트는 step 1(대화)과 step 2(학습·계정)가 만든다. 브라우저 fetch 래퍼(`services/apiClient`)는 3-ui가 만든다.

**DB 코드와 마이그레이션은 바꾸지 않는다.** 이 phase의 AC는 lint·build·test뿐이며 Docker 없이 통과해야 한다.

## 작업

파일마다 같은 폴더에 `*.test.ts`를 먼저 쓴다(TDD guard). `src/test/`와 `src/types/`의 파일은 guard 예외다.

### 1. `src/server/http.ts`: route 래퍼

```ts
import 'server-only'
export type Outcome<T> = { ok: true; value: T; status?: 202 } | { ok: false; code: ErrorCode }

export function route<B = undefined, P = undefined>(spec: {
  requirement: Requirement                 // 'login' | 'consent' | 'ready'
  params?: z.ZodType<P>                    // 경로 파라미터. 없으면 읽지 않는다
  body?: z.ZodType<B>                      // 요청 body. 없으면 body를 읽지 않는다
  handler: (ctx: { userId: string; params: P; body: B }) => Promise<Outcome<unknown>>
}): (request: Request, context: { params: Promise<…> }) => Promise<Response>
```
- `DbResult<T>`는 그대로 `Outcome<T>`로 쓸 수 있어야 한다. 단일 RPC를 부르는 route가 `getDeps().db.x(...)`의 결과를 바로 반환한다.
- 반환 함수는 Next 16 route handler로 `export const POST = route({...})`처럼 export한다. 동적 세그먼트가 있는 route(`[id]`)도 `next build`의 route 타입 검사를 통과해야 한다. context 타입은 그 검사에 맞춰 정한다.
- 처리 순서(spec 6-2). 앞 단계에서 실패하면 뒤 단계를 하지 않는다:
  1. `(await getServerSupabase()).auth.getUser()`. 사용자가 없거나 에러면 401 `UNAUTHORIZED`
  2. `Content-Type`의 media type이 `application/json`이 아니면 400 `INVALID_INPUT`. `; charset=utf-8` 같은 파라미터와 대소문자 차이는 허용한다. body가 없는 API도 이 헤더를 요구한다(CSRF 방어, 보안 체크리스트 4)
  3. `params` 스키마가 있으면 검증한다. 실패하면 404 `NOT_FOUND`다(uuid가 아닌 세션 id, 없는 언어는 존재할 수 없는 리소스다)
  4. `body` 스키마가 있으면 JSON으로 읽어 검증한다. JSON 파싱 실패와 zod 실패는 모두 400 `INVALID_INPUT`이다
  5. `requirement`가 `'login'`이 아니면 `checkReadiness(await getDeps().db.getReadiness(userId), requirement)`. 결과가 `'ok'`가 아니면 그 코드로 403을 반환한다. 언어별 레벨 확인(요청이나 세션의 언어)은 RPC가 잠근 뒤 다시 하므로 래퍼는 하지 않는다
  6. `handler` 실행
- 응답 변환:
  - 성공: `Response.json(value ?? {}, { status: outcome.status ?? 200 })`. 202는 에러가 아니다(`/end` 처리 중)
  - 실패: `{ code, message: ERRORS[code].message }`, 상태는 `ERRORS[code].status`
  - 어느 단계에서든 예외가 나면 500 `INTERNAL`이다
- 로그: 상태 400 이상인 응답만 한 줄 남긴다. 넣는 값은 `code`, `userId`(없으면 null), method, 경로(`URL.pathname`, query 제외), 처리 시간(ms)뿐이다. `INTERNAL`만 예외의 `message`를 덧붙인다. 요청 body·쿠키·이메일·대화 내용은 넣지 않는다.

### 2. `src/server/deps.ts`: use-case 의존성

```ts
import 'server-only'
import * as account from './db/account'   // chat, learning도 같은 방식
export type Db = typeof account & typeof chat & typeof learning
export type Deps = { db: Db; ai: Ai }
export function getDeps(): Deps
```
- `db`는 세 모듈의 함수를 합친 객체다. `ai`는 `createAi()`를 처음 호출할 때 한 번 만들어 재사용한다.
- deps에 `now`는 두지 않는다. 쓰는 use-case가 없고, 판정은 RPC 안의 DB 시각으로 한다.
- 테스트: env가 없어도 `getDeps()` 호출이 throw하지 않음(env는 첫 DB·AI 호출 때 검증된다), 두 번 호출해도 같은 `ai`, `db`에 세 모듈의 함수가 모두 있음.

### 3. `src/test/fakes.ts`: 테스트용 가짜

```ts
export function createFakeDb(overrides?: Partial<Db>): Mocked<Db>
export function createFakeAi(overrides?: Partial<Ai>): Mocked<Ai>
export function createFakeDeps(overrides?: { db?: Partial<Db>; ai?: Partial<Ai> }): { db: Mocked<Db>; ai: Mocked<Ai> }
```
- 모든 함수는 `vi.fn`이고, 기본값은 정상 경로의 성공 결과다. `getReadiness`는 준비된 계정(동의함, 현재 언어와 그 레벨 있음), `beginChatTurn`은 `scenarioId`가 `src/lib/scenarios.ts`에 있는 상황인 예약 성공, AI는 성공 응답이다.
- 테스트는 `overrides`나 `mockResolvedValueOnce`로 결과를 바꾸고, 호출 인자와 `mock.invocationCallOrder`로 순서를 검증한다.
- **RPC 규칙(잠금·한도·상태 전이)을 메모리에서 다시 구현하지 않는다.** 그 동작은 1-data의 `test:db`가 증명했다.

### 4. `src/lib/paths.ts`: 보호 페이지 판정

```ts
export const PROTECTED_PAGES: readonly string[]   // '/onboarding', '/home', '/chat', '/words', '/level-up', '/kana', '/account'
export function isProtectedPage(pathname: string): boolean
```
- 경로 세그먼트 기준이다. `/chat`과 `/chat/abc`는 보호 페이지이고, `/homework`와 `/chatty`는 아니다.
- 테스트: 공개 경로(`/`, `/privacy`, `/terms`, `/auth/callback`)는 false, 보호 경로와 그 하위 경로는 true, 접두어만 같은 경로는 false.

### 5. `src/proxy.ts`

```ts
export async function proxy(request: NextRequest): Promise<NextResponse>
export const config = { matcher: [...] }
```
- `@supabase/ssr`의 `createServerClient<Database>`와 `getPublicEnv()`로 세션을 갱신한다. 쿠키는 request에서 읽고, `setAll`로 받은 쿠키는 request와 응답 양쪽에 쓴다(Supabase SSR proxy 패턴). 그 뒤 `auth.getUser()`로 사용자를 확인한다.
- 사용자가 없고 `isProtectedPage(pathname)`이면 `/`로 redirect한다. 이때 `setAll`로 받은 쿠키를 redirect 응답에도 싣는다. 그 밖에는 그대로 통과시킨다.
- 동의·레벨에 따른 `/onboarding` 이동은 하지 않는다. 그 이동은 3-ui 페이지가 한다.
- `matcher`는 리터럴 상수로 쓴다. `api`, `_next/static`, `_next/image`, `favicon.ico`, 이미지 확장자 파일을 뺀다. `/api/**`는 route 래퍼의 `getUser()`가 인증하고 세션을 갱신하므로, 여기서 빼서 Auth 서버를 두 번 왕복하지 않게 한다.
- 테스트(`vi.mock('@supabase/ssr')`로 `createServerClient`를 대신한다. `getUser` 결과를 정하고 `setAll`을 부를 수 있는 가짜를 쓴다. env는 `vi.stubEnv`):
  - 비로그인일 때 `/home`과 `/chat/x`는 `/`로 redirect한다(`getRedirectUrl` from `next/experimental/testing/server`)
  - 비로그인일 때 `/`, `/privacy`, `/terms`, `/auth/callback`, `/homework`는 통과한다
  - 로그인 상태의 `/home`은 통과한다
  - `setAll`로 받은 쿠키가 통과 응답과 redirect 응답 모두에 실린다
  - `unstable_doesProxyMatch`로 확인한다: `/api/chat/sessions`, `/_next/static/x.js`, `/favicon.ico`는 false이고, `/home`, `/`, `/auth/callback`은 true다

### 6. `src/app/auth/callback/route.ts`

```ts
export async function GET(request: NextRequest): Promise<NextResponse>
```
- query의 `code`가 없으면 `/?login=failed`로 redirect한다. 구글에서 취소하면 `error` 파라미터만 붙어 돌아온다.
- `(await getServerSupabase()).auth.exchangeCodeForSession(code)`가 에러면 `/?login=failed`로 보내고 `ensureProfile`을 부르지 않는다.
- 성공하면 `getDeps().db.ensureProfile(user.id)`를 부른 뒤 `/home`으로 redirect한다. 준비 상태에 따른 이동은 3-ui의 `/home`이 한다.
- redirect URL은 `new URL('/home', request.url)`처럼 고정 경로로 만든다. `next`·`redirect_to` 같은 파라미터는 읽지 않는다(오픈 리디렉트, 보안 체크리스트 8).
- 테스트(`@/services/supabase/server`와 `@/server/deps`만 mock한다):
  - code 없음 → 실패 이동
  - 교환 에러 → 실패 이동, `ensureProfile` 미호출
  - 성공 → `ensureProfile(userId)` 후 `/home`
  - `?code=x&next=https://evil.example`이어도 `/home`

### 7. `src/types/api.ts`

```ts
export type ApiError = { code: ErrorCode; message: string }
```
API별 응답 타입은 step 1·2가 이 파일에 추가한다. 3-ui의 브라우저 코드가 이 파일을 import한다.

### 8. `src/server/http.test.ts`

테스트용 route를 `route({...})`로 만들어 검증한다. mock하는 것은 `@/services/supabase/server`(`getUser`)와 `@/server/deps`(`createFakeDeps`)뿐이다.
- 401: 사용자 없음. 이때 body와 준비 상태는 읽지 않는다
- 400: Content-Type이 없거나 `text/plain`, 깨진 JSON, zod 실패. `application/json; charset=utf-8`은 통과한다
- 404: params 검증 실패
- 403: `CONSENT_REQUIRED`·`ONBOARDING_REQUIRED`일 때 handler를 부르지 않는다. `requirement: 'login'`은 미동의 사용자도 통과하고 `getReadiness`를 부르지 않는다. `'consent'`는 레벨이 없어도 통과한다
- handler 결과 변환: 성공은 200과 value, null value는 `{}`, `status: 202`는 202, 각 에러 코드는 `ERRORS`의 상태와 `{ code, message }`
- 500: handler·`getUser`·`getReadiness`가 throw하면 500 `INTERNAL`
- 로그: `console`을 spy해서 확인한다. 실패 응답 로그에 body 문자열이 없어야 하고, 성공 응답은 로그를 남기지 않는다

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -rn "getSession(" src --include=*.ts --include=*.tsx
for f in src/server/*.ts; do case "$f" in *.test.ts|*/types.ts) ;; *) grep -qE "import ['\"]server-only['\"]" "$f" || { echo "server-only 없음: $f"; exit 1; } ;; esac; done
for f in $(find src/app -name route.ts); do [ -f "$(dirname "$f")/route.test.ts" ] || { echo "테스트 없음: $f"; exit 1; }; done
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/server/http.ts`, `src/proxy.ts`, `src/test/fakes.ts`)
   - ADR-002(deps 주입, 가짜로 분기 테스트), ADR-010(래퍼에서 준비 상태 검사)을 따르는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`getUser()`만 쓰기, body의 userId 무시, admin 클라이언트 지연 생성으로 env 없이 build 통과)
3. 결과에 따라 `phases/2-api/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 다음 step이 그대로 쓸 수 있게 다음을 넣는다: `route()`의 옵션 이름과 동적 세그먼트 route의 export 형태, `Outcome` 타입, `getDeps`/`Deps`/`Db`, `createFakeDeps` 사용법, route 테스트에서 mock한 모듈과 요청을 만드는 방법, 로그인 실패 이동 경로(`/?login=failed`)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `getSession()`으로 사용자를 판단하지 마라. 이유: 토큰을 검증하지 않는다(보안 체크리스트 3).
- body나 query의 userId를 읽거나 쓰지 마라. 이유: CLAUDE.md CRITICAL. 사용자 ID는 `getUser()`로만 얻는다.
- proxy에서 DB를 조회해 동의·레벨을 검사하지 마라. 이유: proxy는 모든 페이지 요청마다 돈다. `/onboarding` 이동은 3-ui 페이지가 한다.
- 로그에 요청 body, 대화 내용, 이메일, 쿠키를 넣지 마라. 이유: 보안 체크리스트 10.
- 가짜 db에 RPC 규칙(한도·잠금·상태 전이)을 다시 구현하지 마라. 이유: 두 구현이 어긋나고, 그 동작은 `test:db`가 증명한다.
- Supabase 쿼리 체인을 mock하지 마라. hook 통과만을 위한 빈 테스트도 만들지 마라. 이유: CLAUDE.md 개발 프로세스.
- 모듈 최상위에서 `getDeps()`, env, Supabase·Anthropic 클라이언트를 만들지 마라. 이유: env 없이 `next build`가 통과해야 한다.
- `/auth/callback`에서 query 파라미터로 이동 경로를 정하지 마라. 이유: 오픈 리디렉트(보안 체크리스트 8).
- `src/services/apiClient.ts`, 페이지, 컴포넌트를 만들지 마라. 이유: 3-ui 범위다.
- `supabase/config.toml`의 auth 설정(구글 provider, redirect URL)을 바꾸지 마라. 이유: 구글 OAuth 로컬 설정은 수동 E2E 준비 때 사용자가 Google 콘솔 키와 함께 한다.
- `src/server/db/*`, `supabase/migrations/*`, `src/services/*`를 고치지 마라. 이유: 1-data·0-foundation에서 검증한 계약이다. 막히면 고치지 말고 error로 보고한다.
- 기존 테스트를 깨뜨리지 마라
