# Step 2: start-at-level-one

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/ADR.md` ADR-019
- `docs/spec/journey.md`
  - "단계별 저니" ③
  - "홈 구조" 1번(언어·레벨 메뉴)
  - "예외 흐름"의 "언어를 바꿈"·"이미 아는 단계가 있음"·"일본어 입문자가 가나를 못 읽음"·"온보딩 도중 이탈"
  - "화면 목록"의 `/onboarding` 행과 그 아래 "레벨은 언어별로 저장한다" 문단
- `docs/spec/ui.md`
  - "화면별 구성" 표의 `/onboarding` 행
  - "상태 패턴" 표의 "첫날" 행
  - 표 아래 "플랜 카드(계정)" 문단
- `docs/UI_GUIDE.md` "학습 화면"의 온보딩 항목
- `docs/spec/backend.md` "API" 표의 `/api/levels` 행
- `docs/spec/testing.md` "컴포넌트"의 "온보딩" 항목
- 이전 step에서 만든 코드
  - `/api/levels`가 `language`만 받고 레벨 1로 저장한다(step 0)
  - `src/lib/scenarios.ts`: `SCENARIOS_PER_LEVEL`, `FREE_SCENARIOS_PER_LEVEL`
  - `src/lib/errors.ts`: `ONBOARDING_REQUIRED` 문구
- 기존 코드
  - `src/lib/onboarding.ts`(+ test), `src/app/onboarding/page.tsx`
  - `src/components/OnboardingFlow.tsx`(+ test), `src/components/LanguageSheet.tsx`
  - `src/app/(app)/home/page.tsx`(첫날 Notice), `src/app/(app)/account/page.tsx`(플랜 카드)
  - `src/lib/levels.ts`(`LEVEL_INFO`, `showsKana`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

모든 언어를 입문에서 시작한다(ADR-019).
- 온보딩은 동의 → 언어 두 단계다. 언어를 고르고 [학습 시작]을 누르면 입문으로 저장한다.
- 새 언어 추가는 시작 확인 단계 하나다.
- 이미 아는 단계는 레벨업 테스트로 올린다는 문구를 온보딩과 첫날 홈에 둔다.
- 계정 화면 플랜 카드에 상황 개수를 더한다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. 시작 단계 (`src/lib/onboarding.ts`)

```ts
export type OnboardingStart =
  | { kind: "home" }
  | { kind: "consent"; language?: Language }   // 동의 뒤 언어 단계로. language가 있으면 그 언어를 미리 고른다
  | { kind: "language"; language?: Language }  // language가 있으면 미리 고른다
  | { kind: "add"; language: Language };       // 다른 언어 레벨이 있는 사용자의 새 언어: 시작 확인 단계
