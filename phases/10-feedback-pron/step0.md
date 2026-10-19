# Step 0: feedback-pron

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md`
  - "세션 종료 피드백" 절 전체(특히 "피드백 형식"과 그 아래 "검사"·"옛 형식". 이 step의 기준이다)
  - "한글 발음" 절의 "대상과 위치", "만드는 곳", "표기 규칙", "검사"
  - "레벨별 조절"의 후리가나 항목 중 종료 피드백 문장
- `docs/spec/ui.md` "화면별 구성" 표의 "종료 피드백" 행(고칠 점 항목의 배치와 클래스)
- `docs/spec/backend.md` "Claude 연동"의 "한글 발음" 항목
- `docs/spec/testing.md`의 "services" 항목과 "컴포넌트"의 "종료 202 표시…" 항목
- `docs/ADR.md` ADR-025
- 기존 코드와 테스트:
  - `src/services/claude/schemas.ts`·`prompts.ts`·`client.ts`와 각 `*.test.ts`. 턴 프롬프트가 일본어 입문~중급에서 `PRONUNCIATION_RULES`를 붙이는 방식(`buildTurnPrompt`의 `showsPronunciation` 분기)과 턴 발음을 정리하는 `cleanTurnPron`을 본보기로 삼는다
  - `src/lib/pronunciation.ts`(`cleanPron`), `src/lib/levels.ts`(`showsPronunciation`)
  - `src/server/db/chat.ts`(`EndResult`, `finishEnd`), `src/server/db/reads.ts`(대화방 읽기의 `result`), `src/server/chat.ts`(`endChatSession`), `src/types/api.ts`(`ChatEndResponse`)
  - `src/components/ChatFeedback.tsx`·`ChatFeedback.test.tsx`, `src/components/Furigana.tsx`
  - `src/test/fakes.ts`
  - 피드백 값을 쓰는 테스트: `src/server/chat.test.ts`, `src/app/api/chat/sessions/[id]/end/route.test.ts`, `src/server/db/chat.test.ts`, `src/server/db/reads.test.ts`, `src/components/ChatRoom.test.tsx`

기존 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

종료 피드백의 고칠 점(`improve`)은 지금 문자열 배열이라 설명과 더 나은 표현 예문이 한 문장에 섞여 있다. 이 step은 고칠 점을 `{ point, example }`로 나눠 받고, 일본어 입문~중급은 예문의 한글 발음(`example_pron_ko`)을 함께 받아 화면에서 예문 아래에 보여 준다. 저장된 옛 피드백(문자열 항목)은 마이그레이션하지 않고 전처럼 그린다. 뒤로 가기 버그(대화방 다시 읽기)는 step 1이 하므로 이 step에서 하지 않는다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. `src/services/claude/schemas.ts`

```ts
export const feedbackSchema = z.object({
  good: z.string(),
  improve: z.array(z.object({ point: z.string(), example: z.string() })),
});
// 일본어 입문~중급 피드백(spec/chat.md "피드백 형식"). 발음 검사와 정리는 client.ts가 한다
export const pronFeedbackSchema = z.object({
  good: z.string(),
  improve: z.array(z.object({ point: z.string(), example: z.string(), example_pron_ko: z.string() })),
});
// 새로 만드는 피드백. example_pron_ko는 일본어 입문~중급만 있고, 검사에 맞지 않으면 null이다. 그 밖에는 키가 없다
export type FeedbackItem = { point: string; example: string; example_pron_ko?: string | null };
export type Feedback = { good: string; improve: FeedbackItem[] };
// 읽은 피드백. 2026-10-20 전에 만든 피드백은 improve가 문자열 배열이다(spec/chat.md "옛 형식")
export type StoredFeedback = { good: string; improve: (FeedbackItem | string)[] };
```

- 이름은 다듬어도 되지만, "AI가 만드는 새 형식"과 "읽을 때 옛 문자열도 섞일 수 있는 형식"을 타입으로 구분한다.

### 2. `src/services/claude/prompts.ts` `buildFeedbackPrompt`

- `improve` 지시를 새 형식으로 바꾼다. 아래 뜻을 담으면 문구는 다듬어도 된다.
  - 고칠 점은 최대 3개이고, 없으면 빈 배열이다.
  - `point`: 무엇을 어떻게 고치면 좋은지 한국어 해요체로 짧게 설명한다. 사용자가 한 말을 인용해도 된다. 비워 두지 않는다. 예문을 `point`에 되풀이하지 않는다.
  - `example`: 더 나은 학습 언어 표현 한 문장. 한국어 설명을 섞지 않는다.
  - `good`(잘한 점 1~2문장)과 "한국어 해요체로 짧고 부드럽게" 지시는 그대로 둔다.
- 일본어 후리가나 지시는 `good`·`point`의 일본어 인용과 `example`의 모든 한자에 `[漢字|かんじ]`를 달라는 뜻으로 고친다(가나·한글에는 달지 않는다는 문장은 그대로).
- `showsPronunciation(language, level)`이면(일본어 입문~중급):
  - 출력 지시에 `example_pron_ko`: `example`의 한글 발음, 아래 '한글 발음' 규칙을 따른다는 줄을 넣는다.
  - 턴 프롬프트처럼 `## 한글 발음` 절에 `PRONUNCIATION_RULES`를 그대로 넣는다(같은 상수를 쓴다. 문구를 복사하지 않는다).
