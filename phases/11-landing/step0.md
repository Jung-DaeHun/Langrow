# Step 0: landing-preview

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/ui.md` "랜딩" 절의 "대화 미리보기" 항목과 그 아래 고정 문구 표(이 step의 기준이다), "세그먼트", "대화 말풍선", "타이포그래피"의 후리가나 문단, "공용 React 컴포넌트와 이유"의 `LandingPreview` 행
- `docs/spec/testing.md` "컴포넌트"의 "랜딩 미리보기" 항목
- `docs/ADR.md` ADR-022
- 기존 코드: `src/components/ChatRoom.tsx`(`AI_BUBBLE`·`MY_BUBBLE` 상수, 교정 카드 마크업, `AiBubble`의 `alwaysOpen` 분기와 한글 발음 줄), `src/components/KanaDeck.tsx`(세그먼트 `SEGMENT_ITEM`·`role="tablist"` 마크업), `src/components/Furigana.tsx`, `src/lib/scenarios.ts`(`ScenarioLine` 타입, `l1-cafe` 첫 마디), `src/lib/levels.ts`(`Language` 타입)
- 테스트 방식: `src/components/KanaDeck.test.tsx`(Testing Library·`userEvent` 사용법)
- 지금 랜딩: `src/app/page.tsx`(옛 정적 미리보기. 이 step에서는 고치지 않는다. step 1이 이 컴포넌트로 바꾼다)

## 배경

랜딩을 ADR-022대로 다시 짠다. 이 step은 히어로 오른쪽 대화 미리보기를 영어/일본어 탭으로 바꾸는 클라이언트 컴포넌트 `LandingPreview`만 만든다. 랜딩의 나머지 섹션과 `page.tsx` 연결은 step 1이 한다.

## 작업

TDD: 테스트를 먼저 쓰고 실패를 본 뒤 구현한다.

### 1. `src/components/LandingPreview.test.tsx`

`testing.md` "랜딩 미리보기" 항목을 그대로 검사한다. props는 테스트 안에서 `l1-cafe` 첫 마디와 같은 값을 직접 만들어 넘긴다(`scenarios.ts`를 import해서 꺼내 써도 된다).

- 처음 렌더에서 [영어] 탭이 `aria-selected="true"`, [일본어]는 `"false"`이고, `role="tabpanel"` 안에 영어 첫 마디·번역, 내 말풍선 "아이스 아메리카노 주세요", 라벨 "이렇게 말하면 돼요", 교정 문장 "Can I get an iced americano?", 교정 설명, AI 답 "Sure! What size would you like?"와 그 번역이 있다.
- 영어 탭에는 한글 발음 줄이 없다(미리보기 안에 `aria-hidden="true"` 요소가 없음).
- [일본어] 탭을 누르면 선택이 바뀌고, 첫 마디와 교정 문장(`アイスコーヒーを[一|ひと]つください。`)이 `ruby`/`rt`로 그려진다(`一` 위에 `ひと`). 첫 마디·교정 문장·AI 답의 한글 발음이 `aria-hidden="true"` 요소로 있다.
- 문장마다 `lang`이 있다: 학습 언어 문장은 `en`/`ja`, 내 말풍선·번역·교정 설명은 `ko`.
- 탭 말고는 버튼이 없다: `queryAllByRole("button")`이 비어 있다(탭은 `role="tab"`). 듣기·번역·뜯어보기 버튼을 두지 않는다는 spec 확인이다.

### 2. `src/components/LandingPreview.tsx`

```tsx
"use client";
type PreviewLine = Pick<ScenarioLine, "text" | "ko" | "pronKo">;
export function LandingPreview(props: { title: string; openings: Record<Language, PreviewLine> })
```

- `title`은 상황 제목("카페에서 음료 주문하기"), `openings`는 `l1-cafe`의 언어별 첫 마디다. step 1에서 `page.tsx`가 골라 넘긴다.
- 상태는 지금 탭(`Language`) 하나다. 처음 값은 `"en"`이다(서버 렌더도 영어).
- 나머지 문구는 이 파일 안 상수로 둔다. `ui.md` 고정 문구 표의 값을 한 글자도 바꾸지 말고 그대로 넣는다(2026-10-19 운영자 검수 확정본이다). 일본어 교정 문장은 표기 `アイスコーヒーを[一|ひと]つください。` 그대로 넣고 `Furigana`로 그린다. 영어에는 한글 발음 값이 없다.
- 위에서부터: `rounded-xl bg-page p-4 shadow-raised md:p-5` 상자 → 세그먼트 [영어 | 일본어](`KanaDeck`과 같은 클래스·`role="tablist"`/`tab`·`aria-selected`, tablist에 `aria-label`) → `role="tabpanel"`(지금 탭을 `aria-labelledby`로 가리킨다. id는 `useId`) 안에 `text-micro text-ink-muted` "상황 · {title}" → AI 말풍선(첫 마디) → 내 말풍선 → 교정 카드 → AI 말풍선(답).
- AI 말풍선은 대화방 `AiBubble`의 입문 레벨 모양(`alwaysOpen`)과 같게 그린다: 바깥 `flex max-w-[84%] flex-col items-start gap-1 self-start`, 안쪽 `AI_BUBBLE` 클래스, 본문(`lang`, `whitespace-pre-wrap wrap-anywhere`, `Furigana` `show={language === "ja"}`) → 한글 발음(값이 있을 때만, `aria-hidden="true"`, `mt-1 block text-sm text-brand`) → 번역(`lang="ko"`, `mt-2 block border-t border-line pt-2 text-sm text-ink-muted`).
- 내 말풍선은 `MY_BUBBLE` + `bg-house text-white`, `lang="ko"`.
- 교정 카드는 대화방과 같은 `flex max-w-[84%] flex-col gap-1 self-end rounded-xl bg-mint p-3` 안에 라벨 `text-micro text-ink-muted` "이렇게 말하면 돼요" → 고친 문장(`lang`, `font-bold text-brand`, `Furigana`) → 한글 발음(일본어만, `aria-hidden="true"`, `text-sm text-brand`) → 설명(`lang="ko"`, `text-sm`).
- 클래스 문자열은 `ChatRoom.tsx`에서 복사해 이 파일 상수로 둔다. 이유: `ChatRoom`의 상수는 그 파일 안에만 있고, 공통 파일로 빼면 TDD guard가 그 파일의 테스트를 요구하며 `ChatRoom`까지 고쳐야 한다. 지금 `page.tsx`도 복사해 쓴다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
test -z "$(git status --porcelain src/app src/lib src/server src/services supabase data public docs)"   # 컴포넌트만 바꿨다
test -z "$(grep -n '@/lib/scenarios' src/components/LandingPreview.tsx | grep -v 'import type')"     # 상황 데이터를 값으로 가져오지 않는다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/components/LandingPreview.tsx`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, 후리가나는 `Furigana`의 `<ruby>`)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `ui.md` "랜딩"의 "대화 미리보기" 항목과 고정 문구 표, `testing.md` "랜딩 미리보기"다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/11-landing/step0-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(props 모양, 고정 문구를 둔 곳, 테스트 항목). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `LandingPreview.tsx`에서 `@/lib/scenarios`를 값으로 import하지 마라(`import type`만 된다). 이유: 상황 35개의 역할·첫 마디·뜯어보기가 모두 브라우저 번들에 들어간다. spec은 `page.tsx`가 첫 마디만 골라 props로 넘기게 한다.
- 고정 문구(일본어 문장·한글 발음·설명)를 고치거나 "더 자연스럽게" 다듬지 마라. 이유: 운영자가 검수해 확정한 문장이고, 바꾸면 다시 검수해야 한다(ADR-022).
- 듣기(`SpeakButtons`)·번역 토글·문장 뜯어보기 토글을 넣지 마라. 이유: spec이 미리보기에는 버튼을 두지 않는다고 정했다. 번역은 늘 펼친다.
- 탭 전환·클릭을 이벤트로 남기지 마라(`/api` 호출, `logEvent` 등). 이유: 로그인 전 화면이라 클릭은 추적하지 않는다(`journey.md` ①).
- `ChatRoom.tsx`·`KanaDeck.tsx`를 고치거나 클래스 상수를 공통 파일로 빼지 마라. 이유: 위 "클래스 문자열" 항목, 이 step 범위 밖이다.
- `src/app/page.tsx`를 고치지 마라. 이유: step 1이 랜딩 전체와 함께 바꾼다.
- hook 통과용 빈 테스트를 만들지 마라. 이유: CLAUDE.md.
- 기존 테스트를 깨뜨리지 마라
