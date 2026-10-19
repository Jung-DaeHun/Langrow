# Step 2: target-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md` "배운 단어 써 보기"의 "목적", "흐름 예", "응답", "화면"과 "세션 종료 피드백"의 목표 단어 문장
- `docs/spec/ui.md`
  - "대화 말풍선" 표의 "배운 단어 줄"·"응답 대기"(새 턴 알림 영역) 행
  - "칩·태그", "카드", "아이콘" 표(배운 단어 행)
  - "화면별 구성"의 `/chat/[id]`, 종료 피드백, `/words` 행
- `docs/UI_GUIDE.md` "학습 화면"
- `docs/spec/testing.md` "컴포넌트"의 "배운 단어" 항목
- 이전 step에서 만든 코드: `src/lib/targetWords.ts`(`TargetWord`, `TargetSource`, `TARGET_SOURCE_NAMES`), `src/server/db/reads.ts`(`ChatRoomData.targetWords`·`targetSource`), `src/types/api.ts`(`ChatMessageResponse.targetWords`·`targetSource`)
- 기존 코드: `src/components/ChatRoom.tsx`·`ChatFeedback.tsx`·`WordSession.tsx`와 각 테스트, `src/components/Furigana.tsx`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 0·1이 목표 단어의 저장과 AI 유도를 만들었다. 대화방 읽기(`ChatRoomData`)와 메시지 응답(`ChatMessageResponse`)이 `targetWords`·`targetSource`를 준다. 이 step은 화면 세 곳을 만든다. 대화방 상단의 단어 줄, 종료 피드백의 결과 카드, 단어 회차 결과의 [대화하러 가기]다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다. 클래스와 문구는 `docs/spec/ui.md`를 그대로 따른다.

### 1. 대화방 단어 줄 (`ChatRoom.tsx`)

- 보여 줄 목표 단어 상태:
  - 처음에는 `room.targetWords`·`room.targetSource`다.
  - 이 화면에서 턴이 확정되면 메시지 응답의 값으로 바꾼다. 다시 읽지 않는다.
  - `router.refresh()`로 `room.turns`가 응답으로 받은 턴까지 따라오면 `room`의 값을 쓴다. 지금 `added`와 `room.turns`를 합치는 규칙과 같다.
- 목표 단어가 `null`이거나 비었으면 줄을 두지 않는다. 첫 마디만 있을 때도 마찬가지다.
- 줄은 sticky `header` 안, 제목 줄(그리드) 아래, `endError` 안내 위에 한 줄로 둔다.
  - 라벨은 `TARGET_SOURCE_NAMES[source]` + ` 쓴 수/전체`(예: "오늘 단어 1/4")다.
  - 칩 목록은 `ul`이고 `aria-label`은 라벨의 이름 부분이다. `overflow-x-auto`로 가로로 밀어 본다.
  - 칩 하나는 단어(학습 언어 `lang`) + 뜻이다. 일본어 단어는 `Furigana`로 그린다. 읽기가 있고 단어와 다르면 `[단어|읽기]` 표기로 넘긴다(`WordSession`의 앞면과 같은 방식).
  - 쓴 칩은 `Check` 14px(`aria-hidden`)과 `sr-only` "썼음"을 단다.
  - 칩은 버튼이 아니다.
- 이 줄은 별도 컴포넌트 파일로 빼도 되고 `ChatRoom.tsx` 안에 둬도 된다. 새 파일로 빼면 같은 폴더에 테스트 파일을 만든다.
- **새 턴 알림**: 이번 턴에 새로 쓴 단어(응답 전에는 아직이었고 응답 뒤 썼음)가 있으면, 새 턴 알림 영역(`TurnAnnouncement`)에 넣는다. 위치는 교정 다음, AI 응답 앞이다. 문구는 "단어를 썼어요: 少し"(여러 개면 "단어를 썼어요: 一緒に, 少し")이고 단어에 학습 언어 `lang`을 단다. 화면을 열 때 이미 있던 턴은 지금처럼 알리지 않는다.

### 2. 종료 피드백 결과 카드 (`ChatFeedback.tsx`)