```

- 미동의면 `consent`이고, 유효한 `language` 파라미터는 지금처럼 넘긴다.
- 동의했고 파라미터 언어에 레벨이 있으면 `home`이다. 전환은 언어 시트가 한다.
- 동의했고 파라미터 언어에 레벨이 없을 때
  - 다른 언어의 레벨이 있으면 `add`
  - 레벨이 하나도 없으면 그 언어를 미리 고른 `language`
- 파라미터가 없으면 지금처럼 준비됐으면 `home`, 아니면 `language`
- 위 주석(spec 참조)과 단위 테스트를 새 동작에 맞춘다.

### 2. 온보딩 화면 (`src/components/OnboardingFlow.tsx`)

spec `ui.md` `/onboarding` 행을 따른다.

- **처음 온보딩**
  - 단계는 동의 → 언어, `n / 2`다.
  - 언어 단계
    - 언어 타일 2개(`role="radio"`)를 누르면 고르기만 한다. 다음 단계로 넘어가지 않는다.
    - 그 아래 안내 문구(`text-sm text-ink-muted`) "모두 입문에서 시작해요. 이미 아는 단계는 레벨업 테스트로 바로 올릴 수 있어요."를 둔다.
    - 오류 안내 아래 [학습 시작](primary `w-full`)은 고르기 전에는 비활성이다.
  - [학습 시작]은 `POST /api/levels`에 `{ language }`만 보낸다(레벨을 보내지 않는다). 성공하면 지금처럼 `router.replace("/home")`이다.
  - 동의 단계에서 [동의하고 계속]을 누르면 언어 단계로 간다. `language`가 있으면 그 언어를 미리 고른 상태다.
  - 언어 단계의 [이전]은 동의 단계로 간다(지금 동작).
- **언어 추가(`add`)**: 시작 확인 단계 하나다.
  - 상단에 [취소] pill(`/home` 링크)을 두고 진행 표시는 없다.
  - 제목은 "{언어 이름}를 시작해요"이고 조사는 언어 이름에 맞춘다. 예: "일본어를 시작해요", "영어를 시작해요".
  - 그 아래 같은 안내 문구, 오류 안내, [학습 시작]을 둔다.
- **레벨 타일 단계는 지운다.** 일본어 가나 안내("가나 익히기 포함" 태그)도 함께 지운다. 홈의 가나 익히기 카드가 대신한다.
- 위 주석("동의 → 언어 → 레벨")을 고친다.

### 3. 언어 시트 (`src/components/LanguageSheet.tsx`)

- 새 언어 링크(`/onboarding?language=…`)는 그대로 둔다.
- 위 주석의 "새 언어는 온보딩 레벨 단계로 보내고"를 "새 언어는 온보딩 시작 확인 단계로 보내고"로 고친다.

### 4. 홈 첫날 안내 (`src/app/(app)/home/page.tsx`)

- 첫날 Notice 설명의 대화 목표 안내 다음 줄에 "모두 입문에서 시작해요. 이미 아는 단계는 레벨업 테스트로 바로 올릴 수 있어요."를 더한다.
- 줄을 나누는 방법(문단 하나 더 등)은 재량이다. Notice 골격과 대화 카드 강조는 바꾸지 않는다.

### 5. 계정 플랜 카드 (`src/app/(app)/account/page.tsx`)

- 한도 줄을 아래처럼 바꾼다.
  - Free: "대화 하루 20턴 · 새 단어 하루 10개 · 상황 레벨마다 3개"
  - Pro: "대화 하루 150턴 · 새 단어 하루 30개 · 상황 레벨마다 7개"
- 숫자는 `PLAN_LIMITS`와 `FREE_SCENARIOS_PER_LEVEL`·`SCENARIOS_PER_LEVEL` 상수에서 가져온다. 숫자를 직접 쓰지 않는다.

### 6. 고아 정리

- 레벨 단계를 지워 쓰지 않게 된 import·상수·상태(`level` state, `LEVELS`, `TAG` 등)는 지운다.
- `LEVEL_INFO`의 `description`이 레벨 타일 말고 쓰이는 곳이 없으면 필드를 지우고 관련 테스트를 맞춘다. grep으로 확인한다.
- `showsKana`는 홈이 쓰므로 둔다.

### 7. 테스트

`docs/spec/testing.md` "컴포넌트"의 "온보딩"을 따른다.

- **lib/onboarding**
  - 미동의(+파라미터)
  - 레벨 없음 + 파라미터는 미리 고른 `language`
  - 다른 언어 레벨 있음 + 새 언어는 `add`
  - 그 언어 레벨 있음은 `home`
  - 준비 완료는 `home`
  - 잘못된 파라미터는 무시
- **OnboardingFlow**
  - 진행 표시가 `1 / 2`·`2 / 2`다.
  - 언어 타일을 눌러도 요청하지 않고 [학습 시작]이 켜진다.
  - [학습 시작]의 요청 body가 `{ language }`뿐이다(`level` 키 없음).
  - 레벨 타일·"가나 익히기 포함"이 없다.
  - 안내 문구가 있다.
  - `add`는 진행 표시 없이 [취소]·제목·안내·[학습 시작]이다.
  - 요청 실패 시 오류 안내가 나오고 이동하지 않는다.
- **홈 첫날 문구, 계정 플랜 카드 문구**: 페이지 테스트가 없으면 문구 확인 테스트를 새로 만들지 않는다. 대신 AC의 grep으로 확인한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -n "레벨을 골라 주세요\|가나 익히기 포함\|STEP_COUNT = 3" src/components/OnboardingFlow.tsx
grep -q "이미 아는 단계는 레벨업 테스트로 바로 올릴 수 있어요" "src/app/(app)/home/page.tsx"
grep -q "SCENARIOS_PER_LEVEL" "src/app/(app)/account/page.tsx"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (시작 단계 규칙은 `lib/onboarding`, 쓰기는 `apiClient`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다.
   - 대상
     - `journey.md` ③·"홈 구조" 1번·예외 흐름 네 행·`/onboarding` 행과 레벨 저장 문단
     - `ui.md` `/onboarding` 행·"첫날" 행·플랜 카드 문단
     - `UI_GUIDE.md` 온보딩 항목
   - step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/8-scenario-unlock/step2-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(시작 단계 종류, 온보딩 단계, 지운 고아). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 레벨 선택 UI를 숨김 처리로 남기거나 `/api/levels`에 레벨을 보내지 마라. 이유: 모두 입문에서 시작한다(ADR-019). 서버도 레벨을 받지 않는다(step 0).
- 언어 타일을 누르는 즉시 `/api/levels`를 부르지 마라. 이유: spec은 고른 뒤 [학습 시작]으로 저장한다(`ui.md` `/onboarding`).
- 서버(`src/server/`, `src/app/api/`, `supabase/`)를 고치지 마라. 이유: step 0의 범위다.
- 상황 목록·레벨업 화면(`ScenarioPicker`, `/chat`, `LevelTestRunner`)을 고치지 마라. 이유: step 1의 범위다.
- 랜딩(`src/app/page.tsx`)을 고치지 마라. 이유: 랜딩은 이 phase 뒤에 따로 다시 만든다.
- 홈의 가나 익히기 카드 조건(`showsKana`)을 바꾸지 마라. 이유: 일본어 입문·초보 안내는 그 카드가 그대로 맡는다(`journey.md` 예외 흐름).
- Anthropic API 같은 외부 API를 부르지 마라. 이유: 유료 호출이고 이 step에 필요 없다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
