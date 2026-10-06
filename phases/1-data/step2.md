# Step 2: db-learning

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 1장 "연속 학습일"(갱신 시점), "지표 수집"(`limit_reached`, `kana_studied`, `level_test_submitted`, `pro_clicked`)
  - 3장 "오늘의 학습" 4~6번(저장 RPC 규칙), "오답 복습", 3-1장 "기록"
  - 4장 "레벨업 테스트" 전체
  - 5장 "세는 방법"(단어 사용량은 `first_seen_at` 기준)
  - 6-3 "데이터 접근과 보안", 6-4 API 표의 `/api/words/*`·`/api/level-up`·`/api/events`
  - 7장 "use-case"의 단어·학습·지표 항목, "DB 통합 테스트"의 단어·활동일 항목
- step 0·1 산출물:
  - `supabase/migrations/*_schema.sql`(helper `kst_today`·`check_readiness`·`record_activity`, 함수 규칙), `*_chat.sql`(한도 판정과 `limit_reached` 기록 방식)
  - `src/server/db/{types,rpc,account,chat}.ts`와 테스트, `src/test/db.ts`
- phase 0 산출물: `src/lib/plan.ts`(`PLAN_LIMITS`), `src/lib/wordBatch.ts`(`BATCH_MAX`, `wordStatus`), `src/lib/levelTest.ts`, `src/lib/blank.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라. step 0의 함수 규칙(SECURITY INVOKER, `search_path`, service_role 전용 EXECUTE, jsonb 응답, 예상된 거부는 반환, profiles 먼저 `FOR UPDATE`)을 이 step의 모든 함수에 그대로 적용한다.

## 배경

규칙이 나뉘는 곳:
- **SQL**: 잠금, 중복 제외, 한도, 레벨 변경 조건, 활동일·연속일
- **2-api use-case(TS)**: known/review 결정(`lib/wordBatch`의 `wordStatus`), 레벨업 채점(`lib/blank`·`lib/levelTest`), 시험 단어 20개 검증. 그래서 RPC는 판정이 끝난 값(`status`, `score`, `passed`)을 받는다.

## 작업

### 1. 마이그레이션: `npx supabase migration new learning`

이전 마이그레이션 파일은 고치지 않는다.

**상수**: Free 하루 새 단어 10개, Pro 30개(`PLAN_LIMITS`), 회차 최대 10개(`BATCH_MAX`), 레벨업 from_level 1~4.

| 함수 | 준비 상태 | 동작 |
|---|---|---|
| `save_word_batch(p_user_id, p_language, p_items jsonb)` | ready + `p_language` | 아래 |
| `save_review(p_user_id, p_language, p_items jsonb)` | ready + `p_language` | 아래 |
| `submit_level_test(p_user_id, p_language, p_from_level, p_score, p_passed)` | ready + `p_language` | 아래 |
| `record_event(p_user_id, p_name)` | ready | `p_name`은 `pro_clicked`·`kana_studied`만(그 밖은 `INVALID_INPUT`). 이벤트 기록(props `{}`). `kana_studied`면 `record_activity`도 |

**`save_word_batch`** — items: `[{ "word_id": text, "status": "known" | "review" }]` (spec 3장 6번)
1. profiles 잠금, 준비 상태 확인
2. items가 1~10개, word_id가 서로 다름, status가 known/review, 모든 단어가 존재하고 `language = p_language`. 아니면 `INVALID_INPUT`. 단어의 레벨은 검사하지 않는다
3. 이미 이 사용자의 `user_words`에 있는 단어를 뺀다. **기존 단어의 상태·날짜는 바꾸지 않는다**
4. 신규가 0개면 한도와 무관하게 `inserted_count: 0`으로 성공. 활동일·연속일·이벤트를 바꾸지 않는다
5. 오늘(한국 날짜) 계정 전체 신규 단어 수(`first_seen_at` 기준, 언어 합산)와 현재 플랜으로 남은 한도를 구한다. 신규 개수가 남은 한도를 넘으면 **하나도 넣지 않고** `limit_reached`(`{ feature: 'words', plan, trial_eligible }`)를 기록한 뒤 `LIMIT_REACHED`
6. 신규 행 삽입(`first_seen_at = updated_at = now()`, `on conflict do nothing`은 보조 방어일 뿐), `record_activity`. 삽입 뒤 오늘 신규 단어 수가 한도와 같아지면 `limit_reached`도 기록한다
7. 실제로 넣은 `inserted_count`를 돌려준다

**`save_review`** — items: `[{ "word_id": text, "knew": boolean }]` (spec 3장 "오답 복습")
1. profiles 잠금, 준비 상태 확인
2. items가 1~10개이고 word_id가 서로 다름. 모든 단어가 이 사용자의 `user_words`에 있고 그 단어의 언어가 `p_language`. 아니면 `INVALID_INPUT`
3. 아직 `review`인 제출 단어만 유효하다. 그중 `knew`가 true면 `known`으로 바꾸고 `updated_at`을 갱신한다. false면 `review`로 둔다
4. 유효한 단어가 1개 이상이면 `record_activity`. 전부 이미 known이면 변경 없이 성공
5. 유효한 단어 수 `reviewed_count`를 돌려준다. 사용량에는 포함하지 않는다

**`submit_level_test`** (spec 4장)
1. profiles 잠금, 준비 상태 확인
2. `p_from_level`이 1~4가 아니거나 `p_score`가 0~20이 아니면 `INVALID_INPUT`
3. 그 언어의 실제 레벨이 `p_from_level`과 다르면 `CONFLICT`. 이벤트도 남기지 않는다
4. `level_test_submitted` 이벤트(`{ language, from_level, score, passed }`)
5. `p_passed`면 `update … set level = from_level + 1 where level = from_level`
6. `record_activity`
7. `passed`와 지금 레벨 `level`을 돌려준다. `user_words`는 바꾸지 않는다

### 2. 타입 재생성

`npx supabase db reset` 뒤 Bash로 `npx supabase gen types typescript --local > src/types/database.ts`.

### 3. `src/server/db/learning.ts`

```ts
import 'server-only'
export async function saveWordBatch(userId: string, language: Language,
  items: { wordId: string; status: 'known' | 'review' }[]): Promise<DbResult<{ insertedCount: number }>>
