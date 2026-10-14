# Step 2: pron-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/superpowers/plans/2026-10-14-korean-pronunciation.md`: "Global Constraints", "Review Focus", "### Task 6" 전체. **이 step은 Task 6만 한다.**
- `docs/spec/chat.md` "한글 발음" 절의 "대상과 위치"·"화면 낭독기"와 "레벨별 조절" 표의 "일본어 한글 발음" 열
- `docs/spec/ui.md`
  - "대화 말풍선" 표의 "번역"·"한글 발음"·"교정"·"응답 대기" 행
  - "플래시카드"의 단어 앞면·뒷면과 "한글 발음" 문장
  - "빈칸 퀴즈"의 채점 뒤 문장
- `docs/spec/words.md` "오늘의 학습" 2번(플래시카드)·3번(빈칸)
- `docs/spec/testing.md`의 컴포넌트 "한글 발음" 항목
- 이전 step에서 만든 코드: `src/lib/levels.ts`(`showsPronunciation`), `src/lib/scenarios.ts`(`ScenarioLine.pronKo`), `src/server/db/reads.ts`(`Word.pronKo`·`examplePronKo`, `ChatTurnView.replyPronKo`), `src/services/claude/schemas.ts`(`TurnReply`의 `reply_pron_ko`·`corrected_pron_ko`)
- 기존 코드: `src/components/ChatRoom.tsx`(`AiBubble`, 교정 카드, `TurnAnnouncement`)·`BlankQuiz.tsx`·`WordSession.tsx`·`Flashcard.tsx`와 각 테스트(`ChatRoom.test.tsx`의 `turn`·`room`·`setup`·`replied`·`ON_SCREEN`·`isBefore`, `WordSession.test.tsx`의 `word`·`setup`·`flashcard`·`answerCards`, `BlankQuiz.test.tsx`의 `setup`·`option`), `src/app/(app)/chat/[id]/page.tsx`(첫 마디를 넘기는 곳)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 0·1로 한글 발음이 저장되고 읽힌다(대화 턴의 `replyPronKo`·`correction.corrected_pron_ko`, 단어의 `pronKo`·`examplePronKo`, 첫 마디의 `pronKo`). 이 step은 일본어 입문~중급 화면에 그 값을 한 줄씩 그린다. 계획 Task 6에 테스트와 코드가 이미 다 있다. 그대로 따르되, 계획의 코드가 실제 코드와 다르면 실제 코드에 맞추고 아래 핵심 규칙은 지켜라.

## 작업

계획 Task 6의 Step 1~4를 순서대로 한다. **Task 6의 커밋 단계는 하지 마라.** 커밋은 이 프롬프트의 작업 규칙대로 한다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

바꿀 인터페이스:

```ts
// src/components/BlankQuiz.tsx Props에 하나
pronunciation?: string | null  // 정답을 채운 예문의 한글 발음. mode "learn"이고 채점한 뒤에만 그린다

// src/components/ChatRoom.tsx 안의 AiBubble
function AiBubble({ line, language, level }: { line: { text: string; ko: string; pronKo?: string | null }; language: Language; level: Level })
```

### 지켜야 할 핵심 규칙

- **보여 줄지는 `showsPronunciation(language, level)`과 값의 유무만으로 정한다.** 대화는 방의 `language`·`level`, 단어는 회차 언어(`runLanguage`)와 `level`을 쓴다. 상급·고수와 영어는 데이터에 발음이 있어도(첫 마디 `pronKo` 포함) 그리지 않는다. 값이 `null`·빈 값이면 그 줄을 두지 않는다.
- **자리와 클래스는 spec `ui.md` 그대로다.**
  - AI 말풍선(첫 마디 포함): 말풍선 안에서 문장 바로 아래, 번역 구분선 위에 `<span aria-hidden="true" className="mt-1 block text-sm text-brand">`. 입문·초보는 늘 보이고, 중급은 번역과 함께 펼칠 때만 보인다.
  - 교정 카드: 고친 문장 `<p>` 바로 아래, 재생 버튼 위에 `<p aria-hidden="true" className="text-sm text-brand">`. 교정 카드는 늘 펼쳐 둔다.
  - 단어 카드 앞면: 단어 바로 아래, "탭해서 뜻 보기" 위에 `<span aria-hidden="true" className="text-lead text-brand">{pronKo}</span>`. 뒷면: 예문 바로 아래, `exampleKo` 위에 `text-sm text-brand`. 오답 복습 카드도 같다. 카드 면은 `<button>` 안이라 `<span>`을 쓴다.
  - 빈칸: 문제 카드 안 빈칸 문장 바로 아래, `exampleKo` 위에 `<p aria-hidden="true" className="text-sm text-brand">`. **채점 전에는 DOM에 두지 않는다**(정답의 발음이 드러난다). 레벨업 테스트(`mode: "test"`)에는 두지 않는다.
- **낭독기**: 발음 요소는 모두 `aria-hidden="true"`다. 새 턴 알림(`TurnAnnouncement`, `aria-live` 영역)은 바꾸지 않는다(발음을 넣지 않는다). 플래시카드 버튼의 접근 가능한 이름에도 발음이 들어가지 않는다.
- 첫 마디는 `scenario.opening`을 그대로 `AiBubble`에 넘긴다(`pronKo`가 함께 간다). 대화방 페이지(`chat/[id]/page.tsx`)는 이미 `ScenarioLine`을 통째로 넘기므로 고치지 않는다.
- `dangerouslySetInnerHTML`을 쓰지 않는다. 발음은 텍스트로만 그린다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가? (UI는 `@theme` 토큰 클래스만)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, 브라우저에서 Supabase 쓰기 없음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `ui.md` "대화 말풍선"의 "한글 발음"·"교정"·"응답 대기" 행, "플래시카드"의 "한글 발음" 문장, "빈칸 퀴즈"의 채점 뒤 문장, `chat.md` "한글 발음"의 "대상과 위치"·"화면 낭독기"다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/6-pron/step2-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(바꾼 컴포넌트와 prop). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 종료 피드백(`ChatFeedback`)·AI 해설(`WordExplanation`)·빈칸 보기·레벨업 테스트(`LevelTestRunner`)에 발음을 넣지 마라. 이유: spec `chat.md` "한글 발음"이 이 곳들을 뺐다.
- 새 턴 알림(`TurnAnnouncement`)에 발음을 넣지 마라. 이유: 일본어 문장에 `lang="ja"`가 있어 낭독기가 같은 내용을 두 번 읽는다(spec `chat.md` "화면 낭독기").
- 발음 표시를 레벨 숫자 비교(`level <= 3`)나 `language === "ja"`로 다시 쓰지 마라. 이유: 표시 조건은 `showsPronunciation` 하나로 둔다(계획 Global Constraints).
- 서버·DB·프롬프트·스크립트를 고치지 마라. 이유: step 0·1에서 끝났다.
- `npm run words:pron`·`npm run seed:words`를 실행하거나 `data/words/*.json`을 고치지 마라. 이유: 실제 발음 생성은 phase 뒤에 사람이 확인하며 돌린다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
