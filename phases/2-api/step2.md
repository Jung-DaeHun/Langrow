# Step 2: learning-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 3장 "오늘의 학습" 4·6번(회차 저장 body, known/review), "오답 복습"
  - 3-1 "기록"(가나 회차 완료 → `kana_studied`)
  - 4장 "레벨업 테스트" 전체(서버 채점, 정답을 클라이언트에 미리 보내지 않음)
  - 5장 "7일 무료 체험", "체험 종료 후"(`pro_clicked`)
  - 6-3 "데이터 접근과 보안"의 첫 레벨·체험·레벨 내리기 조건
  - 6-4 API 표와 "공통 준비 상태 검사" 예외 3개, 6-10 "에러 코드"
  - 7장 use-case 테스트의 "보안"·"레벨"·"체험"·"단어" 항목
- step 0·1 산출물: `src/server/http.ts`, `src/server/deps.ts`, `src/test/fakes.ts`, `src/types/api.ts`, `src/server/chat.ts`, `src/app/api/chat/**/route.ts`와 `route.test.ts`(route 작성·테스트 방식을 그대로 따른다)
- 앞 phase 산출물:
  - `src/server/db/account.ts`, `src/server/db/learning.ts`(함수마다 주석으로 적힌 에러 코드, `getWordsByIds`)
  - `src/lib/wordBatch.ts`(`BATCH_MAX`, `wordStatus`, `hasValidBatchIds`), `src/lib/levelTest.ts`(`LEVEL_TEST_SIZE`, `scoreAnswers`, `isPassed`, `hasValidTestIds`), `src/lib/blank.ts`(`parseBlank`), `src/lib/levels.ts`(`LANGUAGES`, `isLevel`, `canTakeLevelTest`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

나머지 API 9개를 만든다. 판단이 들어가는 두 개(단어 회차의 known/review 결정, 레벨업 채점)만 use-case로 둔다. 나머지 일곱 개는 RPC 하나만 부르므로 route handler가 `getDeps().db.*`를 바로 부르고 결과(`DbResult`)를 그대로 반환한다(ARCHITECTURE.md). 한도, 중복 단어 처리, `where level = from_level`, 체험 1회는 RPC가 이미 지킨다(1-data, test:db로 검증).

## 작업

파일마다 같은 폴더에 `*.test.ts`(route는 `route.test.ts`)를 먼저 쓴다.

### 1. 응답 타입: `src/types/api.ts`에 추가

```ts
export type WordBatchResponse = { insertedCount: number }
export type WordReviewResponse = { reviewedCount: number }
export type LevelUpResponse = { passed: boolean; level: Level; score: number; wrong: { wordId: string; answer: string }[] }  // answer = 정답 표기
export type LevelResponse = { level: Level }
export type TrialResponse = { proUntil: string }   // ISO 문자열
```
동의, 언어 전환, 첫 레벨, 이벤트는 성공하면 `{}`를 돌려준다.

### 2. `src/server/learning.ts`: use-case

```ts
import 'server-only'
export async function saveWords(deps: Deps, userId: string, input: {
  language: Language; items: { word_id: string; knew: boolean; correct: boolean }[]
}): Promise<Outcome<WordBatchResponse>>
export async function submitLevelUp(deps: Deps, userId: string, input: {
  language: Language; from_level: Level; answers: { word_id: string; answer: string }[]
}): Promise<Outcome<LevelUpResponse>>
```

**`saveWords`**
- 각 항목의 상태를 `wordStatus(knew, correct)`로 정한다. [알아요]를 누르고 빈칸도 맞혔을 때만 known이다.
- `db.saveWordBatch(userId, language, items)` 결과를 돌려준다. 기존 단어만 있으면 `insertedCount: 0`으로 성공하고, 한도를 넘으면 `LIMIT_REACHED`다.

**`submitLevelUp`** (spec 4장)
1. `db.getWordsByIds(answers의 word_id들)`. 아래 경우는 `INVALID_INPUT`이고 `submitLevelTest`를 부르지 않는다:
   - 돌려받은 단어가 `LEVEL_TEST_SIZE`개보다 적다
   - 언어가 `input.language`와 다르거나 레벨이 `from_level`과 다른 단어가 있다
2. 정답은 `parseBlank(example).answer`다. `null`이면 throw한다. seed 검증을 통과한 데이터라 `null`이면 버그다.
3. `scoreAnswers(answers, 정답 Map)`으로 `score`와 `wrongIds`를 구하고, `passed = isPassed(score)`로 정한다. 표기를 그대로 비교하므로 일본어 후리가나 표기도 정답 문자열의 일부다.
4. `db.submitLevelTest(userId, { language, fromLevel: from_level, score, passed })`. 거부되면 그 코드를 돌려준다. 실제 레벨이 다르거나 같은 시험을 다시 제출하면 `CONFLICT`다.
5. 응답:
   - `passed`와 `level`은 RPC 결과를 쓴다.
   - `score`는 3에서 구한 값이다.
   - `wrong`은 `wrongIds` 순서대로 `{ wordId, answer: 정답 }`이다. 불합격 화면의 [다시 보기]에 쓴다. 정답은 제출 뒤에만 보낸다.

### 3. route

| 파일 (method) | 준비 상태 | params | body | handler |
|---|---|---|---|---|
| `src/app/api/words/batch/route.ts` (POST) | ready | – | `{ language, items: 1~10개 { word_id, knew: boolean, correct: boolean } }`, `word_id`는 서로 달라야 함 | `saveWords` |
| `src/app/api/words/review/route.ts` (POST) | ready | – | `{ language, items: 1~10개 { word_id, knew: boolean } }`, `word_id`는 서로 달라야 함 | `db.saveReview(userId, language, items를 { wordId, knew }로)` |
| `src/app/api/level-up/route.ts` (POST) | ready | – | `{ language, from_level: 1~4 정수, answers: 정확히 20개 { word_id, answer: 50자 이하 } }`, `word_id`는 서로 달라야 함 | `submitLevelUp` |
| `src/app/api/me/consent/route.ts` (POST) | **login** | – | 없음 | `db.agreeTerms(userId)` 뒤 `{ ok: true, value: null }` |
| `src/app/api/me/language/route.ts` (PUT) | **consent** | – | `{ language }` | `db.switchLanguage` |
| `src/app/api/levels/route.ts` (POST) | **consent** | – | `{ language, level: 1~5 정수 }` | `db.setFirstLevel` |
| `src/app/api/levels/[language]/route.ts` (PATCH) | ready | `{ language: enum }` | `{ level: 1~5 정수 }` | `db.lowerLevel` |
| `src/app/api/trial/route.ts` (POST) | ready | – | 없음 | `db.startTrial` → `{ proUntil: ISO 문자열 }` |
| `src/app/api/events/route.ts` (POST) | ready | – | `{ name: 'pro_clicked' \| 'kana_studied' }` | `db.recordEvent` |

- 준비 상태 예외는 굵게 쓴 세 개뿐이다(spec 6-4). 이벤트 이름에 따라 준비 상태 검사를 생략하지 않는다.
- 언어는 `z.enum(LANGUAGES)`로 받는다. 개수·중복 검사는 lib 상수와 함수(`BATCH_MAX`, `hasValidBatchIds`, `LEVEL_TEST_SIZE`, `hasValidTestIds`, `canTakeLevelTest`)를 쓴다. 숫자를 따로 적지 않는다.
- `word_id`에는 비지 않은 짧은 문자열이라는 상한을 둔다. 답안은 50자 이하다(보안 체크리스트 9).
- 레벨 올리기 API는 만들지 않는다. 레벨은 레벨업 테스트로만 오른다.
- 요청 body는 spec처럼 snake_case(`word_id`, `from_level`)이고, 응답은 camelCase다.

### 4. 테스트 (먼저 작성)

**`src/server/learning.test.ts`** (`createFakeDeps`)
- `saveWords`
  - (knew, correct)의 네 조합 중 (true, true)만 known이고 나머지는 review로 `saveWordBatch`에 전달된다
  - language를 그대로 넘긴다
  - `LIMIT_REACHED`·`ONBOARDING_REQUIRED`는 그대로 반환한다
- `submitLevelUp`
  - 정답 16개 → `submitLevelTest`에 `passed: true`, 15개 → `false`
  - 응답의 `score`, `wrong`(정답 포함, `wrongIds` 순서)
  - 일본어 정답 `[行|い]った`는 같은 표기만 정답이다
  - 단어가 19개만 오거나, 다른 언어·다른 레벨 단어가 섞이면 `INVALID_INPUT`이고 `submitLevelTest` 미호출
  - RPC `CONFLICT` → 그대로 반환

**route 테스트** (각 `route.test.ts`, step 0·1과 같은 mock 방식)
- 모든 route
  - 비로그인 → 401
  - 성공하면 db 함수가 `userId`와 변환된 인자로 불리고 응답 body가 위 타입과 같다
  - db 거부 코드는 해당 HTTP 상태가 된다. 체험 두 번째 요청과 레벨 올리기 시도는 `CONFLICT` → 409, 단어 한도는 429
- 준비 상태
  - consent: 미동의 사용자도 200
  - language·levels POST: 동의만 하고 레벨이 없는 사용자는 통과, 미동의는 403 `CONSENT_REQUIRED`
  - 나머지: 레벨 미설정이면 403 `ONBOARDING_REQUIRED`이고 db 쓰기 함수를 부르지 않는다
- zod 경계 → 400
  - 회차 0개·11개·중복 `word_id`
  - `knew` 누락이나 문자열
  - 답안 19개·21개·51자
  - `from_level` 5와 `"2"`
  - 레벨 0·6
  - 없는 언어
  - 허용하지 않는 이벤트 이름(`limit_reached` 등)
- `PATCH /api/levels/fr` → 404

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -rn "getSession(" src --include=*.ts --include=*.tsx
for f in src/server/*.ts; do case "$f" in *.test.ts|*/types.ts) ;; *) grep -qE "import ['\"]server-only['\"]" "$f" || { echo "server-only 없음: $f"; exit 1; } ;; esac; done
for f in $(find src/app -name route.ts); do [ -f "$(dirname "$f")/route.test.ts" ] || { echo "테스트 없음: $f"; exit 1; }; done
for p in me/consent me/language levels "levels/[language]" chat/sessions "chat/sessions/[id]/messages" "chat/sessions/[id]/end" words/batch words/review level-up trial events; do [ -f "src/app/api/$p/route.ts" ] || { echo "route 없음: $p"; exit 1; }; done
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조와 API 표를 따르는가? (route 12개, 단일 RPC route는 `server/db` 직접)
   - ADR-008(레벨업 서버 채점), ADR-010(준비 상태 예외 3개)을 따르는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (body의 userId 무시, 날짜·플랜·한도는 RPC가 판정)
