# UI 상세 규격

> 요약 규칙은 `docs/UI_GUIDE.md`에 있다. 이 문서는 토큰 값, 컴포넌트 클래스, 화면별 구성을 담는다. 화면·컴포넌트를 구현하는 step은 이 문서를 "읽어야 할 파일"로 지정한다.
> 화면의 동작(상태 전이, 한도, 에러 코드)은 `docs/spec/plan.md`가 기준이다. 이 문서는 그 동작을 어떻게 그릴지만 정한다.
> 새 컴포넌트나 패턴을 만들면 이 문서에 이유와 함께 추가한다.

## 토큰
`src/app/globals.css` (Tailwind v4 기준. v3이면 같은 이름을 `theme.extend`에 넣는다)
```css
@import "tailwindcss";

@theme {
  --color-page: #f2f0eb;
  --color-card: #ffffff;
  --color-zone: #edebe9;
  --color-hover: #f9f9f9;
  --color-house: #1e3932;
  --color-uplift: #2b5148;
  --color-mint: #d4e9e2;
  --color-ok-wash: hsl(160 32% 87% / 33%);
  --color-danger-wash: hsl(4 82% 43% / 5%);
  --color-brand: #006241;
  --color-accent: #00754a;
  --color-ink: rgb(0 0 0 / 0.87);
  --color-ink-muted: rgb(0 0 0 / 0.58);
  --color-line: #e7e7e7;
  --color-line-input: #d6dbde;
  --color-danger: #c82014;
  --color-gold: #cba258;
  --color-gold-light: #dfc49d;
  --color-gold-wash: #faf6ee;
  --color-on-gold: #33433d;

  --font-sans: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;

  --text-display: 2rem;          --text-display--line-height: 1.2;
  --text-display-lg: 2.8125rem;  --text-display-lg--line-height: 1.2;
  --text-h1: 1.5rem;             --text-h1--line-height: 2.25rem;
  --text-h3: 1.1875rem;          --text-h3--line-height: 1.35;
  --text-lead: 1.0625rem;        --text-lead--line-height: 1.4;
  --text-micro: 0.8125rem;       --text-micro--line-height: 1.5;
  --text-quiz: 1.375rem;         --text-quiz--line-height: 1.5;
  --text-word: 2.5rem;           --text-word--line-height: 1.2;
  --text-kana: 6rem;             --text-kana--line-height: 1;

  --radius-bubble: 18px;

  --shadow-card: 0 0 0.5px 0 rgb(0 0 0 / 0.14), 0 1px 1px 0 rgb(0 0 0 / 0.24);
  --shadow-raised: 0 2px 6px rgb(0 0 0 / 0.12), 0 0 1px rgb(0 0 0 / 0.2);
  --shadow-nav: 0 1px 3px rgb(0 0 0 / 0.1), 0 2px 2px rgb(0 0 0 / 0.06), 0 0 2px rgb(0 0 0 / 0.07);
  --shadow-overlay: 0 0 6px rgb(0 0 0 / 0.24), 0 8px 12px rgb(0 0 0 / 0.14);

  --container-app: 45rem;        /* 720 */
  --container-public: 65rem;     /* 1040 */
  --container-form: 32.5rem;     /* 520 */
  --container-prose-doc: 42.5rem; /* 680 */

  --ease-soft: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-spring: cubic-bezier(0.32, 2.32, 0.61, 0.27);
}

body {
  background: var(--color-page);
  color: var(--color-ink);
  font-family: var(--font-sans);
  letter-spacing: -0.01em;
  word-break: keep-all;
  overflow-wrap: anywhere;
  -webkit-font-smoothing: antialiased;
}
/* --font-noto-sans-jp는 next/font가 만든다. 그 className을 <html>에 단다 */
:lang(ja) { font-family: var(--font-noto-sans-jp), "Hiragino Sans", "Yu Gothic", sans-serif; line-height: 1.8; }
rt { font-size: 0.5em; }
```

### 대비 (계산값, WCAG AA 텍스트 4.5:1·아이콘 3:1)
| 조합 | 대비 | 판정 |
|---|---|---|
| `accent` / `card` · `page` | 5.8 · 5.1 | 통과 |
| `brand` / `page` · `mint` | 6.5 · 5.9 | 통과 |
| `ink-muted` / `page` | 5.1 | 통과 |
| `accent` / `mint` | 4.5 | 경계. 굵게 쓰거나 `brand`를 쓴다 |
| `white` · `white/70` / `house` | 12.5 · 7.0 | 통과 |
| `danger` / `card` | 5.7 | 통과 |
| `on-gold` / `gold-wash` | 9.7 | 통과 |
| `gold` / `gold-wash` | 2.2 | **실패**. 골드 아이콘 옆에는 항상 글자를 둔다 |

## 타이포그래피
### 폰트
- **Pretendard Variable**: UI 전체(한글·영문·숫자). npm `pretendard` 패키지의 variable dynamic-subset CSS를 루트 layout에서 import해 자체 호스팅한다. 전체 woff2(약 2MB)를 한 파일로 preload하지 않는다.
- **Noto Sans JP**: 일본어 학습 텍스트(`lang="ja"`)에만 쓴다. `next/font/google`(400·500·700, `preload: false`, `variable: '--font-noto-sans-jp'`)로 불러오고 `:lang(ja)`에 적용한다.
- 디자인 시스템의 Manrope·Lora·Kalam은 쓰지 않는다(한글 글리프 없음).

