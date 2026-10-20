# Step 3: breakdown-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md` "문장 뜯어보기"의 "대상과 위치"와 "처음 열 때 만들기"의 "화면"
- `docs/spec/ui.md` "대화 말풍선" 표의 "문장 뜯어보기" 줄(이 step의 기준이다)과 "AI 정답 설명" 표(오류 Notice·[다시 시도] pill·정보 Notice 모양)
- `docs/UI_GUIDE.md`의 문장 뜯어보기 줄
- `docs/spec/testing.md` "컴포넌트"의 "문장 뜯어보기" 항목
- `docs/spec/backend.md` "에러 코드"(`NOT_FOUND`·`AI_FAILURE_LIMIT`·`AI_UNAVAILABLE`·`CONFLICT` 줄, 표 아래 클라이언트 래퍼 규칙)
- 기존 코드:
  - `src/components/ChatRoom.tsx`(`AiBubble`, `CorrectionBreakdown`, `BreakdownToggle`, `BreakdownTiles`)·`ChatRoom.test.tsx`
  - `src/components/WordExplanation.tsx`·테스트(대기·오류·[다시 시도]·정보 Notice와 `api()` 호출의 선례)
  - `src/components/WaitingDots.tsx`, `src/services/apiClient.ts`(`api`, `NETWORK_MESSAGE`)
  - step 2 산출물: `src/types/api.ts`의 `ChatBreakdownResponse`, `src/app/api/chat/sessions/[id]/breakdown/route.ts`(body `{ turn_no, target }`), `src/lib/breakdown.ts`의 `BreakdownTarget`

## 배경

문장 뜯어보기를 처음 열 때 그 문장 하나만 만든다(ADR-027). 그래서 새 턴에는 저장된 뜯어보기가 없다. step 2가 `POST /api/chat/sessions/[id]/breakdown`을 만들었다. 이 step은 대화방에서 저장본이 없는 문장에도 토글을 두고, 처음 열 때 이 API를 불러 펼치게 한다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. 어디에 토글을 두나

- **AI 말풍선**: 모든 `done` 턴의 말풍선에 토글을 둔다(`target: "reply"`, 그 턴의 `turnNo`). 저장본이 있으면 지금처럼 API 없이 펼친다.
- **첫 마디**(`scenario.opening`): 지금처럼 `scenarios.ts`의 `breakdown`만 쓴다. API를 부르지 않는다. 값이 없으면 토글을 두지 않는다.
- **교정 카드**: 교정이 있으면 토글을 둔다(`target: "corrected"`). 저장본이 있으면 API 없이 펼친다.
- 메타 줄 배치(입문·초보는 "번역" 메타가 없어 뜯어보기 토글 혼자, 중급 이상은 "번역" 오른쪽)와 타일 위치는 지금과 같다(`ui.md`).

### 2. 처음 열 때

`AiBubble`·`CorrectionBreakdown`이 같이 쓰는 작은 상태(예: `useBreakdown(initial, source)`. `source`는 `{ sessionId, turnNo, target }`이고 첫 마디는 없다)를 만든다. 이름과 모양은 재량이다.

- 저장본이 없는 문장의 토글을 처음 누르면 열린 모양(`aria-expanded="true"`)이 된다. 그리고 `api<ChatBreakdownResponse>("POST", "/api/chat/sessions/${sessionId}/breakdown", { turn_no, target })`를 부른다.
- 기다리는 동안 타일 자리에 `WaitingDots`를 `aria-live="polite"` 영역 안에 두고, 토글은 `disabled`다.
- 받으면 타일을 그린다. 받은 값은 화면 상태에 두어, 닫았다 다시 열어도 API를 다시 부르지 않는다.
- 실패:
  - `AI_FAILURE_LIMIT`: 정보 Notice로 서버 `message`만 보여 준다. 버튼은 없다.
  - 그 밖의 모든 실패(`AI_UNAVAILABLE`, 만드는 중 `CONFLICT`, `NOT_FOUND`, `NETWORK`, `INTERNAL`, 400): 타일 자리에 AI 정답 설명과 같은 오류 Notice(서버 `message`, 네트워크는 `NETWORK_MESSAGE`)와 [다시 시도] pill을 둔다. [다시 시도]를 누르면 다시 부른다.
  - 토글을 닫으면 오류·안내를 지운다. 다시 열면 다시 부른다.