- props에 `targetWords: TargetWord[] | null`과 `targetSource: TargetSource | null`을 더한다. `ChatRoom`이 지금 보이는 목표 단어 상태를 넘긴다.
- 목표 단어가 있으면 `ui.md` "화면별 구성"의 종료 피드백 행대로 단어 결과 카드를 둔다.
  - 위치: ready는 Notice 다음·"잘한 점" 앞이다. fallback은 고정 안내 Notice 다음·턴별 교정 목록 앞이다. skipped에는 두지 않는다.
  - 제목은 `BookOpen` + "{오늘/최근} 단어 n개 중 m개를 썼어요"다.
  - 목표 단어 순서의 행마다 `CircleCheck`/`Circle` + `sr-only` "썼음"/"아직" + 단어(`Furigana`, `lang`) + 뜻을 둔다.
- 202(피드백 생성 중) 화면에서도 카드를 그릴지는 다른 카드와 같은 규칙을 따른다.

### 3. 단어 회차 결과 [대화하러 가기] (`WordSession.tsx`)

- 오늘의 학습(`mode === "learn"`)에서 저장에 성공했을 때만(`save.kind === "saved"`, `insertedCount`가 0인 경우 포함) [대화하러 가기]를 둔다. outline이고 `/chat`으로 가는 `Link`다.
- 저장 중·실패·한도·오답 복습에는 두지 않는다.
- 버튼 순서는 [홈으로](primary) → [대화하러 가기] → [단어 화면으로]다. 모바일은 세로이고 `sm` 이상은 한 줄이다(지금 버튼 묶음의 `flex flex-col gap-2 sm:flex-row`).

### 4. 테스트 (`docs/spec/testing.md` "컴포넌트"의 "배운 단어")

- 대화방
  - 목표 단어가 없으면 줄이 없다.
  - 라벨은 출처에 따라 "오늘 단어"/"최근 단어"이고 쓴 수/전체를 보인다.
  - 쓴 칩은 `Check`와 "썼음"이다.
  - 메시지 응답(첫 턴에 처음 생기는 경우 포함)으로 줄이 생기거나 갱신된다.
  - 새로 쓴 단어는 알림 영역에 "단어를 썼어요: …"로 나온다.
  - 일본어 칩에 루비가 있다.
- 종료 피드백
  - 결과 카드는 목표 단어가 있을 때만 나온다(fallback 포함, skipped 없음).
  - 제목의 개수와 행마다 썼음/아직이 맞다.
- 단어 결과
  - [대화하러 가기]는 오늘의 학습에서 저장 성공 뒤에만 있다.
  - 저장 중·실패·한도·오답 복습에는 없다.
  - 링크는 `/chat`이다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
test -z "$(git status --porcelain supabase/ src/server/ src/services/ data/ public/)"   # DB·use-case·AI·데이터를 바꾸지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (화면 단위 Client Component, 공용 컴포넌트 재사용)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, 후리가나는 `<ruby>` React 요소)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `ui.md`의 "배운 단어 줄" 행, 종료 피드백 행의 단어 결과 카드, `/words` 행의 [대화하러 가기], 아이콘 표의 배운 단어 행, `chat.md` "세션 종료 피드백"의 목표 단어 문장이다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/9-target-words/step2-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(바꾼 컴포넌트와 props, 줄·카드·버튼의 조건). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 단어 줄을 메시지 목록 안(대화 안내 줄 아래)에 두지 마라. 이유: 그 영역은 메시지와 함께 스크롤돼 사라져서, 답을 쓰면서 단어를 볼 수 없다(spec `ui.md` "배운 단어 줄").
- 칩을 여러 줄로 감싸지(`flex-wrap`) 마라. 이유: sticky 상단이 모바일 키보드가 열린 화면에서 너무 높아진다. 한 줄로 두고 가로로 민다.
- 메시지 응답 뒤 줄을 갱신하려고 `router.refresh()`를 부르지 마라. 이유: spec은 메시지 응답으로 갱신하고 다시 읽지 않는다고 정했다.
- 피드백 카드의 쓴 개수를 Claude에 요청하거나 `/end` API를 바꾸지 마라. 이유: 저장된 목표 단어와 쓴 단어로 그린다(spec `chat.md` "세션 종료 피드백").
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: CLAUDE.md CRITICAL. 단어는 텍스트와 `Furigana`로만 그린다.
- 마이그레이션·`src/server/`·`src/services/`를 고치지 마라. 이유: step 0·1의 범위다.
- 정해진 것 밖의 애니메이션을 더하지 마라(칩이 체크될 때 포함). 이유: `UI_GUIDE.md` 허용 애니메이션 목록.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
