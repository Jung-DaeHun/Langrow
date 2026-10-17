# Step 2: furigana-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/chat.md` "레벨별 조절"의 표와 "후리가나" 항목 전체, "한글 발음"의 "대상과 위치"
- `docs/spec/ui.md`
  - "타이포그래피" > "크기" 아래 문단(자간·줄바꿈 문장, 일본어 행간·후리가나 문장)
  - "플래시카드"의 단어 앞면 문장, "빈칸 퀴즈"의 보기 문장, "AI 정답 설명" 표의 "설명" 행
- `docs/UI_GUIDE.md` "타이포그래피"
- `docs/spec/words.md`에서 "후리가나"가 나오는 문장(보기 후리가나, AI 해설 표기)
- `docs/spec/testing.md`의 컴포넌트 항목 중 `Furigana`와 "레벨 4·5 일본어 … 루비가 있음"
- `docs/ADR.md` ADR-016
- 이전 step에서 만든 코드: `src/lib/furigana.ts`(`rubySegments`, `parseFurigana`의 여는 괄호 복구)
- 기존 코드:
  - `src/components/Furigana.tsx`·`Furigana.test.tsx`, `src/app/globals.css`, `src/lib/levels.ts`·`levels.test.ts`
  - 후리가나를 그리는 곳: `ChatRoom.tsx`(`AiBubble`·교정 카드), `ChatFeedback.tsx`(피드백·`Corrections`), `LevelTestRunner.tsx`, `WordSession.tsx`(카드 앞면의 `ruby`, 뒷면 예문, `BlankQuiz`·`WordExplanation`에 넘기는 `showFurigana`), `BlankQuiz.tsx`, `WordExplanation.tsx`와 각 테스트
  - `src/components/KanaDeck.tsx`(가나 카드. 바꾸지 않는다), `src/lib/scenarios.ts` 위 주석

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

일본어 후리가나를 모든 레벨로 넓히고(ADR-016) 가타카나에도 히라가나 읽기를 단다. 2026-10-17 운영 확인에서 나온 화면 문제 두 가지도 고친다. 아이폰에서 긴 일본어 AI 말풍선이 줄을 바꾸지 않고 화면 밖으로 늘어났고, `[週末|しゅうまつ]`가 "週 末"처럼 벌어져 보였다(PC·아이폰 모두). step 0이 `rubySegments`(가타카나 읽기)를 만들었고, step 1이 프롬프트를 모든 레벨 표기로 바꿨다. 대화방의 안내 줄·뜯어보기·말풍선 구조는 step 3이 한다.

## 작업

테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 1. `src/components/Furigana.tsx`

```tsx
export function Furigana({ text, show }: { text: string; show: boolean })  // 시그니처 그대로
```

- `show`이면 `rubySegments(text)`로 그린다. 한자 표기와 가타카나 읽기 모두 `<ruby>`가 된다. `show`가 아니면 지금처럼 표기를 지운 본문만 그린다(가타카나 읽기도 없다).
- 마크업은 `<ruby>본문<rp>(</rp><rt>읽기</rt><rp>)</rp></ruby>` 모양을 유지한다.
- **본문 글자가 벌어지지 않게 한다.** 읽기가 본문보다 넓어도 본문 글자 사이를 벌리지 않고 가운데에 모은다(`ruby-align: center`). 이 속성을 따르지 않는 브라우저(WebKit일 수 있다)에서도 붙어 보여야 한다. 예를 들어 본문을 `<span>` 하나로 감싸 `inline-block` 한 덩어리로 만들 수 있다. 방법은 정해도 되지만 `rp`·`rt`는 그대로 둔다.
- HTML 문자열을 만들지 않는다(`dangerouslySetInnerHTML` 금지).

### 2. 모든 일본어 화면에 레벨과 상관없이 후리가나

- 표시 조건은 학습 언어가 일본어인지(`language === "ja"`)뿐이다. 대상은 다음과 같다.
  - 대화: 첫 마디, AI 말풍선, 교정 문장, 교정 설명
  - 종료 피드백: 잘한 점, 고칠 점, 대체 결과의 교정 목록
  - 단어: 카드 앞면 단어, 뒷면 예문, 빈칸 문장·보기·채점 뒤 정답, AI 해설
  - 레벨업 테스트: 문장·보기
