# Step 1: chat-ai

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md`
  - "대화 진행" 2~4번(응답 구조, 교정, 한국어 입력)
  - "레벨별 조절" 표와 "후리가나" 항목(특히 종료 피드백 문장)
  - "한글 발음"의 "대상과 위치"(발음은 입문~중급 그대로다)
  - "문장 뜯어보기" 절 전체
- `docs/spec/backend.md` "Claude 연동" 전체(특히 "API 오류 로그"·"문장 뜯어보기"·"대화 기록")
- `docs/spec/testing.md`의 "services" 항목
- `docs/ADR.md` ADR-016, ADR-017, ADR-018
- 이전 step에서 만든 코드: `src/lib/breakdown.ts`(`alignBreakdown`, `Breakdown`), `src/services/claude/schemas.ts`(`TurnReply`의 `reply_breakdown`·`correction.breakdown`)
- 기존 코드: `src/services/claude/schemas.ts`·`prompts.ts`·`client.ts`와 각 테스트, `src/lib/levels.ts`(`showsFurigana`·`allowsKoreanInput`·`showsPronunciation`), `src/lib/text.ts`(`hasHangul`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 0이 문장 뜯어보기 검사(`alignBreakdown`), 첫 마디 뜯어보기, `chat_turns.reply_breakdown` 저장을 만들었다. 이 step은 Claude 호출 쪽을 바꾼다. 한국어 입력과 일본어 후리가나를 모든 레벨로 넓히고(ADR-016), 턴마다 뜯어보기를 함께 받고(ADR-018), API 오류 원인을 로그로 남긴다(ADR-017). 화면(step 2·3)은 하지 않는다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. `src/services/claude/schemas.ts`

- `turnReplySchema`와 `pronTurnReplySchema` 둘 다에 `reply_breakdown: z.array(z.object({ text: z.string(), meaning_ko: z.string() }))`를 더하고, `correction` 객체에 같은 배열의 `breakdown`을 더한다. 조각 스키마는 하나만 만들어 같이 쓴다.
- 길이·개수 제약(`.min`, `.max`)은 넣지 않는다(파일 위 주석의 이유).

### 2. `src/services/claude/prompts.ts`

- **한국어 입력(모든 레벨)**: `allowsKoreanInput(level)` 조건을 없애 한국어 입력 규칙 네 줄을 레벨 1~5 모두에 붙인다. "## 이번 입력" 절은 `hasHangul(input.userText)`이면 레벨과 상관없이 붙인다. `KOREAN_INPUT_EXAMPLES` 위 주석의 "입문·초보만 쓰므로"를 고친다.
- **일본어 후리가나(모든 레벨)**: 일본어면 레벨과 상관없이 "reply와 corrected의 모든 한자에 [漢字|かんじ] 형식으로 읽기를 단다…" 지시를 붙인다. "한자에 … 읽기 표기를 달지 않는다" 분기는 지운다. 가타카나 읽기는 AI에게 요청하지 않는다(화면 코드가 단다).
- **첫 마디**: `openingText`가 상급·고수에서 표기를 지우던 처리를 없앤다. 모든 레벨이 후리가나를 쓰므로 첫 마디 데이터(`scenario.roles[language].opening.text`)를 그대로 보낸다.
- **문장 뜯어보기(모든 언어·레벨)**: "## 출력"에 아래 뜻의 지시를 더한다(문구는 다듬어도 된다).
  - `reply_breakdown`: reply를 의미 조각(단어·조사 묶음·서술어)으로 나눈 배열. 조각은 `{ text, meaning_ko }`다.
  - correction이 있으면 `correction.breakdown`에 corrected를 같은 방식으로 나눈다.
  - 조각은 문장 순서대로이고, 빠짐없이 이으면 원래 문장이 된다. `text`는 문장에 나온 글자 그대로 쓴다. 사전형으로 바꾸거나(`食べたり` → `食べる`), 한자를 가나로 바꾸거나, 조각을 빼먹지 않는다.
  - 조사·어미는 앞말과 묶는다. `meaning_ko`는 그 조각의 문장 속 뜻을 짧은 한국어로 쓴다.
  - 일본어 조각 `text`에는 `[漢字|かな]` 읽기 표기를 달지 않는다(코드가 원래 문장의 표기를 나눠 붙인다).
  - 예는 그 언어 것만 넣는다. 일본어: `[家|いえ]で[休|やす]んでいました。` → `[{"text":"家で","meaning_ko":"집에서"},{"text":"休んでいました","meaning_ko":"쉬고 있었어요"}]`. 영어: `I was resting at home.` → `I` 나는 / `was resting` 쉬고 있었어요 / `at home` 집에서.
- **종료 피드백**(`buildFeedbackPrompt`): 일본어면 "일본어를 인용할 때는 모든 한자에 [漢字|かんじ] 형식으로 읽기를 단다. 읽기 표기는 한자에만 단다(가나·한글에는 달지 않는다)."를 "## 출력"에 더한다. 영어에는 붙이지 않는다.
- `buildExplanationPrompt` 위 주석의 "Furigana가 레벨 규칙대로 그린다"는 레벨 규칙이 없어졌으니 고친다(동작은 바꾸지 않는다).
- 한글 발음 지시는 지금처럼 `showsPronunciation`(일본어 1~3)일 때만 붙인다.
- 이 step이 끝나면 `prompts.ts`는 `showsFurigana`·`allowsKoreanInput`을 쓰지 않는다. `levels.ts`의 두 함수 자체는 지우지 않는다(화면이 아직 쓴다).

### 3. `src/services/claude/client.ts`

```ts
// 턴 응답을 받아들이는 함수는 입력의 language·level을 알아야 한다(로그용)
generateTurn(input: TurnPromptInput): Promise<AiResult<TurnReply>>  // 시그니처 그대로
```

- **뜯어보기 받아들이기**(두 스키마 모두): reply가 공백뿐이면 지금처럼 `null`(→ `invalid_output`). 그다음:
  - `reply_breakdown` = `alignBreakdown(reply, value.reply_breakdown)`. `null`이면 `reply_breakdown: null`로 두고 로그를 남긴다.
  - correction이 있으면 `alignBreakdown(corrected, correction.breakdown)`. 통과하면 `breakdown`에 그 결과를 넣고, `null`이면 **`breakdown` 키를 뺀다**. 이때도 로그를 남긴다.
  - 돌려주는 `TurnReply`에는 AI가 준 정리 전 조각이 남지 않는다.
  - 검사에 실패해도 턴은 성공이다. `invalid_output`으로 만들거나 다시 부르지 않는다.
  - 한글 발음 처리(`cleanPron`, 일본어 1~3)는 그대로 둔다.
- **`breakdown_invalid` 로그**: 검사에 맞지 않은 문장마다 `console.warn(JSON.stringify({ ai: "breakdown_invalid", target, language, level }))` 한 줄을 남긴다. `target`은 `"reply"` 또는 `"corrected"`다. 문장·조각 내용은 남기지 않는다.
- **API 오류 로그**(`attempt` 안, 대화·종료·설명 모두): 타임아웃(`APIConnectionTimeoutError`)이 아닌 `Anthropic.APIError`면 `api_error`로 실패하기 전에 시도마다 `console.error(JSON.stringify({ ai: "api_error", status, type, requestId, message }))` 한 줄을 남긴다.
  - `status`는 `error.status`, `type`은 `error.type`(예: `invalid_request_error`), `requestId`는 `error.requestID`, `message`는 `error.message`를 300자에서 자른 것이다.
  - 연결 오류처럼 응답이 없어 `undefined`·`null`인 값은 키째 뺀다.
  - 타임아웃은 지금처럼 로그 없이 `timeout`이다. 프롬프트·사용자 입력·AI 응답은 남기지 않는다.
  - 재시도(`withRetry`)로 두 번 실패하면 두 줄이 남는다.

### 4. 테스트 (`docs/spec/testing.md` "services")

- prompts: 한국어 입력 규칙이 레벨 1~5 모두에 붙는다. 한국어가 든 입력이면 모든 레벨에 "이번 입력"이 붙는다. 일본어 레벨 1~5 모두 후리가나 지시가 있고 "달지 않는다" 지시는 없다. 레벨 4·5 일본어 첫 마디의 표기가 남는다. 뜯어보기 지시가 모든 언어·레벨에 있다. 종료 피드백은 일본어에만 표기 지시가 있다. 한글 발음 지시는 지금처럼 일본어 1~3에만 있다.
- client: 통과한 뜯어보기는 표기가 붙은 조각으로 돌아온다. reply 뜯어보기가 맞지 않으면 턴은 성공하고 `reply_breakdown`만 `null`이며 `breakdown_invalid` warn이 한 줄 남는다. 이 줄에는 문장·조각 글자가 없다. 교정 뜯어보기가 맞지 않으면 `breakdown` 키가 없고 `target: "corrected"` 로그가 남는다. 두 경우 모두 다시 부르지 않는다. API 오류는 status·type·requestId·message(300자에서 자름)를 남기고, 프롬프트·응답 내용은 남기지 않는다. 연결 오류는 없는 값을 뺀다. 타임아웃은 `api_error` 로그가 없다.
- 기존 테스트의 가짜 응답 JSON은 새 필수 필드(`reply_breakdown`, 교정의 `breakdown`)가 없으면 파싱에 실패한다. 테스트 의도는 바꾸지 말고 필드만 더한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -nE "showsFurigana|allowsKoreanInput" src/services/claude/prompts.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`services/claude`는 SDK 호출, 검사는 `lib/breakdown`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "대화 진행" 2·4번, "후리가나"의 종료 피드백 문장, "문장 뜯어보기"의 "만드는 곳"·"검사"(로그 포함)·마지막 문장(대화 기록), `backend.md` "Claude 연동"의 "API 오류 로그"·"문장 뜯어보기"다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/7-chat-improve/step1-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(바꾼 스키마·프롬프트 지시·client 동작·로그 모양). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실제 Anthropic API를 부르지 마라(`.env.local`의 키로 스크립트를 돌리는 것 포함). 테스트는 가짜 client로 한다. 이유: 유료 호출이다. 실제 턴 약 30개로 통과율·응답 시간·토큰을 재는 일은 phase가 끝난 뒤 메인 세션이 한다(spec `chat.md` "문장 뜯어보기").
- 뜯어보기 검사 실패로 턴을 실패시키거나 다시 부르지 마라. 이유: spec은 그 뜯어보기만 숨기고 턴은 성공으로 처리한다. 실패로 만들면 사용량·실패 10회 차단에 들어간다.
- 대화 기록(`messages`)에 뜯어보기나 발음을 넣지 마라. 이유: 기록에는 reply만 넣는다(spec `chat.md` "문장 뜯어보기").
- 로그에 프롬프트·사용자 입력·AI 응답·조각 내용을 남기지 마라. 이유: spec `backend.md` 보안 10번(로그의 개인정보).
- 한글 발음 조건(일본어 입문~중급)을 넓히지 마라. 이유: ADR-016에서 발음은 그대로 두기로 했다.
- `src/lib/levels.ts`의 함수를 지우지 마라. 이유: 화면이 아직 쓴다. step 2·3이 쓰는 곳을 바꾼 뒤 지운다.
- DB·use-case(`src/server/`)·화면을 고치지 마라. 이유: step 0과 step 2·3의 범위다. `TurnReply`가 그대로 `finishChatTurn`과 API 응답으로 흐른다.
- 스키마에 `.min`/`.max`를 넣지 마라. 이유: 구조화 출력이 지원하지 않는 제약은 SDK가 응답 뒤에 검증해 사소한 초과도 AI 실패가 된다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