### 크기
| 용도 | 클래스 | 크기/행간 | 굵기·색 |
|---|---|---|---|
| 랜딩 히어로 | `text-display md:text-display-lg` | 32 → 45 / 1.2 | 600 `brand` |
| 화면 제목 | `text-h1` | 24 / 36 | 600 `brand` |
| 섹션 제목 | `text-h3` | 19 / 1.35 | 600 `ink` |
| 카드 제목, 시트 제목, 퀴즈 보기 | `text-lead` | 17 / 1.4 | 600–700 `ink` |
| 본문, 말풍선, 입력 | `text-base` | 16 / 1.5 | 400 `ink` |
| 보조 | `text-sm` | 14 / 1.5 | 400 `ink-muted` |
| 메타, 캡션 | `text-micro` | 13 / 1.5 | 400 `ink-muted` |
| 탭 라벨, 태그 | `text-xs` | 12 | 600–700 |
| 빈칸 문장 | `text-quiz` | 22 / 1.5 | 600 `ink` |
| 플래시카드 단어 | `text-word` | 40 / 1.2 | 700 `brand` |
| 가나 글자 | `text-kana` | 96 / 1 | 500 `house` |

- 눈썹 라벨(eyebrow)은 `text-micro font-bold text-ink-muted`로 쓴다. 대문자·넓은 자간은 영문(Free, Pro)에만 준다.
- 자간은 본문 `-0.01em`, 제목 `-0.02em`이다. 줄바꿈은 `word-break: keep-all`과 `overflow-wrap: anywhere`, 제목은 `text-wrap: balance`로 한다.
- 바뀌는 숫자(`3 / 10`, 남은 사용량, 턴 수)는 `tabular-nums`로 둔다.
- 일본어 문장의 행간은 1.8로 둔다(후리가나 공간). 후리가나는 `<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>`로 그리고 `rt`는 0.5em이다. 표시 레벨(입문~중급)은 spec 2장 표를 따른다.

## 레이아웃
- **모바일 우선.** 주 사용 맥락은 출퇴근 중 모바일 15분이다.
- 간격은 Tailwind 기본 스케일(4px 단위)만 쓰고 `gap-[13px]` 같은 임의값을 쓰지 않는다. 묶음 간격은 카드 안 요소 `gap-2`, 카드 안 그룹 `gap-4`, 블록 사이 `gap-6`, 홈 섹션 사이 `gap-8`이다.
- 좌우 여백은 모바일 `px-4`, `lg` 이상 `px-10`이다.
- 최대 너비: 앱 본문 `max-w-app`(720), 공개 페이지 `max-w-public`(1040), 온보딩 `max-w-form`(520), 약관 `max-w-prose-doc`(680).
- 그리드: 할 일 카드·상황 타일·가나 행은 모바일 1열, `md`(768) 이상 2열이다. 랜딩 기능 소개는 `md` 이상 3열이다.

### 앱 셸 (로그인 후)
| 영역 | 모바일 (< `lg`) | `lg`(1024) 이상 |
|---|---|---|
| 상단바 | sticky, `bg-page`, 좌: 워드마크 또는 뒤로 pill / 우: 언어·레벨 pill + 연속일 칩 | 워드마크는 사이드바로 옮긴다 |
| 내비게이션 | 하단 고정 탭바 4개: 홈·대화·단어·계정. `bg-card`, 위쪽 그림자, safe-area 여백, 탭 높이 48px 이상 | 왼쪽 사이드바 248px: 워드마크, 홈·대화·단어·레벨업 테스트·가나 익히기(일본어일 때)·계정, 아래에 남은 사용량 카드 |
| 본문 | `pb-24`(탭바 공간) | `pb-16` |

- **집중 모드**(대화방, 종료 피드백, 단어 회차, 레벨업 진행, 가나 카드): 탭바를 숨기고 왼쪽 위에 뒤로 pill을 둔다. 라벨은 [상황 목록]·[그만하기]·[행 선택]처럼 돌아갈 곳이나 하는 일을 적는다. 회차 중 나가면 저장하지 않는다(spec 3장). 회차 시작 카드에 미리 알리고, 나갈 때 확인 대화상자는 띄우지 않는다.
  - 구현 계약: 집중 화면은 루트 요소에 `data-focus-mode`를 단다. 셸 요소(상단바·탭바·사이드바)에는 `data-app-chrome`을 단다. `globals.css`의 `body:has([data-focus-mode]) [data-app-chrome] { display: none }`이 숨긴다. 서버 HTML에 속성이 들어 있어서 하이드레이션 전에도 깜빡이지 않는다.
  - 회차가 페이지 안의 컴포넌트로 시작하는 화면(`/words`, `/kana`)은 페이지 제목·탭에도 `data-app-chrome`을 단다. 회차 동안 셸과 함께 숨겨 뒤로 pill이 화면 맨 위에 오고, 회차 중에 탭을 눌러 답을 잃지 않게 한다.
- 화면을 바꿀 때는 본문 스크롤을 맨 위로 올린다.

### 공개 페이지 (`/`, `/privacy`, `/terms`)
- 상단: sticky 흰 내비게이션(`shadow-nav`)에 워드마크와 [로그인](dark-outline sm)을 둔다. 약관 페이지는 왼쪽에 [돌아가기] pill을 둔다.
- 섹션 패딩은 모바일 `py-10 px-4`, `md` 이상 `py-16 px-10`이다. 구분선 대신 면 색으로 섹션을 나눈다: 크림 → 흰색 → `house` 밴드 → 크림 → `house` 푸터.

