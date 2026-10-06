# Step 1: ui-shell

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/ui.md` **전체**(토큰, 레이아웃·앱 셸, 모양, 컴포넌트, 아이콘, 애니메이션, 상태 패턴). 이 step의 기준 문서다
- `docs/spec/plan.md` 6-1 "페이지 접근 규칙", 6-9 "TDD hook에 맞춘 파일 규칙", 6-10 "에러 코드"(클라이언트 동작 열)
- step 0 산출물: `src/server/page.ts`(`requireReady`, `loadTodayUsage`, `ReadyPage`), `src/server/db/reads.ts`(`AccountState`, `TodayUsage`)
- 앞 phase 산출물:
  - `src/types/api.ts`(`ApiError`, `LevelResponse`), `src/lib/errors.ts`(`ERRORS`, `isErrorCode`)
  - `src/lib/levels.ts`(`LANGUAGES`, `LANGUAGE_NAMES`, `LEVEL_INFO`), `src/lib/plan.ts`(`PLAN_LIMITS`, `planAt`), `src/lib/usage.ts`, `src/lib/streak.ts`(`displayStreak`), `src/lib/furigana.ts`(`parseFurigana`)
  - `src/app/api/me/language/route.ts`, `src/app/api/levels/[language]/route.ts`(body·응답 형태)
  - `src/app/layout.tsx`, `src/app/globals.css`, `vitest.config.ts`(`*.test.tsx`는 jsdom), `src/test/setup.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

3-ui의 첫 화면 step이다. 디자인 토큰·폰트, 브라우저 → `/api` fetch 래퍼, 로그인 후 앱 셸, 그리고 뒤 step들이 함께 쓸 공용 컴포넌트를 만든다. 다음 step들은 여기서 만든 export 이름·props·CSS 클래스를 그대로 쓴다. 그러니 summary에 정확히 남긴다.

- 정적 UI는 `page.tsx`/`layout.tsx`에 둔다(TDD guard 예외). 상태·입력·API 호출이 있는 것만 Client Component로 만든다.
- `docs/spec/ui.md`에 없는 색·크기·그림자·애니메이션을 만들지 않는다. 같은 역할에는 ui.md의 클래스 조합을 쓴다.

## 작업

컴포넌트·모듈마다 같은 폴더에 `*.test.ts(x)`를 먼저 쓴다. 컴포넌트 테스트는 Testing Library(jsdom)로 쓰고, `@/services/apiClient`와 `next/navigation`만 mock한다.

### 1. 패키지, 토큰, 폰트

- `npm install lucide-react pretendard`를 실행한다(`.npmrc`의 `save-exact`로 버전 고정). `package.json`에 정확한 버전이 들어갔는지 확인한다.
- `src/app/globals.css`:
  - ui.md "토큰"의 `@import`·`@theme`·`body`·`:lang(ja)`·`rt` 블록을 값 그대로 넣는다.
  - 애니메이션 유틸리티 3개를 `@theme`의 `--animate-*`와 `@keyframes`로 정의한다. 이름은 고정이다:
    - `animate-enter`: 화면 진입. 250ms, opacity 0→1, 6px 위로.
    - `animate-sheet`: 바텀시트. 300ms, 아래에서 올라옴, `--ease-soft`.
    - `animate-dot`: 대기 점. opacity, 1초 반복.
  - `prefers-reduced-motion: reduce`에서는 위 애니메이션과 transition이 즉시 끝나게 한다.
  - **집중 모드 규칙**: `body:has([data-focus-mode]) [data-app-chrome] { display: none }`. 셸 요소(상단바·탭바·사이드바)에 `data-app-chrome`을 단다. 대화방·단어 회차 같은 집중 화면은 자기 루트에 `data-focus-mode`를 단다. 서버 HTML에 속성이 들어 있어 깜빡임이 없다. 탭바 공간(`pb-24`)도 집중 모드에서는 없앤다.
- `src/app/layout.tsx`:
  - `import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"`로 Pretendard를 불러온다. woff2 전체를 preload하지 않는다.
  - Noto Sans JP는 `next/font/google`의 `Noto_Sans_JP({ weight: ["400", "500", "700"], preload: false, variable: "--font-noto-sans-jp" })`로 불러오고, `variable` className을 `<html lang="ko">`에 단다.
  - `next/font/google`은 `next build` 때 폰트를 내려받는다. 네트워크 오류로 빌드가 실패하면 blocked로 보고한다.

### 2. `src/services/apiClient.ts` (+ `apiClient.test.ts`)

브라우저 → `/api/**` 호출은 모두 이 함수 하나로 한다(spec 6-10).

