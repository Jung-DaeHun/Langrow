# 일본어 한글 발음 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일본어 입문~중급에서 대화 말풍선(첫 마디 포함)·교정 문장·단어 카드·빈칸 채점 뒤 예문 아래에 AI가 만든 한글 발음(예: 今日は → 쿄-와)을 보여 준다.

**Architecture:** 순수 함수 `cleanPron`(검사)과 `showsPronunciation`(표시 조건)이 규칙을 정한다. 대화는 일본어 입문~중급 턴만 발음 필드가 있는 스키마로 Claude를 부르고, `finish_chat_turn`이 `chat_turns.reply_pron_ko`와 `correction` jsonb에 저장한다. 단어는 스크립트(`generate-words`, 새 `generate-pronunciation`)가 `pron_ko`·`example_pron_ko`를 단어 JSON에 쓰고 seed로 `words`에 넣는다. 첫 마디 발음은 `scenarios.ts` 상수다. 화면은 저장된 값을 `aria-hidden` 한 줄로 그린다.

**Tech Stack:** Next.js 16.3.8(App Router), React 19.2.8, TypeScript strict, Tailwind, Supabase(Postgres RPC, supabase-js 2.117.2), @anthropic-ai/sdk 0.131.0(구조화 출력, zod 4.6.5), Vitest(jsdom), tsx

**Spec:** `docs/spec/chat.md` "한글 발음"(기준)·"대화 진행"·"레벨별 조절", `docs/spec/words.md` "단어 데이터"·"오늘의 학습", `docs/spec/ui.md` "대화 말풍선"·"플래시카드"·"빈칸 퀴즈", `docs/spec/backend.md` 데이터 모델·"Claude 연동", `docs/spec/testing.md`, ADR-015

## Global Constraints

- 표시 조건은 하나다: `showsPronunciation(language, level)` = `language === "ja" && showsFurigana(level)`(레벨 1~3). 화면·프롬프트·생성 요청이 모두 이 함수를 쓴다.
- 발음 검사는 하나다: `cleanPron(text: unknown): string | null`. 앞뒤 공백을 지운 뒤 `/^[가-힣\s\-.,?!~…]+$/u`에 맞으면 그 문자열, 아니면 `null`.
- 표기 규칙 문구는 하나다: `PRONUNCIATION_RULES`(`src/services/claude/prompts.ts`). 대화 프롬프트·`generate-words`·`generate-pronunciation`이 같은 문구를 쓴다.
- DB: `words.pron_ko text`, `words.example_pron_ko text`, `chat_turns.reply_pron_ko text`(모두 null 허용). 확정 RPC는 `finish_chat_turn(p_user_id uuid, p_session_id uuid, p_token uuid, p_reply text, p_reply_ko text, p_correction jsonb, p_reply_pron_ko text default null)`이다. 교정 발음은 `p_correction` jsonb 안의 `corrected_pron_ko` 키다.
- 화면 클래스(ui.md 그대로): AI 말풍선 `mt-1 block text-sm text-brand`, 교정 카드 `text-sm text-brand`, 카드 앞면 `text-lead text-brand`, 카드 뒷면·빈칸 `text-sm text-brand`. 모든 발음 요소에 `aria-hidden="true"`를 단다. 새 턴 알림(`aria-live`) 영역에는 넣지 않는다.
- `src/lib/`는 순수 함수만(I/O·환경변수·fetch 없음). 구현 파일 경로에 `test` 문자열을 넣지 않는다.
- TDD guard: `page.tsx`/`layout.tsx`를 뺀 모든 `.ts(x)`에 같은 폴더의 `*.test.ts(x)`가 먼저 있어야 한다. hook 통과용 빈 테스트나 Supabase 쿼리 체인 mock 테스트를 만들지 않는다.
- `dangerouslySetInnerHTML`을 쓰지 않는다. 발음은 텍스트로만 그린다.
- DB: `supabase db reset`을 쓰지 않는다(로컬 단어 2,000개와 테스트 계정이 지워진다). 마이그레이션은 **Bash로** `npx supabase migration up`, 타입은 **Bash로** `npx supabase gen types typescript --local > src/types/database.ts`(PowerShell의 `>`는 UTF-16으로 저장해 파일이 깨진다).
- **실제 API로 발음을 만들지 않는다.** `npm run words:pron`·`npm run words:generate`·`npm run seed:words`는 실행하지 않는다(Task 7에서 사람이 지켜보며 돌린다). 테스트는 가짜 deps만 쓴다.
- 커밋은 conventional commits + 마지막 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 커밋 전에 `git status -sb`로 브랜치와 남의 변경을 확인한다. `git add -A` 대신 바꾼 파일만 `git add`한다.
- Stop hook(lint·build·test)은 Docker·env 없이 통과해야 한다. DB를 바꾸는 Task 3은 `npm run test:db`도 돌린다(로컬 Supabase 필요).

## Review Focus

1. 기능을 넣기 전에 저장된 턴(`reply_pron_ko`가 null이고 `correction` jsonb에 `corrected_pron_ko` 키가 없음)을 다시 열어도 화면이 깨지지 않고 발음 줄만 없다 → Task 3 `readChatRoom` "발음 키가 없는 옛 교정", Task 6 "발음이 없는 턴"
2. AI가 발음을 빈 문자열로 주거나 가나·한자를 섞어도 턴은 성공하고 그 발음만 숨는다(재시도·실패 기록 없음) → Task 4 "발음이 비었거나 가나·한자가 섞이면"
3. 레벨 4 이상이거나 영어인 대화방은 첫 마디에 `pronKo`가 있거나 저장된 발음이 있어도 그리지 않는다 → Task 6 "상급과 영어 방"
4. 빈칸 퀴즈의 채점 전 DOM에는 정답을 채운 예문의 발음이 없다(정답이 드러난다). 레벨업 테스트에는 아예 없다 → Task 6 BlankQuiz·WordSession 빈칸 테스트
5. `words:pron`이 뒤 묶음에서 API 오류로 멈춰도 앞 묶음의 발음은 파일에 남고, 검사에 맞는 기존 발음은 바꾸지 않는다 → Task 5 "묶음마다 파일을 써서", "이미 맞는 발음은 바꾸지 않고"

---

### Task 1: 발음 검사와 표시 조건 (`lib/pronunciation`, `lib/levels`)

**Files:**
- Create: `src/lib/pronunciation.ts`
- Test: `src/lib/pronunciation.test.ts`
- Modify: `src/lib/levels.ts` (`showsFurigana` 바로 아래)
- Test: `src/lib/levels.test.ts`

**Interfaces:**
- Consumes: `showsFurigana(level: Level): boolean`, `Language`, `Level`(`src/lib/levels.ts`)
- Produces:
  - `cleanPron(text: unknown): string | null`
  - `showsPronunciation(language: Language, level: Level): boolean`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/pronunciation.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { cleanPron } from "./pronunciation";

