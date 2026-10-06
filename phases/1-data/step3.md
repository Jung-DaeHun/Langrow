# Step 3: scripts

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 1장 "지표 수집", "수요 검증 기준" 전체(지표 정의, 관찰 구간, 분모, 판단 기준, 최소 표본)
  - 3장 "단어 데이터: 미리 생성"(필드 표와 예시, 후리가나 표기)
  - 6-5 "데이터 모델"의 `words`, 6-7 "단어 seed", 6-9(scripts는 `main(deps)`)
  - 7장 `lib/` 테스트의 metrics 항목, "데이터 검증"의 단어 항목
- 기존 코드:
  - `src/lib/usage.ts`(`kstDate`, `kstDayStart`, `addDays`), `src/lib/today.ts`(`VALID_SESSION_TURNS`), `src/lib/plan.ts`(`TRIAL_DAYS`), `src/lib/blank.ts`(`parseBlank`), `src/lib/levels.ts`, `src/lib/furigana.ts`
  - `src/services/env.ts`(`getAdminEnv`, `getClaudeEnv`), `src/services/claude/client.ts`(구조화 출력 호출 방식 참고. import는 하지 않는다)
  - `src/types/database.ts`, `supabase/migrations/*_schema.sql`(`words`·`profiles`·`chat_turns`·`events`·`user_activity_days` 컬럼)
  - `vitest.config.ts`(`scripts/**/*.test.ts`가 기본 테스트에 포함됨), `package.json`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

로컬에서만 돌리는 스크립트 3개와, 그 계산 규칙을 담는 순수 함수 2개를 만든다. 스크립트는 입출력을 주입받는 `main(deps)`를 export하고 가짜 deps로 테스트한다(spec 6-9). 이 step은 Docker와 네트워크 없이 끝난다. **실제 단어 생성·seed·지표 실행은 하지 않는다**(API 키와 사람 검수가 필요해서 사용자가 나중에 한다).

## 작업

### 1. `src/lib/words.ts` (단어 파일 검증, 순수)

```ts
export const WORDS_PER_LEVEL = 200
export type WordEntry = {   // data/words/*.json의 항목이자 words 테이블 행 (키 이름이 DB 컬럼과 같다)
  id: string; language: Language; level: Level; rank: number
  word: string; reading: string | null; meaning_ko: string
  example: string; example_ko: string; distractors: string[]
}
export function wordId(language: Language, level: Level, rank: number): string   // 'en-1-001'
export function validateWordFile(language: Language, level: Level, data: unknown):
  { ok: true; words: WordEntry[] } | { ok: false; errors: string[] }
```
검사 규칙(오류마다 단어 id와 이유를 적는다. 사람이 검수하며 고친다):
- 배열이고 정확히 `WORDS_PER_LEVEL`개. 모든 문자열 필드는 공백이 아님
- `language`·`level`이 파일과 같음. `rank`가 1~200을 한 번씩. `id === wordId(language, level, rank)`
- `example`에 `{{ }}`가 정확히 1개(`parseBlank`가 null이 아님)
- `distractors`가 정확히 3개, 서로 다르고, 정답(`{{ }}` 안 표기)과도 다름
- 일본어는 `reading`(히라가나 읽기)이 있고, 영어는 `reading`이 null
- 파일 안에서 `word`가 중복되지 않음

### 2. `src/lib/metrics.ts` (지표 계산, 순수)