```ts
export type ApiFailureCode = ErrorCode | "NETWORK"
export type ApiResult<T> =
  | { ok: true; status: number; data: T }                                         // 200, 202(/end 처리 중)
  | { ok: false; status: number | null; code: ApiFailureCode; message: string }
export const NETWORK_MESSAGE: string   // "연결이 끊겼어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
export async function api<T>(method: "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<ApiResult<T>>
```

- body가 없는 API(consent, trial, `/end`)도 래퍼가 JSON Content-Type을 요구한다. 그래서 `content-type: application/json` 헤더는 항상 보낸다. body는 인자가 있을 때만 `JSON.stringify`로 보낸다.
- 2xx는 성공이다. 202도 성공이며 `status`로 구분한다. body가 비어 있으면 `{}`로 둔다.
- 실패 처리:
  - body의 `code`가 `isErrorCode`면 그 code와 body의 `message`를 쓴다(없으면 `ERRORS[code].message`).
  - JSON이 아니거나 모르는 code(예: Vercel 타임아웃 HTML)면 `INTERNAL`과 `ERRORS.INTERNAL.message`다.
- 이동:
  - 401 → `window.location.assign("/")`.
  - 403 `CONSENT_REQUIRED`·`ONBOARDING_REQUIRED` → `window.location.assign("/onboarding")`.
  - 이동해도 실패 결과는 돌려준다.
- `fetch`가 throw하면(네트워크 끊김) `{ ok: false, status: null, code: "NETWORK", message: NETWORK_MESSAGE }`다. 자동 재시도는 하지 않는다.
- 테스트: `fetch`를 `vi.stubGlobal`로 바꾼다. `window.location.assign`이 필요하면 파일 맨 위 `// @vitest-environment jsdom` 또는 stub을 쓴다. 확인할 것:
  - 헤더·body 직렬화(body 없는 호출에 body 없음)
  - 200·202 성공
  - 400·404·409·429·503의 code·message 전달
  - 401·403 이동
  - JSON 아닌 500 → `INTERNAL`
  - fetch 예외 → `NETWORK`

### 3. 공용 컴포넌트 (`src/components/`)

| 컴포넌트 | 종류 | props | 규칙 |
|---|---|---|---|
| `Furigana` | 서버·클라이언트 공용(`"use client"` 없음) | `{ text: string; show: boolean }` | `parseFurigana`의 segment를 그린다. `show`면 `<ruby>본문<rp>(</rp><rt>읽기</rt><rp>)</rp></ruby>`, 아니면 본문만. 깨진 표기는 기호를 지운 일반 텍스트. HTML 문자열을 만들지 않는다. `lang`은 부모가 단다 |
| `WaitingDots` | 공용 | `{ label: string }` | 점 3개(7px, `animate-dot`, 0.15초씩 지연), `role="status"`와 화면에 안 보이는 `label`. AI 응답 대기·종료 처리 중·채점 중의 유일한 대기 표시다(스피너·스켈레톤 금지) |
| `UsageCard` | 공용 | `{ usage: TodayUsage; plan: Plan; compact?: boolean; showNote?: boolean }` | 항목 2개(AI 대화 턴 / 새 단어). 오른쪽 "**n** / max 남음"(n = `remaining`), 아래 바는 **사용한 비율**로 채운다. 남은 양이 0이면 숫자와 채움을 `danger`로. 바에 `role="progressbar"`와 aria 값. `compact`면 사이드바용 `p-4`, 아니면 `p-5`. `showNote`면 "한국 시간 자정에 다시 채워져요. 영어·일본어 사용량을 합산해요."(`text-micro`) |
| `Dialog` | `"use client"` | `{ open: boolean; onClose: () => void; title: string; variant: "modal" \| "sheet"; children: ReactNode }` | 아래 "Dialog" 참고 |
| `Toast` | `"use client"` | `export function ToastHost()`(props 없음), `export function showToast(message: string): void` | `ToastHost`는 `(app)` 레이아웃에 한 번 둔다. 어느 Client Component든 `showToast`를 부르면 하단 가운데(`bottom-24`)에 `role="status"`로 띄우고 2.4초 뒤 지운다. 새 메시지는 이전 것을 바꾼다. 호출한 컴포넌트가 곧바로 사라져도(체험 시작 후 버튼이 없어지는 경우) 토스트는 남는다. 짧은 성공 확인에만 쓴다 |
| `AppNav` | `"use client"`(`usePathname`) | `{ variant: "tabs" \| "sidebar"; language: Language }` | tabs: 홈(`/home`, House)·대화(`/chat`, MessagesSquare)·단어(`/words`, BookOpen)·계정(`/account`, CircleUserRound), 아이콘 22px, 탭 높이 48px 이상. sidebar: 홈·대화·단어·레벨업 테스트(`/level-up`, TrendingUp)·가나 익히기(`/kana`, Languages, **`language === "ja"`일 때만**)·계정. 현재 경로(같거나 `href/`로 시작)에 `aria-current="page"`와 강조색 |
| `LanguageSheet` | `"use client"` | `{ language: Language; levels: Partial<Record<Language, Level>> }` | 아래 "LanguageSheet" 참고 |