describe("cleanPron", () => {
  it("한글 음절·공백과 -.,?!~…만 있으면 앞뒤 공백을 지워 돌려준다", () => {
    expect(cleanPron("  쿄-와 나니오 시마스카.  ")).toBe("쿄-와 나니오 시마스카.");
    expect(cleanPron("하지메마시테! 오나마에와 난데스카?")).toBe("하지메마시테! 오나마에와 난데스카?");
    expect(cleanPron("아노, 에-토…")).toBe("아노, 에-토…");
    expect(cleanPron("소-데스네~")).toBe("소-데스네~");
  });

  it.each([
    ["빈 문자열", ""],
    ["공백뿐", "   "],
    ["가나", "갓코-니 いった."],
    ["한자", "今日와"],
    ["영문", "OK데스"],
    ["숫자", "3지"],
    ["자모만", "ㅋㅋ"],
    ["그 밖의 기호", "「하이」"],
  ])("%s이면 null이다", (_, text) => {
    expect(cleanPron(text)).toBeNull();
  });

  it("문자열이 아니면 null이다", () => {
    expect(cleanPron(null)).toBeNull();
    expect(cleanPron(undefined)).toBeNull();
    expect(cleanPron(3)).toBeNull();
  });
});
```

`src/lib/levels.test.ts`의 import에 `showsPronunciation`을 더하고, "후리가나는 입문~중급(1~3)만 보여 준다" 테스트 바로 아래에 넣는다:

```ts
  it("한글 발음은 일본어 입문~중급(1~3)만 보여 준다", () => {
    expect(LEVELS.map((level) => showsPronunciation("ja", level))).toEqual([true, true, true, false, false]);
    expect(LEVELS.map((level) => showsPronunciation("en", level))).toEqual([false, false, false, false, false]);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/pronunciation.test.ts src/lib/levels.test.ts`
Expected: FAIL — `./pronunciation`을 찾을 수 없고 `showsPronunciation is not a function`

- [ ] **Step 3: 구현**

`src/lib/pronunciation.ts`:

```ts
// 한글 발음 검사 (spec/chat.md "한글 발음"). 대화는 맞지 않는 발음을 숨기고, 단어 데이터는 오류로 본다
const PRONUNCIATION = /^[가-힣\s\-.,?!~…]+$/u;

export function cleanPron(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return PRONUNCIATION.test(trimmed) ? trimmed : null;
}
```

`src/lib/levels.ts`의 `showsFurigana` 바로 아래:

```ts
// 일본어 한글 발음은 후리가나와 같은 레벨에서 보여 준다 (spec/chat.md "한글 발음")
export function showsPronunciation(language: Language, level: Level): boolean {
  return language === "ja" && showsFurigana(level);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/pronunciation.test.ts src/lib/levels.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git status -sb
git add src/lib/pronunciation.ts src/lib/pronunciation.test.ts src/lib/levels.ts src/lib/levels.test.ts
git commit -m "feat(pron): add the Korean pronunciation check and level rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 단어 데이터 규칙과 첫 마디 발음 (`lib/words`, `test/wordFiles`, `lib/scenarios`)

**Files:**
- Modify: `src/lib/words.ts` (`WordEntry`, `wordEntryErrors`, `validateWordFile`)
- Modify: `src/test/wordFiles.ts` (`validWord`)
- Test: `src/lib/words.test.ts`
- Modify: `src/lib/scenarios.ts` (`ScenarioLine`, 레벨 1~3 ja 첫 마디 12개)
- Test: `src/lib/scenarios.test.ts`

**Interfaces:**
- Consumes: `cleanPron`, `showsPronunciation`(Task 1)
- Produces:
  - `WordEntry`에 `pron_ko: string | null`, `example_pron_ko: string | null` (DB 컬럼 이름 그대로)
  - `validWord("ja", …)`는 `pron_ko: "이쿠"`, `example_pron_ko: "갓코-니 잇타."`, `validWord("en", …)`는 둘 다 `null`
  - `ScenarioLine = { text: string; ko: string; pronKo?: string }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/words.test.ts`의 `describe("validateWordFile")` 안, "영어는 reading이 null이어야 한다" 바로 아래:

```ts
  it("일본어는 pron_ko·example_pron_ko가 검사(cleanPron)에 맞아야 한다", () => {
    expectError(errorsOf("ja", 1, fileWith({ pron_ko: null }, "ja")), "ja-1-001", "pron_ko");
    expectError(errorsOf("ja", 1, fileWith({ example_pron_ko: "갓코-니 いった." }, "ja")), "ja-1-001", "example_pron_ko");
  });

  it("영어는 pron_ko·example_pron_ko가 null이어야 한다", () => {
    expectError(errorsOf("en", 1, fileWith({ pron_ko: "고" })), "en-1-001", "pron_ko");
    expectError(errorsOf("en", 1, fileWith({ example_pron_ko: "아이 웬트." })), "en-1-001", "example_pron_ko");
  });

  it("일본어 발음은 앞뒤 공백을 지워 돌려준다", () => {
    const result = validateWordFile("ja", 1, fileWith({ pron_ko: " 이쿠 " }, "ja"));
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.words[0].pron_ko).toBe("이쿠");
  });
```

`src/lib/scenarios.test.ts`의 import에 `cleanPron`(`./pronunciation`)과 `showsPronunciation`(`./levels`)을 더하고, `describe("SCENARIOS 데이터")` 안 끝에:

```ts
  it("레벨 1~3 상황의 일본어 첫 마디에는 검사에 맞는 한글 발음이 있다", () => {
    for (const s of SCENARIOS.filter((s) => showsPronunciation("ja", s.level))) {
      const { pronKo } = s.roles.ja.opening;
      expect(cleanPron(pronKo), s.id).toBe(pronKo);
    }
  });

  it("영어 첫 마디와 상급·고수 첫 마디에는 한글 발음을 두지 않는다", () => {
    for (const s of SCENARIOS) {
      expect(s.roles.en.opening.pronKo, s.id).toBeUndefined();
      if (!showsPronunciation("ja", s.level)) expect(s.roles.ja.opening.pronKo, s.id).toBeUndefined();
    }
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/words.test.ts src/lib/scenarios.test.ts`
Expected: FAIL — 일본어 발음 오류가 나오지 않고, 첫 마디 `pronKo`가 `undefined`

- [ ] **Step 3: 구현**

`src/test/wordFiles.ts`의 `validWord`:

```ts
  if (language === "en") {
    return {
      ...base,
      word: `go${rank}`,
      reading: null,
      meaning_ko: `가다${rank}`,
      example: `I {{went${rank}}} to school.`,
      distractors: [`goes${rank}`, `gone${rank}`, `going${rank}`],
      pron_ko: null,
      example_pron_ko: null,
    };
  }
  return {
    ...base,
    word: `行く${rank}`,
    reading: `いく${rank}`,
    meaning_ko: `가다${rank}`,
    example: `[学校|がっこう]に{{[行|い]った${rank}}}。`,
    distractors: [`[行|い]く${rank}`, `[行|い]って${rank}`, `[行|い]かない${rank}`],
    pron_ko: "이쿠",
    example_pron_ko: "갓코-니 잇타.",
  };
```

`src/lib/words.ts`:

```ts
import { parseBlank } from "./blank";
import type { Language, Level } from "./levels";
import { cleanPron } from "./pronunciation";
```

```ts
export type WordEntry = {
  id: string;
  language: Language;
  level: Level;
  rank: number;
  word: string;
  reading: string | null;
  meaning_ko: string;
  example: string;
  example_ko: string;
  distractors: string[];
  pron_ko: string | null; // 일본어 단어의 한글 발음 (spec/chat.md "한글 발음")
  example_pron_ko: string | null; // 정답을 채운 예문의 한글 발음
};
```

`wordEntryErrors`의 reading 검사 두 줄 바로 아래:

```ts
  if (language === "ja") {
    if (cleanPron(w.pron_ko) === null) errors.push("일본어는 pron_ko(단어의 한글 발음)가 있어야 합니다");
    if (cleanPron(w.example_pron_ko) === null) errors.push("일본어는 example_pron_ko(예문의 한글 발음)가 있어야 합니다");
  }
  if (language === "en" && (w.pron_ko !== null || w.example_pron_ko !== null)) {
    errors.push("영어는 pron_ko·example_pron_ko가 null이어야 합니다");
  }
```

`validateWordFile`의 `words.push({...})`에서 `distractors` 아래:

```ts
        distractors: w.distractors as string[],
        pron_ko: cleanPron(w.pron_ko),
        example_pron_ko: cleanPron(w.example_pron_ko),
```

(영어는 검사에서 `null`만 통과하므로 `cleanPron(null)`도 `null`이다.)

`src/lib/scenarios.ts`:

```ts
// pronKo: 한글 발음(spec/chat.md "한글 발음"). 일본어 입문~중급 상황(레벨 1~3)의 첫 마디에만 둔다
export type ScenarioLine = { text: string; ko: string; pronKo?: string };
```

레벨 1~3 상황의 `ja.opening`에 `pronKo`를 더한다(`text`·`ko`는 그대로, 아래 값 그대로):

| id | pronKo |
|---|---|
| `l1-greeting` | `하지메마시테! 오나마에와 난데스카?` |
| `l1-cafe` | `이랏샤이마세. 고츄-몬와 오키마리데스카?` |
| `l1-checkout` | `오벤토-, 아타타메마스카?` |
| `l1-directions` | `아노, 도코니 이키타이데스카?` |
| `l2-restaurant` | `이랏샤이마세! 난메-사마데스카?` |
| `l2-hotel` | `이랏샤이마세. 고요야쿠노 오나마에오 오네가이시마스.` |
| `l2-clothes` | `이랏샤이마세. 나니카 오사가시데스카?` |
| `l2-train` | `콘니치와. 도치라마데 이카레마스카?` |
| `l3-pharmacy` | `콘니치와, 도- 사레마시타카? 돈나 쇼-죠-카 오시에테 이타다케마스카?` |
| `l3-weekend` | `오츠카레사마데스. 슈-마츠와 나니오 시테 이마시타카?` |
| `l3-return` | `이랏샤이마세. 오카이아게노 쇼-힌니 나니카 몬다이가 고자이마시타카?` |
| `l3-reservation` | `오덴와 아리가토- 고자이마스. 고요야쿠데쇼-카?` |

예 (`l1-checkout`):

```ts
      ja: {
        role: "…(그대로)",
        opening: { text: "お[弁当|べんとう]、[温|あたた]めますか？", ko: "도시락 데워 드릴까요?", pronKo: "오벤토-, 아타타메마스카?" },
      },
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib scripts`
Expected: PASS (seed-words·generate-audio 테스트도 `validWord`·`validWordFile`을 쓰므로 함께 확인한다)

- [ ] **Step 5: 커밋**

```bash
git status -sb
git add src/lib/words.ts src/lib/words.test.ts src/test/wordFiles.ts src/lib/scenarios.ts src/lib/scenarios.test.ts
git commit -m "feat(pron): require Korean pronunciation in Japanese word data and openings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: DB — 발음 컬럼, 확정 RPC, 읽기 (`test:db`)

**Files:**
- Create: `supabase/migrations/20261014100000_pronunciation.sql`
- Modify: `src/types/database.ts` (생성)
- Modify: `src/services/claude/schemas.ts` (`TurnReply` 타입만)
- Modify: `src/server/db/chat.ts` (`finishChatTurn`)
- Modify: `src/server/db/reads.ts` (`Word`, `ChatTurnView`, `WORD_COLUMNS`, `toWord`, `readChatRoom`)
- Modify: `src/components/ChatRoom.tsx` (확정 턴을 `added`에 넣는 한 줄. 화면 변경은 Task 6)
- Test: `src/server/db/chat.test.ts`, `src/server/db/reads.test.ts`
- Modify(타입 맞추기): `ChatTurnView`·`Word`를 만드는 테스트 fixture (`npx tsc --noEmit`이 알려 준다. 예: `src/components/ChatRoom.test.tsx`의 `turn()`, `src/components/ChatFeedback.test.tsx`, `src/components/WordSession.test.tsx`의 `word()`)

**Interfaces:**
- Consumes: 없음 (Task 1·2와 독립)
- Produces:
  - `TurnReply = { reply: string; reply_ko: string; reply_pron_ko?: string | null; correction: { corrected: string; explanation_ko: string; corrected_pron_ko?: string | null } | null }` — 발음이 없거나 `null`이면 그리지 않는다
  - `Word`에 `pronKo: string | null`, `examplePronKo: string | null`
  - `ChatTurnView`에 `replyPronKo: string | null` (`correction`은 `TurnReply["correction"]` 그대로라 `corrected_pron_ko`를 담을 수 있다)
  - `finishChatTurn(userId, sessionId, token, reply: TurnReply)`가 `reply_pron_ko`를 저장한다

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server/db/chat.test.ts`의 `describe("대화 1턴")` 안 끝에:

```ts
  it("확정은 한글 발음을 저장한다: reply_pron_ko는 컬럼에, 교정 발음은 correction 안에. 없으면 null이다", async () => {
    const user = await createReadyUser("ja", 1);
    const { sessionId } = valueOf(await createChatSession(user.id, { language: "ja", level: 1, scenarioId: "l1-cafe" }));
    const withPron: TurnReply = {
      reply: "はい、どうぞ。",
      reply_ko: "네, 여기요.",
      reply_pron_ko: "하이, 도-조.",
      correction: { corrected: "コーヒーをください。", explanation_ko: "を를 넣어요.", corrected_pron_ko: "코-히-오 쿠다사이." },
    };
    const first = valueOf(await beginChatTurn(user.id, sessionId, "コーヒーください"));
    valueOf(await finishChatTurn(user.id, sessionId, first.token, withPron));
    const second = valueOf(await beginChatTurn(user.id, sessionId, "ありがとう"));
    valueOf(await finishChatTurn(user.id, sessionId, second.token, PLAIN_REPLY));

    expect(await turnsOf(sessionId)).toMatchObject([
      { turn_no: 1, reply_pron_ko: "하이, 도-조.", correction: withPron.correction },
      { turn_no: 2, reply_pron_ko: null, correction: null },
    ]);
  });
```

`src/server/db/reads.test.ts`:

1. `testWord`의 반환에 `distractors` 아래 두 줄을 더한다:

```ts
    pron_ko: language === "ja" ? "이쿠" : null,
    example_pron_ko: language === "ja" ? "갓코-니 잇타." : null,
```

2. `asWord`의 반환에 `distractors` 아래 두 줄을 더한다:

```ts
    pronKo: row.pron_ko,
    examplePronKo: row.example_pron_ko,
```

3. `readChatRoom` 첫 테스트의 기대값 `turns` 두 항목에 `replyPronKo: null`을 더한다(`replyKo` 바로 아래).

4. `describe("readChatRoom")` 안 끝에:

```ts
  it("한글 발음을 돌려주고, 발음 키가 없는 옛 교정도 그대로 돌려준다", async () => {
    const user = await createReadyUser("ja", 1);
    const session = await newSession(user.id, "ja");
    const correction = { ...CORRECTED.correction!, corrected_pron_ko: "코-히-오 쿠다사이." };
    await doneTurn(user.id, session, { ...CORRECTED, reply_pron_ko: "와카리마시타.", correction });
    // 기능을 넣기 전에 저장된 턴처럼 발음이 없다
    await doneTurn(user.id, session, CORRECTED);

    const room = await readChatRoom(await signedInClient(user), user.id, session, new Date());
    expect(room?.turns.map((t) => ({ replyPronKo: t.replyPronKo, correction: t.correction }))).toEqual([
      { replyPronKo: "와카리마시타.", correction },
      { replyPronKo: null, correction: CORRECTED.correction },
    ]);
  });
```

5. `describe("readUnseenWords")`의 첫 테스트(또는 일본어 단어를 읽는 테스트가 없으면 아래를 `describe("readLevelWords")` 안 끝에)에 일본어 발음이 오는지 더한다:

```ts
  it("일본어 단어의 한글 발음을 돌려준다", async () => {
    const words = await readLevelWords(await signedInClient(await createReadyUser("ja", 1)), "ja", 1);
    expect(words.find((word) => word.id === JA1.id)).toMatchObject({ pronKo: "이쿠", examplePronKo: "갓코-니 잇타." });
  });
```

(`readLevelWords`의 첫 인자가 다른 형태면 같은 describe의 기존 테스트가 부르는 방식을 따른다.)

- [ ] **Step 2: 실패 확인**

Run (Bash): `npm run test:db -- src/server/db/chat.test.ts src/server/db/reads.test.ts`
Expected: FAIL — `column chat_turns.reply_pron_ko does not exist`, `words` upsert의 `pron_ko` 컬럼 없음

- [ ] **Step 3: 마이그레이션 작성** — `supabase/migrations/20261014100000_pronunciation.sql`

본문은 `20261006083621_chat.sql`의 `finish_chat_turn`과 같고, `update public.chat_turns` 한 줄에 `reply_pron_ko = p_reply_pron_ko`만 더했다.

```sql
-- 일본어 한글 발음 (spec/chat.md "한글 발음", ADR-015)
--
-- 단어는 데이터에 미리 만든 발음을, 대화 턴은 일본어 입문~중급에서 AI가 만든 발음을 저장한다.
-- 영어·상급 이상·기능을 넣기 전의 턴은 null이다. 교정 발음은 correction jsonb 안의 corrected_pron_ko다.

alter table public.words
  add column pron_ko text,
  add column example_pron_ko text;

alter table public.chat_turns
  add column reply_pron_ko text;

drop function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb);

-- 턴 성공 확정. 기한이 지난 토큰은 위 복구에서 풀리므로 불일치(CONFLICT)가 된다.
-- p_reply_pron_ko는 발음이 없는 턴(영어·상급 이상)에서 빼고 부를 수 있게 마지막 인자이고 기본값이 null이다
create function public.finish_chat_turn(
  p_user_id uuid, p_session_id uuid, p_token uuid, p_reply text, p_reply_ko text, p_correction jsonb,
  p_reply_pron_ko text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.chat_sessions;
  v_reserved_at timestamptz;
  v_done int;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  perform public.recover_expired_operations(p_user_id);
  select * into v_session from public.chat_sessions
   where id = p_session_id and user_id = p_user_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_session.status <> 'active' or v_session.operation_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  update public.chat_turns
     set status = 'done', reply = p_reply, reply_ko = p_reply_ko, reply_pron_ko = p_reply_pron_ko,
         correction = p_correction
   where id = p_token and session_id = p_session_id and user_id = p_user_id and status = 'pending'
   returning created_at into v_reserved_at;
  if not found then
    raise exception 'finish_chat_turn: 작업 토큰의 pending 턴이 없습니다';
  end if;
  update public.chat_sessions
     set operation_token = null, operation_expires_at = null
   where id = p_session_id and user_id = p_user_id;
  perform public.record_activity(p_user_id);

  -- 이 확정으로 오늘 계정의 done 턴 수가 한도와 같아지면 기록한다 (spec/metrics.md "지표 수집")
  if v_reserved_at >= public.kst_today_start()
     and (select count(*) from public.chat_turns
           where user_id = p_user_id and status = 'done' and created_at >= public.kst_today_start())
         = public.chat_turn_limit(p_user_id) then
    perform public.record_limit_reached(p_user_id, 'chat');
  end if;

  select count(*) into v_done
    from public.chat_turns
   where session_id = p_session_id and user_id = p_user_id and status = 'done';
  return jsonb_build_object('ok', true, 'turns_left', 20 - v_done);
end;
$$;

revoke execute on function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_chat_turn(uuid, uuid, uuid, text, text, jsonb, text) to service_role;
```

- [ ] **Step 4: 적용과 타입 생성**

Run (Bash): `npx supabase migration up`
Expected: `Applying migration 20261014100000_pronunciation.sql...`

Run (Bash): `npx supabase gen types typescript --local > src/types/database.ts`
Expected: `words`·`chat_turns`의 Row에 새 컬럼, `finish_chat_turn`의 Args에 `p_reply_pron_ko?: string`

- [ ] **Step 5: 서버 코드 구현**

`src/services/claude/schemas.ts` — `export type TurnReply = z.infer<typeof turnReplySchema>;`를 아래로 바꾼다(스키마는 그대로):

```ts
// 저장·API·화면이 쓰는 턴 응답. 한글 발음은 일본어 입문~중급 턴에만 있다(spec/chat.md "한글 발음").
// 영어·상급 이상 턴과 기능을 넣기 전의 턴은 발음이 없거나 null이다
export type TurnReply = {
  reply: string;
  reply_ko: string;
  reply_pron_ko?: string | null;
  correction: { corrected: string; explanation_ko: string; corrected_pron_ko?: string | null } | null;
};
```

`src/server/db/chat.ts`의 `finishChatTurn` 인자:

```ts
  const result = await callRpc("finish_chat_turn", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_token: token,
    p_reply: reply.reply,
    p_reply_ko: reply.reply_ko,
    p_correction: reply.correction,
    // 발음이 없으면 인자를 빼서 기본값 null로 저장한다 (undefined 키는 요청 JSON에서 빠진다)
    p_reply_pron_ko: reply.reply_pron_ko ?? undefined,
  });
```

`src/server/db/reads.ts`:

```ts
export type Word = {
  id: string;
  language: Language;
  level: Level;
  rank: number;
  word: string;
  reading: string | null;
  meaningKo: string;
  example: string;
  exampleKo: string;
  distractors: string[];
  pronKo: string | null; // 일본어만. 영어는 null
  examplePronKo: string | null;
};
```

```ts
export type ChatTurnView = {
  turnNo: number;
  userText: string;
  reply: string;
  replyKo: string;
  replyPronKo: string | null;
  correction: TurnReply["correction"];
};
```

```ts
const WORD_COLUMNS =
  "id, language, level, rank, word, reading, meaning_ko, example, example_ko, distractors, pron_ko, example_pron_ko";
```

`toWord`의 반환에 `distractors` 아래:

```ts
    pronKo: row.pron_ko,
    examplePronKo: row.example_pron_ko,
```

`readChatRoom`의 select 문자열에서 `chat_turns(...)`를 `chat_turns(turn_no, status, user_text, reply, reply_ko, reply_pron_ko, correction, created_at)`로 바꾸고, `turns: done.map(...)`의 항목에 `replyKo` 아래 한 줄:

```ts
      replyPronKo: turn.reply_pron_ko,
```

`src/components/ChatRoom.tsx`의 `send()`에서 확정 턴을 넣는 줄:

```ts
        {
          turnNo,
          userText: text,
          reply: reply.reply,
          replyKo: reply.reply_ko,
          replyPronKo: reply.reply_pron_ko ?? null,
          correction: reply.correction,
        },
```

- [ ] **Step 6: 타입 맞추기**

Run: `npx tsc --noEmit`
Expected: `ChatTurnView`·`Word`를 만드는 테스트 fixture에서 `replyPronKo`·`pronKo`·`examplePronKo`가 빠졌다는 오류. 각 fixture의 기본값에 `replyPronKo: null` 또는 `pronKo: null, examplePronKo: null`을 더한다(값을 바꾸지 않고 키만 더한다). 오류가 0개가 될 때까지 반복한다.

- [ ] **Step 7: 통과 확인**

Run (Bash): `npm run test:db`
Expected: PASS (전체. `security.test.ts`의 `finish_chat_turn` 권한 검사도 기본값 덕분에 그대로 통과)

Run: `npm run test && npm run lint && npm run build`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git status -sb
git add supabase/migrations/20261014100000_pronunciation.sql src/types/database.ts src/services/claude/schemas.ts src/server/db/chat.ts src/server/db/chat.test.ts src/server/db/reads.ts src/server/db/reads.test.ts src/components/ChatRoom.tsx
git add <Step 6에서 고친 fixture 파일들>
git commit -m "feat(pron): store Korean pronunciation for words and chat turns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 대화 AI — 발음 요청과 검사 (`schemas`, `prompts`, `client`)

**Files:**
- Modify: `src/services/claude/schemas.ts` (`pronTurnReplySchema`, `PronTurnReply`)
- Test: `src/services/claude/schemas.test.ts`
- Modify: `src/services/claude/prompts.ts` (`PRONUNCIATION_RULES`, `buildTurnPrompt`)
- Test: `src/services/claude/prompts.test.ts`
- Modify: `src/services/claude/client.ts` (`attempt`, `generateTurn`)
- Test: `src/services/claude/client.test.ts`

**Interfaces:**
- Consumes: `cleanPron`, `showsPronunciation`(Task 1), `TurnReply`(Task 3)
- Produces:
  - `PRONUNCIATION_RULES: string` (Task 5의 두 스크립트가 쓴다)
  - `pronTurnReplySchema`(`reply`, `reply_ko`, `reply_pron_ko`, `correction: { corrected, explanation_ko, corrected_pron_ko } | null`, 모두 `z.string()`)
  - `generateTurn`은 `showsPronunciation`이면 발음 필드를 `cleanPron`으로 정리해(맞지 않으면 `null`) 돌려주고, 아니면 지금과 같은 값을 돌려준다

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/claude/schemas.test.ts` 끝에(import에 `pronTurnReplySchema` 추가):

```ts
describe("pronTurnReplySchema", () => {
  const value = {
    reply: "はい。",
    reply_ko: "네.",
    reply_pron_ko: "하이.",
    correction: { corrected: "はい。", explanation_ko: "설명", corrected_pron_ko: "하이." },
  };

  it("발음 필드가 있는 응답과 교정이 없는 응답을 받는다", () => {
    expect(pronTurnReplySchema.parse(value)).toEqual(value);
    expect(pronTurnReplySchema.parse({ ...value, correction: null })).toEqual({ ...value, correction: null });
  });

  it("reply_pron_ko나 corrected_pron_ko가 없으면 거부한다", () => {
    const { reply_pron_ko: _, ...noReplyPron } = value;
    expect(pronTurnReplySchema.safeParse(noReplyPron).success).toBe(false);
    expect(
      pronTurnReplySchema.safeParse({ ...value, correction: { corrected: "はい。", explanation_ko: "설명" } }).success,
    ).toBe(false);
  });
});
```

(lint가 `_`를 막으면 `noReplyPron`을 `{ reply: value.reply, reply_ko: value.reply_ko, correction: value.correction }`로 만든다.)

`src/services/claude/prompts.test.ts` 끝에(import에 `PRONUNCIATION_RULES`, `type TurnPromptInput`, `scenariosForLevel`, `type Language`, `type Level`이 없으면 더한다):

```ts
describe("buildTurnPrompt 한글 발음", () => {
  const input = (language: Language, level: Level): TurnPromptInput => ({
    language,
    level,
    scenario: scenariosForLevel(level)[0],
    history: [],
    userText: "こんにちは",
  });

  it.each([1, 2, 3] as const)("일본어 레벨 %i은 표기 규칙과 reply_pron_ko·corrected_pron_ko를 요청한다", (level) => {
    const { system } = buildTurnPrompt(input("ja", level));
    expect(system).toContain(PRONUNCIATION_RULES);
    expect(system).toContain("reply_pron_ko");
    expect(system).toContain("corrected_pron_ko");
  });

  it.each([
    ["ja", 4],
    ["ja", 5],
    ["en", 1],
    ["en", 3],
  ] as const)("%s 레벨 %i은 한글 발음을 요청하지 않는다", (language, level) => {
    const { system } = buildTurnPrompt(input(language, level));
    expect(system).not.toContain("pron_ko");
    expect(system).not.toContain(PRONUNCIATION_RULES);
  });
});

describe("PRONUNCIATION_RULES", () => {
  it("spec의 표기 규칙과 예를 담는다", () => {
    for (const part of ["조사 は", "와", "쿄-와", "갓코-", "콘니치와", "쟈", "산지", "쿄-와 나니오 시마스카."]) {
      expect(PRONUNCIATION_RULES).toContain(part);
    }
  });
});
```

`src/services/claude/client.test.ts` 끝에:

```ts
describe("generateTurn 한글 발음", () => {
  const jaInput: TurnPromptInput = { language: "ja", level: 1, scenario, history: [], userText: "コーヒーください" };
  const jaReply = {
    reply: "はい、どうぞ。",
    reply_ko: "네, 여기요.",
    reply_pron_ko: " 하이, 도-조. ",
    correction: { corrected: "コーヒーをください。", explanation_ko: "を를 넣어요.", corrected_pron_ko: "코-히-오 쿠다사이." },
  };
  const propertiesOf = (request: Record<string, unknown>) =>
    Object.keys((request.output_config as { format: { schema: { properties: object } } }).format.schema.properties).sort();

  it("일본어 입문~중급은 발음 필드가 있는 형식으로 요청하고, 발음은 앞뒤 공백을 지워 돌려준다", async () => {
    const { ai, requests } = setup(done(jaReply));
    expect(await ai.generateTurn(jaInput)).toEqual({ ok: true, value: { ...jaReply, reply_pron_ko: "하이, 도-조." } });
    expect(propertiesOf(requests[0])).toEqual(["correction", "reply", "reply_ko", "reply_pron_ko"]);
  });

  it("발음이 비었거나 가나·한자가 섞이면 턴은 성공하고 그 발음만 null이다 (다시 부르지 않는다)", async () => {
    const bad = { ...jaReply, reply_pron_ko: "", correction: { ...jaReply.correction, corrected_pron_ko: "코-히-を 쿠다사이." } };
    const { ai, requests } = setup(done(bad));
    expect(await ai.generateTurn(jaInput)).toEqual({
      ok: true,
      value: { ...bad, reply_pron_ko: null, correction: { ...bad.correction, corrected_pron_ko: null } },
    });
    expect(requests).toHaveLength(1);
  });

  it("교정이 없으면 correction은 null 그대로다", async () => {
    const { ai } = setup(done({ ...jaReply, correction: null }));
    expect(await ai.generateTurn(jaInput)).toEqual({
      ok: true,
      value: { ...jaReply, reply_pron_ko: "하이, 도-조.", correction: null },
    });
  });

  it("일본어 상급은 발음 없는 형식으로 요청하고 받은 값을 그대로 돌려준다", async () => {
    const { ai, requests } = setup(done(reply));
    expect(await ai.generateTurn({ ...jaInput, level: 4, scenario: scenariosForLevel(4)[0] })).toEqual({ ok: true, value: reply });
    expect(propertiesOf(requests[0])).toEqual(["correction", "reply", "reply_ko"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/services/claude`
Expected: FAIL — `pronTurnReplySchema`·`PRONUNCIATION_RULES`가 없음, 일본어 턴 요청 형식에 `reply_pron_ko`가 없음

- [ ] **Step 3: 구현**

`src/services/claude/schemas.ts`의 `turnReplySchema` 바로 아래:

```ts
// 일본어 입문~중급 턴(spec/chat.md "한글 발음"). 발음 검사와 정리는 client.ts가 한다
export const pronTurnReplySchema = z.object({
  reply: z.string(),
  reply_ko: z.string(),
  reply_pron_ko: z.string(),
  correction: z.object({ corrected: z.string(), explanation_ko: z.string(), corrected_pron_ko: z.string() }).nullable(),
});
export type PronTurnReply = z.infer<typeof pronTurnReplySchema>;
```

`src/services/claude/prompts.ts` — import에 `showsPronunciation`을 더하고(`@/lib/levels`), `KOREAN_NAME_RULES` 아래에:

```ts
// 한글 발음 표기 규칙(spec/chat.md "한글 발음"). 대화 프롬프트와 단어 발음 생성 스크립트가 같은 문구를 쓴다
export const PRONUNCIATION_RULES = [
  "- 일본어 문장을 소리 나는 대로 한글로만 쓴다. 가나·한자·로마자·숫자를 섞지 않는다.",
  "- 한자는 [漢字|かな] 표기가 있으면 그 읽기대로 읽는다.",
  "- か행은 카·키·쿠·케·코, た행은 타·치·츠·테·토로 쓴다. ず·づ는 즈, じ·ぢ는 지, ふ는 후, を는 오로 쓴다.",
  "- 조사 は는 와, 조사 へ는 에로 쓴다.",
  "- 장음은 -로 쓴다. 예: 今日は → 쿄-와, 先生 → 센세-, ありがとう → 아리가토-, コーヒー → 코-히-",
  "- っ는 앞 글자의 ㅅ받침으로 쓴다. 예: 学校 → 갓코-, 行って → 잇테",
  "- ん은 ㄴ받침으로 쓴다. 예: こんにちは → 콘니치와, 日本語 → 니혼고",
  "- 요음은 きゃ 캬, しゃ 샤, ちゃ 챠, じゃ 쟈, しょ 쇼, ちょ 쵸, にゅ 뉴처럼 쓴다.",
  "- 문절마다 띄어 쓴다. 。는 ., 、는 ,, ？는 ?, ！는 !로 바꾸고 「」 같은 그 밖의 기호는 뺀다. 가타카나 이름의 ・는 띄어 쓴다.",
  "- 숫자는 읽는 대로 한글로 쓴다. 예: 3時 → 산지",
  "- 예: [今日|きょう]は[何|なに]をしますか。 → 쿄-와 나니오 시마스카.",
].join("\n");
```

`buildTurnPrompt`에서 `if (language === "ja") { lines.push(...) }` 블록 바로 아래:

```ts
  if (showsPronunciation(language, level)) {
    lines.push(
      "- reply_pron_ko: reply의 한글 발음. 아래 '한글 발음' 규칙을 따른다.",
      "- correction이 있으면 corrected_pron_ko에 corrected의 한글 발음을 같은 규칙으로 쓴다.",
      "",
      "## 한글 발음",
      PRONUNCIATION_RULES,
    );
  }
```

`src/services/claude/client.ts`:

import에 `cleanPron`(`@/lib/pronunciation`), `showsPronunciation`(`@/lib/levels`), `pronTurnReplySchema`, `type PronTurnReply`를 더한다.

`attempt`가 스키마 값과 돌려줄 값의 타입을 따로 받게 한다(본문은 그대로):

```ts
  async function attempt<S, T>(
    schema: z.ZodType<S>,
    buildPrompt: () => Prompt,
    accept: (value: S) => T | null,
  ): Promise<AiResult<T>> {
```

`generateTurn`:

```ts
    generateTurn: (input) =>
      withRetry(() =>
        showsPronunciation(input.language, input.level)
          ? attempt(pronTurnReplySchema, () => buildTurnPrompt(input), acceptPronTurn)
          : attempt(turnReplySchema, () => buildTurnPrompt(input), (value): TurnReply | null =>
              value.reply.trim() ? value : null,
            ),
      ),
```

파일 끝 `parseOutput` 위에:

```ts
// 발음이 비었거나 검사에 맞지 않으면 턴은 성공으로 두고 그 발음만 null로 숨긴다 (spec/chat.md "한글 발음")
function acceptPronTurn(value: PronTurnReply): TurnReply | null {
  if (!value.reply.trim()) return null;
  return {
    ...value,
    reply_pron_ko: cleanPron(value.reply_pron_ko),
    correction: value.correction && {
      ...value.correction,
      corrected_pron_ko: cleanPron(value.correction.corrected_pron_ko),
    },
  };
}
```

`parseOutput`은 제네릭이라 그대로 쓴다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/services/claude`
Expected: PASS (기존 "요청에 주입한 model…" 테스트는 영어 레벨 1이라 속성 3개 그대로)

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git status -sb
git add src/services/claude/schemas.ts src/services/claude/schemas.test.ts src/services/claude/prompts.ts src/services/claude/prompts.test.ts src/services/claude/client.ts src/services/claude/client.test.ts
git commit -m "feat(pron): ask Claude for Korean pronunciation in Japanese beginner turns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 단어 발음 생성 스크립트 (`generate-words`, `generate-pronunciation`)

**Files:**
- Modify: `scripts/generate-words.ts` (`toEntry`, `wordBatchSchema`, `buildPrompt`)
- Test: `scripts/generate-words.test.ts`
- Create: `scripts/generate-pronunciation.ts`
- Test: `scripts/generate-pronunciation.test.ts`
- Modify: `package.json` (`words:pron` 스크립트)

**Interfaces:**
- Consumes: `cleanPron`(Task 1), `WordEntry`·`validWord`(Task 2), `PRONUNCIATION_RULES`(Task 4), `parseBlank`(`src/lib/blank.ts`), `isLevel`(`src/lib/levels.ts`), `getClaudeEnv`(`src/services/env.ts`)
- Produces:
  - `npm run words:pron -- --language ja --level <1-5> [--model <id>]`
  - `generate-pronunciation`의 `main(deps: GeneratePronunciationDeps): Promise<number>`, `type PronSource = { id: string; word: string; reading: string; sentence: string }`, `type PronRequest = { model: string | undefined; items: PronSource[] }`

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/generate-words.test.ts` — `aiWord` 아래에 일본어 항목을 더한다:

```ts
// 일본어 항목. 두 발음은 검사(cleanPron)에 맞아야 받는다
function aiJaWord(n: number, pron: { pron_ko?: string | null; example_pron_ko?: string | null } = {}) {
  return {
    word: `行く${n}`,
    reading: `いく${n}`,
    meaning_ko: `가다${n}`,
    example: `[学校|がっこう]に{{[行|い]った${n}}}。`,
    example_ko: "학교에 갔다.",
    distractors: [`[行|い]く${n}`, `[行|い]って${n}`, `[行|い]かない${n}`],
    pron_ko: "이쿠",
    example_pron_ko: "갓코-니 잇타.",
    ...pron,
  };
}
```

첫 테스트("묶음으로 나눠 받은 200개…")의 `expect(words[0]).toMatchObject(...)`에 `pron_ko: null, example_pron_ko: null`을 더하고, `describe("generate-words main")` 안 끝에:

```ts
  it("일본어는 두 발음이 검사에 맞는 항목만 받아 파일에 쓴다", async () => {
    let next = 1;
    const { deps, written } = fakeDeps({
      args: ["--language", "ja", "--level", "1"],
      generate: (request, call) => [
        ...(call === 1 ? [aiJaWord(9000, { pron_ko: null }), aiJaWord(9001, { example_pron_ko: "갓코-니 いった." })] : []),
        ...Array.from({ length: request.count }, () => aiJaWord(next++)),
      ],
    });

    expect(await main(deps)).toBe(0);

    const words = JSON.parse(written.get("data/words/ja-1.json")!) as { word: string }[];
    expect(words[0]).toMatchObject({ word: "行く1", pron_ko: "이쿠", example_pron_ko: "갓코-니 잇타." });
    expect(words.map((w) => w.word)).not.toContain("行く9000");
    expect(words.map((w) => w.word)).not.toContain("行く9001");
  });
```

`scripts/generate-pronunciation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validWord } from "@/test/wordFiles";
import { main, type GeneratePronunciationDeps, type PronRequest } from "./generate-pronunciation";

const PATH = "data/words/ja-1.json";
const PRON = { pron_ko: "이쿠", example_pron_ko: "갓코-니 잇타." };

// 발음 키가 없는 일본어 단어 (generate-words로 만든 옛 파일)
function bare(rank: number): Record<string, unknown> {
  const word: Record<string, unknown> = { ...validWord("ja", 1, rank) };
  delete word.pron_ko;
  delete word.example_pron_ko;
  return word;
}

function fakeDeps(
  entries: unknown,
  options: { args?: string[]; generate?: (request: PronRequest, call: number) => unknown[] } = {},
) {
  const requests: PronRequest[] = [];
  const writes: string[] = [];
  const logs: string[] = [];
  const deps: GeneratePronunciationDeps = {
    args: options.args ?? ["--language", "ja", "--level", "1"],
    generate: async (request) => {
      requests.push(structuredClone(request));
      if (options.generate) return options.generate(request, requests.length);
      return request.items.map((item) => ({ id: item.id, ...PRON }));
    },
    readFile: async (path) => {
      if (path !== PATH) throw new Error(`없는 파일: ${path}`);
      return JSON.stringify(entries);
    },
    writeFile: async (path, content) => {
      if (path !== PATH) throw new Error(`다른 파일에 씀: ${path}`);
      writes.push(content);
    },
    log: (line) => logs.push(line),
  };
  const last = () => JSON.parse(writes.at(-1)!) as Record<string, unknown>[];
  return { deps, requests, writes, logs, last };
}

describe("generate-pronunciation main", () => {
  it("발음이 빈 단어만 50개씩 요청하고, 정답을 채운 예문(표기 유지)을 넘긴다", async () => {
    const entries = [validWord("ja", 1, 1), ...Array.from({ length: 60 }, (_, i) => bare(i + 2))];
    const { deps, requests, last } = fakeDeps(entries);

    expect(await main(deps)).toBe(0);

    expect(requests.map((r) => r.items.length)).toEqual([50, 10]);
    expect(requests[0].items[0]).toEqual({
      id: "ja-1-002",
      word: "行く2",
      reading: "いく2",
      sentence: "[学校|がっこう]に[行|い]った2。",
    });
    expect(requests.flatMap((r) => r.items.map((item) => item.id))).not.toContain("ja-1-001");
    expect(last()).toHaveLength(61);
    expect(last()[60]).toMatchObject({ id: "ja-1-061", ...PRON });
  });

  it("이미 맞는 발음은 바꾸지 않고, 비었거나 맞지 않는 쪽만 채운다", async () => {
    const entries = [
      { ...validWord("ja", 1, 1), example_pron_ko: "" },
      { ...validWord("ja", 1, 2), pron_ko: "いく" },
    ];
    const { deps, last } = fakeDeps(entries, {
      generate: (request) => request.items.map((item) => ({ id: item.id, pron_ko: "유쿠", example_pron_ko: "갓코-니 잇타." })),
    });

    expect(await main(deps)).toBe(0);

    expect(last()[0]).toMatchObject({ pron_ko: "이쿠", example_pron_ko: "갓코-니 잇타." });
    expect(last()[1]).toMatchObject({ pron_ko: "유쿠", example_pron_ko: "갓코-니 잇타." });
  });

  it("응답에 없는 id와 검사에 맞지 않는 발음은 쓰지 않고 실패 목록에 남긴 뒤 1을 돌려준다", async () => {
    const { deps, last, logs } = fakeDeps([bare(1), bare(2), bare(3)], {
      generate: () => [
        { id: "ja-1-001", ...PRON },
        { id: "ja-1-002", pron_ko: "いく", example_pron_ko: "갓코-니 잇타." },
      ],
    });

    expect(await main(deps)).toBe(1);

    expect(last()[0]).toMatchObject(PRON);
    expect(last()[1].pron_ko).toBeUndefined();
    expect(last()[1].example_pron_ko).toBe("갓코-니 잇타.");
    expect(last()[2].pron_ko).toBeUndefined();
    expect(logs.join("\n")).toContain("ja-1-002");
    expect(logs.join("\n")).toContain("ja-1-003");
  });

  it("묶음마다 파일을 써서, 뒤 묶음에서 API 오류가 나도 앞 묶음은 남는다", async () => {
    const { deps, writes, last } = fakeDeps(
      Array.from({ length: 60 }, (_, i) => bare(i + 1)),
      {
        generate: (request, call) => {
          if (call === 2) throw new Error("API 오류");
          return request.items.map((item) => ({ id: item.id, ...PRON }));
        },
      },
    );

    await expect(main(deps)).rejects.toThrow("API 오류");

    expect(writes).toHaveLength(1);
    expect(last()[49]).toMatchObject(PRON);
    expect(last()[50].pron_ko).toBeUndefined();
  });

  it("채울 발음이 없으면 요청하지 않고 파일을 쓰지 않는다", async () => {
    const { deps, requests, writes } = fakeDeps([validWord("ja", 1, 1)]);

    expect(await main(deps)).toBe(0);

    expect(requests).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it.each([
    [["--language", "en", "--level", "1"]],
    [["--language", "ja", "--level", "9"]],
    [["--language", "ja"]],
    [["--language", "ja", "--level", "1", "--unknown"]],
  ])("영어·잘못된 인자(%j)는 AI를 부르지 않고 사용법을 알린다", async (args) => {
    const { deps, requests, logs } = fakeDeps([bare(1)], { args });

    expect(await main(deps)).toBe(1);

    expect(requests).toHaveLength(0);
    expect(logs.join("\n")).toContain("사용법");
  });

  it("파일이 배열이 아니면 요청하지 않고 실패한다", async () => {
    const { deps, requests } = fakeDeps({ words: [] });

    expect(await main(deps)).toBe(1);

    expect(requests).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run scripts/generate-words.test.ts scripts/generate-pronunciation.test.ts`
Expected: FAIL — 일본어 항목이 모두 버려지고(발음 필드를 `toEntry`가 넘기지 않음), `./generate-pronunciation`이 없음

- [ ] **Step 3: `generate-words` 구현**

`toEntry`의 `entry`에 `distractors` 아래(영어는 AI 값과 상관없이 `null`):

```ts
    distractors: w.distractors,
    pron_ko: language === "ja" ? w.pron_ko : null,
    example_pron_ko: language === "ja" ? w.example_pron_ko : null,
```

`wordBatchSchema`의 항목에 `distractors` 아래:

```ts
      pron_ko: z.string().nullable(),
      example_pron_ko: z.string().nullable(),
```

import에 `PRONUNCIATION_RULES`(`@/services/claude/prompts`)를 더하고, `buildPrompt`의 항목 설명에서 `"- distractors: …"` 묶음(세 줄의 하위 항목 포함) 바로 아래에:

```ts
    language === "ja" ? "- pron_ko: word를 reading대로 읽은 한글 발음" : "- pron_ko: null",
    language === "ja"
      ? "- example_pron_ko: 정답을 채운 example 전체의 한글 발음({{ }}는 빼고 읽는다)"
      : "- example_pron_ko: null",
```

`if (language === "ja") { lines.push(...) }` 블록의 끝 항목 뒤에 이어서:

```ts
      "",
      "한글 발음 규칙:",
      PRONUNCIATION_RULES,
```

- [ ] **Step 4: `generate-pronunciation` 구현** — `scripts/generate-pronunciation.ts`

```ts
import * as fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parseBlank } from "@/lib/blank";
import { isLevel, type Level } from "@/lib/levels";
import { cleanPron } from "@/lib/pronunciation";
import { PRONUNCIATION_RULES } from "@/services/claude/prompts";
import { getClaudeEnv } from "@/services/env";

// 일본어 단어 파일의 한글 발음(pron_ko·example_pron_ko) 중 비었거나 검사에 맞지 않는 값만 Claude로 채운다
// (spec/words.md "단어 데이터"). 검사에 맞는 값은 바꾸지 않는다. 묶음마다 파일을 써서 중간에 멈춰도 앞 묶음은 남는다

const BATCH_SIZE = 50;

export type PronSource = { id: string; word: string; reading: string; sentence: string };
export type PronRequest = { model: string | undefined; items: PronSource[] };

export type GeneratePronunciationDeps = {
  args: string[];
  generate: (request: PronRequest) => Promise<unknown[]>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  log: (line: string) => void;
};

type Entry = Record<string, unknown>;

const USAGE = "사용법: npm run words:pron -- --language ja --level <1-5> [--model <모델 ID>]";

function parseCliArgs(args: string[]): { level: Level; model: string | undefined } | null {
  try {
    const { values } = parseArgs({
      args,
      options: { language: { type: "string" }, level: { type: "string" }, model: { type: "string" } },
    });
    const level = Number(values.level);
    return values.language === "ja" && isLevel(level) ? { level, model: values.model } : null;
  } catch {
    return null; // 모르는 옵션, 값이 없는 옵션
  }
}

function needsPron(entry: Entry): boolean {
  return cleanPron(entry.pron_ko) === null || cleanPron(entry.example_pron_ko) === null;
}

// 정답을 채운 예문. {{ }}는 빼고 [漢字|かな] 표기는 남겨 한자의 읽기를 알려 준다
function toSource(entry: Entry): PronSource | null {
  const blank = typeof entry.example === "string" ? parseBlank(entry.example) : null;
  if (typeof entry.id !== "string" || typeof entry.word !== "string" || typeof entry.reading !== "string" || !blank) {
    return null;
  }
  return { id: entry.id, word: entry.word, reading: entry.reading, sentence: blank.before + blank.answer + blank.after };
}

function itemsById(items: unknown[]): Map<string, Entry> {
  const byId = new Map<string, Entry>();
  for (const item of items) {
    if (typeof item === "object" && item !== null && typeof (item as Entry).id === "string") {
      byId.set((item as Entry).id as string, item as Entry);
    }
  }
  return byId;
}

export async function main(deps: GeneratePronunciationDeps): Promise<number> {
  const parsed = parseCliArgs(deps.args);
  if (!parsed) {
    deps.log(USAGE);
    return 1;
  }
  const path = `data/words/ja-${parsed.level}.json`;
  const entries = JSON.parse(await deps.readFile(path)) as unknown;
  if (!Array.isArray(entries)) {
    deps.log(`${path}는 단어 배열이어야 합니다`);
    return 1;
  }

  const failed: string[] = [];
  const todo: { entry: Entry; source: PronSource }[] = [];
  for (const entry of entries as Entry[]) {
    if (!needsPron(entry)) continue;
    const source = toSource(entry);
    if (source) todo.push({ entry, source });
    else failed.push(String(entry.id));
  }
  if (todo.length === 0 && failed.length === 0) {
    deps.log(`${path}에 채울 발음이 없습니다`);
    return 0;
  }

  let filled = 0;
  for (let start = 0; start < todo.length; start += BATCH_SIZE) {
    const chunk = todo.slice(start, start + BATCH_SIZE);
    const byId = itemsById(await deps.generate({ model: parsed.model, items: chunk.map((t) => t.source) }));
    for (const { entry, source } of chunk) {
      const item = byId.get(source.id);
      const pron = cleanPron(item?.pron_ko);
      const examplePron = cleanPron(item?.example_pron_ko);
      if (cleanPron(entry.pron_ko) === null && pron !== null) entry.pron_ko = pron;
      if (cleanPron(entry.example_pron_ko) === null && examplePron !== null) entry.example_pron_ko = examplePron;
      if (needsPron(entry)) failed.push(source.id);
      else filled++;
    }
    await deps.writeFile(path, `${JSON.stringify(entries, null, 2)}\n`);
    deps.log(`${Math.min(start + BATCH_SIZE, todo.length)} / ${todo.length}`);
  }

  deps.log(`${path}: ${filled}개 채움`);
  if (failed.length > 0) {
    deps.log(`채우지 못한 단어 ${failed.length}개: ${failed.join(", ")}. 다시 실행하면 이 단어만 다시 요청합니다`);
    return 1;
  }
  deps.log("검수한 뒤 커밋하세요");
  return 0;
}

// ---- 실제 deps (Anthropic API, 파일). 테스트는 가짜 deps만 쓴다 ----

// thinking이 한도를 먼저 써서 목록이 잘리지 않게 넉넉히 둔다. 이만큼 크면 SDK가 스트리밍을 요구한다
const MAX_TOKENS = 32_000;

const pronBatchSchema = z.object({
  items: z.array(z.object({ id: z.string(), pron_ko: z.string(), example_pron_ko: z.string() })),
});

function buildPrompt(items: PronSource[]): { system: string; user: string } {
  return {
    system: "너는 한국인 학습자를 위한 일본어 단어장에 한글 발음을 다는 편집자다.",
    user: [
      "항목마다 id를 그대로 두고 다음을 채운다.",
      "- pron_ko: word를 reading대로 읽은 한글 발음",
      "- example_pron_ko: sentence 전체의 한글 발음. [漢字|かな] 표기의 한자는 かな대로 읽는다",
      "",
      "한글 발음 규칙:",
      PRONUNCIATION_RULES,
      "",
      "항목:",
      JSON.stringify(items),
    ].join("\n"),
  };
}

function createGenerate(): GeneratePronunciationDeps["generate"] {
  let client: Anthropic | undefined;
  return async (request) => {
    const env = getClaudeEnv();
    client ??= new Anthropic({ apiKey: env.apiKey });
    const { system, user } = buildPrompt(request.items);
    try {
      const message = await client.messages
        .stream({
          model: request.model ?? env.model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: user }],
          output_config: { format: zodOutputFormat(pronBatchSchema), effort: "medium" },
        })
        .finalMessage();
      // 거절되거나 잘린 응답은 빈 묶음으로 보고, main이 그 단어들을 실패 목록에 남긴다
      if (message.stop_reason !== "end_turn" || message.parsed_output === null) {
        console.error(`빈 묶음: stop_reason ${message.stop_reason}, 출력 ${message.usage.output_tokens}토큰`);
        return [];
      }
      return message.parsed_output.items;
    } catch (error) {
      // 인증·사용량 같은 API 오류는 멈춘다. JSON 파싱·스키마 검증 실패만 빈 묶음으로 본다
      if (error instanceof Anthropic.APIError) throw error;
      console.error(`빈 묶음: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };
}

function realDeps(): GeneratePronunciationDeps {
  return {
    args: process.argv.slice(2),
    generate: createGenerate(),
    readFile: (path) => fs.readFile(path, "utf8"),
    writeFile: (path, content) => fs.writeFile(path, content),
    log: (line) => console.log(line),
  };
}

// import만 해서는 실행하지 않는다 (테스트가 import한다)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(realDeps()).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
```

`package.json`의 `scripts`에서 `words:generate` 아래:

```json
    "words:pron": "tsx --env-file-if-exists=.env.local scripts/generate-pronunciation.ts",
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run scripts`
Expected: PASS

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음 (`output_config`의 `effort`가 stream 타입에서 거부되면 `effort`를 지우고 그 사실을 결과 파일 `spec_diff`에 적는다)

- [ ] **Step 6: 커밋** (`npm run words:pron`은 실행하지 않는다)

```bash
git status -sb
git add scripts/generate-words.ts scripts/generate-words.test.ts scripts/generate-pronunciation.ts scripts/generate-pronunciation.test.ts package.json
git commit -m "feat(pron): generate Korean pronunciation for Japanese word data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 화면 — 대화·단어 카드·빈칸 (`ChatRoom`, `WordSession`, `BlankQuiz`)

**Files:**
- Modify: `src/components/ChatRoom.tsx` (`AiBubble`, 교정 카드, 첫 마디 전달)
- Test: `src/components/ChatRoom.test.tsx`
- Modify: `src/components/BlankQuiz.tsx` (`pronunciation` prop)
- Test: `src/components/BlankQuiz.test.tsx`
- Modify: `src/components/WordSession.tsx` (카드 앞·뒷면, 빈칸에 발음 전달)
- Test: `src/components/WordSession.test.tsx`

**Interfaces:**
- Consumes: `showsPronunciation`(Task 1), `ScenarioLine.pronKo`(Task 2), `Word.pronKo`·`Word.examplePronKo`·`ChatTurnView.replyPronKo`·`TurnReply`(Task 3)
- Produces: `BlankQuiz`의 새 prop `pronunciation?: string | null`(채점 뒤 학습 모드에서만 그린다)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/ChatRoom.test.tsx` — import에 `type Level`(`@/lib/levels`)을 더하고, 파일 끝에:

```ts
describe("ChatRoom 한글 발음", () => {
  const JA_SCENARIO = { title: "인사", opening: { text: "はじめまして！", ko: "처음 뵙겠습니다!", pronKo: "하지메마시테!" } };
  const pronTurn = turn(1, {
    reply: "[今日|きょう]は[暑|あつ]いですね。",
    replyKo: "오늘 덥네요.",
    replyPronKo: "쿄-와 아츠이데스네.",
    correction: { corrected: "[暑|あつ]いです。", explanation_ko: "설명", corrected_pron_ko: "아츠이데스." },
  });
  const jaRoom = (level: Level, turns: ChatTurnView[] = [pronTurn]) => room({ language: "ja", level, turns });

  it("입문·초보는 첫 마디·AI 말풍선의 문장 아래, 번역 위에 발음을 늘 보여 준다", () => {
    setup(jaRoom(1), { kind: "available" }, JA_SCENARIO);

    const opening = screen.getByText("하지메마시테!", ON_SCREEN);
    expect(opening.previousElementSibling).toHaveAttribute("lang", "ja");
    expect(isBefore(opening, screen.getByText("처음 뵙겠습니다!", ON_SCREEN))).toBe(true);
    const reply = screen.getByText("쿄-와 아츠이데스네.", ON_SCREEN);
    expect(isBefore(reply, screen.getByText("오늘 덥네요.", ON_SCREEN))).toBe(true);
  });

  it("교정 카드는 고친 문장 바로 아래에 발음을 둔다", () => {
    setup(jaRoom(2), { kind: "available" }, JA_SCENARIO);

    const pron = screen.getByText("아츠이데스.", ON_SCREEN);
    expect(pron.previousElementSibling).toHaveAttribute("lang", "ja");
    expect(pron.previousElementSibling).toHaveTextContent("いです。");
  });

  it("중급은 말풍선을 펼쳐야 발음이 번역과 함께 보인다 (교정 카드는 늘 펼쳐 둔다)", async () => {
    const { user } = setup(jaRoom(3), { kind: "available" }, JA_SCENARIO);

    expect(screen.queryByText("하지메마시테!")).toBeNull();
    expect(screen.queryByText("쿄-와 아츠이데스네.")).toBeNull();
    expect(screen.getByText("아츠이데스.")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { expanded: false })[1]);

    expect(screen.getByText("쿄-와 아츠이데스네.")).toBeInTheDocument();
    expect(screen.getByText("오늘 덥네요.")).toBeInTheDocument();
  });

  it("상급과 영어 방은 첫 마디 pronKo나 저장된 발음이 있어도 그리지 않는다", async () => {
    const { user, rerender } = setup(jaRoom(4), { kind: "available" }, JA_SCENARIO);

    expect(screen.queryByText("아츠이데스.")).toBeNull();
    for (const toggle of screen.getAllByRole("button", { expanded: false })) await user.click(toggle);
    expect(screen.queryByText("하지메마시테!")).toBeNull();
    expect(screen.queryByText("쿄-와 아츠이데스네.")).toBeNull();

    rerender(room({ language: "en", level: 1, turns: [pronTurn] }));
    expect(screen.queryByText("하지메마시테!")).toBeNull();
    expect(screen.queryByText("쿄-와 아츠이데스네.")).toBeNull();
    expect(screen.queryByText("아츠이데스.")).toBeNull();
  });

  it("발음이 없는 턴(기능 전 턴, 검사에 맞지 않아 숨긴 발음)은 발음 줄 없이 그린다", () => {
    const old = turn(1, { reply: "はい。", replyKo: "네.", replyPronKo: null, correction: { corrected: "はい。", explanation_ko: "설명" } });
    const { container } = setup(jaRoom(1, [old]), { kind: "available" }, { title: "인사", opening: { text: "はい。", ko: "네." } });

    const hiddenTexts = [...container.querySelectorAll("[aria-hidden='true']")].map((el) => el.textContent).filter(Boolean);
    expect(hiddenTexts).toEqual([]);
  });

  it("발음은 낭독기에서 숨기고 새 턴 알림에도 넣지 않는다", async () => {
    apiMock.mockResolvedValue(replied(2, 18, { reply: "はい。", reply_ko: "네.", reply_pron_ko: "하이." }));
    const { user } = setup(jaRoom(1), { kind: "available" }, JA_SCENARIO);

    expect(screen.getByText("쿄-와 아츠이데스네.", ON_SCREEN)).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("아츠이데스.", ON_SCREEN)).toHaveAttribute("aria-hidden", "true");

    await typeAndSend(user, "はい");

    expect(screen.getByText("하이.", ON_SCREEN)).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector("[aria-live]")).toHaveTextContent("はい。");
    expect(document.querySelector("[aria-live]")).not.toHaveTextContent("하이.");
  });
});
```

`src/components/BlankQuiz.test.tsx` 끝에:

```ts
describe("BlankQuiz 한글 발음", () => {
  const PRON = "갓코-니 잇타.";

  it("학습은 채점 뒤에만 빈칸 문장 바로 아래·번역 위에 발음을 둔다", async () => {
    const { user } = setup({ pronunciation: PRON });
    expect(screen.queryByText(PRON)).toBeNull();

    await user.click(option("goes"));

    const pron = screen.getByText(PRON);
    expect(pron).toHaveAttribute("aria-hidden", "true");
    expect(pron.previousElementSibling).toHaveAttribute("lang", "en");
    expect(pron.nextElementSibling).toHaveTextContent("나는 학교에 갔다.");
  });

  it("발음이 null이면 채점 뒤에도 두지 않는다", async () => {
    const { user, container } = setup({ pronunciation: null });
    await user.click(option("went"));

    const hiddenTexts = [...container.querySelectorAll("[aria-hidden='true']")].map((el) => el.textContent).filter(Boolean);
    expect(hiddenTexts).toEqual([]);
  });

  it("레벨업 테스트는 발음을 받아도 두지 않는다", async () => {
    const { user } = setup({ mode: "test", answer: undefined, pronunciation: PRON });
    await user.click(option("goes"));

    expect(screen.queryByText(PRON)).toBeNull();
  });
});
```

`src/components/WordSession.test.tsx` 끝에:

```ts
describe("WordSession 일본어 한글 발음", () => {
  const iku = word(1, {
    id: "ja-1-001",
    language: "ja",
    level: 1,
    word: "行く",
    reading: "いく",
    example: "[学校|がっこう]に{{[行|い]った}}。",
    exampleKo: "학교에 갔다.",
    distractors: ["[行|い]く", "[行|い]って", "[行|い]かない"],
    pronKo: "이쿠",
    examplePronKo: "갓코-니 잇타.",
  });
  // 보기에 후리가나가 없어 글자로 고를 수 있는 단어
  const kore = word(2, {
    id: "ja-1-002",
    language: "ja",
    level: 1,
    word: "これ",
    reading: "これ",
    example: "{{これ}}はペンです。",
    exampleKo: "이것은 펜이에요.",
    distractors: ["それ", "あれ", "どれ"],
    pronKo: "코레",
    examplePronKo: "코레와 펜데스.",
  });

  it("카드 앞면은 단어 바로 아래, 뒷면은 예문 바로 아래·번역 위에 두고, 카드 이름에는 넣지 않는다", async () => {
    const { user } = setup({ language: "ja", level: 1, words: [iku] });
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    const front = screen.getByText("이쿠");
    expect(front).toHaveAttribute("aria-hidden", "true");
    expect(front.previousElementSibling).toHaveAttribute("lang", "ja");
    expect(flashcard()).not.toHaveAccessibleName(/이쿠/);

    await user.click(flashcard());

    const back = screen.getByText("갓코-니 잇타.");
    expect(back).toHaveAttribute("aria-hidden", "true");
    expect(back.previousElementSibling).toHaveAttribute("lang", "ja");
    expect(back.nextElementSibling).toHaveTextContent("학교에 갔다.");
  });

  it("오답 복습 카드도 앞면 단어·뒷면 예문 아래에 발음을 둔다", async () => {
    const { user } = setup({ mode: "review", language: "ja", level: 2, words: [iku] });
    await user.click(screen.getByRole("button", { name: "복습 시작" }));

    expect(screen.getByText("이쿠")).toBeInTheDocument();
    await user.click(flashcard());
    expect(screen.getByText("갓코-니 잇타.")).toBeInTheDocument();
  });

  it("빈칸은 채점 뒤에만 정답을 채운 예문의 발음을 둔다", async () => {
    const { user } = setup({ language: "ja", level: 3, words: [kore] });
    await user.click(screen.getByRole("button", { name: "시작하기" }));
    await answerCards(user, [true]);
    expect(screen.queryByText("코레와 펜데스.")).toBeNull();

    await user.click(screen.getByText("それ", { selector: "button span[lang]" }));

    expect(screen.getByText("코레와 펜데스.")).toHaveAttribute("aria-hidden", "true");
  });

  it("상급은 카드와 빈칸에 발음을 두지 않는다", async () => {
    const { user } = setup({ language: "ja", level: 4, words: [kore] });
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.queryByText("코레")).toBeNull();
    await user.click(flashcard());
    expect(screen.queryByText("코레와 펜데스.")).toBeNull();
    await answerCards(user, [true]);
    await user.click(screen.getByText("それ", { selector: "button span[lang]" }));
    expect(screen.queryByText("코레와 펜데스.")).toBeNull();
  });
});
```

(`복습 시작` 버튼 이름과 `setup`의 `mode` prop은 같은 파일의 "WordSession 오답 복습" 테스트를 따른다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/components/ChatRoom.test.tsx src/components/BlankQuiz.test.tsx src/components/WordSession.test.tsx`
Expected: FAIL — 발음 글자를 찾지 못함

- [ ] **Step 3: 구현**

`src/components/ChatRoom.tsx`:

import의 `@/lib/levels`에 `showsPronunciation`을 더한다.

`const furigana = …` 바로 아래:

```ts
  const pronunciation = showsPronunciation(room.language, room.level);
```

첫 마디는 받은 줄을 그대로 넘긴다:

```tsx
        <AiBubble line={scenario.opening} language={room.language} level={room.level} />
```

AI 말풍선 턴:

```tsx
            <AiBubble
              line={{ text: t.reply, ko: t.replyKo, pronKo: t.replyPronKo }}
              language={room.language}
              level={room.level}
            />
```

교정 카드의 고친 문장 `<p>` 바로 아래(재생 버튼 위):

```tsx
                {pronunciation && t.correction.corrected_pron_ko && (
                  <p aria-hidden="true" className="text-sm text-brand">
                    {t.correction.corrected_pron_ko}
                  </p>
                )}
```

`AiBubble`:

```tsx
// 입문·초보는 번역을 항상 펼치고, 중급 이상은 말풍선 전체를 눌러 펼친다. 한글 발음은 번역과 같이 펼친다.
// 재생 버튼은 말풍선 밖 아래에 둔다
function AiBubble({
  line,
  language,
  level,
}: {
  line: { text: string; ko: string; pronKo?: string | null };
  language: Language;
  level: Level;
}) {
  const [open, setOpen] = useState(false);
  const body = (
    <span lang={language} className="block whitespace-pre-wrap wrap-break-word">
      <Furigana text={line.text} show={language === "ja" && showsFurigana(level)} />
    </span>
  );
  // 낭독기는 lang="ja" 문장을 읽으므로 발음은 숨긴다
  const pronunciation =
    showsPronunciation(language, level) && line.pronKo ? (
      <span aria-hidden="true" className="mt-1 block text-sm text-brand">
        {line.pronKo}
      </span>
    ) : null;
  const translation = <span className="mt-2 block border-t border-line pt-2 text-sm text-ink-muted">{line.ko}</span>;

  const bubble = opensTranslationByDefault(level) ? (
    <div className={AI_BUBBLE}>
      {body}
      {pronunciation}
      {translation}
    </div>
  ) : (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      className={`flex flex-col items-start gap-1 rounded-bubble text-left ${FOCUS_RING}`}
    >
      <span className={`block ${AI_BUBBLE}`}>
        {body}
        {open && pronunciation}
        {open && translation}
      </span>
      <span className="inline-flex items-center gap-1 px-1 text-xs font-semibold text-accent">
        <Languages size={14} aria-hidden="true" />
        번역
      </span>
    </button>
  );
  return (
    <div className="flex max-w-[84%] flex-col items-start gap-1 self-start">
      {bubble}
      <SpeakButtons source={{ kind: "speech", text: line.text, language }} variant="compact" />
    </div>
  );
}
```

`ScenarioLine` import가 더 쓰이지 않으면(Props 타입에 남아 있으면 그대로) 지우지 않는다. `TurnAnnouncement`는 바꾸지 않는다.

`src/components/BlankQuiz.tsx` — `Props`에 `exampleAudio` 아래:

```ts
  pronunciation?: string | null; // 정답을 채운 예문의 한글 발음. 학습 채점 뒤에만 그린다
```

구조 분해에 `pronunciation`을 더하고, 빈칸 문장 `<p lang={language} …>` 바로 아래(`example_ko` 위):

```tsx
        {/* 채점 전에는 정답의 발음이 드러나서 두지 않는다 */}
        {graded && pronunciation && (
          <p aria-hidden="true" className="text-sm text-brand">
            {pronunciation}
          </p>
        )}
```

`src/components/WordSession.tsx`:

import의 `@/lib/levels`에 `showsPronunciation`을 더하고, `const furigana = …` 바로 아래:

```ts
  const pronunciation = showsPronunciation(runLanguage, level);
```

카드 `front`의 단어 `<span lang={runLanguage} …>` 바로 아래(“탭해서 뜻 보기” 위):

```tsx
              {pronunciation && w.pronKo && (
                <span aria-hidden="true" className="text-lead text-brand">
                  {w.pronKo}
                </span>
              )}
```

카드 `back`의 예문 `<span lang={runLanguage}>` 바로 아래(`exampleKo` 위):

```tsx
              {pronunciation && w.examplePronKo && (
                <span aria-hidden="true" className="text-sm text-brand">
                  {w.examplePronKo}
                </span>
              )}
```

`phase === "quiz"`의 `<BlankQuiz …>`에 prop 하나:

```tsx
          pronunciation={pronunciation ? w.examplePronKo : null}
```

(Flashcard 면은 `<button>` 안이라 phrasing 요소인 `<span>`을 쓴다.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/components`
Expected: PASS

Run: `npm run test && npm run lint && npm run build`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git status -sb
git add src/components/ChatRoom.tsx src/components/ChatRoom.test.tsx src/components/BlankQuiz.tsx src/components/BlankQuiz.test.tsx src/components/WordSession.tsx src/components/WordSession.test.tsx
git commit -m "feat(pron): show Korean pronunciation under Japanese chat, cards, and graded blanks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 발음 데이터 생성·검수와 최종 확인 (하네스 step 밖, 사람이 지켜보며)

phase가 끝난 뒤 메인 세션이 한다. API 비용이 든다(일본어 1,000개 약 $1~2 추정).

- [ ] **Step 1: 생성** — 레벨마다 (Bash)

```bash
for level in 1 2 3 4 5; do npm run words:pron -- --language ja --level $level || break; done
```

실패 목록이 나오면 같은 레벨을 다시 돌린다(실패한 단어만 다시 요청한다). 모두 0으로 끝날 때까지 반복한다.

- [ ] **Step 2: AI 1차 검수** — 파일마다 읽기 전용 에이전트로 표기 규칙(spec/chat.md "한글 발음") 위반을 찾는다: 조사 は·へ, 장음 `-`, っ·ん 받침, 요음, 띄어쓰기, 한자 읽기가 `reading`·후리가나와 다른 것. 고칠 값은 파일에서 직접 고친다.

- [ ] **Step 3: 검사·seed**

Run: `npm run seed:words`
Expected: 10개 파일 모두 통과하고 upsert 완료(검사가 일본어 발음 필수를 확인한다)

- [ ] **Step 4: 전체 확인**

Run: `npm run lint && npm run build && npm run test && npm run test:db`
Expected: 모두 PASS. `npm run test`의 음성 어긋남 검사도 통과한다(발음 필드는 SSML에 들어가지 않는다).

- [ ] **Step 5: spec 대조와 로컬 확인** — `npm run dev` + 테스트 계정으로 일본어 입문(대화 첫 마디·AI 응답·교정), 중급(펼치기), 상급(없음), 단어 카드·오답 복습·빈칸 채점 뒤를 본다. 실제 Claude 대화 몇 턴으로 발음 품질과 출력 토큰 증가를 확인하고 `docs/spec/usage.md` 추정을 실측으로 고친다.

- [ ] **Step 6: 커밋과 병합**

```bash
git status -sb
git add data/words/ja-*.json
git commit -m "chore(words): add Korean pronunciation to Japanese words

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

main에 fast-forward 병합한다. 운영 반영 순서: 운영 Supabase에 마이그레이션(`20261009100000`, `20261014100000`) 적용 → `seed:words` → 배포.