## 모양
| 요소 | 모서리 | 그림자 |
|---|---|---|
| 버튼, pill, 칩, 태그, 세그먼트 | `rounded-full` | 없음 |
| 카드, 목록 묶음, 타일, 퀴즈 보기, 안내, 모달 | `rounded-xl`(12) | `shadow-card` |
| 바텀시트 | `rounded-t-xl` | 없음(배경 어둡게) |
| 말풍선 | `rounded-bubble`(18), 꼬리 쪽 아래 모서리만 6px(AI `rounded-bl-md`, 나 `rounded-br-md`) | AI만 `shadow-card` |
| 대화 입력창 | `rounded-3xl` | `shadow-card` |
| 텍스트 입력 | `rounded-sm`(4) | 없음, `border-line-input` |
| 아이콘 원, 전송 버튼, 진행 링 | `rounded-full` | 없음 |
| 플래시카드, 랜딩 대화 미리보기 | `rounded-xl` | `shadow-raised` |
| 모달, 토스트 | `rounded-xl` / `rounded-full` | `shadow-overlay` |

## 컴포넌트
같은 역할에는 아래 컴포넌트만 쓴다. 공용 React 컴포넌트로 만들 것(`Flashcard`, `BlankQuiz`, `Furigana` 등)은 ARCHITECTURE를 따르고, 나머지는 같은 클래스 조합을 반복해 쓴다.

### 공용 React 컴포넌트와 이유
동작(포커스·타이머·API 호출)이 있거나 여러 화면에서 같은 규칙을 지켜야 하는 것만 컴포넌트로 만든다. 버튼·카드·Notice는 래퍼 없이 클래스 조합을 쓴다.

| 컴포넌트 | 이유 |
|---|---|
| `Dialog` | 모달·바텀시트의 포커스 가두기·Esc·포커스 복귀를 한 곳에서 지킨다. jsdom에 `<dialog>.showModal()`이 없어서 직접 구현하고 테스트한다 |
| `Toast` (`ToastHost` + `showToast`) | 셸에 한 번 두고 어디서든 부른다. 체험 시작처럼 호출한 버튼이 곧바로 사라져도 토스트가 남는다 |
| `WaitingDots` | 대기 표시(점 3개)를 하나로 통일한다 |
| `UsageCard` | 홈과 사이드바가 같은 사용량 표시(0이면 danger)를 쓴다 |
| `AppNav` | 탭바·사이드바의 현재 위치(`aria-current`)에 `usePathname`이 필요하다 |
| `TrialButton`, `ProButton` | 체험 시작(`/api/trial`)과 Pro 클릭(`pro_clicked` + 준비 중 모달)을 한도 안내·계정 화면이 같이 쓴다 |
| `LimitNotice` | 한도 도달 안내 3상태를 홈·대화방·단어 화면이 같이 쓴다 |
| `WordExplanation` | AI 정답 설명의 버튼 → 대기 → 설명/오류/한도 상태와 `/api/words/explain` 호출을 빈칸 퀴즈와 복습 카드가 같이 쓴다 |
| `LogoutButton` | 브라우저 Supabase로 로그아웃한다(브라우저가 Supabase를 쓰는 두 곳 중 하나) |
| `ScenarioPicker` | 상황 타일이 열린 세션을 열거나 새 세션을 만든다(API 호출) |

### 버튼
```
Primary: inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-accent text-white font-semibold
         hover:bg-brand active:scale-95 transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed
Outline: (같은 골격) border border-accent text-accent bg-transparent hover:bg-black/5
Dark-outline: (같은 골격) border border-ink text-ink hover:bg-black/5     ← 공개 내비 [로그인]
Pill:    inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-line-input bg-card text-sm font-semibold text-ink hover:bg-hover
         ← 뒤로, 닫기(X), 언어·레벨 전환, [다시 보내기]
Small:   h-9 px-4 text-sm   (Primary/Outline에 덧붙임)
Google:  h-12 px-5 rounded-full border border-line-input bg-card font-semibold text-ink, Google 공식 "G" 로고 SVG + "Google로 시작하기"
```
- 높이는 주된 행동 44px(`h-11`), 보조 36px(`h-9`)이다. 온보딩·퀴즈·결과의 다음 단계 버튼은 `w-full`로 둔다.
- 짝을 지을 때는 primary(진행)와 outline(대안)을 함께 둔다. 예: [다른 상황 고르기] + [홈으로].
- 라벨은 동사로 끝낸다: 시작하기, 다음 문제, 다시 보내기, 7일 무료 체험. 단독 [확인]은 정보 모달에만 쓰고, 확인 대화상자의 실행 버튼은 동사(예: [내리기])로 쓴다.

### 카드
```
기본:   rounded-xl bg-card shadow-card p-5        (큰 시작 카드 p-6, 사이드바 사용량 p-4)
보상:   rounded-xl bg-gold-wash text-on-gold shadow-card p-5     ← Pro 플랜 카드
밴드:   rounded-xl bg-house text-white p-6                       ← 그림자 없음
```

### 목록 묶음 (메뉴·바로가기·결과 목록)
```
묶음: rounded-xl bg-card shadow-card overflow-hidden divide-y divide-line
행:   flex items-center gap-3.5 w-full px-4 py-3.5 text-left hover:bg-hover disabled:opacity-50 disabled:hover:bg-card
선행 아이콘: size-10 rounded-full bg-mint grid place-items-center (아이콘 20px accent)
제목 + 보조: font-bold / text-sm text-ink-muted,  끝: ChevronRight text-ink-muted
```
- 비활성 행은 이유를 보조 문구로 적는다(예: "최고 레벨이에요", "아직 틀린 단어가 없어요").

