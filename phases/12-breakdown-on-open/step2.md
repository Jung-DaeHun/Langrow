# Step 2: breakdown-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md` "문장 뜯어보기" 아래 "처음 열 때 만들기" 전체(이 step의 기준이다)
- `docs/spec/backend.md` "API"(표의 `/breakdown` 줄), "공통 준비 상태 검사", "보안 체크리스트" 9번, "에러 코드"(`NOT_FOUND`·`AI_FAILURE_LIMIT`·`AI_UNAVAILABLE`·`CONFLICT` 줄과 표 위 문단)
- `docs/spec/testing.md` "use-case" 항목의 "문장 뜯어보기"와 "route / 페이지 접근"
- `docs/ADR.md` ADR-027
- 기존 코드:
  - `src/server/learning.ts` `explainWord`·`saveExplanation`(가장 가까운 선례: 예약 → AI → 실패 RPC/저장, 저장 실패 로그, 실패 한도 문구 바꾸기)·`learning.test.ts`
  - `src/server/chat.ts`(대화 use-case와 문구 상수 모양)·`chat.test.ts`
  - `src/app/api/words/explain/route.ts`·`route.test.ts`, `src/app/api/chat/sessions/[id]/messages/route.ts`(params 검증)
  - `src/server/http.ts`(`route()`·`Outcome`), `src/types/api.ts`
  - step 0·1 산출물: `src/server/db/chat.ts`의 `beginTurnBreakdown`·`failTurnBreakdown`·`saveTurnBreakdown`, `src/lib/breakdown.ts`의 `BreakdownTarget`·`BREAKDOWN_TARGETS`, `src/services/claude/client.ts`의 `generateBreakdown`, `src/test/fakes.ts`

## 배경

문장 뜯어보기를 처음 열 때 그 문장 하나만 만들어 저장한다(ADR-027). step 0이 RPC·db 함수를, step 1이 `ai.generateBreakdown`을 만들었다. 이 step은 둘을 잇는 use-case와 라우트 `POST /api/chat/sessions/[id]/breakdown`을 만든다. 화면(step 3)은 하지 않는다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. `src/types/api.ts`

```ts
// POST /api/chat/sessions/[id]/breakdown. 검사를 통과해 원래 문장을 조각 경계에서 자른 조각이다
export type ChatBreakdownResponse = { breakdown: Breakdown };
```

### 2. use-case (`src/server/chat.ts`)

```ts
export const BREAKDOWN_UNAVAILABLE_MESSAGE = "뜯어보기를 만들지 못했어요. 다시 눌러 주세요.";
export const BREAKDOWN_FAILURE_LIMIT_MESSAGE = "오늘은 응답 오류가 많아 문장 뜯어보기를 잠시 쉬어요. 내일 다시 시도해 주세요.";
export const BREAKDOWN_IN_PROGRESS_MESSAGE = "뜯어보기를 만드는 중이에요. 잠시 뒤 다시 눌러 주세요.";

export async function openChatBreakdown(
  deps: Deps,
  userId: string,
  sessionId: string,
  input: { turn_no: number; target: BreakdownTarget },
): Promise<Outcome<ChatBreakdownResponse>>;
```

1. `deps.db.beginTurnBreakdown(userId, sessionId, input.turn_no, input.target)`.
   - 실패 코드는 그대로 돌려준다. 다만 `AI_FAILURE_LIMIT`은 `BREAKDOWN_FAILURE_LIMIT_MESSAGE`를, `CONFLICT`는 `BREAKDOWN_IN_PROGRESS_MESSAGE`를 `message`로 붙인다(`explainWord`가 실패 한도 문구를 바꾸는 방식과 같다).
   - `stored`면 그 값을 돌려주고 끝난다. AI와 저장 RPC를 부르지 않는다.
2. `started`면 `deps.ai.generateBreakdown({ language, level, target, sentence })`.
3. AI가 실패하면 `deps.db.failTurnBreakdown(userId, sessionId, turn_no, target, until, reason)`을 부른다. 그 결과가 성공이면 `AI_UNAVAILABLE`과 `BREAKDOWN_UNAVAILABLE_MESSAGE`를, 실패면 그 결과를 돌려준다.
4. AI가 성공하면 `deps.db.saveTurnBreakdown(…, until, breakdown)`을 부른다.
   - 성공이면 RPC가 돌려준 값을 응답한다. 먼저 저장된 값이 있으면 그것이 온다.
   - 실패 코드를 받았거나 throw하면 로그만 남기고 AI가 만든 값을 응답한다. 로그는 `{ breakdown: "save_failed", sessionId, turnNo, target, code | error }` 한 줄이고, 문장·조각 내용은 넣지 않는다.