- **검사가 거부하는 모양을 프롬프트에서 금지한다**(아래 3의 검사가 버리거나 숨기는 것): `point`를 비우지 말라. `example`은 학습 언어 한 문장으로 쓰라. `example_pron_ko`는 한글과 공백·`-.,?!~…`만 쓰고 가나·한자·로마자·숫자를 섞지 말라(숫자도 읽는 대로 한글로). 비워 두지 말라. `PRONUNCIATION_RULES`에 이미 있는 문장은 거듭 쓰지 않아도 된다.
- 영어와 일본어 상급·고수(`showsPronunciation`이 false)는 표기 규칙도 `example_pron_ko` 지시도 넣지 않는다.
- 대화 기록(`content`)의 모양은 바꾸지 않는다.

### 3. `src/services/claude/client.ts` `generateFeedback`

- `showsPronunciation(input.language, input.level)`이면 `pronFeedbackSchema`, 아니면 `feedbackSchema`로 받는다(턴의 `generateTurn` 분기와 같은 방식).
- 받은 값을 정리한다(spec "피드백 형식"의 "검사"):
  - `point`가 공백뿐인 항목은 버리고, 남은 항목을 앞에서 3개(`IMPROVE_MAX`)까지 남긴다. 버리는 것이 자르는 것보다 먼저다(빈 항목 때문에 맞는 항목이 잘리지 않게).
  - `example`이 공백뿐이면 `""`로 저장한다.
  - 발음은 `cleanPron`으로 정리한다. 비었거나 검사에 맞지 않으면 그 항목의 `example_pron_ko`만 `null`이다. 피드백은 성공이다.
  - 발음을 요청하지 않은 피드백의 항목에는 `example_pron_ko` 키를 두지 않는다.
- 결과 타입은 `AiResult<Feedback>`(새 형식)이다.

### 4. 저장·읽기 타입

- `src/server/db/chat.ts`: `finishEnd`의 인자는 새 형식 `Feedback`, `EndResult`의 `ready` 피드백은 `StoredFeedback`이다. DB 함수·쿼리는 바꾸지 않는다(`feedback`은 형식 검사 없는 jsonb다).
- `src/server/db/reads.ts`의 대화방 `result`는 `EndResult`를 따르므로 타입만 맞춘다.
- `src/types/api.ts`의 `ChatEndResponse`는 `EndResult`를 그대로 쓴다.
- `src/test/fakes.ts`의 `generateFeedback` 기본값을 새 형식으로 바꾼다.

### 5. `src/components/ChatFeedback.tsx` 고칠 점 카드

`docs/spec/ui.md` "종료 피드백" 행대로 항목을 그린다. 카드 제목·구분선·최대 3개(`IMPROVE_MAX`)는 그대로다.

- 문자열 항목(옛 형식): 지금처럼 한 줄(`Furigana`)로 그린다.
- 객체 항목: 위에서부터
  1. 설명(`point`, 본문, 일본어면 `Furigana`)
  2. 예문(`example`): `mt-1 font-bold text-brand`, `lang={language}`, 일본어면 `Furigana`. 공백뿐이면 이 줄을 두지 않는다.
  3. 한글 발음(`example_pron_ko`): 값이 있는 문자열일 때만 `text-sm text-brand`, `aria-hidden="true"`. 레벨을 다시 따지지 않는다(만들 때 일본어 입문~중급만 요청했고, 중급도 항상 보인다).
- 예문 줄이 없으면 발음 줄도 두지 않는다.
- 잘한 점 카드, 단어 결과 카드, fallback·skipped 화면은 바꾸지 않는다.

### 6. 테스트

