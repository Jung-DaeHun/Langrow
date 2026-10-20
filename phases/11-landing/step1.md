# Step 1: landing-page

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/ui.md` "랜딩" 절 전체(이 step의 기준이다), "화면별 구성" 표의 `/` 행과 그 아래 "플랜 비교표(랜딩)" 항목, "공개 페이지", "레이아웃"의 그리드 문단, "카드"(기본 카드), "칩·태그"(연속일 칩), "아이콘"
- `docs/ADR.md` ADR-022, `docs/spec/journey.md` "유저 저니" 표의 ① 발견 행
- step 0에서 만든 코드: `src/components/LandingPreview.tsx`(props `title`·`openings`)
- 기존 코드: `src/app/page.tsx`(지금 랜딩. 내비·로그인 실패 Notice·비교표·푸터 마크업을 이어 쓴다), `src/components/ChatRoom.tsx`의 `BreakdownTiles`(조각 타일 배치), `src/app/(app)/layout.tsx`의 연속일 칩, `src/components/Furigana.tsx`
- 상수와 데이터: `src/lib/scenarios.ts`(`findScenario`, `l1-cafe`, `FREE_SCENARIOS_PER_LEVEL`, `SCENARIOS_PER_LEVEL`), `src/lib/plan.ts`(`PLAN_LIMITS`, `FREE_DAILY_EXPLANATIONS`, `PRO_PRICE_KRW`, `TRIAL_DAYS`), `src/lib/today.ts`(`DAILY_WORD_GOAL`, `VALID_SESSION_TURNS`), `src/lib/levelTest.ts`, `src/lib/kana.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

랜딩이 2026-10-08 뒤로 바뀌지 않아 한국어 입력·문장 뜯어보기·듣기·후리가나·한글 발음, 상황 잠금과 Free/Pro 상황 수가 빠져 있고, 예로 든 "길 묻기"는 이제 Pro 상황이다. ADR-022대로 디자인 톤(색·글꼴·말풍선)은 그대로 두고 섹션만 다시 짠다.

## 작업

`src/app/page.tsx`만 고친다. Server Component 그대로 두고(`"use client"` 금지), 탭 상태가 필요한 미리보기만 step 0의 `LandingPreview`를 쓴다. `page.tsx`는 TDD guard 예외라 테스트 파일을 만들지 않는다.

섹션 순서와 면 색(spec "공개 페이지"): 내비 → 히어로(크림, 배경 클래스 없음) → ①(흰색 `bg-card`) → ②(`bg-house text-white`) → ③(크림) → 비교표(흰색 `bg-card`) → 푸터(`house`). 섹션 여백 `SECTION`, 최대 너비 `max-w-public`, 섹션 제목 `H2`는 지금 상수를 그대로 쓴다.

1. **내비·로그인 실패 Notice·푸터**: 지금 그대로 둔다.
2. **히어로**: 눈썹 "영어 · 일본어", 제목 "하루 15분, 대화하면서 익히는 영어와 일본어", 설명 "카페 주문, 편의점 계산 같은 상황에서 AI와 대화해요. 말이 막히면 한국어로 써도 돼요."(지금 `text-h3 text-ink-muted` 클래스 유지), [Google로 시작하기] + "만 14세 이상 · 무료로 시작". 오른쪽(모바일은 버튼 아래)은 옛 정적 미리보기를 지우고 `<LandingPreview title={cafe.title} openings={{ en, ja }} />`로 바꾼다.
   - `cafe`는 `findScenario("l1-cafe")`다. 없으면 `throw`한다(데이터 오류라 빌드에서 드러나야 한다).
   - `openings`에는 언어별 `opening`의 `text`·`ko`·`pronKo`만 골라 넘긴다. `opening` 객체를 통째로 넘기지 마라(뜯어보기까지 브라우저로 직렬화된다).
3. **① 처음이어도 괜찮아요**: 항목 3개 목록(`ul`, 모바일 1열·`md:grid-cols-3`). 항목은 아이콘 24px `text-accent`(`aria-hidden`) → `h3` `text-lead font-semibold` → `text-sm text-ink-muted` 설명. 아이콘·문구는 spec 그대로: `Footprints` "모두 입문에서 시작해요", `MessagesSquare` "한국어로 말해도 돼요", `Languages` "일본어는 가나부터"(71은 `KANA.hiragana.length`).
4. **② 대화하다 막히면** (`house` 밴드): 제목·항목 제목 흰색, 설명 `text-white/70`, 아이콘 `text-mint`. 항목 3개, 모바일 1열·`md:grid-cols-3`.
   - `Puzzle` "문장 뜯어보기" + 예시: `cafe.roles.en.opening.breakdown`의 조각 타일. `BreakdownTiles`와 같은 배치(`flex flex-wrap gap-1.5`, 타일 `rounded-lg px-2 py-1 text-center`)에 색만 밴드용: 타일 `bg-uplift`, 조각 `lang="en" text-sm font-semibold text-mint`, 뜻 `text-xs text-white/70`. 값이 없으면 예시를 그리지 않는다.
   - `Volume2` "듣기 · 천천히 듣기"(0.75배는 문구 그대로).
   - `Glasses` "일본어 읽기 도우미" + 예시: `cafe.roles.ja.opening.text`를 `<p lang="ja">` 안에 `<Furigana show />`로, 그 아래 `pronKo`를 `aria-hidden="true"` `text-sm text-mint`로. 행간은 `globals.css`의 `:lang(ja)` 규칙(1.8)에 맡기고 `leading-*` 클래스를 달지 않는다.
