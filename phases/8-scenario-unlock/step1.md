# Step 1: scenario-list

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/ADR.md` ADR-019
- `docs/spec/ui.md`
  - "상황 목록 (`/chat`, 2026-10-18 ADR-019)" 절 전체(이 step의 기준)
  - "화면별 구성" 표의 `/chat` 행과 `/level-up` 행(합격 Notice)
  - "칩·태그", "모달 (확인 대화상자)", "선택 타일", "아이콘" 표(`Lock`)
- `docs/spec/journey.md` "예외 흐름" 표의 "위 레벨 상황을 누름"·"Free 사용자가 Pro 상황을 누름"·"체험이 끝난 뒤 Pro 상황 세션" 행
- `docs/spec/chat.md` "대화 진행" 1번(열린 세션 문장)
- `docs/spec/usage.md` "Pro 상황", "체험 종료 후"
- `docs/UI_GUIDE.md` "학습 화면"의 상황 목록 항목, "접근성"
- `docs/spec/testing.md` "컴포넌트"의 "상황 목록" 항목
- 이전 step에서 만든 코드
  - `src/lib/scenarios.ts`: `isProScenario`, `isScenarioLocked`, `SCENARIOS_PER_LEVEL`, `FREE_SCENARIOS_PER_LEVEL`, 순번 함수가 있으면 그것
  - `src/lib/errors.ts`: `PRO_REQUIRED`
- 기존 코드
  - `src/app/(app)/chat/page.tsx`
  - `src/components/ScenarioPicker.tsx`(+ test), `ProButton.tsx`(+ test), `TrialButton.tsx`, `Dialog.tsx`
  - `src/components/LevelTestRunner.tsx`(+ test)
  - `src/lib/plan.ts`: `planAt`, `trialState`
  - `src/lib/levels.ts`: `LEVELS`, `LEVEL_INFO`
  - `src/server/db/reads.ts`: `readOpenSessions`, `readEndedScenarioIds`
  - `src/server/page.ts`: `requireReady`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 0이 서버 규칙을 만들었다.
- 위 레벨 상황은 400을 돌려준다.
- Free의 Pro 상황(레벨마다 4~7번째)은 세션 생성 RPC가 403 `PRO_REQUIRED`를 돌려준다.

이 step은 `/chat` 상황 목록을 레벨 묶음으로 바꾼다. 위 레벨 상황과 Free의 Pro 상황은 화면에서 먼저 안내한다. 레벨업 합격 문구도 바꾼다. 온보딩·홈·계정은 step 2가 한다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. `/chat` 페이지 (`src/app/(app)/chat/page.tsx`)

- 지금 레벨의 상황만이 아니라 **5개 레벨 전체**(`LEVELS` 순서, 입문 → 고수)를 넘긴다.
- **묶음마다**
  - 레벨
  - 레벨 이름
  - 잠김 여부(`level > 지금 레벨`)
  - 상황 7개
- **상황마다**
  - 기존 값: `scenarioId`, 레벨 안 순번, `title`, `goal`, `open`, `completed`
  - 새 값: `pro`(`isProScenario`), `locked`(`isScenarioLocked`)
- 열린 세션과 완료 여부는 지금처럼 `readOpenSessions`·`readEndedScenarioIds`(현재 언어 전체)로 상황 id에 맞춘다.
  - 아래 레벨 상황에 예전 레벨의 열린 세션이 있으면 그 세션을 연다(spec: 그 세션은 만들 때의 레벨로 이어 간다).
- **플랜 상태** 하나를 넘긴다.
  - `"pro"`: `planAt(account.proUntil, now) === "pro"`
  - `"trial-available"`: Free이고 `trialState(...)`가 `available`
  - `"trial-ended"`: 그 밖의 Free
  - 이 값은 표시용이다. 실제 판정은 RPC가 한다.
- 위 문구 `text-sm`은 "영어 · 지금 레벨 중급" 모양으로 바꾼다. 제목과 "오늘 대화 턴 n개 남음 · 한 세션은 최대 20턴"은 그대로다.
- 레벨 묶음을 만드는 규칙이 페이지에 길게 들어가면 `lib/`(예: `lib/scenarios`)의 순수 함수로 빼고 단위 테스트한다.

### 2. "정식 출시 준비 중"을 같이 쓰기 (`src/components/ProButton.tsx`)

- 상황 타일도 `ProButton`과 같은 일을 해야 한다.
  - `pro_clicked` 기록을 결과를 기다리지 않고 보낸다. 실패해도 모달은 연다.
  - "정식 출시 준비 중" 모달을 연다.
- 그래서 기록과 모달을 `ProButton.tsx`에서 꺼내 같이 쓸 수 있게 한다(훅이나 작은 컴포넌트, 이름은 재량).
- `ProButton`의 동작·문구·기존 테스트는 바꾸지 않는다.

### 3. `ScenarioPicker` (`src/components/ScenarioPicker.tsx`)

spec `ui.md` "상황 목록" 절을 그대로 구현한다. 요점은 아래와 같다.

```ts
type Props = {
  language: Language;
  level: Level;                                              // 지금 레벨. 세션 생성 요청에 그대로 보낸다
  groups: Group[];                                           // 입문 → 고수
  access: "pro" | "trial-available" | "trial-ended";
};
```

- **레벨 묶음 머리**
  - `<button>`이고 `aria-expanded`·`aria-controls`를 단다.
  - 내용: 레벨 이름, "상황 7개", 지금 레벨이면 기본 태그 "지금 레벨", 위 레벨이면 `Lock`(접근 이름에 "잠김"), `ChevronDown`
  - 처음에는 지금 레벨 묶음만 펼친다. 묶음마다 따로 열고 닫는다.
- **타일 태그**(여러 개면 이 순서)
  1. 열린 세션: "n턴 진행 중", `ending`이면 "피드백 확인"
  2. 끝낸 세션: "완료"
  3. Pro 상황: 골드 태그 "Pro". Free(`access !== "pro"`)면 태그 안에 `Lock` 12px를 함께 둔다.
  4. 위 레벨 상황: 끝에 `Lock` 16px
  - 태그 줄은 `flex-wrap`이라 좁은 화면에서도 가로로 넘치지 않는다.
  - 접근 이름에 "Pro"·"잠김"이 들어간다.
- **누르면** (위에서 먼저 맞는 것 하나)
  1. 열린 세션이 있으면 그 세션 링크(지금처럼 API를 부르지 않음). Pro 상황이고 체험이 끝났어도 같다.
  2. 위 레벨 상황이면 모달
     - 제목 "레벨업 테스트에 합격하면 열려요"
     - 본문 "지금 레벨보다 높은 상황이에요. 레벨업 테스트로 한 단계씩 올릴 수 있어요."
     - 버튼: [닫기](outline) + [레벨업 테스트 하기](primary, `/level-up` 링크)
     - API를 부르지 않는다.
  3. Pro 상황이고 `access !== "pro"`이면
     - `trial-available`: 모달
       - 제목 "Pro 상황이에요"
       - 본문 "Pro는 레벨마다 상황 7개를 모두 할 수 있어요. 7일 무료 체험으로 써 보세요. 결제 정보는 받지 않아요."
       - 버튼: [닫기](outline) + `TrialButton`(label "7일 무료 체험", primary)
       - `onStarted`에서 모달만 닫는다. 토스트와 `router.refresh()`는 `TrialButton`이 한다. 세션은 만들지 않는다.
     - `trial-ended`: 위 2번에서 꺼낸 기록 + "정식 출시 준비 중" 모달
     - 두 경우 모두 세션 생성 API를 부르지 않는다.
  4. 그 밖에는 지금처럼 `POST /api/chat/sessions`로 세션을 만들고 이동한다.
     - `level`은 지금 레벨이고, 상황 레벨이 아니다.
     - `PRO_REQUIRED`(화면을 연 뒤 체험이 끝남)면 `router.refresh()`를 하고 `trial-ended`와 같은 기록 + 준비 중 모달을 띄운다. 오류 안내는 띄우지 않는다.
       - 이 응답은 타일이 열려 보였던 체험 사용자에게만 나온다. 체험 가능 사용자는 3번에서 막힌다.
     - 그 밖의 오류는 지금처럼 목록 위 오류 안내이고, `CONFLICT`면 `router.refresh()`다.
- 요청 중 모든 타일 비활성화, 이동하는 동안 비활성 유지는 지금 동작을 지킨다.
- 상호작용 요소는 `<button>`·`<a>`(Link)만 쓴다.

### 4. 레벨업 합격 문구 (`src/components/LevelTestRunner.tsx`)

- 합격 보상 Notice의 "새 상황 4개가 열렸어요"를 "{새 레벨 이름} 상황이 열렸어요"로 바꾼다(예: "상급 상황이 열렸어요").
  - 새 레벨은 아래 줄 "이제 {이름} 단어와 상황으로 학습해요"가 쓰는 값과 같다.
  - 개수는 쓰지 않는다.
- [새 상황 보기]는 지금처럼 `/chat`으로 간다.

### 5. 테스트

`docs/spec/testing.md` "컴포넌트"의 "상황 목록"을 따른다.

- **묶음**
  - 묶음 5개 중 지금 레벨만 펼침이다(`aria-expanded`).
  - 다른 묶음을 펼치고 접을 수 있다.
  - 위 레벨 묶음 머리에 잠김 표시가 있다.
- **위 레벨 타일**: 누르면 레벨업 모달과 `/level-up` 링크가 나오고, `fetch`를 부르지 않는다.
- **Free의 Pro 타일**
  - `trial-available`이면 체험 모달이 나오고 세션 API를 부르지 않는다.
  - 체험을 시작하면 모달이 닫힌다.
  - `trial-ended`면 `pro_clicked` 요청과 준비 중 모달이 나오고 세션 API를 부르지 않는다.
- **체험·Pro**
  - 자물쇠 없는 Pro 태그를 단다.
  - 누르면 세션 API를 지금 레벨로 부른다.
- **열린 세션**: 열린 세션이 있는 Pro 타일은 `trial-ended`여도 그 세션 링크다.
- **`PRO_REQUIRED` 응답**: `router.refresh()`를 하고 준비 중 모달이 나온다. 오류 안내는 없다.
- **아래 레벨 타일**: 세션 요청 body의 `level`이 지금 레벨이다.
- **기존 동작**: 기존 `ScenarioPicker` 테스트(열린 세션 링크, 요청 중 비활성, 오류, 409)는 새 props에 맞춰 의도를 유지한다.
- **ProButton**: `ProButton` 테스트는 그대로 통과한다.
- **LevelTestRunner**: 합격 문구가 새 레벨 이름이다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -rn "새 상황 4개" src
! grep -n "scenariosForLevel(level)" "src/app/(app)/chat/page.tsx"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (페이지는 읽기만, 쓰기는 `apiClient` → API, 분기 규칙은 `lib/`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, 구현 경로에 `test` 문자열 없음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다.
   - 대상
     - `ui.md` "상황 목록" 절 전체, `/chat`·`/level-up` 행, 칩·태그의 골드 태그, 모달 "쓰는 곳"
     - `journey.md` 예외 흐름 세 행
     - `usage.md` "체험 종료 후"(Pro 상황 타일의 `pro_clicked`)
   - step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/8-scenario-unlock/step1-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(바꾼 컴포넌트·props 모양, 꺼낸 Pro 모달의 이름, 레벨 묶음 함수). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 화면에서 플랜·잠금으로 막았다고 서버 검사를 빼거나 바꾸지 마라(`src/server/`, `src/app/api/`, `supabase/` 수정 금지). 이유: step 0의 범위이고, spec은 화면과 서버 모두에서 막는다.
- 체험을 시작한 뒤 세션을 자동으로 만들거나 대화방으로 이동하지 마라. 이유: spec은 모달을 닫고 목록을 다시 읽은 뒤 사용자가 타일을 다시 누르게 한다(`ui.md` "상황 목록").
- 열린 세션이 있는 타일을 Pro·잠금 안내로 막지 마라. 이유: 체험 중 시작한 세션은 체험이 끝나도 이어서 할 수 있다(`usage.md` "Pro 상황").
- "정식 출시 준비 중" 문구와 `pro_clicked` 기록을 `ScenarioPicker`에 따로 복사하지 마라. 이유: 문구나 기록 규칙이 두 곳에서 어긋난다. `ProButton.tsx`에서 꺼내 같이 쓴다.
- 남은 대화 턴 수로 타일이나 세션 생성을 막지 마라. 이유: 입력은 서버의 429 뒤에만 막는다(`chat.md` "처리 중단 복구").
- `div onClick` 같은 버튼 아닌 상호작용 요소를 만들지 마라. 이유: UI_GUIDE 접근성.
- 온보딩·홈·계정 화면과 `lib/onboarding`을 고치지 마라. 이유: step 2의 범위다.
- `src/lib/scenarios.ts`의 상황 내용과 순서를 바꾸지 마라. 이유: 사람이 검수를 마쳤다. 순서가 Free/Pro를 정한다.
- 새 애니메이션을 더하지 마라. 펼침 화살표는 transition 없이 방향만 바꾼다. 이유: `ui.md` "애니메이션"은 허용한 것만 쓴다.
- Anthropic API 같은 외부 API를 부르지 마라. 이유: 유료 호출이고 이 step에 필요 없다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
