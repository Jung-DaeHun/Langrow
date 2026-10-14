# Step 0: pron-data

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/superpowers/plans/2026-10-14-korean-pronunciation.md`: "Global Constraints", "Review Focus", "### Task 1", "### Task 2", "### Task 3" 전체. **이 step은 Task 1·2·3만 한다.**
- `docs/spec/chat.md` "한글 발음" 절 전체와 "대화 진행" 2번(응답 구조)
- `docs/spec/words.md` "단어 데이터: 미리 생성"(필드 표와 `pron_ko`·`example_pron_ko` 설명)
- `docs/spec/backend.md` "데이터 모델"의 `chat_turns`·`words` 행과 "Claude 연동"의 "한글 발음"
- `docs/spec/testing.md`의 `lib/` 단위 테스트 "pronunciation"·"words", DB 통합 테스트 "한글 발음", 데이터 검증 "상황"
- 기존 코드:
  - `src/lib/levels.ts`(`showsFurigana`), `src/lib/words.ts`, `src/test/wordFiles.ts`, `src/lib/scenarios.ts`
  - `supabase/migrations/20261006083621_chat.sql`의 `finish_chat_turn`과 맨 아래 권한 줄, `supabase/migrations/20261009100000_save_explanation_source.sql`(함수를 지우고 다시 만드는 모양)
  - `src/services/claude/schemas.ts`, `src/server/db/chat.ts`, `src/server/db/reads.ts`, `src/server/db/rpc.ts`(`callRpc`의 인자 타입)
  - `src/server/db/chat.test.ts`, `src/server/db/reads.test.ts`(도우미 `createReadyUser`·`newSession`·`doneTurn`·`turnsOf`·`testWord`·`asWord`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

일본어 입문~중급 학습자에게 문장과 단어의 한글 발음(예: 今日は → 쿄-와)을 보여 주는 기능의 바탕이다. 발음은 AI가 만든다. 대화는 턴마다 Claude가 만들어 `chat_turns`에 저장하고, 단어는 미리 만들어 단어 JSON과 `words`에 저장한다(ADR-015). 이 step은 순수 함수(검사·표시 조건), 단어 데이터 규칙, 첫 마디 발음 상수, DB 컬럼·확정 RPC·읽기를 만든다. AI 호출(step 1)과 화면(step 2)은 하지 않는다.

계획 Task 1·2·3에 테스트와 코드가 이미 다 있다. 그대로 따르되, 계획의 코드가 실제 코드와 다르면 실제 코드에 맞추고 아래 핵심 규칙은 지켜라.

## 작업

계획 Task 1, Task 2, Task 3의 Step을 순서대로 한다. **각 Task의 커밋 단계는 하지 마라.** 커밋은 이 프롬프트의 작업 규칙대로 한다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

만들거나 바꿀 인터페이스:

```ts
// src/lib/pronunciation.ts (순수 함수)
export function cleanPron(text: unknown): string | null  // 앞뒤 공백 제거 후 /^[가-힣\s\-.,?!~…]+$/u면 그 문자열, 아니면 null

// src/lib/levels.ts
export function showsPronunciation(language: Language, level: Level): boolean  // language === "ja" && showsFurigana(level)

// src/lib/words.ts
export type WordEntry = { /* 기존 필드 */ pron_ko: string | null; example_pron_ko: string | null }

// src/lib/scenarios.ts
export type ScenarioLine = { text: string; ko: string; pronKo?: string }  // 레벨 1~3 상황의 ja 첫 마디 12개에만

// src/services/claude/schemas.ts (타입만. 스키마는 그대로)
export type TurnReply = {
  reply: string; reply_ko: string; reply_pron_ko?: string | null;
  correction: { corrected: string; explanation_ko: string; corrected_pron_ko?: string | null } | null;
}

