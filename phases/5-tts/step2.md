# Step 2: chat-settings

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/superpowers/plans/2026-10-12-tts-audio.md`: "Global Constraints", "### Task 6: 대화에 붙이기", "### Task 7: 설정 화면" 전체. **이 step은 Task 6과 Task 7만 한다.**
- `docs/spec/audio.md`: "대화 음성", "위치"의 AI 대화 행, "나중에: 남성 음성"(지금 만들지 않는 것을 알기 위해)
- `docs/spec/ui.md`
  - "대화 말풍선"의 "음성 재생" 행, "음성 재생"의 대화 행
  - "목록 묶음", "선택 타일"
  - "화면별 구성"의 `/account`·`/settings` 행
- `docs/spec/journey.md` "페이지 접근"의 보호 경로 문장
- step 1 산출물: `src/components/SpeakButtons.tsx`(`SpeakButtons`, `SpeakSource`)와 테스트
- 기존 코드:
  - `src/components/ChatRoom.tsx`(`AiBubble`, 교정 카드)와 `ChatRoom.test.tsx`
  - `src/components/AppNav.tsx`와 테스트, `src/lib/paths.ts`와 테스트
  - `src/app/(app)/account/page.tsx`(목록 묶음 `ROW`), `src/app/(app)/kana/page.tsx`(페이지 모양)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

step 1이 만든 `SpeakButtons`를 대화 화면에 붙이고, 정적인 설정 화면을 만든다.

- 대화: 첫 마디를 포함한 AI 말풍선과 교정의 고친 문장을 브라우저 음성으로 읽는다(`{ kind: "speech" }`, `variant="compact"`). 학습 언어 음성이 없는 기기에서는 `SpeakButtons`가 스스로 버튼을 숨긴다.
- 설정: 지금은 여성 음성 하나뿐이라 저장하지 않는 정적 화면이다. 남성 음성은 나중에 추가하며, 그때 남성 타일을 켜고 계정에 저장한다.

계획 Task 6·7에 테스트와 코드가 이미 다 있다. 그대로 따르되, 계획의 코드가 실제 코드와 다르면 실제 코드에 맞추고 아래 핵심 규칙은 지켜라.

## 작업

계획 Task 6의 Step 1~4, Task 7의 Step 1~4를 순서대로 한다. 두 Task의 Commit 단계는 하지 말고, 커밋은 이 프롬프트의 작업 규칙대로 한다. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다(`page.tsx`는 TDD guard 예외).

### 지켜야 할 핵심 규칙

- **대화 음성**
  - `AiBubble`은 말풍선(중급 이상은 번역을 펼치는 `<button>`)을 바깥 div(`flex max-w-[84%] flex-col items-start gap-1 self-start`)로 감싼다. 재생 버튼은 말풍선 밖 바로 아래에 둔다. 말풍선 버튼 안에 넣지 않는다.
  - 교정 카드는 라벨 → 고친 문장 → 재생 버튼 → 설명 순서다.
  - 원문(후리가나 표기 포함)을 그대로 `text`로 넘긴다. 표기는 `SpeakButtons`가 지운다.
  - 대화는 설정과 무관하게 기기 음성을 쓴다. 성별로 음성을 고르지 않는다.
- **`/settings`** (ui.md 화면별 구성)
  - 맨 위에 [계정] 뒤로 pill(Pill + `ChevronLeft`, → `/account`)을 둔다. 셸 상단바는 경로를 몰라서 화면 안에 둔다.
  - 제목은 "설정"이다.
  - 섹션 "음성"에 `role="radiogroup"` 선택 타일 2개를 둔다.
    - "여성": 보조 "영어 Ava · 일본어 Nanami", 선택됨 `aria-checked="true"` + `ring-2 ring-accent bg-ok-wash`
    - "남성": `disabled`, `aria-disabled="true"`, `opacity-50`, 보조 "준비 중이에요"
  - 그 아래에 "대화 문장은 기기의 음성으로 읽어요."(`text-sm text-ink-muted`)를 둔다.
  - `requireReady()`를 부르는 보호 페이지다.
- **계정 화면**: 목록 묶음 맨 위에 "설정" 행을 둔다. 선행 아이콘은 `Settings`(mint 원 안 accent 20px), 보조는 "음성", 끝은 `ChevronRight`, 이동은 `/settings`다.
- **보호 경로·내비**
  - `PROTECTED_PAGES`에 `/settings`를 더한다.
  - `AppNav`는 `/settings`에서 계정을 현재 위치(`aria-current="page"`)로 표시한다. 탭·사이드바 모두이며, 현재 위치는 하나뿐이다.

## Acceptance Criteria

```bash
npm run lint
npm run build      # 출력의 route 목록에 /settings가 있다
npm run test
grep -q '"/settings"' src/lib/paths.ts
grep -q "준비 중이에요" "src/app/(app)/settings/page.tsx"
grep -q 'href="/settings"' "src/app/(app)/account/page.tsx"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (정적 UI는 `page.tsx`, 보호 경로는 `lib/paths`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (페이지는 읽기만, 쓰기 없음, `dangerouslySetInnerHTML` 없음)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `audio.md` "대화 음성"·"위치"의 AI 대화 행, `ui.md` "대화 말풍선"의 음성 재생 행·`/account`·`/settings` 행, `journey.md`의 보호 경로다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/5-tts/step2-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`. spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 음성 설정을 저장하지 마라(DB 컬럼, API, `localStorage` 모두). 이유: 지금은 고를 수 있는 음성이 하나뿐이다. 남성 음성을 넣을 때 계정에 저장하기로 했다(spec `audio.md` "나중에: 남성 음성").
- 남성 타일을 고를 수 있게 하거나 `public/audio/male/`을 만들지 마라. 이유: 남성 음성은 아직 만들지 않는다.
- 브라우저 음성 이름(예: "Male", "Keita")으로 성별을 추정하지 마라. 이유: 대화는 설정과 무관하게 기기 음성을 쓰기로 했다.
- 셸 레이아웃(`src/app/(app)/layout.tsx`)의 상단바를 고치지 마라. 이유: 상단바는 경로를 모른다. spec은 뒤로 pill을 화면 안에 두기로 했다.
- `SpeakButtons`의 동작을 바꾸지 마라. 이유: step 1이 spec대로 만들고 테스트했다. 부족하면 고치지 말고 `error_message`에 적는다.
- `npm run audio:generate`를 실행하지 마라. 이유: 생성은 다음에 사람이 확인하며 돌린다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
