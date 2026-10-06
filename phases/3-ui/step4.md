# Step 4: chat-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/plan.md`
  - 1장 "예외 흐름"(대화 도중 이탈, 한도 도달, 두 탭 동시 전송, 종료 재요청)
  - 2장 "대화 진행"(1~9), "레벨별 조절" 표와 후리가나, "세션 종료 피드백"(대체 결과 문구)
  - 6-10 "에러 코드"(클라이언트 동작 열), 7장 "컴포넌트" 테스트 항목
- `docs/spec/ui.md`: "입력"(대화 입력창·IME·글자 수·placeholder), "대화 말풍선" 표 전체, "한도 도달 안내", "상태 패턴"(종료 처리 중 202, 인라인 오류), "화면별 구성"의 `/chat`·`/chat/[id]`·"종료 피드백" 행
- step 0~3 산출물:
  - `src/server/page.ts`, `src/server/db/reads.ts`(`readOpenSessions`, `readEndedScenarioIds`, `readChatRoom`, `ChatRoomData`, `ChatTurnView`)
  - `src/services/apiClient.ts`(`api`, `NETWORK_MESSAGE`)
  - `src/components/`: `Furigana`, `WaitingDots`, `LimitNotice`, `Dialog`와 테스트
  - `src/app/globals.css`(집중 모드 `data-focus-mode`), `src/app/(app)/home/page.tsx`