### 선택 타일 (온보딩 언어·레벨, 언어 시트, 상황 목록)
```
기본: flex items-center gap-3.5 w-full p-4 rounded-xl bg-card shadow-card text-left transition hover:ring-1 hover:ring-line-input
선택: ring-2 ring-accent bg-ok-wash
번호 원: size-9 rounded-full bg-zone font-bold  → 선택 시 bg-accent text-white
```
- 단일 선택은 `role="radio"`와 `aria-checked`, 묶음은 `role="radiogroup"`으로 표시한다.

### 칩·태그
```
태그:     inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold
  기본 bg-mint text-brand (진행 중·완료) / 골드 bg-gold-wash text-on-gold ring-1 ring-inset ring-gold-light (Pro 체험 중)
  회색 bg-zone text-ink-muted (Free, 끝난 세션)
연속일 칩: inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold bg-gold-wash text-on-gold ring-1 ring-inset ring-gold-light
          Flame 16px gold + "12일", aria-label="연속 학습일 12일"
```

### 안내 (Notice)
```
골격: flex items-start gap-3 rounded-xl p-4  — 아이콘 20px, 굵은 제목 + text-sm 설명 + (선택) 버튼
정보:  bg-card shadow-card                  ← 3턴 미만, 불합격, 빈 상태
성공:  bg-mint                              ← 목표 완료, 저장 결과, 첫날 안내
보상:  bg-gold-wash ring-1 ring-inset ring-gold-light   ← 한도 도달 체험 안내, 체험 중, 레벨업 합격
오류:  bg-card ring-1 ring-inset ring-danger, 아이콘 danger, role="alert"
```

### 진행 표시
- **바**: `h-1.5 rounded-full bg-zone overflow-hidden`, 채움 `bg-accent`(width 400ms)이다. 회차 진행은 `h-1`이고, 위에 왼쪽 단계 이름과 오른쪽 `i / n`을 둔다. 사용량이 0이 되면 채움을 `bg-danger`로 바꾼다. `role="progressbar"`와 `aria-valuenow`/`aria-valuemax`를 단다.
- **링**(홈 할 일 카드만): 64px, `conic-gradient(accent p%, zone 0)` 안에 흰 원 50px과 `3/10` 라벨을 둔다. 완료되면 라벨 대신 Check 아이콘을 넣는다.

### 세그먼트 (단어: 오늘의 학습/오답 복습, 가나: 히라가나/가타카나)
```
inline-flex rounded-full bg-zone p-1 gap-0.5
항목: rounded-full px-4 py-2 text-sm font-semibold text-ink-muted  → 선택: bg-card text-brand shadow-card
```
- `role="tablist"`/`role="tab"`과 `aria-selected`를 단다.

### 바텀시트 (언어·레벨 메뉴)
- 배경 `bg-black/50`, 시트는 `w-full max-w-[560px] rounded-t-xl bg-card px-5 pt-5 pb-7`이고 300ms 동안 아래에서 올라온다.
- 제목(`text-lead font-bold`)과 닫기 pill(X, `aria-label="닫기"`)을 둔다. 배경 탭과 Esc로 닫고, 열려 있는 동안 포커스를 안에 가두며, 닫으면 연 버튼으로 포커스를 돌려준다.

### 모달 (확인 대화상자)
- 가운데에 `max-w-[500px] rounded-xl bg-card p-6 shadow-overlay`로 띄운다. 제목은 `text-h1 text-brand`, 오른쪽 위에 닫기 버튼(40px 원, `bg-black/5`)을 둔다. 버튼은 오른쪽 정렬로 [취소](outline) + 실행(primary)이다.
- 쓰는 곳: 레벨 내리기 확인, Pro 클릭 시 "정식 출시 준비 중". 포커스 규칙은 바텀시트와 같다.

### 토스트
- 하단 가운데(탭바 위 `bottom-24`)에 `rounded-full bg-house text-white text-sm font-semibold px-4.5 py-2.5 shadow-overlay`로 띄우고 2.4초 뒤 사라진다. `role="status"`를 단다.
- `(app)` 레이아웃에 `ToastHost`를 한 번 두고, Client Component는 `showToast(message)`로 띄운다.
- 짧은 성공 확인에만 쓴다(예: "7일 Pro 체험을 시작했어요", "레벨을 내렸어요"). 에러는 토스트로 띄우지 않고 그 자리에 오류 안내로 보여 준다.

### 입력
```
대화 입력창: flex items-end gap-2 rounded-3xl bg-card shadow-card p-1.5 pl-4
  textarea: flex-1 resize-none bg-transparent py-2 text-base outline-none max-h-30 (자동 높이)
  전송:     size-11 rounded-full bg-accent text-white (ArrowUp) disabled:bg-zone disabled:text-ink-muted, aria-label="보내기"
체크박스:   24px, 테두리 2px ink-muted → 선택 시 accent 채움 + Check(스프링 300ms). 라벨 전체가 클릭 영역
```
- 입력 글자 크기는 16px 이상이다(iOS 자동 확대 방지).
- 250자가 넘으면 오른쪽 아래에 `n / 300`을 보여 주고, 300자를 넘으면 `danger` 굵게 바꾼다. 글자 수는 `lib/text`로 센다.
- Enter는 전송, Shift+Enter는 줄바꿈이다. IME 조합 중(`isComposing`)에 누른 Enter는 무시한다.
- placeholder는 레벨에 따라 다르다. 입문·초보는 "영어로 답해 보세요. 한국어도 괜찮아요", 중급 이상은 "영어로 답해 보세요"(일본어도 같은 형식)로 쓴다.