- 어느 경우에도 대화 입력을 막지 않고, 대화방을 다시 읽지(`router.refresh`) 않는다. 404여도 홈으로 이동하지 않는다. 401·403 이동은 `api()` 래퍼가 하던 대로 둔다.
- 기다리는 중에 화면이 다시 그려져(새 턴, `router.refresh`) props가 바뀌어도, 받은 값이나 진행 중인 상태를 잃지 않게 한다. 다시 읽은 데이터에 저장본이 오면 그것을 써도 된다.

### 3. 테스트 (`src/components/ChatRoom.test.tsx`)

`docs/spec/testing.md` "컴포넌트"의 "문장 뜯어보기" 문장을 모두 쓴다. 기존 항목인 처음 닫힘, `aria-expanded`, 말풍선 타일을 눌러도 번역이 바뀌지 않음, 교정 카드에서 설명 위에 펼침은 유지한다. 다음을 더한다.
- 값이 없어도 토글이 있다.
- 처음 누르면 `turn_no`·`target`으로 API를 부르고, 대기 표시(점 3개)가 보이고 토글이 `disabled`다. 응답이 오면 펼친다.
- 받은 뒤 닫았다 다시 열면 API를 다시 부르지 않는다. 값이 있으면 처음부터 API를 부르지 않는다. 첫 마디는 API를 부르지 않는다.
- 실패하면 오류와 [다시 시도]가 보이고, 누르면 다시 부르고, 닫으면 지워진다. 409(만드는 중)도 같다.
- `AI_FAILURE_LIMIT`이면 안내만 보이고 버튼은 없다.
- 어느 경우에도 대화 입력이 막히지 않는다.

기존 "값이 없으면 토글 없음" 테스트는 첫 마디에만 남기고, 턴 말풍선·교정 카드는 새 동작으로 바꾼다. `api()`는 기존 컴포넌트 테스트가 모킹하는 방식을 따른다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
grep -q "/breakdown" src/components/ChatRoom.tsx
test -z "$(git status --porcelain supabase/ data/ public/ src/services/claude/ src/server/ src/app/api/)"   # DB·AI·API를 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (브라우저는 `services/apiClient`로만 API를 부르고, Supabase를 직접 쓰지 않음)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, AI 출력은 텍스트·`Furigana`로만)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "처음 열 때 만들기"의 "화면", `ui.md` "문장 뜯어보기" 줄 전체, `UI_GUIDE.md`의 해당 줄이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/12-breakdown-on-open/step3-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(바뀐 컴포넌트, 상태 모양, 에러 코드별 화면). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 첫 마디의 뜯어보기에 API를 부르지 마라. 이유: 첫 마디는 `scenarios.ts`에 사람이 검수한 값이 있고 턴 행이 없다.
- 뜯어보기의 실패(409·429 포함)로 대화 입력을 막거나 `router.refresh()`를 부르지 마라. 이유: spec은 뜯어보기를 대화와 따로 다룬다. 대화의 409 처리(상태 다시 읽기)를 여기에 쓰면 안 된다.
- 열림 상태나 받은 값을 `localStorage` 등에 저장하지 마라. 이유: spec "열림 상태는 저장하지 않는다". 받은 값은 서버에 저장된다.
- 타일·토글의 모양(클래스, 아이콘, 위치)을 바꾸지 마라. 바꿔도 되는 것은 대기·오류 상태를 더하는 것뿐이다. 이유: `ui.md`가 정한 모양이고 2026-10-17 390px 확인을 거쳤다.
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: CLAUDE.md CRITICAL.
- API·use-case·DB·프롬프트를 고치지 마라. 이유: step 0~2의 범위다.
- 개발 서버나 브라우저를 띄워 확인하지 마라. 이유: 화면 확인(390px·320px)은 phase가 끝난 뒤 메인 세션이 한다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