**Dialog** (ui.md "바텀시트"·"모달")
- jsdom에는 `<dialog>.showModal()`이 없다. 그래서 `role="dialog"`, `aria-modal="true"`, `aria-labelledby`(제목)를 단 요소로 직접 만든다. 테스트로 확인할 동작:
  - 열리면 직전 포커스 요소를 기억하고 안의 첫 포커스 가능 요소로 포커스를 옮긴다.
  - Tab·Shift+Tab이 안에서 돈다(포커스 가두기).
  - Esc와 배경(`bg-black/50`) 클릭은 `onClose`를 부른다.
  - 닫히면 기억한 요소로 포커스를 돌려준다.
- `modal`: 가운데, `max-w-[500px] rounded-xl bg-card p-6 shadow-overlay`. 제목은 `text-h1 text-brand`. 오른쪽 위 닫기 버튼은 40px 원, `bg-black/5`, X, `aria-label="닫기"`.
- `sheet`: 아래, `w-full max-w-[560px] rounded-t-xl bg-card px-5 pt-5 pb-7 animate-sheet`. 제목은 `text-lead font-bold`. 닫기는 pill(X, `aria-label="닫기"`).
- 버튼 배치(취소·실행)는 children이 정한다.

**LanguageSheet** (ui.md "언어 시트", spec 1장 홈 구조 1번)
- **트리거**: 상단바의 Pill 버튼 "영어 · 중급" + ChevronDown, `aria-haspopup="dialog"`.
- **시트**: `Dialog`(sheet), 제목 "학습 언어".
- **언어 타일**: `LANGUAGES` 순서, 선택 타일 스타일, `role="radiogroup"`/`role="radio"`.
  - 현재 언어: Check, `aria-checked="true"`.
  - 레벨이 있는 다른 언어: "레벨 n · 이름". 누르면 `api("PUT", "/api/me/language", { language })`. 성공하면 시트를 닫고 `router.refresh()`, 실패하면 시트 안에 오류 Notice(`role="alert"`, 서버 `message`).
  - 레벨이 없는 언어: "새 언어 추가하기" + Plus. `/onboarding?language=xx` 링크다.
- **레벨 내리기**: 현재 언어 레벨이 2 이상일 때만 [레벨 내리기 (중급 → 초보)](outline)를 둔다.
  - 누르면 시트를 닫고 확인 모달(`Dialog` modal, 제목 "레벨을 내릴까요?")을 연다. 모달에는 "다시 올리려면 레벨업 테스트를 통과해야 해요."를 적는다.
  - 버튼은 [취소](outline) + [내리기](primary)다.
  - [내리기]는 `api("PATCH", "/api/levels/" + language, { level: level - 1 })`를 부른다. 성공하면 모달을 닫고 `showToast("레벨을 내렸어요")` 뒤 `router.refresh()`, 실패하면 모달 안에 오류 Notice를 보여 준다.
- **진행 중**: 요청 중에는 해당 버튼을 비활성화한다. 같은 요청을 두 번 보내지 않는다.

### 4. 앱 셸: `src/app/(app)/layout.tsx`

로그인 후 학습 페이지(`/home`, `/chat/**`, `/words`, `/level-up`, `/kana`, `/account`)가 이 route group 아래에 온다. 이 step에서는 레이아웃만 만들고 페이지는 만들지 않는다.

- `const page = await requireReady()`, `const usage = await loadTodayUsage()`. 준비되지 않았으면 `requireReady`가 이동시킨다.
- **상단바**(sticky, `bg-page`, `data-app-chrome`):
  - 왼쪽: 워드마크 "Langrow". 800, 자간 -0.03em, `brand`이고 `lg` 이상에서는 숨긴다(사이드바로 옮김).
  - 오른쪽: `LanguageSheet` + 연속일 칩. 칩은 Flame 16px gold + "n일", `aria-label="연속 학습일 n일"`이며 n = `displayStreak(account.streak, kstDate(now))`.
