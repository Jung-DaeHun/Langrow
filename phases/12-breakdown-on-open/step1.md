# Step 1: breakdown-ai

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md`
  - "대화 진행" 2번(턴 응답 구조. 뜯어보기는 이제 턴 응답에 없다)
  - "문장 뜯어보기" 절 전체(형식·검사·저장)와 그 아래 "처음 열 때 만들기"의 2번(Claude 호출)
- `docs/spec/backend.md` "Claude 연동"(구조화 출력, 실패로 처리하는 경우, 타임아웃과 재시도, 문장 뜯어보기, 프롬프트 캐싱)
- `docs/spec/testing.md` "services" 항목
- `docs/ADR.md` ADR-027
- 기존 코드:
  - `src/services/claude/prompts.ts`(`buildTurnPrompt`의 뜯어보기 지시와 `BREAKDOWN_RULES`, `buildExplanationPrompt`의 모양)·`prompts.test.ts`
  - `src/services/claude/schemas.ts`·`schemas.test.ts`
  - `src/services/claude/client.ts`(`attempt`, `withRetry`, `acceptTurn`의 뜯어보기 검사와 `breakdown_invalid` 로그)·`client.test.ts`
  - `src/lib/breakdown.ts`(`alignBreakdown`, `Breakdown`, step 0이 더한 `BreakdownTarget`)
  - `src/server/db/chat.ts`의 `finishChatTurn`, `src/server/chat.ts`의 `sendChatMessage`, `src/test/fakes.ts`(가짜 ai)

## 배경

문장 뜯어보기를 턴마다 만들지 않고, 사용자가 그 문장을 처음 열 때 그 문장 하나만 만든다(ADR-027). 2026-10-20 실측에서 뜯어보기는 턴 출력의 54%였다. 이 step은 Claude 쪽을 바꾼다. 턴 스키마·프롬프트에서 뜯어보기를 빼고, 문장 하나의 뜯어보기를 만드는 `ai.generateBreakdown`을 더한다. step 0이 데이터(RPC·db 함수)를 만들었다. use-case·라우트(step 2)와 화면(step 3)은 하지 않는다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. 턴에서 뜯어보기 빼기

- `schemas.ts`: `turnReplySchema`·`pronTurnReplySchema`에서 `reply_breakdown`과 `correction.breakdown`을 뺀다. 저장·API·화면이 쓰는 `TurnReply` 타입의 선택 필드(`reply_breakdown?`, `correction.breakdown?`)는 그대로 둔다. 이미 저장된 턴과 처음 열 때 만든 값을 읽기 때문이다. 주석도 맞게 고친다.
- `prompts.ts` `buildTurnPrompt`: `reply_breakdown`·`correction.breakdown` 지시와 `BREAKDOWN_RULES`를 넣던 줄을 뺀다. 다른 지시(교정·후리가나·한국어 입력·배운 단어·한글 발음)의 문구와 순서는 바꾸지 않는다. 이유: 바꾸면 대사·교정 품질을 다시 비교해야 한다.
- `client.ts` `acceptTurn`: 뜯어보기 검사를 뺀다. `GeneratedTurn`에는 뜯어보기가 없다. 빈 reply 검사, 한글 발음 정리, 배운 단어 번호 처리는 그대로 둔다.
- `src/server/db/chat.ts` `finishChatTurn`: `p_reply_breakdown`을 넘기지 않는다. RPC 인자 자체는 DB에 남아 있다(옛 코드와 함께 돌아가게, 지우지 않는다).
- `src/test/fakes.ts`의 가짜 `generateTurn`에 뜯어보기가 있으면 뺀다.

### 2. 문장 하나의 뜯어보기

`prompts.ts`:

```ts
export type BreakdownPromptInput = { language: Language; sentence: string };
// 시스템 프롬프트는 언어별 지시만이고, 문장은 user 메시지로 보낸다. 대화 기록·레벨은 넣지 않는다
export function buildBreakdownPrompt(input: BreakdownPromptInput): Prompt;
```

- 출력 필드는 `breakdown` 하나다. 그 문장을 의미 조각(단어·조사 묶음·서술어)으로 나눈 배열이고, 조각은 `{ text, meaning_ko }`다.
- 지금 `buildTurnPrompt`에 있던 뜯어보기 지시와 `BREAKDOWN_RULES`의 내용을 그대로 옮긴다. 문구 속 필드 이름만 바꾼다(`reply`·`corrected` → "문장", `reply_breakdown` → `breakdown`). 예시 문장과 예시 조각은 그대로 둔다.
- 검사(`lib/breakdown`)가 거부하는 모양을 프롬프트에서 모두 금지한다. 지금 턴 프롬프트에 있는 금지를 빠짐없이 옮기고, 없는 것은 더한다.
  - 조각을 빼먹거나 순서를 바꿔 이은 것이 원래 문장과 다른 것
  - 사전형·기본형으로 바꾼 것(`食べたり` → `食べる`, `was resting` → `rest`)
  - 한자를 가나로 바꾼 것
  - `meaning_ko`가 빈 조각
  - 일본어에서 `[漢字|かな]` 표기 하나로 묶인 말을 두 조각에 나눈 것
  - 문장부호만으로 된 조각(검사는 빼고 받아 주지만 만들지 않게 한다)
  - 조각의 `text`에는 읽기 표기를 달지 않는다(코드가 원래 문장에서 잘라 쓴다)
- 일본어 문장은 `[漢字|かな]` 표기가 붙은 채로 온다. 표기는 읽기라는 것과 조각을 나눌 때 그 묶음을 깨지 말라는 것을 적는다.
- `schemas.ts`: `export const breakdownReplySchema = z.object({ breakdown: breakdownSchema })`. `.min`·`.max`는 넣지 않는다(파일 머리 주석의 이유).

`client.ts`:

```ts
export type BreakdownInput = { language: Language; level: Level; target: BreakdownTarget; sentence: string };
// Ai 타입에 더한다
generateBreakdown(input: BreakdownInput): Promise<AiResult<{ breakdown: Breakdown }>>;
```

- 대화 턴과 같은 `attempt`·`withRetry`를 쓴다. 모델·`max_tokens`·effort·타임아웃·재시도 1번이 같다. 프롬프트 캐싱(`cache`)은 걸지 않는다.
- 받아들이기: `alignBreakdown(sentence, value.breakdown)`가 null이면 `breakdown_invalid` 로그를 남기고 null을 돌려준다. 로그는 지금과 같은 모양으로 `{ ai: "breakdown_invalid", target, language, level }`이고 문장·조각은 남기지 않는다. null은 `invalid_output`이 되어 `withRetry`가 한 번 다시 부른다. 통과하면 정렬된 조각을 `{ breakdown }`으로 돌려준다. `level`은 이 로그에만 쓰고 프롬프트에는 넣지 않는다.
- 가짜 ai(`src/test/fakes.ts` `defaultAi`)에 `generateBreakdown` 기본값(짧은 조각 배열)을 더한다.

### 3. 테스트

`docs/spec/testing.md` "services" 항목을 따른다.
- `schemas.test.ts`: 턴 스키마 두 개의 필드 목록에 뜯어보기가 없다. `breakdownReplySchema`는 `{ breakdown }`만 받는다.
- `prompts.test.ts`: 턴 프롬프트에 뜯어보기 지시가 없다(언어·레벨 모두). 뜯어보기 프롬프트에 위 금지가 모두 있다(언어별). 일본어에만 표기 지시가 있다. 문장은 user 메시지에 있고 대화 기록·레벨은 없다.
- `client.test.ts`: 턴 요청의 스키마에 뜯어보기가 없다. 뜯어보기는 통과하면 원래 문장을 조각 경계에서 자른 조각을 돌려준다. 검사에 맞지 않으면 `breakdown_invalid` 로그를 남기고 한 번 다시 부른 뒤 `invalid_output`이다. refusal·`max_tokens`·API 오류는 기존 규칙과 같다. `cache_control`이 없다.
- 기존의 "턴의 뜯어보기 검사 실패면 그 값만 null" 테스트는 뜯어보기 쪽 테스트로 옮기거나 지운다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -n "reply_breakdown: breakdownSchema" src/services/claude/schemas.ts   # 턴 zod 스키마에 뜯어보기가 없다 (TurnReply 타입의 선택 필드는 남는다)
grep -q "generateBreakdown" src/services/claude/client.ts
grep -q "buildBreakdownPrompt" src/services/claude/prompts.ts
test -z "$(git status --porcelain supabase/ data/ public/)"   # DB·단어·음성을 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (프롬프트 빌더는 순수 함수, 스키마는 `schemas.ts`, SDK 호출은 `client.ts`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (AI 출력은 텍스트로만, 로그에 문장·조각 내용 없음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "대화 진행" 2번, "문장 뜯어보기"의 형식·만드는 곳·검사, "처음 열 때 만들기" 2번이고, `backend.md` "Claude 연동"의 문장 뜯어보기·프롬프트 캐싱도 대조한다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/12-breakdown-on-open/step1-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(바뀐 턴 스키마, `buildBreakdownPrompt`·`generateBreakdown` 시그니처, 가짜 ai 기본값). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- Anthropic API를 실제로 부르지 마라(`count_tokens` 포함). 이유: step 안에서는 외부 API를 부르지 않는 규칙이다. 실측과 전후 비교는 phase가 끝난 뒤 메인 세션이 한다.
- 턴 프롬프트에서 뜯어보기 말고 다른 지시의 문구·순서를 바꾸지 마라. 이유: 대사·교정·후리가나 품질을 다시 비교해야 하고, 전후 비교에서 원인을 가를 수 없게 된다.
- 뜯어보기 프롬프트에 대화 기록이나 레벨을 넣지 마라. 이유: spec은 같은 문장이면 같은 기준으로 정해지게 문장만 넣는다고 정했다.
- 뜯어보기 호출에 `cache_control`을 걸지 마라. 이유: 문장마다 한 번이고 시스템 프롬프트가 짧다(spec "프롬프트 캐싱").
- `TurnReply` 타입에서 뜯어보기 필드를 지우거나 `lib/breakdown`의 검사 규칙을 바꾸지 마라. 이유: 저장된 턴을 읽는 쪽이 쓰고, 검사는 첫 마디 데이터 테스트도 쓴다.
- DB 마이그레이션·RPC를 고치지 마라. `finish_chat_turn`의 `p_reply_breakdown` 인자도 그대로 둔다. 이유: step 0 범위이고, 운영 DB와 옛 코드가 함께 돌아가야 한다.
- use-case(`src/server/chat.ts`의 새 함수)·라우트·`src/types/api.ts`·화면을 만들지 마라. 이유: step 2·3의 범위다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