```ts
export type MetricsRows = {
  profiles: { id: string; createdAt: Date; onboardedAt: Date | null; trialStartedAt: Date | null }[]
  doneTurns: { userId: string; sessionId: string; createdAt: Date }[]   // status = done만
  activityDays: { userId: string; date: string }[]                     // 한국 날짜 'YYYY-MM-DD'
  events: { userId: string; name: 'limit_reached' | 'pro_clicked'; props: Record<string, unknown>; createdAt: Date }[]
}
export type MetricResult = {
  key: string; label: string; numerator: number; denominator: number
  verdict: 'pass' | 'fail' | 'pending' | 'reference'   // pending = 표본 부족으로 판단 보류
}
export function computeMetrics(rows: MetricsRows,
  options: { now: Date; excludedUserIds: ReadonlySet<string>; launchDate?: string }): MetricResult[]
```
정의(spec 1장 "수요 검증 기준"):
- 모든 지표에서 `excludedUserIds` 사용자를 뺀다. 분자·분모는 distinct 사용자 수다.
- `launchDate`(한국 날짜)가 있으면 모집 기간 28일 안의 사용자만 넣는다. 온보딩 완료율은 `createdAt`, 나머지는 `onboardedAt` 기준이다.
- **온보딩 완료율**: 분모 = 가입 후 24시간이 지난 사용자. 분자 = 그중 가입 후 24시간 안에 `onboardedAt`. 기준 60% 이상
- **첫 세션 완료율**: 분모 = 온보딩 후 24시간이 지난 사용자. 분자 = 세션별 done 턴을 시각 순으로 놓았을 때 `VALID_SESSION_TURNS`번째 턴이 온보딩 후 24시간 안에 있는 세션이 있음(세션 종료 여부는 보지 않는다). 기준 50% 이상
- **D1 / D7 학습 재참여율**: D0 = `kstDate(onboardedAt)`. 분모 = 그날(D0+1 / D0+7)이 한국 시간으로 끝난 사용자. 분자 = 그 날짜에 `activityDays` 행이 있음. 기준 30% / 15% 이상
- **한도 도달 → 체험**: 사용자마다 첫 "체험 가능한 Free 한도 도달"(`limit_reached` 중 `props.plan === 'free'`이고 `props.trial_eligible === true`인 가장 이른 것)을 찾는다. 분모 = 그 도달이 온보딩 후 7일 안에 있고 도달 후 7일이 지난 사용자. 분자 = 도달 후 7일 안에 `trialStartedAt`. 기준: 분모 20명 이상에서 20% 이상. 같은 방식으로 첫 도달의 `props.feature`(`words`/`chat`)별 결과도 `reference`로 낸다
- **체험 후 Pro 관심**(참고): 분모 = 온보딩 후 14일 안에 체험을 시작했고(경로 무관) 체험 종료(`trialStartedAt + TRIAL_DAYS`) 후 7일이 지난 사용자. 분자 = 종료 후 7일 안에 `pro_clicked`. 항상 `reference`
- **판단 보류**: 모집 사용자 중 온보딩 완료 사용자가 50명 미만이면 기준이 있는 지표는 모두 `pending`. 한도 도달 → 체험은 분모가 20명 미만이어도 `pending`
- 기준값·최소 표본·관찰 일수는 이 파일의 상수로 둔다.

### 3. 스크립트 (`scripts/*.ts`, 각각 `main(deps)` export)

공통:
- `main(deps)`는 종료 코드(number)를 돌려준다. **파일을 import만 해서는 main이 실행되지 않아야 한다**(테스트가 import한다). 직접 실행될 때만 실제 deps로 main을 부르고 그 코드로 종료한다.
- Supabase는 `@supabase/supabase-js`의 `createClient`를 직접 쓰고 env는 `getAdminEnv()`로 읽는다. 실제 deps(네트워크·파일 I/O) 구현은 같은 파일에 두되 테스트는 가짜 deps만 쓴다.
- `tsx`를 devDependency로 정확한 버전 고정 설치한다(`.npmrc` save-exact).

**`scripts/generate-words.ts`**: `npm run words:generate -- --language ja --level 1 [--model <id>]`
- 한 번 실행에 언어·레벨 하나의 파일(`data/words/{language}-{level}.json`)을 만든다. 파일이 이미 있으면 덮어쓰지 않고 실패한다(검수한 데이터 보호).
- 모델은 `--model`, 없으면 `getClaudeEnv().model`. 모델 ID 문자열을 이 파일에 적지 않는다.
- 실제 생성은 Anthropic SDK 구조화 출력(`messages.parse` + `zodOutputFormat`, `output_config.format`)으로 한다. 한 번에 200개를 요청하지 말고 묶음(예: 50개)으로 나눠 요청하며, 이미 받은 단어 목록을 넘겨 중복을 피한다. `max_tokens`는 SDK의 non-streaming 상한보다 작게 둔다.
- 프롬프트 요구: 해당 레벨에 맞는 빈도 순 단어, 한국어 뜻, 정답 위치를 `{{ }}`로 표시한 예문과 한국어 번역, 문장에 맞지 않는 같은 단어의 다른 형태 오답 3개(spec 3장 표의 예: went → goes, gone, going). 일본어는 예문·정답·오답의 모든 한자에 `[漢字|かな]` 표기를 달고 `reading`은 히라가나다.
- 받은 항목에 rank를 순서대로 매기고 `wordId`로 id를 붙인다. 규칙에 어긋나는 항목과 중복 단어는 버리고 200개가 될 때까지 더 요청한다. 호출 횟수에 상한을 두고, 넘으면 파일을 쓰지 않고 실패한다. 마지막에 `validateWordFile`을 통과한 경우에만 쓴다(사람이 읽기 좋게 들여쓰기한 JSON).
- deps 예: `args`, `generate(요청) → unknown[]`, `fileExists`, `writeFile`, `log`

**`scripts/seed-words.ts`**: `npm run seed:words`
- `data/words/`의 `{en,ja}-{1..5}.json`을 모두 읽어 파일 이름의 언어·레벨로 `validateWordFile`한다. 일부 파일만 있어도 된다.
- 하나라도 실패하면 오류를 모두 출력하고 **아무것도 upsert하지 않는다.** 파일이 하나도 없으면 안내를 출력하고 실패한다.
- 모두 통과하면 `words`에 `onConflict: 'id'`로 upsert한다(나눠서). 단어 ID는 재사용하지 않으므로 다시 돌려도 학습 기록이 깨지지 않는다.
- deps 예: `listWordFiles`, `readFile`, `upsertWords(rows)`, `log`