5. **③ 매일 조금씩, 할 일은 두 개** (크림): `md:grid-cols-2`, 왼쪽 홈 그림, 오른쪽 항목 2개(①과 같은 모양).
   - 홈 그림: 기본 카드(`rounded-xl bg-card p-5 shadow-card`) 안에 `text-micro text-ink-muted` "홈 화면" → 한 줄에 "오늘 할 일 2개 남았어요"(`font-bold`)와 연속일 칩 → 할 일 줄 2개. 연속일 칩은 `(app)/layout.tsx`의 칩 마크업(`Flame` + "5일", `role="img"`, `aria-label`)을 복사하고 값만 5로 고정한다. 할 일 줄은 `rounded-xl border border-line px-3 py-2.5`, 왼쪽 제목 `font-bold` + 보조 `text-micro text-ink-muted`, 오른쪽 `text-micro tabular-nums`: "새 단어 {DAILY_WORD_GOAL}개" / "플래시카드 → 빈칸 문제" / "0 / {DAILY_WORD_GOAL}", "상황 대화 한 번" / "{VALID_SESSION_TURNS}턴 이상 말하면 완료" / "0 / {VALID_SESSION_TURNS}턴".
   - 항목: `Lightbulb` "왜 정답인지 AI가 설명해요", `TrendingUp` "레벨업하면 새 상황이 열려요"(문제 수·합격 기준은 `LEVEL_TEST_SIZE`·`PASS_SCORE`).
6. **플랜 비교표** (흰색): 제목 "Free로 시작하고, 더 하고 싶으면 Pro" → 지금 표 마크업 → 체험 문구 → [Google로 시작하기]. `PLAN_ROWS`를 spec의 6행으로 바꾼다: AI 대화 턴, 대화 상황(`레벨마다 ${FREE_SCENARIOS_PER_LEVEL}개` / `레벨마다 ${SCENARIOS_PER_LEVEL}개`), 새 단어, AI 정답 설명(`하루 ${FREE_DAILY_EXPLANATIONS}회` / "제한 없음"), "복습 · 레벨업 테스트 · 가나"(한 행, 제한 없음 / 제한 없음), 가격.
7. **정리**: 내 변경으로 안 쓰게 된 상수(`FEATURES`, `AI_BUBBLE`, `TRANSLATION`, 가나 밴드)와 import를 지운다. 파일 위 주석의 섹션 면 색 순서를 새 순서(크림 → 흰색 → house → 크림 → 흰색 → house 푸터)로 고친다.

핵심 규칙:
- 문구 속 숫자(대화 턴·새 단어·가격·체험 일수·상황 수·정답 설명 횟수·가나 글자 수·레벨업 문제 수와 합격 기준·대화 목표 턴)는 spec 목록의 `lib` 상수로 채운다. "하루 15분", "5단계", "0.75배", 홈 그림의 "2개"·"5일"은 상수가 없어 그대로 쓴다.
- 320px에서 말풍선·조각 타일·표가 줄을 바꿔 페이지에 가로 스크롤이 생기지 않아야 한다. 표 셀·타일에 `whitespace-nowrap`을 달지 않는다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
test -z "$(git status --porcelain src/components src/lib src/server src/services supabase data public docs)"   # page.tsx만 바꿨다
test -z "$(grep -n '길 묻기' src/app/page.tsx)"
test -z "$(grep -nE '14,900|하루 [0-9]+(턴|개|회)|레벨마다 [0-9]|[0-9]+자씩|[0-9]+문제 중|[0-9]+일 무료|[0-9]+턴 이상|0 / [0-9]' src/app/page.tsx)"   # 숫자를 직접 쓰지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (`dangerouslySetInnerHTML` 없음, 페이지는 읽기만)
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다. 대상은 `ui.md` "랜딩" 절 전체(미리보기 항목은 step 0 컴포넌트를 쓰는지만), "화면별 구성"의 `/` 행, "플랜 비교표(랜딩)" 항목, "공개 페이지"의 면 색 순서다. step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/11-landing/step1-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`(섹션 구성, 상수로 채운 문구, 지운 상수). spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `LandingPreview.tsx`와 그 테스트를 고치지 마라. 고쳐야 할 문제를 찾으면 고치지 말고 결과 파일 `spec_diff`에 적는다. 이유: step 0에서 spec 대조를 끝냈고, 이 step은 `page.tsx`만 바꾼다.
- `page.tsx`에 `"use client"`를 달거나 랜딩 섹션을 새 컴포넌트 파일로 빼지 마라. 이유: spec이 탭 상태가 필요한 미리보기만 컴포넌트로 두고 나머지는 `page.tsx`에 정적으로 둔다고 정했다(새 파일은 TDD guard가 테스트를 요구한다).
- 섹션·항목을 더하거나 빼지 마라(상황 35개·레벨 잠금 섹션, 후기, FAQ 등). 이유: 운영자가 ①②③ 구성으로 확정했고, 상황 수·잠금은 ③ 한 줄과 표 행으로만 보인다(ADR-022).
- 랜딩 클릭·스크롤을 이벤트로 남기지 마라. 이유: 로그인 전 화면이라 추적하지 않는다(`journey.md` ①).
- 홈 그림에 버튼·링크 모양(`[시작하기]`, 화살표, `href`)을 넣지 마라. 이유: 정적 그림이라 누를 수 있어 보이면 안 된다(spec).
- `ChatRoom.tsx`·`(app)/layout.tsx`를 고치거나 클래스를 공통 파일로 빼지 마라. 이유: 이 step 범위 밖이고, 새 파일은 TDD guard가 테스트를 요구한다. 마크업은 복사해 쓴다.
- 기존 테스트를 깨뜨리지 마라