- `schemas.test.ts`: 새 형식을 받고, 항목이 문자열이면 거부, 발음 스키마는 `example_pron_ko`가 있어야 통과.
- `prompts.test.ts`: 일본어 레벨 1~3만 표기 규칙과 `example_pron_ko` 지시가 붙고 4~5·영어는 없음, `point`·`example` 지시와 금지 문장, 일본어 후리가나 지시가 `example`까지 다룸.
- `client.test.ts`: 레벨·언어별로 고른 스키마(`output_config.format`의 항목 속성), 빈 `point` 항목을 버린 뒤 3개로 자름(예: 4개 중 2번째가 빈 `point`면 1·3·4번째가 남음), 공백뿐인 `example`은 `""`, 잘못된 발음(가나 섞임·빈 값)은 그 항목만 `null`이고 피드백은 성공, 발음을 요청하지 않은 피드백엔 키 없음.
- `ChatFeedback.test.tsx`: 객체 항목의 설명 → 예문 → 발음 순서, 예문 `lang`, 일본어 예문의 루비, 발음 `aria-hidden`, 빈 예문이면 예문·발음 줄 없음, 발음 `null`·키 없음이면 발음 줄 없음, 옛 문자열 항목은 한 줄, 문자열과 객체가 섞여도 그림, 4개면 3개만.
- 피드백 값을 쓰는 기존 테스트(`server/chat.test.ts`, end `route.test.ts`, `server/db/chat.test.ts`, `server/db/reads.test.ts`, `ChatRoom.test.tsx`)는 새 형식으로 바꾸거나, 읽기 쪽 테스트는 옛 형식도 쓸 수 있다. 타입이 맞아야 `npm run build`가 통과한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run test:db   # server/db 테스트 데이터와 EndResult 타입을 바꿨다. 로컬 Supabase가 떠 있어야 한다
grep -q "pronFeedbackSchema" src/services/claude/schemas.ts
test -z "$(git status --porcelain supabase/ data/ public/)"   # 마이그레이션·단어 데이터·음성을 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `test:db`가 연결 오류로 실패하면(로컬 Supabase가 꺼져 있음) `blocked`로 멈춘다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`services/claude`는 프롬프트·스키마·SDK 호출, 발음 검사는 `lib/pronunciation`, 화면은 `components`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, AI 출력은 텍스트와 `Furigana`로만 그림, 의존 방향 app → server → services, lib)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "세션 종료 피드백"의 "피드백 형식"(검사·옛 형식 포함), "한글 발음"의 종료 피드백 문장, "레벨별 조절"의 종료 피드백 후리가나 문장, `ui.md` "종료 피드백" 행의 고칠 점 항목, `backend.md` "Claude 연동"의 종료 피드백 문장이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/10-feedback-pron/step0-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(타입 이름과 위치, generateFeedback 정리 규칙, ChatFeedback 항목 구조). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실제 Anthropic API를 부르지 마라(`.env.local`의 키로 스크립트를 돌리는 것 포함). 테스트는 가짜 client로 한다. 이유: 유료 호출이다. 실제 피드백으로 예문·발음을 확인하는 일은 phase가 끝난 뒤 메인 세션이 한다.
- 발음이 틀리거나 `point`가 빈 항목이 있다고 피드백을 실패(`invalid_output`)로 만들지 마라. 이유: 실패하면 고정 대체 결과(fallback)로 끝나 잘한 점·고칠 점이 모두 사라진다. spec은 그 값만 숨기거나 버린다.
- 영어·일본어 상급·고수 피드백에 표기 규칙이나 `example_pron_ko`를 넣지 마라. 이유: spec은 일본어 입문~중급만 발음을 보여 주고, 규칙 입력은 약 940토큰이라 비용이 는다.
- 마이그레이션을 만들거나 저장된 옛 피드백을 바꾸지 마라. 이유: `feedback`은 형식 검사 없는 jsonb이고, spec은 옛 문자열 항목을 읽을 때 그대로 그린다.
- `PRONUNCIATION_RULES` 문구를 고치지 마라. 이유: 단어 발음 생성 스크립트와 턴 프롬프트가 같은 문구를 쓴다.
- 대화방 다시 읽기(`router.refresh()`)를 더하지 마라. 이유: step 1의 범위다.
- 고칠 점 예문에 재생 버튼·문장 뜯어보기를 넣지 마라. 이유: spec `audio.md`·`chat.md`는 종료 피드백에 두지 않는다.
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: CLAUDE.md CRITICAL. AI 출력은 텍스트로만 그린다.
- 로그에 프롬프트·사용자 입력·AI 응답을 남기지 마라. 이유: spec `backend.md` 보안(로그의 개인정보).
- hook 통과용 빈 테스트나 Supabase 쿼리 체인 mock 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