### 대화 말풍선
| 요소 | 규칙 |
|---|---|
| AI 말풍선 | 왼쪽, `max-w-[84%] rounded-bubble rounded-bl-md bg-card shadow-card px-3.5 py-3`. `lang`은 학습 언어로 단다 |
| 내 말풍선 | 오른쪽, `rounded-bubble rounded-br-md bg-house text-white` |
| 번역 | AI 말풍선 안 아래쪽에 구분선(`border-t border-line`)을 두고 `text-sm text-ink-muted`로 쓴다. 입문·초보는 항상 펼친다. 중급 이상은 말풍선 아래 "번역" 메타(Languages 14px + `text-xs font-semibold text-accent`)를 두고, 말풍선 전체를 `<button aria-expanded>`로 만들어 탭하면 펼친다 |
| 교정 | 내 말풍선 **바로 아래, 말풍선 밖에** 오른쪽 정렬 `max-w-[84%] rounded-xl bg-mint p-3`로 둔다. 순서는 라벨(`text-micro text-ink-muted`: "이렇게 말하면 더 자연스러워요", 한국어로 입력했으면 "이렇게 말하면 돼요") → 고친 문장(`font-bold text-brand`, 학습 언어 `lang`) → 설명(`text-sm`)이다. 항상 펼쳐 둔다 |
| 교정 없음 | `correction`이 `null`이면 아무것도 표시하지 않는다("자연스러워요" 배지도 없음) |
| 응답 대기 | 내 말풍선을 바로 그리고, AI 자리에 점 3개(7px, 1초 반복)를 띄운다. 메시지 목록에 `aria-live="polite"`를 단다 |
| 전송 실패(503) | 내 말풍선을 `bg-card text-ink ring-1 ring-inset ring-danger`로 바꾸고, 아래에 CircleAlert + "응답을 받지 못했어요. 턴은 차감되지 않았어요." + [다시 보내기] pill을 둔다. 입력은 지우지 않는다 |
| 대화방 상단 | 왼쪽: [상황 목록] pill / 가운데: 상황 제목(`font-bold`) + `n / 20턴`(`text-micro`) / 오른쪽: [대화 끝내기](outline sm) |
| 한도(429 `LIMIT_REACHED`) | 서버가 429를 준 뒤에만 입력창 자리를 체험 안내(보상 Notice)로 바꾼다. 표시된 남은 사용량만 보고 막지 않는다. [대화 끝내기]는 계속 쓸 수 있다 |
| 실패 10회(429 `AI_FAILURE_LIMIT`) | 입력창을 비활성화하고 서버 `message`를 정보 Notice로 보여 준다 |

### 플래시카드
- 카드: `w-full max-w-[440px] aspect-[4/3.4] mx-auto rounded-xl bg-card shadow-raised`. 내용은 가운데 정렬이고 `<button>`이다(Space·Enter로 뒤집기).
- 단어 앞면: 단어(`text-word`, 일본어는 레벨 규칙대로 후리가나), 아래에 "탭해서 뜻 보기"(RotateCw 13px, `text-micro`). 단어 뒷면: 뜻(28px 700), 정답을 채운 예문, `example_ko`(`text-sm text-ink-muted`).
- 가나 앞면: 글자(`text-kana`). 가나 뒷면: 글자(56px)와 `a · 아`(32px 700 `brand`, 로마자 · 한글).
- 뒤집기는 `rotateY` 450ms다. 카드 아래에 [모르겠어요](outline)와 [알아요](primary)를 `flex-1`로 나란히 둔다. 가나에서 [모르겠어요]를 누른 글자는 회차 끝에 다시 나온다.
- 오답 복습 카드만 뒤집은 뒤 카드와 버튼 사이에 AI 정답 설명(라벨 [예문 설명])을 둔다. 앞면일 때와 단어 학습·가나 카드에는 두지 않는다.

### 빈칸 퀴즈 (단어 학습·레벨업 공용)
- 위에 진행(단계 이름 + `i / n` + 바)을 둔다.
- 문제 카드(`p-6`): 문장(`text-quiz`)과 빈칸 `inline-block min-w-18 border-b-2 border-accent`, 아래에 `example_ko`를 둔다.
- 보기 4개는 세로로 쌓는다: `w-full rounded-xl bg-card shadow-card px-4.5 py-4 text-lead font-semibold text-left`. 일본어 보기에도 레벨 규칙대로 후리가나를 단다.
- 단어 학습은 고르면 바로 채점을 보여 준다. 정답은 `ring-2 ring-accent bg-ok-wash` + CircleCheck, 고른 오답은 `ring-2 ring-danger bg-danger-wash` + CircleX다. 그 아래에 "정답이에요." 또는 "오답이에요. 정답은 **X** (뜻)", AI 정답 설명(라벨 [왜 정답이에요?]), [다음 문제]/[결과 보기](primary, `w-full`) 순서로 둔다.
- 레벨업 테스트는 정답을 보여 주지 않는다. 고르면 바로 다음 문제로 넘어가고, 제출 뒤 "채점하고 있어요"(점 3개, 가운데 정렬)를 띄운다. AI 정답 설명은 두지 않는다.

