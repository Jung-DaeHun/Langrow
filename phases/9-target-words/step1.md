# Step 1: target-ai

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md`
  - "배운 단어 써 보기" 절 전체(이 phase의 기준이다. 특히 "고르기", "유도", "쓴 단어 판단", "검사")
  - "대화 진행" 2번(응답 구조와 턴마다 더 받는 필드)
- `docs/spec/backend.md` "Claude 연동" 전체(특히 "배운 단어", "대화 기록")
- `docs/spec/testing.md`의 "services" 항목과 "use-case"의 "대화" 항목
- `docs/ADR.md` ADR-023
- 이전 step에서 만든 코드: `src/lib/targetWords.ts`(`WordCandidate`, `TargetWord`, `TargetSource`, `pickTargetIds`, `pickUsedIds`), `src/server/db/chat.ts`(`beginChatTurn`이 주는 `candidates`·`candidateSource`·`targets`, `finishChatTurn`의 `words` 인자와 `targetWords`·`targetSource` 결과)
- 기존 코드: `src/services/claude/schemas.ts`·`prompts.ts`·`client.ts`와 각 테스트, `src/server/chat.ts`·`chat.test.ts`, `src/test/fakes.ts`, `src/types/api.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 0이 순수 규칙(`lib/targetWords`), DB 컬럼, 예약 RPC의 후보·목표 단어, 확정 RPC의 저장을 만들었다. 이 step은 Claude에게 단어를 고르고 유도하고 쓴 단어를 알려 달라고 요청하고, use-case가 예약 결과를 AI에 넘기고 AI 결과를 확정 RPC에 넘기게 한다. 메시지 API 응답에 목표 단어 상태를 담는다. 화면(step 2)은 하지 않는다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. `src/services/claude/prompts.ts`

```ts
export type TurnPromptInput = {
  // 기존 필드 그대로
  words?:
    | { kind: "pick"; candidates: readonly WordCandidate[] }   // 첫 턴, 후보가 1개 이상
    | { kind: "practice"; targets: readonly TargetWord[] };    // 목표 단어가 있는 세션의 턴
};
```

- `words`가 없으면 프롬프트는 지금과 글자 하나 다르지 않다(기존 테스트가 그대로 통과해야 한다).
- `words`가 있으면 시스템 프롬프트에 "## 배운 단어" 절을 넣는다. 아래 뜻을 담으면 문구는 다듬어도 된다.
  - 목록: 1부터 번호를 붙여 한 줄에 하나씩 쓴다. 형식은 `번호. 단어(읽기) — 뜻`이다. 읽기는 일본어이고 `reading`이 있으며 단어와 다를 때만 붙인다.
    - pick: 오늘 이미 쓴 후보(`usedToday`)는 줄 끝에 `(오늘 씀)`을 붙인다.
    - practice: 줄 끝에 ` — 썼음` 또는 ` — 아직`을 붙인다.
  - pick 지시: 목록은 학습자가 최근 배운 단어다. 이 상황과 너의 역할에서 자연스럽게 나올 단어만 최대 5개 고른다. 맞는 단어 중에서는 `(오늘 씀)`이 없는 단어를 먼저 고른다. 화제를 바꿔야 쓸 수 있는 단어는 고르지 않는다. 맞는 단어가 없으면 고르지 않는다. 이번 reply부터 고른 단어를 유도한다.
  - 유도 지시(pick·practice 모두):
    - 역할을 지키면서, 아직 쓰지 않은 목표 단어를 학습자가 대답에 쓰기 쉬운 질문이나 상황을 만든다.
    - 한 reply에서 한 단어만 노린다.
    - 아직 쓰지 않은 목표 단어를 reply에서 먼저 말하지 않는다. corrected는 이 제한을 받지 않는다(자연스럽고 맞는 문장이 먼저다).
    - 역할을 벗어나 "이 단어를 써 보세요"처럼 말하지 않는다.
    - 사용자의 목표(상황)가 먼저다. 단어를 쓰게 하려고 화제를 바꾸거나 대화를 억지로 늘리지 않는다.
    - 목표 단어를 모두 썼으면 더 유도하지 않는다.
  - "## 출력"에 필드 지시를 더한다:
    - pick만 `target_words`: 고른 단어의 번호 배열.
    - 둘 다 `used_words`: 이번 사용자의 말에서 학습자가 학습 언어로 직접 쓴 목표 단어의 번호 배열(pick은 `target_words`에 넣은 번호 중에서만).
      - 활용형(`買う` → `買いました`, `decide` → `decided`)과 다른 표기(`美味しい` → `おいしい`)도 쓴 것이다.
      - 한국어로 쓴 것은 넣지 않는다. 앞 턴의 교정 문장을 보고 학습 언어로 직접 쓴 것은 넣는다.
      - 문법이 틀려도 그 단어를 썼으면 넣는다.
      - 없으면 빈 배열이다.
  - **검사가 거부하는 모양을 금지한다**(`lib/targetWords`가 버리는 것): 번호는 목록에 있는 번호만 쓴다(0·음수·소수·목록 밖 번호 금지). 같은 번호를 두 번 쓰지 않는다. `target_words`는 5개를 넘기지 않는다. `used_words`에는 목표 단어(pick은 `target_words`) 밖의 번호를 넣지 않는다. 숫자로 쓴다(문자열·단어 글자 금지).
