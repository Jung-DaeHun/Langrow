# Step 3: chat-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/ui.md`
  - "입력"(placeholder 문장, `aria-label`)
  - "대화 말풍선" 표 전체: "대화 안내"·"AI 말풍선"·"번역"·"한글 발음"·"교정"·"문장 뜯어보기"·"음성 재생"·"응답 대기" 행
- `docs/spec/chat.md` "대화 진행" 3~4번, "문장 뜯어보기"의 "대상과 위치"와 마지막 문장(대화 기록·`aria-live`)
- `docs/UI_GUIDE.md` "학습 화면 (spec 반영, 프로토타입과 다른 부분 포함)" 목록
- `docs/spec/testing.md` 컴포넌트 항목의 "대화 안내 줄"과 "문장 뜯어보기"
- 이전 step에서 만든 코드:
  - `src/lib/breakdown.ts`(`Breakdown`), `src/lib/scenarios.ts`(`ScenarioLine.breakdown`)
  - `src/server/db/reads.ts`(`ChatTurnView.replyBreakdown`), `src/services/claude/schemas.ts`(`TurnReply`의 `reply_breakdown`·`correction.breakdown`)
  - `src/components/Furigana.tsx`(step 2, 모든 레벨·가타카나 루비), `src/lib/levels.ts`
- 기존 코드: `src/components/ChatRoom.tsx`(`AiBubble`, 교정 카드, `TurnAnnouncement`, 입력창)와 `ChatRoom.test.tsx`(도우미 `turn`·`room`·`setup`·`replied`·`ON_SCREEN`·`isBefore`), `src/app/(app)/chat/[id]/page.tsx`(첫 마디 `ScenarioLine`을 통째로 넘긴다)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

대화 개선 phase의 마지막 step이다. step 0~2에서 뜯어보기가 저장·응답되고(첫 마디는 `scenarios.ts`), 후리가나가 모든 레벨에 붙었다. 이 step은 대화방 화면 세 가지를 바꾼다. (1) 맨 위 안내 줄로 한국어 입력과 번역 보기를 알리고 입력창 placeholder를 지운다. (2) AI 말풍선(첫 마디 포함)과 교정 카드에 [문장 뜯어보기] 토글과 조각 타일을 둔다. (3) 중급 이상 말풍선은 버튼 안에 버튼을 넣을 수 없어서 구조를 바꾼다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. 대화 안내 줄과 입력창

- 메시지 목록 맨 위(첫 마디 말풍선 위) 가운데에 `text-micro text-ink-muted text-center`로 쓰고, 아래에 좁은 구분선(`border-t border-line`, 가운데 정렬)을 둔다.
- 문구는 "한국어로 말해도 괜찮아요"다. 중급 이상(`!opensTranslationByDefault(level)`)이면 그 아래에 "누르면 번역이 나와요"를 더한다. 영어·일본어 같은 문구다.
- 닫기 버튼 없이 늘 보이고, 메시지와 함께 스크롤된다.
- 입력창의 `placeholder`를 지운다. `aria-label="메시지 입력"`은 남긴다.
- `src/lib/levels.ts`에서 `allowsKoreanInput`을 지우고 `levels.test.ts`를 맞춘다. 내 변경으로 쓰이지 않게 된 import(`LANGUAGE_NAMES` 등)도 지운다.

### 2. 문장 뜯어보기 (ChatRoom.tsx 안의 컴포넌트. 대화방에서만 쓴다)

```tsx
// 토글과 타일. 값이 없으면(null·undefined·빈 배열) 아무것도 그리지 않는다
function BreakdownToggle(...)   // 이름·나누는 방식은 정해도 된다
```

- **토글**: `<button type="button" aria-expanded>` "문장 뜯어보기", `text-xs font-semibold text-accent` + ChevronDown 14px(열리면 ChevronUp, `aria-hidden`). 처음에는 닫혀 있다. 열림 상태는 저장하지 않는다.
- **타일**: `flex flex-wrap gap-1.5`로 문장 순서대로 잇는다. 타일 하나는 `rounded-lg bg-page px-2 py-1 text-center`이다(교정 카드 안은 `bg-card/70`).
  - 위: 조각. `text-sm font-semibold text-brand`, 학습 언어 `lang`. 일본어는 `<Furigana show>`로 그린다.
  - 아래: 뜻. `text-xs text-ink-muted`.
  - 한글 발음은 넣지 않는다.
- 값이 없는 문장(기능 전 턴, 검사 실패)에는 토글을 두지 않는다.

### 3. AI 말풍선 (`AiBubble`, 첫 마디 포함)

```tsx
function AiBubble({ line, language, level }: {
  line: { text: string; ko: string; pronKo?: string | null; breakdown?: Breakdown | null };
  language: Language; level: Level;
})
```