### AI 정답 설명 (빈칸 퀴즈·오답 복습 카드)
| 상태 | 표시 |
|---|---|
| 처음 | Outline Small 버튼 `w-full`: 빈칸은 [왜 정답이에요?], 복습 카드는 [예문 설명]. 보조 행동이라 primary를 쓰지 않는다 |
| 대기 | 버튼 자리에 점 3개(`WaitingDots`). `aria-live="polite"` 영역 안에 둔다 |
| 설명 | 교정 카드와 같은 `rounded-xl bg-mint p-3`에 라벨(`text-micro text-ink-muted`: "AI 설명") → 설명(`text-sm`, 일본어 표기는 `Furigana`로 레벨 규칙대로). 버튼은 다시 보이지 않는다 |
| 실패(503·네트워크·그 밖의 오류) | 오류 Notice: 서버 `message`(503은 "설명을 만들지 못했어요. 횟수는 차감되지 않았어요.", 네트워크는 "연결을 확인해 주세요.") + [다시 시도] pill. 404여도 홈으로 이동하지 않는다 |
| 한도(429 `LIMIT_REACHED`, Free만) | 보상 Notice: "오늘 AI 설명 20회를 모두 썼어요" + "Pro는 AI 설명을 제한 없이 볼 수 있어요." + 체험 가능하면 [7일 무료 체험](outline sm), 체험을 썼으면 [Pro 시작하기](outline sm). 회차의 primary는 [다음 문제]이므로 버튼을 outline으로 두고 [내일 할게요]는 두지 않는다 |
| 실패 10회(429 `AI_FAILURE_LIMIT`) | 정보 Notice로 서버 `message`를 보여 준다. 버튼 없음 |

- 429를 받으면 같은 회차의 남은 문제·카드에서도 버튼 대신 같은 안내를 보여 준다. 회차를 새로 시작하면 다시 버튼을 보여 준다.
- 기다리는 중에 다음 문제·카드로 넘어가면 늦게 온 응답은 그리지 않는다.

### 사용량 표시
- 항목마다 왼쪽에 이름(AI 대화 턴 / 새 단어), 오른쪽에 "**n** / max 남음"을 두고 아래에 바를 둔다. 0이면 숫자와 바를 `danger`로 바꾼다.
- 홈에서는 아래에 "한국 시간 자정에 다시 채워져요. 영어·일본어 사용량을 합산해요."를 `text-micro`로 덧붙인다.
- 표시 위치: 홈 하단, `lg` 이상 사이드바 하단.

### 한도 도달 안내
| 사용자 상태 | 표시 |
|---|---|
| Free, 체험 가능 | 보상 Notice(Sprout gold): "오늘 {AI 대화 턴/새 단어}을 모두 썼어요" + Pro 한도 설명 + "결제 정보는 받지 않아요." + [7일 무료 체험](primary sm) + [내일 할게요](outline sm) |
| Free, 체험 사용함 | 보상 Notice + [Pro 시작하기](primary sm) → "정식 출시 준비 중" 모달 |
| 체험 중 | 정보 Notice(Moon): 자정에 다시 채워진다는 안내와 복습·레벨업 테스트는 계속 할 수 있다는 안내. 버튼 없음 |

홈에서 대화·단어 한도에 모두 닿으면 안내는 하나만 둔다. 제목은 "오늘 AI 대화 턴과 새 단어를 모두 썼어요"이다(primary는 화면에 하나).

## 아이콘
- `lucide-react`를 쓴다. 기본 크기는 20px(인라인 16, 탭바 22, 랜딩 기능 24)이고 `strokeWidth` 2다.
- 색: 밝은 면 위에서는 `accent`, 어두운 면 위에서는 흰색, 꺾쇠·닫기는 `ink-muted`/`ink`이다.
- 아이콘 원형 배경(`bg-mint`)은 목록 행과 선택 타일의 앞 아이콘에만 쓴다. 그 밖의 아이콘은 배경 없이 쓴다.
- 장식 아이콘에는 `aria-hidden`을 달고, 아이콘만 있는 버튼에는 `aria-label`을 단다.

| 의미 | 아이콘 | 의미 | 아이콘 |
|---|---|---|---|
| 홈 | `House` | 연속 학습일 | `Flame` |
| 대화 | `MessagesSquare` | 오답 복습 | `RotateCcw` |
| 단어 | `BookOpen` | 번역 | `Languages` |
| 계정 | `CircleUserRound` | 잘한 점 / 고칠 점 | `ThumbsUp` / `Pencil` |
| 레벨업 테스트 | `TrendingUp` | 정답 / 오답 | `CircleCheck` / `CircleX` |
| 가나 익히기 | `Languages` | 오류 / 정보 | `CircleAlert` / `Info` |
| Pro·체험 | `Sprout` | 레벨업 합격 | `Award` |
| 뒤로 / 이동 / 펼침 | `ChevronLeft` / `ChevronRight` / `ChevronDown` | 전송 / 닫기 / 추가 | `ArrowUp` / `X` / `Plus` |

## 애니메이션
허용하는 것만 적는다. 그 밖의 애니메이션은 쓰지 않는다.
| 대상 | 값 |
|---|---|
| 버튼 hover·press | `transition` 200ms ease, 누르면 `scale-95` |
| 화면 진입 | 250ms, opacity 0 → 1 + 아래 6px에서 올라옴 |
| 바텀시트 | 300ms 아래에서 올라옴, `cubic-bezier(.25,.46,.45,.94)` |
| 플래시카드 뒤집기 | 450ms `rotateY(180deg)`, 같은 easing |
| 진행 바 | width 400ms ease |
| 체크박스 | 300ms 스프링 `cubic-bezier(.32,2.32,.61,.27)` |
| 응답 대기 점 3개 | opacity 1초 반복, 0.15초씩 지연. **유일한 반복 애니메이션** |

