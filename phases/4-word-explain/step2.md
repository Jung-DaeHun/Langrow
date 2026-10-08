# Step 2: explain-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/superpowers/plans/2026-10-08-word-explanation.md`: "Global Constraints", "Review Focus", "### Task 4: 화면 — `WordExplanation`과 빈칸·복습 카드 연결" 전체. **이 step은 Task 4만 한다.** Step 12(문서 맞추기)는 이미 반영돼 있어 건너뛴다.
- `docs/spec/ui.md`
  - "AI 정답 설명 (빈칸 퀴즈·오답 복습 카드)"
  - "빈칸 퀴즈 (단어 학습·레벨업 공용)", "플래시카드"
  - "버튼", "안내 (Notice)", "한도 도달 안내"
  - "공용 React 컴포넌트와 이유"의 `WordExplanation` 행
- `docs/spec/words.md` "AI 정답 설명"의 "위치", "요청 단위", "화면 상태"
- `docs/spec/testing.md` 컴포넌트 테스트의 "AI 정답 설명" 항목
- step 1 산출물: `src/types/api.ts`(`WordExplainResponse`), `src/server/learning.ts`(`EXPLAIN_UNAVAILABLE_MESSAGE`, `EXPLAIN_FAILURE_LIMIT_MESSAGE` — 화면은 서버 `message`를 그대로 보여 주므로 import하지 않는다)
- step 0 산출물: `src/lib/plan.ts`(`FREE_DAILY_EXPLANATIONS`)
- 기존 코드(구현 파일과 같은 폴더의 `*.test.tsx`):
  - `src/components/WordSession.tsx`(`start()`, `trial`, `trialStarted`, `furigana`, 회차 phase)
  - `src/components/BlankQuiz.tsx`, `Flashcard.tsx`, `TrialButton.tsx`, `ProButton.tsx`
  - `src/components/LimitNotice.tsx`(보상·정보 Notice 모양), `Furigana.tsx`, `WaitingDots.tsx`
  - `src/services/apiClient.ts`(`api`, `ApiResult`, `NETWORK_MESSAGE`), `src/lib/plan.ts`(`TrialState`)
  - `src/components/LevelTestRunner.tsx`(레벨업 테스트에서 `BlankQuiz`를 test 모드로 쓰는 곳. 바꾸지 않는다)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

`POST /api/words/explain`(step 1)을 화면에 연결한다. body는 `{ word_id, choice? }`이고 응답은 `{ explanation }`이다. 실패 코드별 응답은 다음과 같다.

- 429 `LIMIT_REACHED`: 공용 문구
- 429 `AI_FAILURE_LIMIT`: 설명용 문구
- 503 `AI_UNAVAILABLE`: 설명용 문구
- 400, 404, 500
- 네트워크 실패: `apiClient`가 `NETWORK`와 `NETWORK_MESSAGE`로 돌려준다.

공용 컴포넌트 `WordExplanation`이 버튼 → 대기 → 설명/오류/한도 상태를 그리고, 빈칸 퀴즈와 오답 복습 카드가 같이 쓴다. 429 안내는 회차 전체에 걸리므로 상태를 `WordSession`이 들고 있다.

계획 Task 4에 테스트와 코드가 이미 다 있다. 그대로 따르되, 계획의 코드가 실제 코드와 다르면 실제 코드에 맞추고 아래 핵심 규칙은 지켜라.

## 작업

계획 Task 4의 Step 1~11, 13을 순서대로 한다. Step 12(문서)와 Step 14(Commit)는 하지 말고, 커밋은 이 프롬프트의 작업 규칙대로 한다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다. 새 파일 `WordExplanation.tsx`는 같은 폴더의 `WordExplanation.test.tsx`를 먼저 만든다(TDD guard).

만들거나 바꿀 인터페이스:

```tsx
// TrialButton·ProButton props에 추가 (기본 primary, ProButton 모달의 [확인]은 primary 그대로)
tone?: "primary" | "outline"
// src/components/WordExplanation.tsx ("use client")
export type ExplanationBlock = { kind: "limit" } | { kind: "failure-limit"; message: string }
export function WordExplanation(props: {
  wordId: string; choice?: string; label: string; showFurigana: boolean; trial: TrialState;
  block: ExplanationBlock | null; onBlock: (block: ExplanationBlock) => void; onTrialStarted: () => void;
})
// BlankQuiz props에 추가: learn 모드에서 채점 뒤에만, 결과 문구와 [다음 문제] 사이에 그린다
explanation?: (choice: string) => ReactNode
// Flashcard props에 추가: 뒷면을 볼 때만 카드와 버튼 사이에 보인다
revealed?: ReactNode
```

### 지켜야 할 핵심 규칙

- **위치**
  - 단어 학습 빈칸에서는 채점 뒤 정답·오답 모두 [왜 정답이에요?]를 두고, 고른 보기를 `choice`로 보낸다.
  - 오답 복습 카드는 뒤집은 뒤에만 [예문 설명]을 두고, `choice` 없이 보낸다.
  - 오늘의 학습 플래시카드, 가나 카드, 레벨업 테스트에는 두지 않는다. `BlankQuiz`의 test 모드는 `explanation`을 그리지 않는다.