- 단어 목록은 대화 기록(`messages`)에 넣지 않는다. 기록에는 지금처럼 reply만 넣는다.

### 2. `src/services/claude/schemas.ts`

- 지금 두 스키마(`turnReplySchema`, `pronTurnReplySchema`)에 단어 필드를 더한 변형을 만든다. pick은 `target_words: z.array(z.number())`와 `used_words: z.array(z.number())`, practice는 `used_words`만 더한다. 발음 유무 × (없음/pick/practice) 조합을 어떻게 만들지(`.extend` 등)는 재량이다.
- `words`가 없는 턴의 스키마는 지금과 같아야 한다.
- `.int()`·`.min`·`.max` 같은 제약은 넣지 않는다(파일 위 주석의 이유). 번호 검사는 `lib/targetWords`가 한다.

### 3. `src/services/claude/client.ts`

- `generateTurn(input)`이 `input.words`에 맞는 스키마로 부른다(발음 조건 `showsPronunciation`은 그대로).
- 받아들이기: 지금 처리(발음 `cleanPron`, 뜯어보기 `alignBreakdown`, 빈 reply는 `invalid_output`)는 그대로 두고, 번호를 id로 바꾼다.
  - pick: `targetWordIds = pickTargetIds(후보 id들, target_words)`, `usedWordIds = pickUsedIds(후보 id들, used_words, targetWordIds)`.
  - practice: `usedWordIds = pickUsedIds(목표 id들, used_words, 목표 id들)`.
  - 번호가 맞지 않으면 버릴 뿐 턴은 성공이다. `invalid_output`으로 만들거나 다시 부르지 않는다.
- 결과 모양은 재량이다(예: `TurnReply`에 선택 키 `words?: { targetWordIds?: string[]; usedWordIds: string[] }`를 더한 결과). 단, 아래 use-case가 API 응답의 `reply`에서 이 값을 떼어 낼 수 있어야 한다.
- 로그에 단어·번호·사용자 입력을 남기지 않는다.

### 4. `src/server/chat.ts` — `sendChatMessage`

- 예약 결과로 `words`를 정한다:
  - `candidates`가 1개 이상이면 `{ kind: "pick", candidates }`.
  - 그렇지 않고 `targets`가 1개 이상이면 `{ kind: "practice", targets }`.
  - 둘 다 아니면 넘기지 않는다.
- AI가 성공하면 `finishChatTurn(userId, sessionId, token, reply, words)`에 id로 넘긴다:
  - pick 턴: `{ targetWordIds, targetSource: candidateSource, usedWordIds }`. 고른 것이 없어도 빈 배열을 넘긴다. RPC가 저장하지 않는다.
  - practice 턴: `{ usedWordIds }`.
  - `words`가 없던 턴: 넘기지 않는다.
- 성공 응답은 `{ turnNo, turnsLeft, reply, targetWords, targetSource }`다. `targetWords`·`targetSource`는 확정 RPC가 돌려준 값이다. `reply`는 `TurnReply` 모양 그대로이고 단어 id·번호를 담지 않는다.
- 예약 거부·AI 실패·확정 거부 흐름은 바꾸지 않는다.

### 5. `src/types/api.ts`

- `ChatMessageResponse`에 `targetWords: TargetWord[] | null`과 `targetSource: TargetSource | null`을 더한다(타입은 `@/lib/targetWords`에서 가져온다). 주석에 `chat.md` "배운 단어 써 보기"를 적는다.

### 6. 가짜와 테스트

