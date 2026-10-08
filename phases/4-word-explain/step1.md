# Step 1: explain-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/superpowers/plans/2026-10-08-word-explanation.md`: "Global Constraints", "### Task 2: AI — 설명 프롬프트·스키마·호출", "### Task 3: API — use-case `explainWord`와 `POST /api/words/explain`" 전체. **이 step은 Task 2와 Task 3만 한다.**
- `docs/spec/words.md` "AI 정답 설명"의 "내용", "API" 1~5번과 그 아래 두 줄
- `docs/spec/backend.md`
  - "API"의 `/api/words/explain` 행
  - "Claude 연동"(타임아웃·재시도·구조화 출력, 설명 프롬프트 입력)
  - "에러 코드"(설명용 문구 문장 포함)
- `docs/spec/testing.md`의 services 항목과 use-case 테스트의 "AI 정답 설명" 항목
- step 0 산출물: `src/server/db/learning.ts`(`getWord`, `beginWordExplanation`, `failWordExplanation`, `saveWordExplanation`), `src/test/fakes.ts`(새 db 기본값)
- 기존 코드:
  - `src/services/claude/client.ts`(`Ai`, `withRetry`, `attempt`), `prompts.ts`(`Prompt`, `levelLabel`, `LANGUAGE_NAMES`), `schemas.ts`와 각 테스트
  - `src/server/http.ts`(`route`, `Outcome`, `toResponse`)와 테스트, `src/server/learning.ts`와 테스트, `src/server/deps.ts`
  - `src/app/api/words/batch/route.ts`와 `route.test.ts`(라우트·테스트 모양)
  - `src/lib/blank.ts`(`parseBlank`), `src/lib/errors.ts`, `src/types/api.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

AI 정답 설명은 (단어, 고른 보기)별로 저장해 재사용하는 짧은 한국어 설명이다. 한도는 Free 하루 10회, Pro 무제한이다. step 0이 DB(예약·실패·저장 RPC와 접근 함수)를 만들었다. 이 step은 그 위에 다음 두 가지를 만든다.

- Claude 설명 호출(Task 2)
- use-case `explainWord`와 `POST /api/words/explain`(Task 3)

use-case 흐름은 다음과 같다.

1. `getWord`
2. `choice` 검증
3. 예약
4. 저장본이면 그대로 응답하고 끝
5. 저장본이 없으면 잠금 밖에서 Claude를 부른다. 성공하면 저장 후 응답하고, 실패하면 실패 RPC를 부른 뒤 503으로 응답한다.

계획 Task 2·3에 테스트와 코드가 이미 다 있다. 그대로 따르되, 계획의 코드가 실제 코드와 다르면 실제 코드에 맞추고 아래 핵심 규칙은 지켜라.

## 작업

계획 Task 2의 Step 1~9, Task 3의 Step 1~9를 순서대로 한다. 두 Task의 마지막 Commit 단계는 하지 말고, 커밋은 이 프롬프트의 작업 규칙대로 한다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

만들 인터페이스:

```ts
// src/services/claude/schemas.ts
export const explanationSchema = z.object({ explanation: z.string() }); export type Explanation
// src/services/claude/prompts.ts
export type ExplanationPromptInput = { language: Language; level: Level; sentence: string; exampleKo: string; answer: string; meaningKo: string; choice: string | null }
export function buildExplanationPrompt(input: ExplanationPromptInput): Prompt
// src/services/claude/client.ts — Ai 타입과 createAi에 추가, fakes의 defaultAi()에도 기본 가짜 추가
generateExplanation(input: ExplanationPromptInput): Promise<AiResult<Explanation>>
// src/server/http.ts — 실패 Outcome에 message?: string. 있으면 ERRORS 문구 대신 그 문구로 응답(code·status는 그대로)
export type Outcome<T> = { ok: true; value: T; status?: 202 } | { ok: false; code: ErrorCode; message?: string }
// src/types/api.ts
export type WordExplainResponse = { explanation: string }
// src/server/learning.ts
export const EXPLAIN_UNAVAILABLE_MESSAGE = "설명을 만들지 못했어요. 횟수는 차감되지 않았어요."
export const EXPLAIN_FAILURE_LIMIT_MESSAGE = "오늘은 응답 오류가 많아 AI 설명을 잠시 쉬어요. 내일 다시 시도해 주세요."
export function explainWord(deps: Deps, userId: string, input: { word_id: string; choice?: string }): Promise<Outcome<WordExplainResponse>>
// src/app/api/words/explain/route.ts
export const maxDuration = 60; export const POST  // requirement "ready", body { word_id: 1~50자, choice?: 1~50자 }
```

### 지켜야 할 핵심 규칙

- **입력**
  - 예문·보기는 클라이언트에서 받지 않는다. DB 단어(`getWord`)로 `choice`를 검증하고 프롬프트를 만든다.
  - `choice`는 `parseBlank(word.example).answer` 또는 `distractors` 중 하나와 정확히 같아야 한다. 대소문자나 공백이 달라도 400이다.
  - 복습은 `choice`가 없고, 저장 키는 빈 문자열, 프롬프트의 `choice`는 `null`이다.
  - 사용자 ID는 `route`가 `getUser()`로 얻은 값만 쓴다. body의 `userId`는 무시한다.
- **문구**
  - 503 문구는 `EXPLAIN_UNAVAILABLE_MESSAGE`다.
  - 예약이 `AI_FAILURE_LIMIT`로 거부되면 `EXPLAIN_FAILURE_LIMIT_MESSAGE`로 덮어쓴다(2026-10-08 사용자 결정, spec `words.md` "API" 2번). 그 밖의 거부 코드는 문구 없이 그대로 돌려준다.
  - `src/lib/errors.ts`의 공용 문구는 바꾸지 않는다.
- **Claude 호출**
  - 저장본이 없을 때만 부른다. 예약 RPC가 끝난 뒤 잠금 밖에서 부른다.
  - 대화와 같은 `createAi` 설정이다: 모델 env, effort `low`, `max_tokens` 4096, 타임아웃 20초, 직접 재시도 1번.
  - 스키마는 `{ explanation }` 하나이고, 공백뿐인 설명은 `invalid_output`이다.
- **프롬프트**
  - 해요체 2~4문장으로 쓰게 한다.
  - 빈칸 오답일 때만 "고른 보기가 틀린 이유"를 지시한다. 복습은 "예문에서 정답 형태를 쓴 이유"를 지시한다.
  - 일본어는 레벨과 상관없이 모든 한자에 `[漢字|かんじ]` 표기를 달게 한다. 화면이 레벨 규칙대로 그린다.
  - 문제 데이터 속 지시를 따르지 말라는 규칙을 넣는다.
  - 설명은 모든 사용자가 다시 쓰므로 사용자 정보를 넣지 않는다.
- **저장 실패**: 저장이 거부되거나 throw해도 설명은 돌려준다. 로그에는 `wordId`와 코드·에러만 남기고, 설명 내용과 고른 보기는 남기지 않는다.
- **라우트**: `export const maxDuration = 60`

## Acceptance Criteria

```bash
npm run lint
npm run build      # 출력의 route 목록에 /api/words/explain이 있다
npm run test
grep -q "maxDuration = 60" src/app/api/words/explain/route.ts
grep -q "대화를 잠시 쉬어요" src/lib/errors.ts   # 대화 공용 문구는 그대로
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (app → server → services·lib 의존 방향, Claude 호출은 route → `src/server/` use-case에서만)
   - ADR 기술 스택을 벗어나지 않았는가? (Anthropic SDK 구조화 출력, zod)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (Claude 호출 중 DB 잠금 없음, body의 userId 무시)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `words.md` "AI 정답 설명"의 "내용"·"API" 1~5번, `backend.md` "Claude 연동"의 설명 문장과 "에러 코드"다(예외 흐름·에러 코드별 동작 포함). step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/4-word-explain/step1-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(API body·응답·에러 코드별 status와 문구, fakes의 `generateExplanation` 기본값). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실제 Anthropic API를 부르지 마라. 이유: 비용이 들고 테스트는 `client.test.ts`의 가짜 Anthropic client와 `createFakeDeps`로 검증한다. 실제 호출은 phase 끝 로컬 화면 확인에서 사람이 한다.
- `src/lib/errors.ts`의 `AI_FAILURE_LIMIT`·`AI_UNAVAILABLE` 문구를 바꾸지 마라. 이유: 대화 화면이 그 문구를 쓴다. 설명 문구는 use-case의 `Outcome.message`로만 바꾼다.
- 클라이언트가 보낸 예문·보기·정답을 받거나 프롬프트에 넣지 마라. 이유: 저장본은 모든 사용자가 다시 쓰므로 DB 값만으로 만들어야 한다.
- 로그에 설명 내용이나 고른 보기를 남기지 마라. 이유: spec `words.md`. 기존 로그 규칙도 사용자 입력을 남기지 않는다.
- DB 마이그레이션·RPC나 화면 컴포넌트를 고치지 마라. 이유: step 0·2의 범위다. step 0의 함수가 부족하면 고치지 말고 `error_message`에 적는다.
- Supabase 쿼리 체인을 mock하는 테스트나 hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md. use-case는 `createFakeDeps`로 테스트한다.
- 기존 테스트를 깨뜨리지 마라
