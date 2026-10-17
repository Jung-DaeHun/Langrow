# Step 0: chat-data

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md`
  - "대화 진행" 2번(응답 구조)
  - "레벨별 조절"의 "후리가나" 항목 전체(한자·가타카나·여는 괄호만 빠진 표기·본문에 한자가 없는 표기)
  - "문장 뜯어보기" 절 전체
- `docs/spec/backend.md` "데이터 모델"의 `chat_turns` 행, "Claude 연동"의 "문장 뜯어보기"
- `docs/spec/testing.md`: `lib/` 단위 테스트의 "furigana"·"breakdown"(scenarios 문장 포함), DB 통합 테스트의 "문장 뜯어보기"
- `docs/ADR.md` ADR-016, ADR-018
- 기존 코드:
  - `src/lib/furigana.ts`·`furigana.test.ts`, `src/lib/audio.ts`(`parseFurigana`로 음성 SSML을 만든다. 이 step에서 고치지 않는다)
  - `src/lib/scenarios.ts`·`scenarios.test.ts`
  - `supabase/migrations/20261014100000_pronunciation.sql`(`finish_chat_turn`의 최신 정의, 함수를 지우고 다시 만드는 모양, 권한 줄)
  - `src/services/claude/schemas.ts`(`TurnReply` 타입), `src/server/db/chat.ts`(`finishChatTurn`), `src/server/db/reads.ts`(`readChatRoom`, `ChatTurnView`), `src/server/db/rpc.ts`(`callRpc`의 인자 타입)
  - `src/server/db/chat.test.ts`·`reads.test.ts`에서 한글 발음(`reply_pron_ko`)을 확인하는 테스트와 도우미, `src/server/db/security.test.ts`의 `finish_chat_turn` 호출

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

2026-10-17 운영 확인에서 나온 대화 개선 phase의 첫 step이다. phase 전체는 (1) 한국어 입력을 모든 레벨에서 받기, (2) 일본어 후리가나를 모든 레벨의 한자·가타카나에 달기, (3) 문장 뜯어보기(AI 말풍선·교정 문장을 의미 조각으로 나눠 조각마다 한국어 뜻), (4) 일본어 줄넘침 수정, (5) Claude API 오류 로그다. 이 step은 그 바탕이 되는 순수 함수, 첫 마디 데이터, DB만 만든다. AI 호출(step 1)과 화면(step 2·3)은 하지 않는다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. `src/lib/furigana.ts`

```ts
export type FuriganaSegment = { text: string; reading?: string };  // 그대로
export function parseFurigana(input: string): FuriganaSegment[]   // 여는 괄호만 빠진 표기 복구를 더한다
export function stripFurigana(input: string): string             // 그대로 (parseFurigana를 쓰므로 복구도 따른다)
// 화면용. parseFurigana 결과에서 읽기가 없는 segment 안의 가타카나 묶음에 히라가나 읽기를 단다
export function rubySegments(input: string): FuriganaSegment[]
```

- **여는 괄호만 빠진 표기**: 온전한 표기(`[본문|읽기]`) 밖에서 `본문|읽기]` 꼴을 만나면 `|` 바로 앞에 붙은 한자 묶음(`\p{Script=Han}`이 이어진 부분)을 본문으로 보고 읽기를 단다.
  - `[風邪|かぜ]気味|ぎみ]` → `[{ text: "風邪", reading: "かぜ" }, { text: "気味", reading: "ぎみ" }]`
  - `少し疲れ気味|ぎみ]です` → `[{ text: "少し疲れ" }, { text: "気味", reading: "ぎみ" }, { text: "です" }]`
  - `|` 바로 앞이 한자가 아니면(`コーヒー|こーひー]`) `|`부터 `]`까지의 읽기를 버리고 본문만 남긴다 → `[{ text: "コーヒー" }]`
  - 그 밖의 깨진 표기(닫는 괄호가 없는 `[漢字|かんじ`, `|`가 없는 `[漢字]`)는 지금처럼 괄호 기호만 지우고 일반 텍스트로 둔다.
- **가타카나 읽기(`rubySegments`)**: 읽기가 없는 segment에서 가타카나 묶음(가타카나 글자 U+30A1–U+30F6과 장음 `ー` U+30FC가 이어진 부분)을 떼어 같은 소리의 히라가나를 읽기로 단다(코드포인트 −0x60, `ー`는 그대로). `コーヒー` → `{ text: "コーヒー", reading: "こーひー" }`.
  - `・`(U+30FB)는 묶음을 끊고 일반 텍스트로 둔다: `チョン・デフン` → `[チョン|ちょん]`, `・`, `[デフン|でふん]`.
  - 가타카나 글자 없이 `ー`만 있는 묶음(`えー`의 `ー`)에는 읽기를 달지 않는다.
  - 읽기가 있는 segment(한자 표기)의 본문·읽기 안에 있는 가타카나는 건드리지 않는다.
  - 이웃한 일반 텍스트 segment는 지금처럼 하나로 합친다.

### 2. `src/lib/breakdown.ts` (새 파일, 순수 함수)

```ts
export type BreakdownPiece = { text: string; meaning_ko: string };
export type Breakdown = BreakdownPiece[];
// 검사를 통과하면 원래 문장을 조각 경계에서 자른 조각(표기 포함)을, 아니면 null을 돌려준다
export function alignBreakdown(sentence: string, pieces: readonly BreakdownPiece[]): Breakdown | null
```

- **비교**: 조각 `text`를 순서대로 이은 것과 `sentence`를 각각 `stripFurigana` → 공백(`\s`)·문장부호(`\p{P}`)·기호(`\p{S}`) 제거 → `toLowerCase()`(영어 대소문자 무시)로 정규화해 비교한다. 같지 않으면 `null`.
- **거부(`null`)**: 조각 배열이 비었다. `text`나 `meaning_ko`가 앞뒤 공백을 지우면 빈 조각이 있다. 정규화하면 빈 조각(문장부호만 있는 조각)이 있다(문장에서 자를 자리가 없다). 한자 표기(`[漢字|かな]`) 하나가 두 조각에 걸친다.
- **돌려주는 `text`**: AI가 준 글자가 아니라 **원래 문장(표기 포함)을 조각 경계에서 자른 부분**이다. 조각 사이와 문장 끝의 공백·문장부호는 앞 조각에 붙이고, 문장 맨 앞의 것은 첫 조각에 붙인다. 각 `text`와 `meaning_ko`의 앞뒤 공백은 지운다. 그래서 대소문자·표기·문장부호가 늘 문장과 같고, AI 조각에 표기가 있든 없든 결과가 같다.
- 예(테스트에 넣는다):
  - `[家|いえ]で[休|やす]んでいました。` + `[{家で, 집에서}, {休んでいました, 쉬고 있었어요}]` → `[{ text: "[家|いえ]で", … }, { text: "[休|やす]んでいました。", … }]`
  - `Hi! What's your name?` + `[{hi, 안녕하세요}, {what's, 뭐예요}, {your name, 이름이}]` → text는 `"Hi!"`, `"What's"`, `"your name?"`
  - `[週末|しゅうまつ]は` + `[{週, 주}, {末は, 말은}]` → `null` (표기가 두 조각에 걸침)
  - `[食|た]べたり` + `[{食べる, 먹다}]` → `null` (형태가 바뀜) / `[食|た]べます` + `[{たべます, 먹어요}]` → `null` (한자를 가나로 바꿈)
  - 조각 하나를 빼먹으면 `null`, 빈 배열이면 `null`, `meaning_ko`가 공백뿐이면 `null`

### 3. `src/lib/scenarios.ts`

```ts
export type ScenarioLine = { text: string; ko: string; pronKo?: string; breakdown?: Breakdown };
```

- 상황 20개의 영어·일본어 첫 마디 **40개 모두**에 `breakdown`을 단다. **이 step 세션이 직접 초안을 쓴다**(외부 API를 부르지 않는다). 사람 검수는 phase 뒤에 한다. 파일 위 첫 마디 주석의 "AI 초안이라 출시 전에 사람이 검수한다"에 뜯어보기도 들어가게 고친다.
- 조각은 의미 단위(단어·조사 묶음·서술어)로, 조사·어미는 앞말과 묶는다(`chat.md` "문장 뜯어보기"의 형식 예). `meaning_ko`는 그 조각의 문장 속 뜻을 짧은 한국어로 쓴다.
- 일본어 `text`는 `alignBreakdown`이 돌려주는 모양 그대로(원래 첫 마디의 `[漢字|かな]` 표기가 붙은 부분 문자열) 적는다.
- `scenarios.test.ts`에 테스트를 더한다: 40개 첫 마디 모두 `alignBreakdown(opening.text, opening.breakdown ?? [])`가 `opening.breakdown`과 같다(`toEqual`). 이 테스트가 빠진 첫 마디도 잡는다.

### 4. DB: 마이그레이션 `supabase/migrations/20261017100000_breakdown.sql`

```sql
alter table public.chat_turns add column reply_breakdown jsonb;
drop function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb, text);
-- 마지막에 p_reply_breakdown jsonb default null을 더해 다시 만든다
```

- 본문은 `20261014100000_pronunciation.sql`의 `finish_chat_turn`과 같고, 턴 update에 `reply_breakdown = p_reply_breakdown`만 더한다. 잠금 순서(`profiles` → 만료 복구 → `chat_sessions`), 토큰·상태 확인, 활동일·`limit_reached` 기록을 바꾸지 않는다.
- `p_reply_breakdown`은 **마지막 인자이고 `default null`**이다. 그래야 뜯어보기가 없는 턴은 인자를 빼고 부를 수 있고, `security.test.ts`의 권한 검사 호출도 그대로 맞는다.
- 권한은 `revoke … from public, anon, authenticated` + `grant … to service_role`을 새 시그니처 `(uuid, uuid, uuid, text, text, jsonb, text, jsonb)`로 다시 건다.
- **교정 뜯어보기는 컬럼을 만들지 않는다.** `correction` jsonb 안의 `breakdown` 키로 그대로 저장된다.
- 마이그레이션은 **Bash로** `npx supabase migration up`, 타입은 **Bash로** `npx supabase gen types typescript --local > src/types/database.ts`로 만든다. `src/types/database.ts`를 손으로 고치지 않는다.

### 5. 저장·읽기 코드

```ts
// src/services/claude/schemas.ts (타입만. zod 스키마는 step 1이 바꾼다)
export type TurnReply = {
  reply: string; reply_ko: string; reply_pron_ko?: string | null; reply_breakdown?: Breakdown | null;
  correction: { corrected: string; explanation_ko: string; corrected_pron_ko?: string | null; breakdown?: Breakdown } | null;
};
// src/server/db/reads.ts
export type ChatTurnView = { /* 기존 필드 */ replyBreakdown: Breakdown | null };
```

- `finishChatTurn`은 `p_reply_breakdown: reply.reply_breakdown ?? undefined`로 넘긴다(undefined 키는 요청에서 빠져 기본값 null이 된다).
- `readChatRoom`은 `reply_breakdown`을 읽어 `replyBreakdown`으로 돌려준다. 기능을 넣기 전의 턴은 `null`이고 교정에는 `breakdown` 키가 없다. 그대로 돌려준다.
- `src/components/ChatRoom.tsx`는 확정 턴을 `added`에 넣는 곳에 `replyBreakdown: reply.reply_breakdown ?? null` 한 줄만 더한다.
- 타입이 바뀌어 깨지는 테스트 fixture(`ChatTurnView`를 만드는 곳)는 `npx tsc --noEmit`이 알려 준다. 새 키를 `null`로 더하기만 하고 다른 값은 바꾸지 않는다.
- DB 통합 테스트(`chat.test.ts` 또는 `reads.test.ts`, 한글 발음 테스트 옆): `finish_chat_turn`이 `reply_breakdown`과 `correction` 안의 `breakdown`을 저장하고 `readChatRoom`이 돌려준다(`null`도 그대로), 인자를 빼고 불러도 기존처럼 동작한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run test:db
test -f supabase/migrations/20261017100000_breakdown.sql
grep -q "reply_breakdown" src/types/database.ts
test -z "$(git status --porcelain data/ public/)"   # 단어 데이터·음성을 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `npm run test:db`는 로컬 Supabase가 켜져 있어야 한다(꺼져 있으면 `blocked`).
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/`는 순수 함수, DB 변경은 `supabase/migrations/`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (admin 쿼리의 `user_id` 조건, 구현 경로에 `test` 문자열 없음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "레벨별 조절"의 "후리가나" 항목(가타카나·여는 괄호만 빠진 표기·본문에 한자가 없는 표기), "문장 뜯어보기"의 "형식"·"검사"·"저장"과 첫 마디 문장, `backend.md` 데이터 모델의 `chat_turns` 행과 "Claude 연동"의 저장 문장이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/7-chat-improve/step0-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(만든 파일, export 이름, RPC 시그니처, 첫 마디 뜯어보기 수). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(로컬 Supabase가 꺼짐 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `parseFurigana`가 가타카나에 읽기를 달게 하지 마라. 가타카나 읽기는 `rubySegments`에만 둔다. 이유: `lib/audio.ts`가 `parseFurigana`로 음성 SSML(`<sub alias>`)을 만든다. 바뀌면 이미 만든 단어·예문 음성의 SSML이 달라져 전체를 다시 만들어야 한다(spec `chat.md` "후리가나"). 여는 괄호 복구는 괜찮다. 2026-10-17에 `data/words/*.json`과 `scenarios.ts`를 검사했더니 깨진 표기가 0건이라 SSML이 바뀌지 않는다.
- `src/lib/audio.ts`, `scripts/generate-audio.ts`를 고치거나 `npm run audio:generate`를 실행하지 마라. 이유: 음성 생성은 Azure 유료 호출이고, 결과가 `git add -A`로 그대로 커밋된다.
- `supabase db reset`을 하지 마라. 이유: 로컬 단어 2,000개와 테스트 계정이 지워진다. 마이그레이션은 `npx supabase migration up`으로만 적용한다.
- 옛 `finish_chat_turn`을 남겨 두거나 같은 이름으로 오버로드를 하나 더 만들지 마라. 이유: 두 시그니처가 있으면 PostgREST가 이름 있는 인자 호출을 어느 쪽으로 보낼지 모호해지고, 권한도 두 벌 관리해야 한다.
- Anthropic API 같은 외부 API를 부르지 마라. 첫 마디 뜯어보기 초안은 이 세션이 직접 쓴다. 이유: 유료 호출이고 step 안에서 하지 않는 규칙이다.
- zod 스키마, 프롬프트, `client.ts`를 고치지 마라. 이유: step 1의 범위다. 이 step은 `TurnReply` 타입만 바꾼다.
- `src/lib/levels.ts`를 고치지 마라. 이유: `showsFurigana`·`allowsKoreanInput`은 프롬프트(step 1)와 화면(step 2·3)이 쓰는 곳을 바꾼 뒤에 지운다.
- 화면에 뜯어보기나 가타카나 읽기를 그리지 마라(`Furigana.tsx`도 고치지 않는다, `ChatRoom.tsx`의 `added` 한 줄 제외). 이유: step 2·3의 범위다.
- `data/words/*.json`을 고치거나 `npm run seed:words`·`words:*`를 실행하지 마라. 이유: 이 phase는 단어 데이터를 바꾸지 않는다.
- hook 통과용 빈 테스트나 Supabase 쿼리 체인 mock 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