- `src/test/fakes.ts`의 `generateTurn`·`finishChatTurn` 가짜를 새 모양에 맞춘다. 기존 use-case 테스트 의도는 바꾸지 않는다.
- services 테스트(`docs/spec/testing.md` "services"의 배운 단어 문장):
  - pick 턴만 후보 목록·고르기 지시와 `target_words`·`used_words`를 요청한다.
  - practice 턴은 목표 단어 목록(썼음/아직)·유도 지시와 `used_words`를 요청한다.
  - 둘 다 없으면 지시도 필드도 없다.
  - 일본어 읽기는 단어와 다를 때만 붙는다. 오늘 쓴 후보에만 `(오늘 씀)`이 붙는다.
  - 범위 밖·중복 번호, 6개 이상 고른 것, 목표 밖 쓴 번호는 턴은 성공하고 그 값만 버린다. 다시 부르지 않는다.
  - 발음 턴(일본어 1~3)과 아닌 턴 모두 단어 필드가 붙는다.
- use-case 테스트(`docs/spec/testing.md` "use-case"의 "대화"):
  - 예약이 준 후보를 AI에 pick으로 넘긴다.
  - 고른 번호·쓴 번호를 id로 바꿔 출처와 함께 확정 RPC에 넘긴다.
  - 목표 단어가 있는 턴은 쓴 단어 id만 넘긴다.
  - 후보·목표가 없으면 AI에 단어를 넘기지 않고 확정 RPC에도 넘기지 않는다.
  - 확정 RPC가 돌려준 목표 단어 상태를 응답에 담는다. 응답 `reply`에는 단어 id가 없다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
grep -q "targetWords" src/types/api.ts
test -z "$(git status --porcelain supabase/ data/ public/)"   # 마이그레이션·단어 데이터·음성을 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`services/claude`는 SDK 호출과 프롬프트, 번호 검사는 `lib/targetWords`, 흐름은 `server/chat.ts`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (Claude 호출 중 DB 잠금 없음, 의존 방향 app → server → services, lib)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "대화 진행" 2번의 배운 단어 문장, "배운 단어 써 보기"의 "고르기"·"유도"·"쓴 단어 판단"·"검사"·"응답"(메시지 응답 부분), `backend.md` "Claude 연동"의 "배운 단어"다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/9-target-words/step1-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(TurnPromptInput.words, 스키마 변형, generateTurn 결과 모양, use-case 흐름, ChatMessageResponse 필드). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실제 Anthropic API를 부르지 마라(`.env.local`의 키로 스크립트를 돌리는 것 포함). 테스트는 가짜 client로 한다. 이유: 유료 호출이다. 실제 대화로 고르기·유도·쓴 단어 판단을 확인하는 일은 phase가 끝난 뒤 메인 세션이 한다(spec `chat.md` "배운 단어 써 보기" "확인").
- 번호가 맞지 않다고 턴을 실패시키거나 다시 부르지 마라. 이유: spec은 맞지 않는 값만 버리고 턴은 성공으로 처리한다. 실패로 만들면 사용량·실패 10회 차단에 들어간다.
- 세션 생성(`startChatSession`)에서 Claude를 부르거나 단어를 고르지 마라. 이유: ADR-023. 턴으로 세지 않는 AI 호출이 생겨 한도를 우회할 수 있다.
- 단어 목록이나 쓴 여부를 대화 기록(`messages`)에 넣지 마라. 이유: 기록에는 reply만 넣는다. 지금 상태는 매 턴 시스템 프롬프트로 준다.
- `words`가 없는 턴의 프롬프트·스키마를 바꾸지 마라. 이유: 목표 단어가 없는 세션은 지금과 같아야 하고 비용도 늘지 않아야 한다(spec `usage.md`).
- API 응답의 `reply`에 단어 id·번호를 넣지 마라. 이유: `reply`는 DB에 저장되는 턴 모양이고, 목표 단어 상태는 `targetWords`로 따로 준다.
- 스키마에 `.int()`·`.min`·`.max`를 넣지 마라. 이유: 구조화 출력이 지원하지 않는 제약은 SDK가 응답 뒤에 검증해 사소한 초과도 AI 실패가 된다.
- 마이그레이션·`src/server/db/`·화면을 고치지 마라. 이유: step 0·2의 범위다.
- 로그에 프롬프트·사용자 입력·AI 응답·단어를 남기지 마라. 이유: spec `backend.md` 보안(로그의 개인정보).
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