- 첫 마디는 `scenario.opening`을 그대로 넘기고(`breakdown`이 함께 간다), 턴은 `breakdown: t.replyBreakdown`을 넘긴다. 이 화면에서 받은 턴(`added`)도 같다.
- **입문·초보** (번역이 항상 펼쳐져 있다):
  - 말풍선 `div`에 문장 → 발음 → 번역을 두고, 뜯어보기를 열면 번역 아래에 구분선(`border-t border-line`)과 타일을 둔다.
  - 말풍선 아래 메타 줄에는 뜯어보기 토글만 혼자 둔다(값이 있을 때). 그 아래에 재생 버튼을 둔다.
- **중급 이상**:
  - 말풍선 `div` 안에서 문장·발음·번역 부분만 번역 토글 `<button aria-expanded>`로 만든다. 문장을 누르면 번역(과 발음)이 열린다.
  - 타일은 그 버튼 **밖**, 말풍선 안에 둔다. 번역 아래, 번역이 닫혀 있으면 문장 아래에 구분선과 함께 둔다.
  - 말풍선 아래 메타 줄에는 "번역"(Languages 14px + `text-xs font-semibold text-accent`)을 같은 번역 상태를 여닫는 `<button aria-expanded>`로 두고, 그 오른쪽에 뜯어보기 토글을 둔다. 그 아래에 재생 버튼을 둔다.
- 버튼 안에 버튼을 넣지 않는다. 타일 영역을 눌러도 번역이 열리거나 닫히지 않는다.
- 한글 발음 규칙(입문·초보는 늘, 중급은 번역과 함께)은 그대로다.

### 4. 교정 카드

- 순서는 라벨 → 고친 문장 → 한글 발음 → 재생 버튼 → 뜯어보기 토글과 펼친 타일(`correction.breakdown`이 있을 때, 타일 `bg-card/70`) → 설명이다.
- 카드는 늘 펼쳐 두고 뜯어보기만 접는다.

### 5. 바꾸지 않는 것

- 새 턴 알림(`TurnAnnouncement`, `aria-live`)에는 뜯어보기를 넣지 않는다.
- 종료 피드백(`ChatFeedback`)에는 뜯어보기를 두지 않는다.

### 6. 테스트 (`docs/spec/testing.md` 컴포넌트)

- 안내 줄은 입문·초보 1줄, 중급 이상 2줄이다. 입력창에 placeholder가 없다.
- 문장 뜯어보기:
  - 처음에는 닫혀 있고, 눌러 열고 닫는다(`aria-expanded`). 첫 마디, 저장된 턴, 이 화면에서 받은 턴 모두 해당한다.
  - 중급 이상 말풍선에서 타일을 눌러도 번역이 바뀌지 않는다. 문장을 누르거나 메타 "번역"을 누르면 번역이 열린다.
  - 값이 없으면 토글이 없다.
  - 교정 카드에서는 설명 위에 펼친다(`isBefore`).
  - `aria-live` 영역에 조각 뜻이 들어가지 않는다.
- 기존 테스트가 말풍선 버튼을 찾는 방법(이름·역할)이 구조 변경으로 달라지면 의도는 그대로 두고 찾는 방법만 맞춘다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -rn "allowsKoreanInput" src
! grep -n "placeholder" src/components/ChatRoom.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가? (UI는 `@theme` 토큰 클래스만, 아이콘은 lucide-react)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, AI 출력은 텍스트로만)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `ui.md` "입력"의 placeholder 문장, "대화 말풍선" 표의 "대화 안내"·"번역"·"교정"·"문장 뜯어보기"·"음성 재생"·"응답 대기" 행, `chat.md` "문장 뜯어보기"의 "대상과 위치"와 마지막 문장, `UI_GUIDE.md` "학습 화면" 목록이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/7-chat-improve/step3-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(바꾼 구조, 컴포넌트 이름, 지운 함수). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `<button>` 안에 `<button>`을 넣지 마라. 이유: HTML에서 허용되지 않고, 낭독기와 클릭이 안쪽 버튼을 제대로 다루지 못한다. 그래서 중급 이상 말풍선 구조를 바꾼다.
- 뜯어보기 열림 상태나 안내 줄 닫힘을 `localStorage` 등에 저장하지 마라. 이유: spec은 열림 상태를 저장하지 않고 안내 줄은 늘 보인다.
- 새 턴 알림(`aria-live`)과 종료 피드백에 뜯어보기를 넣지 마라. 이유: spec `chat.md` "문장 뜯어보기".
- 타일에 한글 발음을 넣지 마라. 이유: spec `ui.md` "문장 뜯어보기" 행.
- `Furigana.tsx`·`globals.css`에서 step 2가 고친 루비·줄바꿈 처리를 되돌리지 마라. 이유: 운영에서 나온 넘침·벌어짐 수정이다.
- 서버·프롬프트·`lib/breakdown` 검사를 고치지 마라. 이유: step 0·1에서 끝났다.
- Playwright 같은 새 의존성을 설치하거나 브라우저를 내려받지 마라. 이유: 화면 확인은 phase 뒤 메인 세션이 한다.
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: CLAUDE.md CRITICAL.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