- `prefers-reduced-motion: reduce`이면 모두 즉시 바꾼다(`motion-reduce:transition-none`, 뒤집기는 회전 없이 면만 바꿈).

## 상태 패턴
| 상태 | 표시 |
|---|---|
| AI 대기·채점 중 | 점 3개 하나로 통일한다. 스피너·스켈레톤은 쓰지 않는다 |
| 저장 중 | 해당 버튼을 비활성화하고 라벨을 "저장 중…"으로 바꾼다 |
| 빈 상태 | 정보 Notice(Inbox): 한 줄 이유 + 다음 행동. 예: "아직 틀린 단어가 없어요 / 오늘의 학습에서 틀린 단어가 여기에 모여요" |
| 첫날 | 학습 기록이 없는 사용자(`last_study_date` 없음)다. 성공 Notice "첫날이에요"를 두고, **대화** 할 일 카드에 `ring-2 ring-accent`와 "여기서 시작하세요" 태그를 단다(저니 ④, 첫 세션 완료율). 카드 순서는 단어 → 대화 그대로다 |
| 목표 완료 | 할 일 카드 버튼 자리에 "완료" 태그를 달고, 링 안에 Check를 넣는다 |
| 새 단어 소진 | 할 일 카드 자리에 "이 레벨의 새 단어를 모두 학습했어요"와 안내 버튼(레벨 1~4: 레벨업 테스트·오답 복습 / 5: 오답 복습·대화)을 둔다 |
| 인라인 오류 | 해당 영역에 오류 Notice로 서버 `message`를 보여 준다. 입력·결과를 보존하고 [다시 시도] 버튼을 둔다. 자동으로 반복하지 않는다(`CONFLICT` 포함) |
| 페이지 오류 | `error.tsx`·`not-found.tsx`도 같은 셸을 쓴다: `text-h1` + 한 줄 설명 + [홈으로](primary) |
| 종료 처리 중(202) | 피드백 화면에 "피드백을 만들고 있어요"와 점 3개를 보여 주고, `retryAfterSeconds`마다 다시 확인한다 |

## 화면별 구성
프로토타입의 기준 변형은 홈 A(카드), 랜딩 A(분할), 단어 플래시카드, 계정 플랜 카드다.