- 앞 phase 산출물:
  - `src/types/api.ts`(`ChatSessionCreated`, `ChatMessageResponse`, `ChatEndResponse`), `src/server/db/chat.ts`(`EndResult`), `src/server/chat.ts`(`END_RETRY_AFTER_SECONDS`)
  - `src/app/api/chat/sessions/**/route.ts`(body·상태 코드)
  - `src/lib/scenarios.ts`(`scenariosForLevel`, `findScenario`, `ScenarioLine`), `src/lib/levels.ts`(`showsFurigana`, `opensTranslationByDefault`, `allowsKoreanInput`, `LANGUAGE_NAMES`), `src/lib/text.ts`(`countChars`, `isValidChatInput`, `CHAT_INPUT_MAX`), `src/lib/today.ts`(`isValidSession`), `src/lib/errors.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

상황 목록(`/chat`)과 대화방(`/chat/[id]`), 종료 피드백을 만든다. 서버의 상태 전이·한도·토큰은 이미 API가 지킨다. 화면은 응답 코드별로 spec 6-10의 클라이언트 동작을 정확히 따른다.

- 대화방과 종료 피드백은 **집중 모드**다. 루트 요소에 `data-focus-mode`를 단다.
- 세션의 언어·레벨은 **세션에 저장된 값**(`ChatRoomData.language`·`level`)을 쓴다. 현재 학습 언어와 다를 수 있다.
- 표시된 남은 사용량으로 입력을 막지 않는다. 서버가 429를 준 뒤에만 막는다(ADR-007, spec 2장).

## 작업

모듈·컴포넌트마다 같은 폴더에 테스트를 먼저 쓴다. 컴포넌트 테스트는 `@/services/apiClient`와 `next/navigation`만 mock한다.

### 1. lib: `src/lib/text.ts`에 추가

```ts
export function hasHangul(s: string): boolean   // 한글 음절·자모가 하나라도 있으면 true
```

교정 라벨에 쓴다. 한국어로 입력했으면 "이렇게 말하면 돼요", 아니면 "이렇게 말하면 더 자연스러워요"다. 테스트는 기존 `text.test.ts`에 추가한다.

### 2. `/chat`: `src/app/(app)/chat/page.tsx` + `src/components/ScenarioPicker.tsx`

**페이지**
- 데이터: `requireReady()`, `loadTodayUsage()`, `readOpenSessions(…, language)`, `readEndedScenarioIds(…, language)`, `scenariosForLevel(level)`.
- 위에서부터:
  - `text-sm` "영어 · 중급 상황"과 제목 "어떤 상황에서 말해 볼까요?".
  - "오늘 대화 턴 n개 남음 · 한 세션은 최대 20턴"(`remaining`).
  - `ScenarioPicker`.

**`ScenarioPicker`** (`"use client"`)

```ts
type Item = {
  scenarioId: string; index: number; title: string; goal: string
  open: { id: string; status: "active" | "ending"; doneTurns: number } | null   // 그 상황의 가장 최근 열린 세션
  completed: boolean                                                            // ended 세션이 있음
}
type Props = { language: Language; level: Level; items: Item[] }
```

- **타일**(모바일 1열, `md` 2열, ui.md "선택 타일" 모양):
  - `text-micro` "상황 n" + 상태 태그, 제목(`text-lead`), 설명(`goal`, `text-sm`).
  - 태그: `active`면 "n턴 진행 중", `ending`이면 "피드백 확인", 열린 세션 없이 `completed`면 "완료"다.
- **열린 세션이 있는 타일**: `/chat/{id}` 링크다. 새 세션을 만들지 않는다.
- **그 밖의 타일**: 버튼이다. 누르면 `api<ChatSessionCreated>("POST", "/api/chat/sessions", { language, level, scenario_id })`를 부른다.
  - 성공: `router.push("/chat/" + sessionId)`.
  - 실패: 목록 위에 오류 Notice(`role="alert"`, 서버 `message`)를 보여 준다. 409(다른 탭에서 레벨이 바뀜)면 `router.refresh()`도 한다.
  - 요청 중에는 모든 타일을 비활성화한다.

### 3. `/chat/[id]`: `src/app/(app)/chat/[id]/page.tsx`

- async `params`의 `id`로 `readChatRoom`을 읽는다. `null`이면 `notFound()`다.
- `findScenario(room.scenarioId)`로 제목과 `roles[room.language].opening`을 꺼낸다. 없으면 throw한다(상황 상수 누락 버그).
- `trial = trialState(…, now)`를 계산해 `<ChatRoom room={room} scenario={{ title, opening }} trial={trial} />`을 그린다.

### 4. `src/components/ChatRoom.tsx` (`"use client"`)

```ts
type Props = { room: ChatRoomData; scenario: { title: string; opening: ScenarioLine }; trial: TrialState }
```

- `room.status !== "active"`면 바로 `ChatFeedback`을 그린다(`ending`이면 `result: null`로 넘겨 다시 확인하게 함).

**상단** (ui.md "대화방 상단")
- 왼쪽: [상황 목록] pill(`/chat`).
- 가운데: 상황 제목(`font-bold`) + `n / 20턴`(`text-micro`, `tabular-nums`, n = 성공 턴 수).
- 오른쪽: [대화 끝내기](outline sm). 전송 중이거나 종료 요청 중에는 비활성화한다.

**메시지 목록** (`aria-live="polite"`, 새 메시지가 오면 맨 아래로 스크롤)
- 첫 마디 AI 말풍선 → 턴마다 내 말풍선 → 교정 카드 → AI 말풍선 순서다.
- **AI 말풍선**:
  - `Furigana show={room.language === "ja" && showsFurigana(room.level)}`, `lang={room.language}`.
  - 번역(`reply_ko`·첫 마디 `ko`): `opensTranslationByDefault(level)`면 항상 펼친다. 아니면 말풍선 전체가 `<button aria-expanded>`이고, 아래 "번역" 메타(Languages 14px)를 탭하면 펼친다.
- **내 말풍선**: `bg-house text-white`, `lang`.
- **교정 카드**: 내 말풍선 바로 아래, 말풍선 밖, 오른쪽 정렬 `bg-mint`.
  - 순서: 라벨(`hasHangul(userText)`로 고름) → 고친 문장(`font-bold text-brand`, `Furigana`, `lang`) → 설명(`text-sm`). 항상 펼쳐 둔다.
  - `correction`이 `null`이면 아무것도 그리지 않는다(배지 없음).
- **응답 대기**: 내 말풍선을 바로 그리고, AI 자리에 `WaitingDots label="응답을 기다리고 있어요"`.

**입력창** (ui.md "입력", sticky 하단, `bg-page`)
- 자동 높이 textarea, 16px 이상.
- placeholder: `allowsKoreanInput(level)`면 "{영어}로 답해 보세요. 한국어도 괜찮아요", 아니면 "{영어}로 답해 보세요"(`LANGUAGE_NAMES`).
- 글자 수(`countChars`)가 250을 넘으면 `n / 300`을 보여 주고, 300을 넘으면 `danger` 굵게 바꾼다.
- 전송 버튼(`aria-label="보내기"`)은 `isValidChatInput`이 아니거나 전송 중이면 비활성화다.
- 키: Enter는 전송, Shift+Enter는 줄바꿈이다. **IME 조합 중(`nativeEvent.isComposing`)의 Enter는 무시**한다.

**전송** (`api<ChatMessageResponse>("POST", "/api/chat/sessions/" + id + "/messages", { text })`)
- 보낼 때 입력창을 비우고 대기 말풍선을 띄운다.

| 결과 | 동작 |
|---|---|
| 200 | 턴을 추가한다. `turnsLeft === 0`이면 이어서 종료를 부르고 입력창을 비활성화한다 |
| 503 `AI_UNAVAILABLE`, `NETWORK`, `INTERNAL` | 보낸 문장을 **실패 말풍선**으로 남긴다. 아래 "실패 말풍선" 참고 |
| 409 `CONFLICT` | 실패 말풍선(서버 `message`) + `router.refresh()`. 새로 받은 `room.turns`를 반영하되 실패 말풍선은 남긴다. 자동으로 다시 보내지 않는다 |
| 429 `LIMIT_REACHED` | 실패 말풍선 + 입력창 자리를 `<LimitNotice feature="chat" trial={trial} onLater={() => router.push("/home")} onTrialStarted={입력창 복구} />`로 바꾼다. [대화 끝내기]는 계속 쓸 수 있다 |
| 429 `AI_FAILURE_LIMIT` | 실패 말풍선 + 입력창 비활성화 + 서버 `message`를 정보 Notice로 |
| 409 `SESSION_FULL` | 종료를 부른다 |
| 404 `NOT_FOUND` | `router.push("/home")` |

- **실패 말풍선**: 말풍선 스타일은 `bg-card text-ink ring-1 ring-inset ring-danger`다.
  - 아래에 CircleAlert + 메시지 + [다시 보내기] pill을 둔다. 메시지는 503이면 서버 `message`("응답을 받지 못했어요. 턴은 차감되지 않았어요."), 네트워크 오류면 `NETWORK_MESSAGE`다.
  - [다시 보내기]는 같은 문장을 다시 보낸다.
  - 실패 말풍선은 하나만 둔다. 새 문장을 보내면 이전 실패 말풍선은 없앤다.
  - 입력이 막힌 동안(429 두 종류)에는 [다시 보내기]도 비활성화한다.
- 401·403은 `api`가 이동시킨다.

**종료** (`api<ChatEndResponse>("POST", "/api/chat/sessions/" + id + "/end")`)

| 결과 | 동작 |
|---|---|
| 200 | `ChatFeedback`으로 바꾼다(`result`) |
| 202 | `ChatFeedback`으로 바꾸고 다시 확인하게 한다(`result: null`) |
| 409 `CONFLICT`(턴 처리 중) 등 실패 | 상단 아래에 오류 Notice(서버 `message`) + [다시 시도]. 자동으로 반복하지 않는다 |

**props 동기화**: `router.refresh()`로 `room`이 바뀌면 화면에 반영한다.
- 확정된 턴 목록은 `room.turns`로 바꾼다.
- `room.status`가 `active`가 아니면(다른 탭에서 종료) `ChatFeedback`으로 바꾼다.

### 5. `src/components/ChatFeedback.tsx` (`"use client"`)

```ts
type Props = {
  sessionId: string; scenarioTitle: string; language: Language
  turns: ChatTurnView[]
  result: EndResult | null      // null이면 종료 처리 중(202)이라 다시 확인한다
}
```

- 루트 `data-focus-mode`, 왼쪽 위 [상황 목록] pill.
- 머리: `text-sm` "{상황 제목} · n턴" + 제목 "대화 피드백".
- **처리 중**(`result === null`): "피드백을 만들고 있어요" + `WaitingDots`.
  - `retryAfterSeconds` 뒤 `/end`를 다시 부른다. 처음에는 2초다(`END_RETRY_AFTER_SECONDS`와 같은 값).
  - 200이면 결과를 그리고, 202면 다시 예약하고, 실패면 오류 Notice + [다시 시도](자동 반복 없음)다.
  - 화면이 보이는 동안(`document.visibilityState === "visible"`)만 확인한다. 숨겨지면 멈추고, 다시 보이면 바로 확인한다. 언마운트되면 타이머를 지운다.
- **ready**:
  - `isValidSession(turns.length)`면 성공 Notice "오늘 대화 목표를 채웠어요", 아니면 정보 Notice "3턴 이상 대화하면 오늘 목표가 채워져요".
  - 카드 "잘한 점"(ThumbsUp, `good`) → 카드 "고칠 점"(Pencil, `improve` 최대 3개, 항목 사이 구분선. 비어 있으면 카드를 생략한다).
  - 피드백 문장은 일반 텍스트로 그린다(후리가나 표기를 요청하지 않는 출력이다).
- **fallback**: 같은 목표 Notice + 정보 Notice로 `feedback.message`(서버 저장 문구 그대로) + 턴별 교정 목록.
  - 교정 목록은 `correction`이 있는 턴만 넣는다: 내 문장 → 고친 문장(`Furigana`, `lang`) → 설명. 없으면 "교정할 문장이 없었어요".
- **skipped**: 피드백 카드·Notice 없이 버튼만 둔다.
- **버튼**: [다른 상황 고르기](primary, `/chat`) + [홈으로](outline, `/home`).

### 6. 테스트 (먼저 작성)

**`ScenarioPicker`**
- 열린 세션 타일은 링크이고 API를 부르지 않는다.
- 새 타일 → body `{ language, level, scenario_id }` → `/chat/{id}`로 이동.
- 실패 → 오류 표시, 409면 refresh.
- 태그 3종.

**`ChatRoom`**
- 표시:
  - 첫 마디와 턴 순서.
  - `correction: null`이면 교정 카드 없음. 한글 입력이면 "이렇게 말하면 돼요".
  - 레벨 1·2는 번역 펼침, 레벨 3은 `aria-expanded` 토글.
  - 일본어 레벨 3은 `<ruby>` 있음, 레벨 4는 없음.
- 입력:
  - IME 조합 중 Enter는 전송하지 않고, Enter는 전송하고, Shift+Enter는 전송하지 않는다.
  - 251자 → 카운터 표시, 301자 → `danger`와 전송 비활성화.
- 전송 결과:
  - 전송 중 대기 점 → 200이면 턴 추가.
  - 503 → 실패 말풍선, 문장 보존, [다시 보내기]가 같은 문장을 보냄.
  - 429 `LIMIT_REACHED` → `LimitNotice`, [대화 끝내기]는 활성, 체험 시작 콜백 후 입력창 복구.
  - `AI_FAILURE_LIMIT` → 입력 비활성화와 문구.
  - `turnsLeft: 0` → `/end` 자동 호출. `SESSION_FULL` → `/end`.
- 종료 결과:
  - `/end` 202 → 처리 중 화면.
  - `/end` 409 → 오류 표시, 자동 재호출 없음.
- 처음 렌더에서 입력창이 막혀 있지 않다(남은 사용량을 받지 않음).

**`ChatFeedback`**
- ready·fallback(저장된 턴 교정 표시)·skipped 표시.
- `result: null` → 가짜 타이머로 2초 뒤 `/end` 재확인, 202면 다시 예약, 200이면 결과 표시.
- 숨김 상태에서는 확인하지 않음.
- 언마운트 후 호출 없음.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -rn "dangerouslySetInnerHTML" src
! grep -rn "getSession(" src --include=*.ts --include=*.tsx
! grep -rnE "(bg|text|border|ring|fill|stroke|from|to)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}" src/app src/components
! grep -rnE "backdrop-blur|bg-gradient|bg-linear|bg-radial|animate-(pulse|bounce|spin|ping)" src/app src/components
! grep -rnE "#[0-9a-fA-F]{3,8}\b" src/app src/components --include=*.tsx | grep -v "GoogleLoginButton"
for f in $(find src/components -name "*.tsx" ! -name "*.test.tsx"); do [ -f "${f%.tsx}.test.tsx" ] || { echo "테스트 없음: $f"; exit 1; }; done
grep -q "isComposing" src/components/ChatRoom.tsx && grep -q "data-focus-mode" src/components/ChatRoom.tsx && grep -q "data-focus-mode" src/components/ChatFeedback.tsx
test -f "src/app/(app)/chat/page.tsx" && test -f "src/app/(app)/chat/[id]/page.tsx"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md "상태 관리"를 따르는가? (진행 중인 입력·회차만 `useState`, 서버 상태는 페이지에서 읽고 `router.refresh()`로 다시 읽음)
   - UI_GUIDE: 교정은 빨강이 아닌 민트, 빨강은 전송 실패에만, 대기 표시는 점 3개 하나, 반복 애니메이션은 대기 점만
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (AI 출력은 텍스트로만, 후리가나는 `<ruby>` 요소, `dangerouslySetInnerHTML` 없음)
3. 결과에 따라 `phases/3-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 만든 컴포넌트·props, 응답 코드별 화면 동작을 넣는다
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 표시된 남은 사용량이나 클라이언트 계산으로 입력·전송을 막지 마라. 이유: 만료된 pending이 표시 사용량에 남을 수 있어서 서버의 429 뒤에만 막는다(ADR-007).
- 실패한 전송·종료를 자동으로 다시 보내지 마라(`CONFLICT` 포함). 이유: spec 6-10과 ui.md "인라인 오류". 202의 재확인만 예외다.
- AI 출력(reply, 번역, 교정, 피드백)을 HTML로 넣지 마라. 이유: XSS(보안 체크리스트 7). 후리가나는 `Furigana`의 `<ruby>` 요소로만 그린다.
- 대화 내용을 `localStorage`·`console`에 남기지 마라. 이유: 로그의 개인정보 금지(보안 체크리스트 10)와 회차 이어하기 MVP 제외.
- 응답 스트리밍이나 타이핑 효과를 만들지 마라. 이유: 스트리밍은 MVP 제외이고, 대기 표시는 점 3개 하나다.
- pending 턴을 화면에 그리거나 폴링하지 마라. 이유: 페이지는 done 턴만 읽는다. 처리 중인 턴은 서버가 409로 알려 주고, 기한이 지나면 다음 요청에서 복구한다.
- 대화 1턴과 종료를 한 요청으로 합치지 마라. 이유: spec 2장 5번(`turnsLeft: 0`을 받은 뒤 클라이언트가 `/end`를 부른다).
- step 0~3의 공용 모듈·컴포넌트 동작을 바꾸지 마라. 이유: 다른 화면이 그 계약을 쓴다. 꼭 필요하면 테스트와 함께 고치고 summary에 적는다.
- 기존 테스트를 깨뜨리지 마라