- 활동일·연속일·사용량을 바꾸지 않고 이벤트도 남기지 않는다(RPC가 하지 않으면 여기서도 하지 않는다).

### 3. 라우트 `src/app/api/chat/sessions/[id]/breakdown/route.ts` (+ `route.test.ts`)

```ts
export const maxDuration = 60; // AI 호출 예산(재시도 포함 약 40초)보다 길게
export const POST = route({
  requirement: "ready",
  params: z.object({ id: z.uuid() }),
  body: z.object({ turn_no: z.number().int().min(1).max(20), target: z.enum(BREAKDOWN_TARGETS) }),
  handler: ({ userId, params, body }) => openChatBreakdown(getDeps(), userId, params.id, body),
});
```

- `z.enum`에 상수 배열을 넘기는 방법이 이 zod 버전과 맞지 않으면 `["reply", "corrected"]`를 쓰고 `BREAKDOWN_TARGETS`와 같은지 테스트한다.
- 세션 언어의 레벨은 시작 RPC가 다시 확인한다(403). 라우트에서 따로 조회하지 않는다.

### 4. 테스트

- `src/server/chat.test.ts`: `docs/spec/testing.md` use-case의 "문장 뜯어보기" 문장을 모두 쓴다.
  - 저장본이면 AI·저장을 부르지 않는다.
  - 저장본이 없으면 AI가 성공한 뒤 저장 RPC가 돌려준 값(먼저 저장된 것 포함)을 응답한다. 저장이 실패(코드·throw)해도 만든 값을 돌려준다.
  - 시작 RPC의 not found는 404다. 실패 10회는 뜯어보기용 문구이고 AI를 부르지 않는다. 만드는 중은 409와 그 문구이고 AI를 부르지 않는다. 세션 언어 레벨 없음은 403이고 AI를 부르지 않는다.
  - 시작 RPC가 준 기한 값을 실패·저장 RPC에 그대로 넘긴다. AI 실패면 실패 RPC를 부른 뒤 503과 그 문구다.
  - AI에는 시작 RPC가 준 문장·언어·레벨·대상을 넘긴다.
  - 가짜 db·ai(`createFakeDeps`)만 쓴다.
- `route.test.ts`: 기존 `route.test.ts`들처럼 연결과 준비 상태(`ready`)를 확인한다. body 검증(`turn_no` 0·21·소수·문자열, `target` 그 밖의 값, 빠진 키는 400)과 params가 uuid가 아니면 400인지도 본다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
test -f "src/app/api/chat/sessions/[id]/breakdown/route.ts"
grep -q "maxDuration = 60" "src/app/api/chat/sessions/[id]/breakdown/route.ts"
test -z "$(git status --porcelain supabase/ data/ public/ src/services/claude/ src/components/)"   # DB·AI·화면을 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (라우트는 얇게 `route()` → use-case, 의존 방향 app → server → services·lib)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (Claude 호출은 route → use-case에서만, 사용자 ID는 `getUser()`로 얻고 body로 받지 않음, Claude 호출 중 DB 잠금 없음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "처음 열 때 만들기"의 API·1~4번(use-case 쪽 동작과 문구)과 그 아래 문장들이고, `backend.md` "API"·"에러 코드"의 뜯어보기 부분도 대조한다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/12-breakdown-on-open/step2-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(라우트 경로·body·응답, 문구 상수 이름, 에러 코드별 동작). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- body에서 `userId`·문장·언어·레벨을 받지 마라. 이유: CLAUDE.md CRITICAL. 문장은 DB의 턴에서만 가져온다(시작 RPC).
- 저장본이 있을 때 AI나 저장 RPC를 부르지 마라. 이유: 비용을 줄이려는 기능의 핵심이다.
- `CONFLICT`·`AI_FAILURE_LIMIT`에 기본 문구를 쓰지 마라. 이유: 기본 문구("대화를 잠시 쉬어요" 등)는 뜯어보기 자리에 맞지 않고, spec이 문구를 정했다.
- 기한 값을 새로 만들거나 바꿔 넘기지 마라. 이유: 시작 RPC가 준 값과 같아야 실패·저장 RPC가 표시를 지운다.
- 로그에 문장·조각·사용자 입력을 남기지 마라. 이유: `backend.md` 보안 체크리스트 10번.
- Anthropic API를 실제로 부르지 마라. 이유: step 안에서는 외부 API를 부르지 않는 규칙이다.
- DB·프롬프트·`client.ts`·화면(`src/components/`)을 고치지 마라. 이유: step 0·1·3의 범위다.
- hook 통과용 빈 테스트나 Supabase 쿼리 체인 mock 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