3. 결과에 따라 `phases/2-api/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 3-ui가 쓸 수 있게 API 9개의 method·경로·body·응답 타입·준비 상태를 넣는다
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 레벨을 올리는 API나 레벨 값을 직접 쓰는 경로를 만들지 마라. 이유: 첫 레벨 API로 레벨업을 우회하는 것을 막는다(보안 체크리스트 2). 올리기는 레벨업 테스트 RPC로만 한다.
- 클라이언트가 보낸 점수·합격 여부·known/review 상태를 믿지 마라. 이유: 서버가 `lib`로 판정한다(spec 3·4장).
- 레벨업 채점 전에 정답을 응답에 넣거나 출제 API를 만들지 마라. 이유: 출제는 3-ui 페이지가 읽기로 하고, 정답은 제출 결과에만 담는다(spec 4장).
- 사용량·한도를 route나 use-case에서 세지 마라. 이유: 한도는 RPC가 계정을 잠근 뒤 DB 시각으로 판정한다(CLAUDE.md CRITICAL).
- `getWordsByIds` 말고 user_id 없는 admin 조회를 추가하지 마라. 이유: CLAUDE.md CRITICAL. words는 공용 카탈로그라 예외로 둔 것이다.
- 이벤트 API에서 `pro_clicked`·`kana_studied` 말고 다른 이름을 받지 마라. 이유: 나머지 이벤트는 서버가 기록한다(보안 체크리스트 9).
- 단일 RPC route를 위한 통과용 use-case 파일을 만들지 마라. 이유: ARCHITECTURE.md. 판단 없는 호출은 route가 `server/db`를 바로 부른다.
- `src/server/db/*`, `src/services/*`, `src/server/http.ts`, `src/server/chat.ts`의 동작을 바꾸지 마라. 이유: 앞 step에서 검증한 계약이다. 막히면 고치지 말고 error로 보고한다.
- 기존 테스트를 깨뜨리지 마라