- **단어 카드 앞면**: 한자가 없는 가타카나 단어(예: `コーヒー`)에도 코드가 단 읽기가 보여야 한다. 지금 `ruby` 조건(`reading !== word` 등)이 이를 막지 않는지 확인한다.
- **가나 익히기 카드(`KanaDeck`)에는 달지 않는다**(글자를 익히는 연습이다).
- `src/lib/levels.ts`에서 `showsFurigana`를 지운다. `showsPronunciation`은 `language === "ja" && level <= 3`으로 바꾸고, 주석에 2026-10-17 후리가나를 넓힐 때 발음은 넓히지 않았다고 적는다. `levels.test.ts`도 맞춘다(발음 경계 테스트는 남긴다). `allowsKoreanInput`은 step 3이 지운다.
- `src/lib/scenarios.ts` 위 주석의 "표시 여부는 showsFurigana(level)가 정한다"를 고친다.

### 3. 일본어 줄바꿈과 넘침 (`src/app/globals.css`, 필요하면 컴포넌트 클래스)

- `:lang(ja)`에 `word-break: normal`을 준다. 띄어쓰기가 없는 일본어가 `keep-all`이면 문장 전체가 한 단어로 묶이기 때문이다.
- 말풍선이 화면 밖으로 넘친 원인을 코드로 확인하고 고친다. 의심 가는 곳은 이렇다. `ChatRoom.tsx`의 `MY_BUBBLE`과 `AiBubble` 본문에 붙은 `wrap-break-word`(`overflow-wrap: break-word`)는 body의 `overflow-wrap: anywhere`를 덮어쓴다. `break-word`는 최소 너비 계산에 글자 사이 줄바꿈을 넣지 않으므로, `items-start` flex 열의 말풍선이 `max-w-[84%]`를 넘어 늘어날 수 있다(Tailwind v4에는 `wrap-anywhere`가 있다).
- 320px 너비에서도 말풍선·교정 카드가 화면 안에서 줄을 바꾸고, 페이지에 가로 스크롤이 생기지 않아야 한다. 띄어쓰기 없는 긴 영어 낱말(URL 등)도 넘치지 않아야 한다.
- 원인 판단과 고친 내용을 summary에 적는다. 브라우저로 확인하는 일(390px·320px Chrome, WebKit)은 phase가 끝난 뒤 메인 세션이 한다.

### 4. 테스트 (`docs/spec/testing.md` 컴포넌트)

- `Furigana`: 가타카나에 히라가나 루비가 붙는다(`コーヒー` → `こーひー`). 한자 표기 안의 가타카나는 그대로다. `show`가 false면 루비가 없다. HTML을 주입하지 않는다. 여는 괄호만 빠진 표기와 그 밖의 깨진 표기를 처리한다.
- 레벨 4·5 일본어에서 대화 말풍선·교정, 종료 피드백, 단어(카드·빈칸 보기), 레벨업 보기에 `<ruby>`가 있다. 영어 화면에는 `<ruby>`가 없다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -rn "showsFurigana" src
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가? (UI는 `@theme` 토큰 클래스만)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, 후리가나는 React `<ruby>` 요소)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `chat.md` "레벨별 조절" 표의 후리가나 열과 "후리가나" 항목, `ui.md` "타이포그래피"의 줄바꿈·후리가나 문장, "플래시카드"·"빈칸 퀴즈"·"AI 정답 설명"의 후리가나 문장, `UI_GUIDE.md` "타이포그래피"다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/7-chat-improve/step2-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(바꾼 컴포넌트, 루비 벌어짐 방지 방법, 넘침 원인과 수정). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `parseFurigana`·`stripFurigana`·`src/lib/audio.ts`를 바꾸지 마라. 이유: 음성 SSML이 `parseFurigana`를 쓴다. 바뀌면 이미 만든 음성 전체를 다시 만들어야 한다. 가타카나 읽기는 화면(`rubySegments`)에서만 단다.
- 가나 익히기 카드에 후리가나를 넣지 마라. 이유: 글자를 익히는 연습이다(spec `chat.md` "후리가나").
- 한글 발음의 표시 레벨(입문~중급)을 넓히지 마라. 이유: ADR-016에서 발음은 그대로 두기로 했다.
- 대화방의 안내 줄·placeholder·문장 뜯어보기·말풍선 버튼 구조를 바꾸지 마라. `allowsKoreanInput`도 지우지 마라. 이유: step 3의 범위다. 이 step에서 `ChatRoom.tsx`는 후리가나 표시 조건과 넘침 클래스만 고친다.
- Playwright 같은 새 의존성을 설치하거나 브라우저를 내려받지 마라. 이유: 프로젝트 의존성을 늘리지 않는다. WebKit 확인은 phase 뒤 메인 세션이 프로젝트 밖 임시 폴더에서 한다(spec `ui.md`).
- 서버·프롬프트·DB를 고치지 마라. 이유: step 0·1에서 끝났다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
