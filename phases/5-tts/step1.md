# Step 1: speak-buttons

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/superpowers/plans/2026-10-12-tts-audio.md`: "Global Constraints", "Review Focus", "### Task 4: 재생 버튼 (`SpeakButtons`)", "### Task 5: 단어·가나 화면에 붙이기" 전체. **이 step은 Task 4와 Task 5만 한다.**
- `docs/spec/audio.md`: "대화 음성", "재생 규칙", "위치", "합성 음성 고지", "미리 만드는 음성"의 마지막 줄(인증 가드 `.mp3` 제외)
- `docs/spec/ui.md`
  - "공용 React 컴포넌트와 이유"의 `SpeakButtons` 행
  - "플래시카드", "빈칸 퀴즈", "음성 재생"
  - "화면별 구성"의 `/words`·`/kana` 행
- `docs/UI_GUIDE.md` "컴포넌트와 화면 규칙"의 에러·토스트 문장과 "접근성"
- step 0 산출물: `src/lib/audio.ts`(`SLOW_RATE`, `pickVoice`, `wordAudioPath`, `exampleAudioPath`, `kanaAudioPath`)와 테스트
- 기존 코드:
  - `src/lib/furigana.ts`(`stripFurigana`)
  - `src/components/Flashcard.tsx`, `BlankQuiz.tsx`, `WordSession.tsx`, `KanaDeck.tsx`와 각 테스트
  - `src/app/(app)/kana/page.tsx`, `src/proxy.ts`와 `src/proxy.test.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

[듣기]·[천천히 듣기] 공용 컴포넌트 `SpeakButtons`를 만들고 단어 화면에 붙인다.

- 파일 재생: 단어·예문·가나. step 0의 경로 함수로 `/audio/female/...mp3`를 `Audio`로 재생한다.
- 브라우저 음성: 대화 문장. 이 step에서는 컴포넌트만 만들고, 대화 화면 연결은 step 2가 한다.

음성 파일은 아직 만들지 않았다(다음에 생성한다). 그래서 지금 실제 화면에서 파일을 재생하면 404가 나고 오류 문구가 보이는 것이 정상이다. 테스트는 가짜 `Audio`·`speechSynthesis`로 한다.

계획 Task 4·5에 테스트와 코드가 이미 다 있다. 그대로 따르되, 계획의 코드가 실제 코드와 다르면 실제 코드에 맞추고 아래 핵심 규칙은 지켜라.

## 작업

계획 Task 4의 Step 1~5, Task 5의 Step 1~4를 순서대로 한다. 두 Task의 Commit 단계는 하지 말고, 커밋은 이 프롬프트의 작업 규칙대로 한다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

만들 인터페이스:

```tsx
// src/components/SpeakButtons.tsx ("use client")
export type SpeakSource = { kind: "file"; src: string } | { kind: "speech"; text: string; language: Language }  // text는 후리가나 표기가 있어도 된다
export function SpeakButtons(props: { source: SpeakSource; variant?: "pill" | "compact"; align?: "start" | "center" })  // 기본 pill, start
// src/components/Flashcard.tsx — prop 추가
audio?: { front: ReactNode; back: ReactNode }   // 카드 <button> 바로 아래, 보이는 면의 것을 그린다
// src/components/BlankQuiz.tsx — prop 추가
exampleAudio?: ReactNode                        // 채점 뒤(graded)에만 문제 카드 안 example_ko 아래
```

### 지켜야 할 핵심 규칙

- **재생 규칙** (spec `audio.md` "재생 규칙")
  - 누를 때만 재생한다. 자동 재생은 없다.
  - [듣기]는 속도 1, [천천히 듣기]는 0.75다. 파일은 `playbackRate`, 브라우저 음성은 `rate`다.
  - 누르면 처음부터 재생한다(매번 새로 시작). 재생 중에 다시 눌러도 처음부터 다시 한다.
  - 페이지에서 소리는 하나만 난다. 모듈 수준의 "지금 소리 멈추기" 함수로, 다른 버튼(파일·브라우저 음성 상관없이)을 누르면 앞 소리를 멈춘다.
  - 버튼이 사라지면(unmount) 그 버튼의 소리를 멈춘다.
- **실패 처리**
  - 파일 `error` 이벤트, `play()` 거부, 음성 `onerror`가 나면 버튼 아래에 `role="alert"`로 "소리를 재생하지 못했어요. 다시 눌러 보세요."를 보여 준다. 다시 누르면 지운다.
  - 우리가 멈춰서 생긴 실패는 오류가 아니다. 멈춘 뒤 거부된 `play()`(AbortError)와 음성 `interrupted`·`canceled`가 해당한다.
