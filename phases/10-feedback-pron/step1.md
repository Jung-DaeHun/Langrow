# Step 1: chat-refresh

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/journey.md` "예외 흐름" 표의 "뒤로 가기로 대화방에 돌아옴" 행(이 step의 기준이다)과 "대화 도중 이탈했다가 돌아옴" 행
- `docs/spec/chat.md` "배운 단어 써 보기"의 "응답" 항목(줄은 메시지 응답으로 바로 갱신하고 다시 읽기를 기다리지 않는다), "대화 진행" 5·6번(20턴 뒤 `/end`, `/end` 멱등)
- `docs/spec/testing.md` "컴포넌트"의 "뒤로 가기 대비 다시 읽기" 항목
- `docs/ADR.md` ADR-025
- `node_modules/next/dist/docs/01-app/04-glossary.md` "Client Cache"와 `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`의 `router.refresh()` 설명
- 기존 코드와 테스트: `src/components/ChatRoom.tsx`·`ChatRoom.test.tsx`(특히 `send`, `endSession`, `added`·`replyTarget`이 다시 읽은 `room`을 따라가는 방식, 기존 `refresh` 단언들), `src/components/ChatFeedback.tsx`·`ChatFeedback.test.tsx`(202를 기다리는 `check`), `src/app/(app)/chat/[id]/page.tsx`
- step 0에서 바꾼 코드: `src/components/ChatFeedback.tsx`(고칠 점 항목), `src/services/claude/schemas.ts`(`Feedback`·`StoredFeedback`), `src/server/db/chat.ts`(`EndResult`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

버그: 대화를 끝낸 뒤 [홈으로] → 브라우저 뒤로 가기로 대화방에 오면, 처음 대화방을 열 때 받은 화면(턴 0, `active`)이 보인다. 거기서 [대화 끝내기]를 다시 누르면 `/end`가 저장된 결과를 주고, 피드백이 "0턴"으로 단어 결과 카드 없이 그려진다(실제 세션은 턴 3·목표 단어 5개가 저장돼 있었다).

원인: Next.js는 브라우저 뒤로/앞으로 가기에서 페이지 데이터(RSC)를 서버에 다시 묻지 않고, 그 페이지를 마지막으로 받았을 때의 것을 다시 쓴다. 대화방이 이 화면에서 받은 턴(`added`)과 목표 단어(`replyTarget`)는 컴포넌트 상태에만 있어서, 페이지가 다시 마운트되면 처음 받은 `room`(턴 0)으로 돌아간다. `router.refresh()`는 지금 페이지를 서버에서 다시 받아 그 저장본을 바꾸고, 컴포넌트 상태는 유지한 채 새 `room`을 props로 넘긴다(`ChatRoom`은 `key={room.id}`라 다시 만들어지지 않는다).

고침(spec): 턴이 확정되거나 끝난 결과(`ended`)를 받으면 `router.refresh()`를 부른다. 화면은 다시 읽기를 기다리지 않는다.

## 작업

먼저 버그를 재현하는 테스트를 쓰고 실패를 확인한 뒤 구현한다.

### 1. `src/components/ChatRoom.tsx`

- `send`: 메시지 응답이 성공(턴 확정)하면 지금처럼 `added`·`replyTarget`을 갱신하고 `router.refresh()`를 한 번 부른다. 마지막 턴(`turnsLeft === 0`)이어도 부른다(이어서 부르는 `/end`가 끝난 결과를 받으면 거기서 한 번 더 부른다).
- `endSession`: `/end`가 끝난 결과(`status: "ended"`)를 주면 지금처럼 `setEnd`하고 `router.refresh()`를 부른다. 202(`ending`)면 부르지 않는다(`ChatFeedback`이 기다리다 끝난 결과를 받을 때 부른다).
- 실패 응답의 동작은 바꾸지 않는다(409 `CONFLICT`의 기존 다시 읽기 한 번 포함). 404·429·503 등에 다시 읽기를 더하지 않는다.
- 단어 줄과 피드백은 응답으로 바로 그린다. 다시 읽은 `room`이 오면 지금 코드의 규칙(`lastTurnNo`로 `added`·`replyTarget`을 걸러 `room`의 값을 씀)대로 이어진다. 이 규칙은 바꾸지 않는다.

### 2. `src/components/ChatFeedback.tsx`

- 202를 기다리다 `/end`가 끝난 결과를 주면 `setPolled`와 함께 `router.refresh()`를 부른다. 오류·404 동작은 바꾸지 않는다.

### 3. 테스트

- `ChatRoom.test.tsx`
  - 재현: 처음 받은 `room`이 `active`·턴 0인 화면에서 [대화 끝내기] → `/end`가 저장된 결과(`ended`)를 주면 `refresh`가 불린다. 이어서 다시 읽은 `room`(`status: "ended"`, 턴 3개, 목표 단어, `result`)으로 rerender하면 피드백이 "3턴"과 단어 결과 카드를 그린다.
  - 메시지 응답이 성공할 때마다 `refresh`가 한 번씩 불린다. 실패 응답(예: 503)에는 불리지 않는다.
  - `/end` 202면 불리지 않는다.
  - 기존 테스트 "첫 턴의 메시지 응답으로 줄이 생기고 다음 응답으로 갱신되며, 다시 읽지 않는다"는 spec이 바뀌었으므로(줄은 응답으로 바로 갱신하고 다시 읽기를 기다리지 않는다) 다시 읽기를 부르되 줄은 rerender 없이 응답만으로 갱신되는지 확인하도록 고친다. 그 밖의 `refresh` 횟수 단언은 이번 변경으로 횟수가 늘어나는 경우에만 고치고, 왜 늘었는지 테스트 이름이나 단언으로 드러낸다.
- `ChatFeedback.test.tsx`: 202를 기다리다 끝난 결과를 받으면 `refresh`가 불린다(필요하면 이 파일에 `useRouter` mock의 `refresh`를 더한다).

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
grep -q "refresh" src/components/ChatFeedback.tsx
test -z "$(git status --porcelain supabase/ data/ public/ src/server/ src/services/)"   # 화면만 바꿨다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (브라우저는 로그인·로그아웃 말고 Supabase를 직접 쓰지 않음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `journey.md` "예외 흐름"의 "뒤로 가기로 대화방에 돌아옴" 행, `chat.md` "배운 단어 써 보기"의 "응답" 항목 중 화면 문장이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/10-feedback-pron/step1-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(refresh를 부르는 곳과 조건, 고친 기존 테스트). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 마운트할 때마다(`useEffect` 첫 실행) `router.refresh()`를 부르지 마라. 이유: 상황 목록·홈에서 새로 들어올 때마다 같은 페이지를 두 번 읽는다. spec은 턴 확정과 끝난 결과 때만 다시 읽는다.
- `window.location.reload()`·`location.href` 이동이나 `router.push`로 같은 주소를 다시 열지 마라. 이유: 입력 중인 글자·스크롤·화면 상태를 잃는다. `router.refresh()`는 상태를 유지한다.
- `next.config.ts`의 `staleTimes`, `cacheComponents`, `bfcacheId`를 쓰지 마라. 이유: Next 문서상 `staleTimes`는 뒤로/앞으로 가기 캐시를 바꾸지 않고, `cacheComponents`는 앱 전체의 렌더링 방식을 바꾼다.
- 다시 읽기가 끝날 때까지 단어 줄·피드백을 숨기거나 입력을 막지 마라. 이유: spec은 화면이 다시 읽기를 기다리지 않는다고 정한다.
- 서버 코드(`src/server/`, `src/services/`)와 API 응답 모양을 바꾸지 마라. 이유: 원인은 브라우저의 페이지 캐시이고, 서버는 저장된 결과를 맞게 돌려준다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
