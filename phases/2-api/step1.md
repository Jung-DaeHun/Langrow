# Step 1: chat-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 2장 "대화 진행"(특히 1·5·6·7번), "대화 1턴 처리", "처리 중단 복구", "세션 종료 피드백"
  - 6-6 "Claude 연동"(호출 예산, `maxDuration = 60`, 같은 작업 토큰), 6-10 "에러 코드"
  - 7장 use-case 테스트의 "대화"·"`/end`"·"보안" 항목, "route / 페이지 접근"
- step 0 산출물: `src/server/http.ts`(`route`, `Outcome`), `src/server/deps.ts`(`getDeps`, `Deps`), `src/test/fakes.ts`(`createFakeDeps`), `src/types/api.ts`, `src/server/http.test.ts`, `src/app/auth/callback/route.test.ts`(route 테스트에서 mock하는 방법)
- 앞 phase 산출물:
  - `src/server/db/chat.ts`: `ChatSessionInfo`, `EndResult`, `BeginEndResult`, 그리고 함수마다 주석으로 적힌 에러 코드
  - `src/services/claude/client.ts`(`Ai`, `AiFailureReason`, 재시도 1번 내장), `src/services/claude/prompts.ts`(`TurnPromptInput`, `FeedbackPromptInput`), `src/services/claude/schemas.ts`(`TurnReply`, `Feedback`)
  - `src/lib/scenarios.ts`(`findScenario`), `src/lib/text.ts`(`isValidChatInput`), `src/lib/levels.ts`(`LANGUAGES`, `isLevel`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

대화 1턴은 **예약 RPC → (잠금 밖에서) Claude → 성공 또는 실패 확정 RPC**다. 종료는 **`beginEnd` → Claude 피드백 → `finishEnd` 또는 `failEnd`**다. 잠금·한도·토큰 만료 복구는 RPC가 이미 한다(1-data, test:db로 검증). 이 step의 use-case는 RPC 결과에 따라 AI를 부를지 정하고, 결과를 HTTP 응답으로 바꾼다.

## 작업

파일마다 같은 폴더에 `*.test.ts`(route는 `route.test.ts`)를 먼저 쓴다.

### 1. 응답 타입: `src/types/api.ts`에 추가

```ts
export type ChatSessionCreated = { sessionId: string }
export type ChatMessageResponse = { turnNo: number; turnsLeft: number; reply: TurnReply }   // reply는 DB에 저장되는 형태 그대로(reply_ko, correction.explanation_ko)
export type ChatEndResponse =
  | ({ status: 'ended' } & EndResult)                          // 200
  | { status: 'ending'; retryAfterSeconds: number }            // 202
```
`TurnReply`와 `EndResult`는 `import type`으로 가져온다. 3-ui가 페이지에서 읽은 DB 행과 API 응답을 같은 형태로 그릴 수 있게, AI 결과는 바꾸지 않고 그대로 내보낸다.

### 2. `src/server/chat.ts`: use-case

```ts
import 'server-only'
export const END_RETRY_AFTER_SECONDS = 2
export async function startChatSession(deps: Deps, userId: string,
  input: { language: Language; level: Level; scenarioId: string }): Promise<Outcome<ChatSessionCreated>>
export async function sendChatMessage(deps: Deps, userId: string, sessionId: string, text: string): Promise<Outcome<ChatMessageResponse>>
export async function endChatSession(deps: Deps, userId: string, sessionId: string): Promise<Outcome<ChatEndResponse>>
```

**`startChatSession`**
- `findScenario(scenarioId)`가 없거나 그 상황의 `level`이 `input.level`과 다르면 `INVALID_INPUT`이다. 이때 DB를 부르지 않는다(spec 2장 1번).
- 그 밖에는 `db.createChatSession(userId, input)` 결과를 그대로 돌려준다. 실제 레벨이 다르면 RPC가 `CONFLICT`를 준다.

**`sendChatMessage`** (spec 2장 "대화 1턴 처리")
1. `userText = text.trim()`. 예약과 AI 모두 이 값을 쓴다.
2. `db.beginChatTurn(userId, sessionId, userText)`. 거부되면 그 코드를 그대로 돌려주고 AI를 부르지 않는다.
3. 언어·레벨·상황은 **요청이 아니라 예약 결과의 `session`**에서 가져온다. `findScenario(session.scenarioId)`가 없으면 throw한다. 상황 상수에서 항목이 빠진 버그이며, 예약은 90초 뒤 RPC가 복구한다.
4. `ai.generateTurn({ language, level, scenario, history, userText })`
5. 성공하면 `db.finishChatTurn(userId, sessionId, token, reply)`를 부른다.
   - 성공: `{ turnNo, turnsLeft, reply }`를 돌려준다.
   - 실패(`CONFLICT` 등): 그 코드를 돌려주고 AI 응답은 버린다. 만료되거나 교체된 토큰의 결과는 저장하지도 보여 주지도 않는다.
6. AI가 실패하면 `db.failChatTurn(userId, sessionId, token, reason)`를 부른다.
   - 성공: `AI_UNAVAILABLE`(503)을 돌려준다.
   - 실패: 그 코드(`CONFLICT`)를 돌려준다.

**`endChatSession`** (spec 2장 "세션 종료 피드백", ADR-005)
1. `db.beginEnd(userId, sessionId)`. 거부되면 그 코드를 돌려준다. 턴 처리 중이면 `CONFLICT`다.
2. `state: 'ended'`이면 `{ status: 'ended', ...result }`를 돌려준다(200). 저장된 결과를 그대로 쓰고 AI를 부르지 않는다.
3. `state: 'ending'`이면 `{ ok: true, status: 202, value: { status: 'ending', retryAfterSeconds: END_RETRY_AFTER_SECONDS } }`를 돌려준다. AI를 부르지 않는다.
4. `state: 'reserved'`이면 상황을 찾는다(없으면 throw). 그다음 `ai.generateFeedback({ language, level, scenario, turns })`를 부른다.
   - 성공: `db.finishEnd(userId, sessionId, token, feedback)`
   - 실패: `db.failEnd(userId, sessionId, token, reason)`
   - 두 RPC 모두 성공하면 `{ status: 'ended', ...result }`(200, ready 또는 fallback), 실패하면 그 코드를 돌려준다.
5. `finishEnd`·`failEnd`가 throw하면 그대로 throw한다(래퍼가 500으로 바꾼다). AI와 DB를 다시 부르지 않는다. 다음 `/end`는 202를 받고, 기한이 지나면 RPC가 fallback으로 끝낸다(spec 6-6 "DB 확정 재시도 때문에 AI 호출을 새로 시작하지 않는다").

### 3. route

| 파일 | 준비 상태 | params | body | handler |
|---|---|---|---|---|
| `src/app/api/chat/sessions/route.ts` (POST) | ready | – | `{ language: enum LANGUAGES, level: 1~5 정수, scenario_id: 비지 않은 짧은 문자열 }` | `startChatSession(getDeps(), userId, { language, level, scenarioId: body.scenario_id })` |
| `src/app/api/chat/sessions/[id]/messages/route.ts` (POST) | ready | `{ id: uuid }` | `{ text: string }`, `isValidChatInput`으로 검증(앞뒤 공백 제거 뒤 1~300자) | `sendChatMessage(getDeps(), userId, params.id, body.text)` |
| `src/app/api/chat/sessions/[id]/end/route.ts` (POST) | ready | `{ id: uuid }` | 없음 | `endChatSession(getDeps(), userId, params.id)` |

- messages와 end route는 `export const maxDuration = 60`이다(spec 6-6). 리터럴로 쓴다.
- route 파일은 `export const POST = route({...})` 한 덩어리로 얇게 둔다. 판단은 use-case에 둔다.
- 요청 body는 spec처럼 snake_case(`scenario_id`)이고, 응답은 camelCase다.

### 4. 테스트 (먼저 작성)

**`src/server/chat.test.ts`** (`createFakeDeps` 사용. 실제 네트워크 없음)
- 세션 생성
  - 없는 상황, 다른 레벨의 상황 → `INVALID_INPUT`, `createChatSession` 미호출
  - 정상 → `sessionId`
  - RPC `CONFLICT` → 그대로 반환
- 메시지
  - `beginChatTurn`이 `NOT_FOUND`, `CONSENT_REQUIRED`, `ONBOARDING_REQUIRED`, `CONFLICT`, `AI_FAILURE_LIMIT`, `SESSION_FULL`, `LIMIT_REACHED`를 주면 같은 코드를 반환하고, `generateTurn`·`finishChatTurn`·`failChatTurn`을 부르지 않는다
  - 정상: 호출 순서 `beginChatTurn → generateTurn → finishChatTurn`. `"  hi  "` 입력은 예약과 AI에 `"hi"`로 간다. AI 입력의 언어·레벨·상황·history는 예약 결과의 세션 값이다. 응답은 `{ turnNo, turnsLeft, reply }`다
  - AI 실패: `failChatTurn(userId, sessionId, token, reason)` 뒤 `AI_UNAVAILABLE`, `finishChatTurn` 미호출
  - `failChatTurn`이 `CONFLICT`면 `CONFLICT`
  - `finishChatTurn`이 `CONFLICT`면 `CONFLICT`이고, 결과에 AI 응답이 없다
- 종료
  - `beginEnd` 거부(`NOT_FOUND`, `CONFLICT` 등) → 같은 코드, AI 미호출
  - `ended`(ready·fallback·skipped) → 저장된 결과, AI 미호출
  - `ending` → `status: 202`와 `{ status: 'ending', retryAfterSeconds: 2 }`, AI 미호출
  - `reserved`
    - AI 성공: `generateFeedback` 입력이 세션의 언어·레벨·상황과 `turns`이고, `finishEnd(…, token, feedback)` → ready
    - AI 실패: `failEnd(…, token, reason)` → fallback 200
    - `finishEnd`가 `CONFLICT`면 `CONFLICT`
    - `finishEnd`가 throw하면 reject되고, `generateFeedback`은 1번만 호출되며 `failEnd`는 부르지 않는다

**route 테스트** (각 `route.test.ts`. step 0의 route 테스트처럼 `@/services/supabase/server`와 `@/server/deps`만 mock한다)
- 비로그인 → 401
- 미동의 → 403 `CONSENT_REQUIRED`, 레벨 미설정 → 403 `ONBOARDING_REQUIRED`. 두 경우 모두 db의 대화 함수와 AI를 부르지 않는다
- 잘못된 입력 → 400
  - sessions: 없는 언어, level 0·6·`"3"`, `scenario_id` 누락
  - messages: `text` 누락, 빈 문자열, 공백만, 301자
- uuid가 아닌 `[id]` → 404
- 정상 연결: 가짜 deps의 결과가 응답 body로 나오고, use-case가 `userId`와 params·body 값을 받는다. body에 `userId`를 넣어도 쓰이지 않는다
- end: `ending` 결과 → 202와 `retryAfterSeconds`
- messages·end의 `maxDuration`이 60이다

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -rn "getSession(" src --include=*.ts --include=*.tsx
for f in src/server/*.ts; do case "$f" in *.test.ts|*/types.ts) ;; *) grep -qE "import ['\"]server-only['\"]" "$f" || { echo "server-only 없음: $f"; exit 1; } ;; esac; done
for f in $(find src/app -name route.ts); do [ -f "$(dirname "$f")/route.test.ts" ] || { echo "테스트 없음: $f"; exit 1; }; done
grep -q "maxDuration = 60" "src/app/api/chat/sessions/[id]/messages/route.ts" && grep -q "maxDuration = 60" "src/app/api/chat/sessions/[id]/end/route.ts"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (route는 얇게, 판단은 `src/server/chat.ts`)
   - ADR-004(예약 → AI → 확정, 만료·교체 토큰 결과 폐기), ADR-005(202, fallback, AI 중복 호출 없음)를 따르는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (Claude 호출은 use-case에서만, DB 잠금 중 AI 호출 없음)