export async function saveReview(userId: string, language: Language,
  items: { wordId: string; knew: boolean }[]): Promise<DbResult<{ reviewedCount: number }>>
export async function submitLevelTest(userId: string, input: {
  language: Language; fromLevel: Level; score: number; passed: boolean }): Promise<DbResult<{ passed: boolean; level: Level }>>
export async function recordEvent(userId: string, name: 'pro_clicked' | 'kana_studied'): Promise<DbResult<null>>

// 레벨업 채점용. 정답은 use-case가 parseBlank(example).answer로 얻는다
export async function getWordsByIds(ids: string[]): Promise<{ id: string; language: Language; level: Level; example: string }[]>
```
- `getWordsByIds`는 이 프로젝트에서 **유일하게 user_id 범위가 없는 admin 조회**다. `words`는 사용자 소유가 아닌 공용 카탈로그이고, 로그인 사용자 누구나 RLS로 읽을 수 있는 테이블이기 때문이다. 이 이유를 코드 주석으로 남긴다. 없는 id는 결과에서 빠진다.

### 4. 테스트 (`src/server/db/learning.test.ts`, 먼저 작성)

실제 로컬 DB로 검증한다. **테스트용 단어는 테스트가 admin으로 직접 넣고 지운다.** seed 단어와 겹치지 않게 `rank`를 9000 이상으로 하고 id도 그에 맞춘다(예: `en-1-9001`). 기대값은 `PLAN_LIMITS`, `BATCH_MAX`, `LEVEL_TEST_SIZE` 등 lib 상수로 만든다.

- 단어 회차:
  - 신규 저장: 행·status·`first_seen_at`, `inserted_count`, 활동일·연속일 갱신
  - 오늘 한도 0에서 기존 단어 10개 재전송 → 성공, `inserted_count: 0`, 이벤트 추가 없음
  - 전부 기존 단어면 다음 날에도 활동일·연속일이 바뀌지 않음(`last_study_date`를 어제로 바꾸고 오늘 활동일 행이 없는 상태에서 재전송)
  - 기존 + 신규 혼합 → 신규분만 한도 검사, 기존 단어 상태는 그대로
  - 신규분이 남은 한도 초과 → 하나도 저장 안 됨, `LIMIT_REACHED`, `limit_reached` props
  - 한도를 정확히 채우는 저장 → 성공하고 `limit_reached` 기록
  - Pro 한도, 어제(한국 날짜) `first_seen_at`은 오늘 사용량에 안 셈
  - `INVALID_INPUT`: 다른 언어 단어, 없는 단어, 중복 word_id, 11개, 빈 배열, 잘못된 status
  - 그 언어 레벨이 없으면 `ONBOARDING_REQUIRED`
- 동시성(`Promise.all`):
  - 남은 한도 10에서 서로 다른 신규 6개 묶음 2개 → 합계 신규가 한도를 넘지 않음
  - 영어·일본어 회차 동시 저장 → 계정 합산 한도를 넘지 않음
  - 같은 회차 동시 재전송 → 한 번만 삽입(`inserted_count` 합계 = 단어 수)
  - 같은 날 단어 저장과 복습 동시 → 활동일 행 1개
- 복습: knew → known, 나머지 review 유지. 전부 이미 known → 성공하고 활동일 변경 없음. 남의 단어·다른 언어 단어 → `INVALID_INPUT`. 복습만 한 날도 활동일 기록
- 레벨업: 합격 → 레벨 +1, 같은 시험 재제출 → `CONFLICT`이고 레벨 그대로. `Promise.all`로 합격 동시 제출 2번 → 한 번만 오름. 불합격 → 레벨 그대로, 이벤트·활동일 기록. from_level이 실제 레벨과 다름 → `CONFLICT`이고 이벤트 없음. from_level 5 → `INVALID_INPUT`. 테스트만 한 날도 활동일 기록
- 이벤트: `pro_clicked` → 이벤트만(활동일 없음), `kana_studied` → 이벤트 + 활동일, 다른 이름 → `INVALID_INPUT`
- `getWordsByIds`: 넣은 단어를 돌려주고 없는 id는 빠짐
- 권한: 이 step의 모든 함수를 anon·authenticated로 부르면 거부

## Acceptance Criteria

```bash
npx supabase db reset
npx supabase gen types typescript --local | diff -q --strip-trailing-cr - src/types/database.ts   # 생성 타입이 최신
npm run lint
npm run build
npm run test
npm run test:db
! grep -riE "security\s+definer" supabase/migrations
for f in src/server/db/*.ts; do case "$f" in *.test.ts|*/types.ts) ;; *) grep -qE "import ['\"]server-only['\"]" "$f" || { echo "server-only 없음: $f"; exit 1; } ;; esac; done
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR-007(원본 행으로 사용량 계산, 계정 단위, 한국 자정), ADR-008(서버 채점, 레벨 변경은 서버)을 따르는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`getWordsByIds`를 뺀 모든 admin 조회에 user_id, profiles 먼저 잠금, DB 시각 판정)
3. 결과에 따라 `phases/1-data/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 마이그레이션 파일명, RPC 이름, `learning.ts`의 export, 각 함수가 돌려줄 수 있는 에러 코드를 포함한다
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (Docker 꺼짐 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 이전 마이그레이션 파일을 고치지 마라. 이유: 마이그레이션은 추가만 한다.
- known/review 결정이나 채점(정답 비교)을 SQL로 다시 구현하지 마라. 이유: 규칙은 `lib/`에 한 벌만 두고 use-case가 판정한다.
- 신규 단어의 레벨을 검사하지 마라. 이유: spec 3장. 다른 레벨 단어 저장은 본인 손해일 뿐이다.
- 한도를 넘는 회차에서 일부만 저장하지 마라. 이유: spec 3장. 신규분은 전부 저장하거나 하나도 저장하지 않는다.
- 기존 단어 재전송이 활동일·연속일·이벤트·기존 상태를 바꾸게 하지 마라. 이유: 응답 유실 재전송이 지표와 연속일을 부풀린다.
- seed 단어와 겹치는 rank·id로 테스트 단어를 넣거나 seed 단어를 지우지 마라. 이유: 로컬 DB에 seed한 단어가 있을 수 있다.
- `npx supabase stop`을 하지 마라. 이유: 사용자가 이어서 로컬 DB를 쓴다.
- 기존 테스트를 깨뜨리지 마라