**`scripts/metrics-report.ts`**: `npm run metrics [-- --launch 2026-11-01]`
- 원본 테이블을 읽어 `computeMetrics`로 계산하고, 지표마다 `라벨: 분자/분모 (비율%) 판단`을 한 줄씩 출력한다. 분모가 0이면 비율 대신 `-`.
- `METRICS_EXCLUDED_USER_IDS`(쉼표 구분, 공백·빈 값 무시)를 제외 목록으로 쓴다.
- 실제 조회는 `profiles`, `chat_turns`(done만), `user_activity_days`, `events`(`limit_reached`·`pro_clicked`만)에서 필요한 컬럼만 읽는다. **PostgREST는 요청당 최대 1000행이므로 `.range()`로 끝까지 페이지를 넘긴다.**
- deps 예: `args`, `now`, `excludedUserIds`(문자열), `fetchRows() → MetricsRows`, `log`

**npm scripts** (`package.json`): `words:generate`, `seed:words`, `metrics`. 각각 `tsx`로 실행하고 `.env.local`이 있으면 읽는다(`--env-file-if-exists=.env.local`이 tsx에서 동작하는지 확인한다). `CLAUDE.md`의 명령어 목록에 새 script를 추가한다.

### 4. 테스트 (먼저 작성)

- `src/lib/words.test.ts`: 올바른 200개 통과, 규칙마다 위반 1건씩 잡아냄(개수, rank 누락·중복, id 불일치, 언어·레벨 불일치, `{{ }}` 0개·2개, 오답 중복, 오답 = 정답, 일본어 reading 없음, 영어 reading 있음, word 중복)
- `src/lib/metrics.test.ts`(spec 7장): D1/D7 한국 날짜 경계(예: 한국 23시 30분 온보딩), 관찰이 끝나지 않은 사용자는 분모 제외, 제외 계정, 온보딩 50명 미만·체험 분모 20명 미만이면 `pending`, 유효한 세션은 done 3턴 이상이면 종료 여부와 무관(2턴은 아님), 3번째 턴이 24시간 뒤면 미완료, 한도 도달 `feature`별 분리, Pro 한도 도달·`trial_eligible` false 도달은 출발점이 아님, 한도 도달 없이 체험한 사용자도 Pro 관심 분모에 포함, `launchDate` 모집 기간 밖 사용자 제외
- `scripts/generate-words.test.ts`: 가짜 생성 결과로 검증된 JSON을 씀(rank·id 순서), 잘못된 항목·중복을 버리고 추가 요청, 호출 상한 초과 시 파일 안 씀, 기존 파일이 있으면 실패, `--model`이 생성 요청에 전달됨, 인자 누락 시 사용법 출력과 실패
- `scripts/seed-words.test.ts`: 올바른 파일들 → upsert 행이 파일 내용과 같음, 파일 하나라도 잘못되면 upsert 호출 없음, 파일 이름과 내용의 언어·레벨 불일치, 파일 없음
- `scripts/metrics-report.test.ts`: 가짜 행 → 출력 줄에 분자/분모, 제외 목록 문자열 파싱, `--launch` 전달, 분모 0 표시

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
grep -q '"seed:words"' package.json && grep -q '"words:generate"' package.json && grep -q '"metrics"' package.json
! grep -rnE "services/supabase/admin|services/claude/client" scripts src/lib
! grep -rnE "claude-(haiku|sonnet|opus)" scripts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`scripts/`의 `main(deps)`, 계산 규칙은 `src/lib/`)
   - ADR-008(단어 미리 생성, 검수 후 커밋), ADR-009(지표는 로컬 스크립트, 분자/분모 출력)를 따르는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`src/lib/`에 I/O·환경변수·fetch 없음, secret에 `NEXT_PUBLIC_` 없음)
3. 결과에 따라 `phases/1-data/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (lib export, 스크립트 사용법과 npm script 이름 포함)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실제 Anthropic API를 부르거나 `data/words/*.json`을 만들지 마라. 이유: 비용·API 키가 필요하고, 결과는 사람이 검수해야 한다. 단어 생성은 사용자가 나중에 실행한다.
- 실제 DB에 seed하거나 지표 스크립트를 실제 DB에 돌리지 마라. 이유: 이 step의 검증은 가짜 deps 단위 테스트다.
- scripts에서 `src/services/supabase/admin.ts`나 `src/services/claude/client.ts`를 import하지 마라. 이유: `server-only`라서 Next 밖에서 import하면 throw한다.
- `src/lib/`에서 파일·네트워크·환경변수에 접근하지 마라. 이유: CLAUDE.md. lib는 순수 함수만 둔다.
- 이미 있는 단어 파일을 덮어쓰지 마라. 이유: 사람이 검수한 데이터가 사라진다.
- 기존 테스트를 깨뜨리지 마라