- **브라우저 음성**
  - `pickVoice(speechSynthesis.getVoices(), language)`로 고른다. 맞는 음성이 없거나 `speechSynthesis`가 없으면 버튼을 그리지 않는다.
  - `voiceschanged` 뒤에 다시 고르고, 서버 렌더링 때는 그리지 않는다(`useSyncExternalStore`, 서버 스냅샷 `null`).
  - 읽을 문장은 `stripFurigana(text)`다.
- **모양** (ui.md "음성 재생"): 카드·퀴즈는 Pill 2개(`Volume2`·`Snail` 16px), 대화는 `compact`(text-xs 글자 버튼, 아이콘 14px, `gap-3`)다. 카드 아래는 가운데(`align="center"`), 문제 카드 안은 왼쪽이다.
- **배치**
  - 카드가 `<button>`이라 재생 버튼은 카드 밖, 바로 아래에 둔다. 면마다 `key`로 새로 만들어 뒤집으면 앞면 소리가 멈추게 한다.
  - 오답 복습 카드의 순서는 카드 → 재생 버튼 → [예문 설명] → [모르겠어요]/[알아요]다.
  - 단어 학습·오답 복습 카드는 앞면에서 `wordAudioPath`, 뒷면에서 `exampleAudioPath`를 재생한다.
  - 빈칸은 단어 학습에서 채점 뒤에만 `exampleAudioPath`를 둔다. 레벨업 테스트(`mode="test"`)에는 없다.
  - 가나 카드는 앞·뒷면 모두 `kanaAudioPath(char)`다.
- **합성 음성 고지 문구(그대로)**
  - 오늘의 학습 시작 카드: "끝까지 풀면 한 번에 저장돼요. 중간에 나가면 저장되지 않아요. 발음은 합성 음성이에요."
  - 오답 복습 시작 카드: "복습은 하루 사용량에 포함되지 않아요. 발음은 합성 음성이에요."
  - `/kana`: "사용량에 포함되지 않아요 · 발음은 합성 음성이에요"
- **인증 가드**: `src/proxy.ts` matcher의 확장자 목록에 `mp3`를 더해 `/audio/**/*.mp3`에서 돌지 않게 한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
grep -q "mp3" src/proxy.ts
grep -q "발음은 합성 음성이에요" src/components/WordSession.tsx
grep -q "발음은 합성 음성이에요" "src/app/(app)/kana/page.tsx"
test ! -e public/audio   # 음성 파일을 만들지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (공용 컴포넌트는 `src/components/`, 규칙은 `src/lib/audio.ts`)
   - ADR 기술 스택을 벗어나지 않았는가? (새 의존성 없음, lucide 아이콘)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, 브라우저가 Supabase를 쓰지 않음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `audio.md` "재생 규칙"·"위치"(대화 행 제외)·"합성 음성 고지"·인증 가드 문장, `ui.md` "음성 재생"·"플래시카드"·"빈칸 퀴즈"·`/words`·`/kana` 행이다(실패 처리 포함). step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/5-tts/step1-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(`SpeakButtons` props, `Flashcard`·`BlankQuiz` 새 prop, 테스트용 가짜 Audio·speechSynthesis 모양). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `npm run audio:generate`를 실행하거나 `public/audio/`에 파일을 만들지 마라. 이유: 생성은 다음에 사람이 확인하며 돌리고, step 커밋은 `git add -A`라서 그대로 커밋된다.
- 재생 실패를 `showToast`로 알리지 마라. 이유: UI_GUIDE "에러는 토스트가 아니라 그 자리의 오류 안내로 보여 준다".
- 재생 버튼을 카드 `<button>` 안에 넣지 마라. 이유: 버튼 안의 버튼은 잘못된 HTML이고 키보드·스크린리더 동작이 깨진다.
- 자동 재생이나 재생 이벤트(`/api/events` 등)를 넣지 마라. 이유: spec `audio.md` "재생 규칙"(누를 때만, 이벤트 없음).
- 브라우저 음성이 학습 언어와 맞지 않을 때 기본 음성으로 대신 읽지 마라. 이유: 일본어를 영어 음성으로 읽게 된다. 버튼을 숨긴다.
- `ChatRoom`, `/settings`, `/account`, `AppNav`, `lib/paths`를 고치지 마라. 이유: step 2의 범위다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라(단, 계획 Task 5가 바꾸라고 한 시작 카드 문구 단언 2개는 새 문구로 바꾼다)