// src/server/db/reads.ts
export type Word = { /* 기존 필드 */ pronKo: string | null; examplePronKo: string | null }
export type ChatTurnView = { /* 기존 필드 */ replyPronKo: string | null }
```

```sql
-- supabase/migrations/20261014100000_pronunciation.sql
alter table public.words add column pron_ko text, add column example_pron_ko text;
alter table public.chat_turns add column reply_pron_ko text;
-- finish_chat_turn: 옛 6인자 함수를 지우고 마지막에 p_reply_pron_ko text default null을 더해 다시 만든다
```

### 지켜야 할 핵심 규칙

- **검사와 표시 조건은 하나씩만 둔다.** 발음이 맞는지는 `cleanPron`, 보여 줄지는 `showsPronunciation`만 정한다. 다른 곳에서 정규식이나 레벨 비교를 다시 쓰지 않는다.
- **단어 데이터 검사**: 일본어는 `pron_ko`·`example_pron_ko`가 둘 다 `cleanPron`을 통과해야 하고, 영어는 둘 다 `null`이어야 한다. `validateWordFile`이 돌려주는 단어의 일본어 발음은 `cleanPron`으로 앞뒤 공백을 지운 값이다.
- **첫 마디 발음**: 계획 Task 2의 표에 있는 12개 값을 글자 그대로 넣는다. 레벨 4·5 상황과 영어 첫 마디에는 넣지 않는다(상황은 그 레벨의 대화방에만 나와서 보일 일이 없다).
- **확정 RPC**: 본문은 `20261006083621_chat.sql`의 `finish_chat_turn`과 같고 `reply_pron_ko = p_reply_pron_ko`만 더한다. 잠금 순서(`profiles` → 만료 복구 → `chat_sessions`), 토큰·상태 확인, 활동일·`limit_reached` 기록을 바꾸지 않는다. `p_reply_pron_ko`는 **마지막 인자이고 `default null`**이다. 그래야 발음이 없는 턴은 인자를 빼고 부를 수 있고(생성 타입이 `p_reply_pron_ko?: string`), `security.test.ts`의 권한 검사 호출도 그대로 맞는다. 권한은 `revoke … from public, anon, authenticated` + `grant … to service_role`을 새 시그니처 `(uuid, uuid, uuid, text, text, jsonb, text)`로 다시 건다.
- **교정 발음은 컬럼을 만들지 않는다.** `correction` jsonb 안의 `corrected_pron_ko` 키로 그대로 저장된다.
- **옛 턴**: 기능을 넣기 전에 저장된 턴은 `reply_pron_ko`가 null이고 `correction`에 `corrected_pron_ko` 키가 없다. 읽기는 그대로 돌려준다(`replyPronKo: null`, 교정은 키 없는 그대로).
- `finishChatTurn`은 `p_reply_pron_ko: reply.reply_pron_ko ?? undefined`로 넘긴다(undefined 키는 요청에서 빠져 기본값 null이 된다).
- 마이그레이션은 **Bash로** `npx supabase migration up`, 타입은 **Bash로** `npx supabase gen types typescript --local > src/types/database.ts`로 만든다. `src/types/database.ts`를 손으로 고치지 않는다.
- 타입이 바뀌어 깨지는 테스트 fixture(`ChatTurnView`·`Word`·`WordRow`를 만드는 곳)는 `npx tsc --noEmit`이 알려 준다. 기본값에 새 키를 `null`로 더하기만 하고 다른 값은 바꾸지 않는다. `src/components/ChatRoom.tsx`는 확정 턴을 `added`에 넣는 한 줄(`replyPronKo: reply.reply_pron_ko ?? null`)만 고친다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run test:db
test -f supabase/migrations/20261014100000_pronunciation.sql
grep -q "reply_pron_ko" src/types/database.ts
test -z "$(git status --porcelain data/)"   # 단어 데이터를 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `npm run test:db`는 로컬 Supabase가 켜져 있어야 한다(꺼져 있으면 `blocked`).
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/`는 순수 함수, DB 변경은 `supabase/migrations/`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (admin 쿼리의 `user_id` 조건, 구현 경로에 `test` 문자열 없음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "한글 발음"의 "검사"와 첫 마디 문장, `words.md` "단어 데이터"의 발음 필드 설명, `backend.md` 데이터 모델의 두 행과 "Claude 연동"의 저장 문장이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/6-pron/step0-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(만든 파일, export 이름, RPC 시그니처). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(로컬 Supabase가 꺼짐 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db reset`을 하지 마라. 이유: 로컬 단어 2,000개와 테스트 계정이 지워진다. 마이그레이션은 `npx supabase migration up`으로만 적용한다.
- `npm run words:pron`·`npm run words:generate`·`npm run seed:words`를 실행하거나 `data/words/*.json`을 고치지 마라. 이유: 실제 발음 생성은 phase 뒤에 사람이 확인하며 돌린다. step 커밋은 `git add -A`라서 바뀐 데이터가 그대로 커밋된다. 지금 seed하면 일본어 발음 필수 검사에 걸려 실패하는 것이 정상이다.
- 옛 `finish_chat_turn`을 남겨 두거나 같은 이름으로 오버로드를 하나 더 만들지 마라. 이유: 두 시그니처가 있으면 PostgREST가 이름 있는 인자 호출을 어느 쪽으로 보낼지 모호해지고, 권한도 두 벌 관리해야 한다.
- `pronTurnReplySchema`, 프롬프트, `client.ts`를 고치지 마라. 이유: step 1(Task 4)의 범위다. 이 step은 `TurnReply` 타입만 바꾼다.
- 대화방·단어 카드·빈칸 화면에 발음을 그리지 마라(`ChatRoom.tsx`의 `added` 한 줄 제외). 이유: step 2(Task 6)의 범위다.
- hook 통과용 빈 테스트나 Supabase 쿼리 체인 mock 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