3. 결과에 따라 `phases/2-api/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 3-ui가 쓸 수 있게 API 3개의 경로·body·응답 타입(`src/types/api.ts`)·상태 코드를 넣는다
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `beginChatTurn`·`beginEnd`가 성공하기 전에 AI를 부르지 마라. 이유: 한도·실패 횟수·세션 상태 검사를 우회해 비용이 샌다(spec 2장).
- 메시지 처리에서 요청 body의 언어·레벨로 프롬프트를 만들지 마라. 이유: 세션에 저장된 언어·레벨로 이어서 대화한다(spec 2장 "대화 1턴 처리" 1번).
- use-case에 AI 재시도를 추가하지 마라. 이유: `createAi`가 이미 1번 재시도한다. 더하면 호출 예산 약 40초와 `maxDuration` 60초를 넘는다.
- `finishEnd`·`failEnd`·`finishChatTurn` 실패나 예외 뒤에 AI를 다시 부르거나 DB 확정을 반복하지 마라. 이유: spec 6-6. 만료 복구는 다음 요청의 RPC가 한다.
- 서버에서 `ending`이 끝나기를 기다리지(sleep·polling) 마라. 이유: 202와 `retryAfterSeconds`를 주면 클라이언트가 다시 확인한다.
- 대화 내용(입력, AI 응답, 피드백)을 로그나 에러 메시지에 넣지 마라. 이유: 보안 체크리스트 10.
- 응답 스트리밍을 쓰지 마라. 이유: MVP 제외 사항이다.
- 테스트에서 실제 Anthropic API나 Supabase를 부르지 마라.
- `src/server/db/*`, `src/services/*`, `src/server/http.ts`의 동작을 바꾸지 마라. 이유: 앞 step에서 검증한 계약이다. 막히면 고치지 말고 error로 보고한다.
- 기존 테스트를 깨뜨리지 마라
