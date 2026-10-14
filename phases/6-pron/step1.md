# Step 1: pron-ai

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/superpowers/plans/2026-10-14-korean-pronunciation.md`: "Global Constraints", "Review Focus", "### Task 4", "### Task 5" 전체. **이 step은 Task 4·5만 한다.**
- `docs/spec/chat.md` "한글 발음" 절 전체(특히 "표기 규칙"과 "검사")와 "대화 진행" 2번
- `docs/spec/words.md` "단어 데이터: 미리 생성"(`generate-words`와 `generate-pronunciation` 설명)
- `docs/spec/backend.md` "Claude 연동"(구조화 출력, 실패 처리, "한글 발음")
- `docs/spec/testing.md`의 services 항목(한글 발음 문장)과 "발음 생성 스크립트" 항목
- 이전 step에서 만든 코드: `src/lib/pronunciation.ts`(`cleanPron`), `src/lib/levels.ts`(`showsPronunciation`), `src/lib/words.ts`(`WordEntry`의 `pron_ko`·`example_pron_ko`), `src/test/wordFiles.ts`(`validWord`), `src/services/claude/schemas.ts`(`TurnReply`)
- 기존 코드: `src/services/claude/prompts.ts`·`client.ts`와 각 테스트, `scripts/generate-words.ts`와 테스트(`main(deps)`·가짜 deps·실행 가드 모양), `src/lib/blank.ts`(`parseBlank`), `src/services/env.ts`(`getClaudeEnv`), `package.json`의 `scripts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

일본어 입문~중급의 한글 발음은 AI가 만든다(ADR-015). 이 step은 두 곳을 만든다.

- 대화: 일본어 입문~중급 턴만 발음 필드가 있는 스키마로 Claude를 부르고, 받은 발음을 `cleanPron`으로 정리한다. 저장은 step 0의 `finishChatTurn`이 이미 한다.
- 단어: `generate-words`가 새 단어와 함께 발음을 만들고, 새 스크립트 `generate-pronunciation`(`npm run words:pron`)이 기존 일본어 단어 파일의 빈 발음을 채운다.

화면(step 2)은 하지 않는다. 계획 Task 4·5에 테스트와 코드가 이미 다 있다. 그대로 따르되, 계획의 코드가 실제 코드와 다르면 실제 코드에 맞추고 아래 핵심 규칙은 지켜라.

## 작업

계획 Task 4, Task 5의 Step을 순서대로 한다. **각 Task의 커밋 단계는 하지 마라.** 커밋은 이 프롬프트의 작업 규칙대로 한다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

만들거나 바꿀 인터페이스:

```ts
// src/services/claude/schemas.ts
export const pronTurnReplySchema  // { reply, reply_ko, reply_pron_ko, correction: { corrected, explanation_ko, corrected_pron_ko } | null } 모두 z.string()
export type PronTurnReply = z.infer<typeof pronTurnReplySchema>

// src/services/claude/prompts.ts
export const PRONUNCIATION_RULES: string  // 표기 규칙 문구. 대화 프롬프트와 두 스크립트가 같이 쓴다

// src/services/claude/client.ts
// attempt<S, T>(schema: z.ZodType<S>, buildPrompt, accept: (value: S) => T | null): Promise<AiResult<T>>
// generateTurn: showsPronunciation이면 pronTurnReplySchema + acceptPronTurn, 아니면 지금과 같다

// scripts/generate-pronunciation.ts
export type PronSource = { id: string; word: string; reading: string; sentence: string }
export type PronRequest = { model: string | undefined; items: PronSource[] }
export type GeneratePronunciationDeps = { args; generate(request: PronRequest): Promise<unknown[]>; readFile; writeFile; log }
export function main(deps: GeneratePronunciationDeps): Promise<number>
```

### 지켜야 할 핵심 규칙