| 경로 | 위에서부터 |
|---|---|
| `/` | 공개 내비 → 히어로(`md` 이상 6:5 분할): 눈썹 "영어 · 일본어", 히어로 제목, 19px 설명, [Google로 시작하기] + "만 14세 이상 · 무료로 시작" / 오른쪽 대화+교정 미리보기(실제 말풍선·교정 스타일과 같게) → 흰 섹션 기능 3개(아이콘+제목+설명) → `house` 밴드 가나 소개 → 플랜 비교표 + "7일 무료 체험은 계정당 한 번" + Google 버튼 → 푸터(이용약관·개인정보처리방침). 로그인 실패 시 히어로 위에 오류 Notice "로그인을 완료하지 못했어요" |
| `/onboarding` | `max-w-form`. 상단: [이전] pill(첫 단계는 워드마크, 언어 추가는 [취소]) + `n / 3` + 진행 바 → ① 동의: 제목, 국외 이전 설명(`text-sm`), 카드 안 체크박스("[필수] 만 14세 이상이며, 이용약관과 개인정보처리방침(국외 이전 포함)에 동의합니다", 링크 포함), [동의하고 계속] ② 언어 타일 2개(EN/JA) ③ 레벨 타일 5개(번호 원·이름·설명, 일본어 입문·초보에 "가나 익히기 포함") + [학습 시작]. 안내 문구: "이후 올리기는 레벨업 테스트로, 내리기는 상단 언어 메뉴에서 할 수 있어요" |
| `/home` | 상단바(언어·레벨 pill, 연속일 칩) → `text-sm` "영어 · 중급" + 체험 태그("체험 n일 남음"/"체험이 끝났어요") → 제목 "오늘 할 일 n개 남았어요"/"오늘 목표를 끝냈어요" → 첫날 Notice → 할 일 카드 2개(아이콘·제목·보조·링·[시작하기]/[계속하기]/"완료") → 한도 안내 → 이어서 대화하기 타일(제목, `n / 20턴 · "마지막 문장"` 한 줄 말줄임. `ending` 세션은 "피드백 확인") → 섹션 "더 학습하기" 목록 묶음(오답 복습 n개, 레벨업 테스트 `중급 → 상급 · 20문제 중 16개`, 가나 익히기) → 섹션 "오늘 남은 사용량" 카드 |
| 언어 시트 | 제목 "학습 언어" → 언어 타일(EN/JA, "레벨 n · 이름" 또는 "새 언어 추가하기", 현재 언어 Check / 새 언어 Plus) → 현재 언어 레벨이 2 이상이면 [레벨 내리기 (중급 → 초보)](outline) → 확인 모달 |
| `/chat` | `text-sm` "영어 · 중급 상황" + 제목 "어떤 상황에서 말해 볼까요?" → "오늘 대화 턴 n개 남음 · 한 세션은 최대 20턴" → 상황 타일 4개(`text-micro` "상황 n" + 상태 태그 "n턴 진행 중"/"완료", 제목 `text-lead`, 설명 `text-sm`) |
| `/chat/[id]` | 집중 모드. 대화방 상단 → 메시지 목록(첫 마디 포함) → 입력창(sticky 하단, `bg-page`). 20턴째 응답 뒤에는 자동으로 종료한다. 다른 탭이나 이전 방문에서 보낸 턴이 처리 중이면 그 내 말풍선과 대기 점을 보여 주고, 전송과 [대화 끝내기]를 막은 채 3초마다 다시 읽는다. 작업 기한이 지나면 기다리기를 멈춘다(다음 전송 때 서버가 복구) |
| 종료 피드백 | `text-sm` "상황 제목 · n턴" + 제목 "대화 피드백" → 3턴 이상이면 성공 Notice "오늘 대화 목표를 채웠어요", 미만이면 정보 Notice → 카드 "잘한 점"(ThumbsUp) → 카드 "고칠 점"(Pencil, 최대 3개, 항목 사이 구분선) → [다른 상황 고르기] + [홈으로]. 대체 결과(fallback)는 고정 안내 Notice와 턴별 교정 목록, 0턴(skipped)은 피드백 카드 없이 버튼만 둔다 |
| `/words` | 제목 "단어" → 세그먼트(오늘의 학습 / 오답 복습 n) → 시작 카드(눈썹 "영어 · 중급", "오늘 n / 10"(오늘 목표를 채웠고 오늘 남은 한도가 있으면 "오늘 목표 완료 · m개 더 할 수 있어요". Free는 한도가 목표와 같아 사실상 Pro만 해당), 28px "새 단어 n개", "끝까지 풀면 한 번에 저장돼요. 중간에 나가면 저장되지 않아요.", [시작하기]) 또는 한도·소진 상태 → 회차(집중): 플래시카드 → 빈칸(채점 뒤 [왜 정답이에요?]) → 결과("n개 중 m개 맞혔어요", 성공 Notice 저장 결과, 틀린 단어 목록, [홈으로] + [단어 화면으로]). 오답 복습: 틀린 단어 회색 태그 목록 + "복습은 하루 사용량에 포함되지 않아요." + [복습 시작] → 플래시카드만(뒤집으면 [예문 설명]) → 결과 |
| `/level-up` | 시작: `text-sm` 언어 + 제목 "중급 → 상급 레벨업 테스트" → 규칙 카드(ListChecks "중급 단어 빈칸 20문제", Target "16개 이상 맞히면 레벨 +1", Repeat "재응시 제한 없음 · 사용량에 포함되지 않아요") → "제출하면 서버가 채점해요" → [테스트 시작] → 문제(집중) → 채점 중 → 결과: "20문제 중 n개 정답 · 기준 16개" + 제목 + 바(합격 `accent`, 불합격 `ink-muted`. 빨강 금지) + 합격 보상 Notice(Award, "새 상황 4개가 열렸어요") [새 상황 보기] / 불합격 정보 Notice("n개만 더 맞히면 통과예요") [다시 보기] + [홈으로]. 고수는 정보 Notice "이미 최고 레벨이에요" |
| `/kana` | 제목 + "사용량에 포함되지 않아요" → 세그먼트(히라가나/가타카나) + [71자 전체](outline sm) → 섹션 "기본 46자" 행 타일(글자 22px `house`, "あ행 · 5자") → 섹션 "탁음·반탁음 25자" → 카드(집중) → 완료(제목 "あ행 5자 완료", 성공 Notice, 글자 5열 격자, [한 번 더] + [다른 행]) |
| `/account` | 제목 "계정" + 이메일(`text-sm`) → 섹션 "플랜"(오른쪽에 Free/체험 태그): 플랜 카드 2개(아래) + 체험 블록(체험 가능: [7일 무료 체험 시작] + "계정당 한 번 · 결제 정보 없이 시작해요" / 체험 중: 보상 Notice "Pro 체험 중 · n일 남음 / 체험이 끝나면 Free로 돌아가요. 자동 결제는 없어요." / 체험 끝: [Pro 시작하기 · 월 9,900원] + "무료 체험은 이미 사용했어요." → 모달). 버튼은 `w-full`, 아래 문구는 `text-micro text-ink-muted text-center` → 목록 묶음(이용약관, 개인정보처리방침, 회원 탈퇴 안내 문구) → [로그아웃](outline) |
| `/privacy`, `/terms` | [돌아가기] pill + 워드마크 → `max-w-prose-doc` 본문: `text-h1`, 시행일(`text-micro`), 소제목 17px 700, 문단 15px/1.7 |

- 플랜 카드(계정): 모바일 1열, `md` 이상 2열(`gap-4`)이다. Free는 기본 카드, Pro는 보상 카드(`bg-gold-wash text-on-gold`)이며 둘 다 `p-5`, 내부 `gap-2`다. 순서는 첫 줄 플랜 이름(`font-bold`)과 오른쪽 태그 → 한도 한 줄(`text-sm text-ink-muted`: "대화 하루 20턴 · 새 단어 하루 10개" / "대화 하루 150턴 · 새 단어 하루 30개") → 가격(`text-h1 font-bold`: "무료" / "월 9,900원")이다. 태그는 체험 중이 아니면 Free 카드에 "현재"(기본 태그), 체험 중이면 Pro 카드에 "체험 중"(골드 태그)을 단다.
- 플랜 비교표(랜딩): 열은 항목/Free/Pro, 행은 AI 대화 턴·새 단어·복습·레벨업 테스트·가나·가격이다. 숫자 열은 오른쪽 정렬하고 Pro 값은 굵게, 행 사이는 `border-line` 구분선으로 둔다. 머리글은 `text-micro font-bold text-ink-muted`이다.