- **사이드바**(`lg` 이상, 248px, `data-app-chrome`): 워드마크, `AppNav variant="sidebar"`, 아래에 `UsageCard compact`.
- **탭바**(`lg` 미만, 하단 고정, `bg-card`, 위쪽 그림자, safe-area 여백, `data-app-chrome`): `AppNav variant="tabs"`.
- **본문**: `max-w-app` 가운데, 좌우 `px-4 lg:px-10`, 아래 `pb-24 lg:pb-16`(집중 모드에서는 탭바 공간 없음).
- `ToastHost`를 한 번 둔다.

### 5. 오류·없는 페이지 (TDD guard 예외 파일)

- `src/app/(app)/error.tsx`(`"use client"`), `src/app/(app)/not-found.tsx`: 셸 안에서 `text-h1` 제목 + 한 줄 설명 + [홈으로](primary, `/home`)를 보여 준다(ui.md "상태 패턴"의 페이지 오류). error에는 [다시 시도](outline, `reset`)도 둔다.
- `src/app/error.tsx`, `src/app/not-found.tsx`: 셸 밖(레이아웃 자체의 오류, 없는 URL)용이다. 같은 구성으로 둔다.
- Supabase 장애·읽기 실패는 이 페이지로 보인다(spec 6-10).

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
node -e "const p=require('./package.json').dependencies; for (const n of ['lucide-react','pretendard']) if (!/^\d/.test(p[n]||'')) { console.error('버전 고정 안 됨: '+n); process.exit(1) }"
! grep -rn "dangerouslySetInnerHTML" src
! grep -rn "getSession(" src --include=*.ts --include=*.tsx
! grep -rnE "(bg|text|border|ring|fill|stroke|from|to)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}" src/app src/components
! grep -rnE "backdrop-blur|bg-gradient|bg-linear|bg-radial|animate-(pulse|bounce|spin|ping)" src/app src/components
! grep -rnE "#[0-9a-fA-F]{3,8}\b" src/app src/components --include=*.tsx
for f in $(find src/components -name "*.tsx" ! -name "*.test.tsx"); do [ -f "${f%.tsx}.test.tsx" ] || { echo "테스트 없음: $f"; exit 1; }; done
grep -q "data-focus-mode" src/app/globals.css && grep -q "data-app-chrome" "src/app/(app)/layout.tsx"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (fetch 래퍼는 `services/apiClient`, 공용 컴포넌트는 `components/`)
   - UI_GUIDE의 AI 슬롭 안티패턴(그라데이션, blur, 글로우, 보라색, 이모지, 장식 애니메이션)을 쓰지 않았는가?
   - 접근성: `<button>`/`<a>`만 상호작용, `focus-visible` 외곽선, 아이콘 버튼 `aria-label`, `role="status"`/`role="alert"`
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (브라우저는 Supabase를 로그인·로그아웃에만 씀, `dangerouslySetInnerHTML` 없음)
3. 결과에 따라 `phases/3-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 다음 step이 쓰도록 컴포넌트별 export·props, `api()` 시그니처, 애니메이션 클래스 이름, 집중 모드 속성(`data-focus-mode`·`data-app-chrome`), 설치한 패키지 버전을 넣는다
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (패키지 설치·폰트 다운로드 네트워크 실패 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `(app)` 아래에 `page.tsx`를 만들지 마라. 이유: 홈·대화·단어 등 페이지는 다음 step들의 범위다.
- 브라우저 코드에서 `fetch`를 직접 부르지 마라. 이유: 401·403 이동, 202, 네트워크 오류 처리를 `services/apiClient` 하나에 모은다(spec 6-10).
- 브라우저에서 Supabase로 데이터를 읽거나 쓰지 마라. 이유: 브라우저는 로그인·로그아웃에만 Supabase를 쓴다(CLAUDE.md).
- 버튼·카드·Notice용 래퍼 컴포넌트(`Button`, `Card` 등)를 만들지 마라. 이유: ui.md는 위 표의 컴포넌트 말고는 같은 클래스 조합을 반복해 쓰게 정했다. 새 공용 컴포넌트가 꼭 필요하면 `docs/spec/ui.md`에 이유와 함께 추가한다.
- hex 색, Tailwind 기본 팔레트, 임의 간격(`gap-[13px]`)을 쓰지 마라. 이유: UI_GUIDE "색상"·"레이아웃". `@theme` 토큰만 쓴다.
- 오류를 토스트로 띄우지 마라. 이유: 오류는 그 자리의 오류 Notice로 보여 준다(UI_GUIDE).
- 기존 테스트를 깨뜨리지 마라