- **요청 조건은 `showsPronunciation(language, level)` 하나다.** 일본어 레벨 1~3만 시스템 프롬프트에 `reply_pron_ko`·`corrected_pron_ko` 지시와 "## 한글 발음" + `PRONUNCIATION_RULES`를 넣고 `pronTurnReplySchema`로 부른다. 일본어 4~5와 영어의 프롬프트·스키마·반환값은 지금과 한 글자도 다르지 않아야 한다(기존 테스트가 그대로 통과해야 한다).
- **발음은 턴의 성패를 바꾸지 않는다.** 발음이 비었거나 `cleanPron`에 맞지 않으면 그 값만 `null`로 바꾸고 턴은 성공이다. 재시도·`invalid_output`·`chat_failed`가 생기면 안 된다. 빈 `reply`만 지금처럼 `invalid_output`이다.
- **표기 규칙 문구는 `PRONUNCIATION_RULES` 하나다.** 계획 Task 4의 문구를 그대로 쓰고, spec `chat.md` "표기 규칙"의 예(쿄-와, 센세-, 아리가토-, 코-히-, 갓코-, 잇테, 콘니치와, 니혼고, 캬·샤·챠·쟈·쇼·쵸·뉴, 산지, `쿄-와 나니오 시마스카.`)가 모두 들어 있어야 한다. 두 스크립트도 이 상수를 import해 쓴다(문구를 복사하지 않는다).
- **`generate-words`**: 일본어는 AI가 준 `pron_ko`·`example_pron_ko`를 그대로 넘겨 `wordEntryErrors`가 검사하게 하고(맞지 않으면 그 항목을 버리고 더 요청), 영어는 AI 값과 상관없이 `null`로 둔다.
- **`generate-pronunciation`** (spec `words.md`)
  - `--language ja --level <1-5> [--model <id>]`만 받는다. 영어·모르는 옵션·잘못된 레벨은 AI 없이 사용법을 출력하고 1이다. 파일이 배열이 아니면 1이다.
  - 두 발음 중 하나라도 `cleanPron`에 맞지 않는 단어만 50개씩 요청한다. 요청에는 `id`, `word`, `reading`, 정답을 채운 예문 `sentence`(`{{ }}`만 빼고 `[漢字|かな]` 표기는 남김)를 넣는다.
  - 받은 값은 지금 값이 맞지 않는 필드에만, 받은 값이 `cleanPron`을 통과할 때만 쓴다. 검사에 맞는 기존 값은 바꾸지 않는다.
  - 묶음마다 파일 전체를 쓴다(`JSON.stringify(entries, null, 2)` + 줄바꿈). 뒤 묶음에서 API 오류가 나면 throw로 멈추고 앞 묶음은 파일에 남는다.
  - 채우지 못한 단어 id를 로그에 남기고 1을 돌려준다. 채울 것이 없으면 요청·쓰기 없이 0이다.
  - 실제 deps는 `generate-words`처럼 `messages.stream(...).finalMessage()`와 `zodOutputFormat`을 쓴다. 키는 `getClaudeEnv()`로만 읽고 값을 로그에 남기지 않는다.
- `package.json`에 `"words:pron": "tsx --env-file-if-exists=.env.local scripts/generate-pronunciation.ts"`를 더한다. `CLAUDE.md`의 명령어 줄은 이미 있으니 고치지 않는다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
grep -q '"words:pron"' package.json
test -f scripts/generate-pronunciation.test.ts
test -z "$(git status --porcelain data/)"   # 단어 데이터를 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`scripts/*.ts`는 `main(deps)`를 export, 프롬프트 빌더는 `services/claude/prompts.ts`의 순수 함수)
   - ADR 기술 스택을 벗어나지 않았는가? (새 의존성 없음, 구조화 출력은 `output_config.format`, deprecated `output_format`·`messages.parse()`를 쓰지 않음)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (secret에 `NEXT_PUBLIC_` 없음, 구현 경로에 `test` 문자열 없음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "한글 발음"의 "만드는 곳"·"표기 규칙"·"검사"와 "대화 진행" 2번의 발음 문장, `words.md` "단어 데이터"의 생성 스크립트 문장, `backend.md` "Claude 연동"의 "한글 발음"이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/6-pron/step1-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(바꾼 파일, export 이름, 스크립트 옵션). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `npm run words:pron`·`npm run words:generate`·`npm run seed:words`를 실행하거나 실제 Anthropic API를 부르지 마라. `data/words/*.json`도 고치지 마라. 이유: 일본어 1,000개 생성은 비용이 들고 phase 뒤에 사람이 확인하며 돌린다. step 커밋은 `git add -A`라서 만든 데이터가 검수 없이 커밋된다.
- 일본어 4~5·영어 턴의 프롬프트나 스키마에 발음 필드를 넣지 마라(null을 요구하는 지시도 넣지 마라). 이유: 그 턴은 발음을 보여 주지 않으니 출력 토큰만 늘어난다(spec `chat.md` "대화 진행" 2번).
- 발음 검사 실패를 `invalid_output`이나 재시도로 처리하지 마라. 이유: spec이 "턴은 성공으로 처리한다"로 정했다. 발음 하나 때문에 턴을 버리면 사용자의 하루 한도와 실패 10회 차단에 영향을 준다.
- 종료 피드백·AI 정답 설명 프롬프트를 고치지 마라. 이유: 두 곳은 발음을 두지 않는다(spec `chat.md` "한글 발음" "대상과 위치").
- 컴포넌트·페이지를 고치지 마라. 이유: step 2의 범위다.
- 새 의존성을 설치하지 마라. 이유: 필요한 SDK·zod는 이미 있다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