- **요청 한 번**
  - 문제(카드)마다 한 번만 요청한다. 누르면 바로 대기 상태로 바꿔 두 번 빠르게 눌러도 요청은 한 번이다.
  - 설명을 받으면 버튼을 다시 보여 주지 않는다.
- **늦은 응답**: 기다리는 중에 다음 문제·카드로 넘어가 컴포넌트가 사라지면, 도착한 응답은 429여도 버린다(`onBlock`을 부르지 않는다).
- **회차 단위 429**
  - `LIMIT_REACHED`·`AI_FAILURE_LIMIT`를 받으면 `WordSession`의 상태에 저장한다. 그 회차의 남은 문제·카드에서도 버튼 대신 같은 안내를 보여 준다.
  - 새 회차를 시작하거나 한도 안내에서 7일 체험을 시작하면 상태를 풀어 다시 버튼을 보여 준다.
  - 이미 받은 설명은 뒤에 안내가 생겨도 그대로 둔다.
- **복습 카드**: 앞면으로 돌리면 설명 영역을 숨기기만 하고 언마운트하지 않는다. 기다리던 요청과 받은 설명이 남아야 한다. 다시 누르면 또 차감되기 때문이다.
- **실패**
  - 503, 네트워크, 400, 404, 500은 그 자리의 오류 Notice(`role="alert"`, 서버 `message`)와 [다시 시도] pill로 보여 준다. 다시 시도하면 같은 body로 요청한다. 404여도 홈으로 이동하지 않는다.
  - 401·403 이동은 `apiClient`가 이미 한다.
- **문구는 ui.md 그대로다.**
  - 버튼: [왜 정답이에요?], [예문 설명]
  - 설명 카드 라벨: "AI 설명"
  - 한도 안내: "오늘 AI 설명 10회를 모두 썼어요"(10은 `FREE_DAILY_EXPLANATIONS`) + "Pro는 AI 설명을 제한 없이 볼 수 있어요."
  - 한도 안내 버튼: 체험 가능하면 [7일 무료 체험], 체험을 썼으면 [Pro 시작하기]. 둘 다 outline sm이다.
  - [내일 할게요]는 두지 않는다. 회차의 primary는 [다음 문제]다.
  - `AI_FAILURE_LIMIT`는 서버 `message`를 정보 Notice로 보여 주고 버튼을 두지 않는다.
- **그리기**
  - 대기는 `WaitingDots`이고, 대기·설명은 처음부터 있는 `aria-live="polite"` 영역 안에 둔다.
  - 설명은 `rounded-xl bg-mint p-3` 안에 텍스트로만 그린다. 일본어 `[漢字|かな]` 표기는 `Furigana`로, `WordSession`의 레벨 규칙(`furigana`)대로 그린다. 후리가나를 숨기는 레벨이면 루비 없이 글자만 보인다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -rn "dangerouslySetInnerHTML" src
test -f src/components/WordExplanation.test.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (공용 컴포넌트는 `src/components/`, API 호출은 `services/apiClient`의 `api()`만)
   - ADR 기술 스택을 벗어나지 않았는가? (Tailwind 토큰·ui.md 클래스, lucide-react 아이콘)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, AI 출력은 텍스트와 `<ruby>`로만, 브라우저에서 Supabase 직접 쓰기 없음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `ui.md` "AI 정답 설명" 표의 상태 6개와 아래 두 줄, "플래시카드"·"빈칸 퀴즈"의 설명 문장, `words.md` "요청 단위"·"화면 상태"다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/4-word-explain/step2-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(바꾼 컴포넌트 props, 회차 단위 429 상태가 어디 있는지). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: CLAUDE.md CRITICAL. AI 설명은 텍스트와 `Furigana`의 `<ruby>`로만 그린다.
- 설명 버튼을 primary로 만들지 마라. 한도 안내에 [내일 할게요]도 넣지 마라. 이유: ui.md. 회차의 primary는 [다음 문제]·[알아요]이고, 설명은 보조 행동이다.
- `LimitNotice`를 고쳐 설명 한도 안내에 재사용하지 마라. 이유: 문구·버튼 구성(outline, [내일 할게요] 없음)이 다르고, 홈·단어 화면의 기존 안내가 바뀐다.
- `LevelTestRunner`에서 `BlankQuiz`에 `explanation`을 넘기지 마라. 이유: spec `words.md`. 레벨업 테스트에는 설명을 두지 않고 정답도 보여 주지 않는다.
- 복습 카드를 앞면으로 돌릴 때 설명 영역을 언마운트하지 마라. 이유: 기다리던 요청과 받은 설명이 사라지고, 다시 누르면 또 1회 차감된다.
- API·use-case·DB를 고치지 마라. 이유: step 0·1의 범위다. 부족하면 고치지 말고 `error_message`에 적는다.
- 문서(`docs/`)를 고치지 마라. 이유: 이 phase를 시작하기 전에 이미 맞췄다.
- 기존 테스트를 깨뜨리지 마라
