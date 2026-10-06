# Step 2: account-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `docs/spec/ui.md`: "공개 페이지", "버튼"(Google·Dark-outline), "안내 (Notice)", "한도 도달 안내", "모달", "토스트", "화면별 구성"의 `/`·`/account`·`/privacy`·`/terms` 행, 플랜 카드·플랜 비교표 문단
- `docs/spec/plan.md`: 1장 "예외 흐름"(구글 로그인 취소·실패), 5장 "7일 무료 체험"·"체험 종료 후", 6-7 "구글 OAuth"(`redirectTo`), 6-8 "출시 최소 요건"(개인정보처리방침·이용약관·회원 탈퇴)
- step 0·1 산출물:
  - `src/server/page.ts`(`requireReady`), `src/services/apiClient.ts`(`api`)
  - `src/components/Dialog.tsx`, `src/components/Toast.tsx`(`showToast`), `src/app/(app)/layout.tsx`, `src/app/globals.css`
  - 이 파일들의 테스트 파일(컴포넌트 테스트에서 mock하는 방법)
- 앞 phase 산출물: `src/lib/plan.ts`(`PLAN_LIMITS`, `PRO_PRICE_KRW`, `TRIAL_DAYS`, `TrialState`, `trialState`), `src/types/api.ts`(`TrialResponse`), `src/app/api/trial/route.ts`, `src/app/api/events/route.ts`, `src/app/auth/callback/route.ts`, `src/services/supabase/browser.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

공개 페이지(랜딩·약관)와 로그인 버튼, 그리고 **플랜 관련 공용 컴포넌트**를 만든다. 한도 안내(`LimitNotice`)는 홈·대화방·단어 화면이 같이 쓴다. 그래서 그 화면들보다 먼저 만든다. `/account` 페이지도 이 step에서 만든다.

## 작업

컴포넌트마다 같은 폴더에 `*.test.tsx`를 먼저 쓴다. `@/services/apiClient`, `@/services/supabase/browser`, `next/navigation`만 mock한다.

### 1. 운영자 정보: `src/site.config.ts`

```ts
// TODO(출시 전): 실제 운영자 이름·문의 이메일·시행일로 바꾼다
export const SITE = {
  operatorName: "운영자 이름",
  contactEmail: "contact@example.com",
  effectiveDate: "2026-11-01",
} as const
```

- 개인정보처리방침·이용약관·계정의 탈퇴 안내는 이 값만 쓴다. 값을 페이지에 직접 쓰지 않는다.
- 설정 파일이라 TDD guard 대상이 아니다(`*.config.*`).

### 2. 공용 컴포넌트 (`src/components/`)

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `GoogleLoginButton` | `{ variant: "google" \| "nav" }` | 아래 "GoogleLoginButton" 참고 |
| `TrialButton` | `{ label: string; size: "sm" \| "lg"; fullWidth?: boolean; onStarted?: () => void }` | 아래 "TrialButton" 참고 |
| `ProButton` | `{ label: string; size: "sm" \| "lg"; fullWidth?: boolean }` | 아래 "ProButton" 참고 |
| `LimitNotice` | `{ feature: "chat" \| "words"; trial: TrialState; onLater?: () => void; onTrialStarted?: () => void }` | 아래 표 |
| `LogoutButton` | 없음 | 아래 "LogoutButton" 참고 |

모두 `"use client"`다.

**GoogleLoginButton**
- `google`: ui.md "Google" 버튼. Google 공식 "G" 로고 SVG + "Google로 시작하기"이며, 로고의 공식 색 4개만 hex를 허용한다.
- `nav`: Dark-outline Small, 라벨 "로그인".
- 누르면 `getBrowserSupabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/auth/callback" } })`를 부른다. 에러가 오면 `/?login=failed`로 이동하고, 진행 중에는 비활성화한다.

**TrialButton**
- primary 버튼이다. `sm`은 Small(36px), `lg`는 44px이다.
- 누르면 `api<TrialResponse>("POST", "/api/trial")`를 부른다.
  - 성공: `showToast("7일 Pro 체험을 시작했어요")` → `router.refresh()` → `onStarted?.()`.
  - 실패: 버튼 아래에 오류 Notice(`role="alert"`, 서버 `message`)를 보여 준다. 409(이미 사용함)도 같다.
- 요청 중에는 비활성화하고 라벨을 "시작하는 중…"으로 바꾼다.

**ProButton**
- primary 버튼이다. 누르면 "정식 출시 준비 중" 모달(`Dialog` modal)을 연다.
  - 본문은 "Pro는 정식 출시를 준비하고 있어요. 결제 정보는 받지 않아요."이고, 버튼은 [확인](primary, 닫기) 하나다.
- 동시에 `api("POST", "/api/events", { name: "pro_clicked" })`를 보낸다. 결과를 기다리지 않고, 실패해도 모달은 연다. 누를 때마다 한 번 기록한다(spec 5장).

**LimitNotice** (ui.md "한도 도달 안내")

| `trial.kind` | 표시 |
|---|---|
| `available` | 보상 Notice(Sprout gold).<br>제목: "오늘 AI 대화 턴을 모두 썼어요" / "오늘 새 단어를 모두 썼어요".<br>설명: Pro 한도("Pro는 하루 대화 150턴, 새 단어 30개까지 할 수 있어요." — 숫자는 `PLAN_LIMITS`) + "결제 정보는 받지 않아요."<br>버튼: `TrialButton`(sm, "7일 무료 체험", `onStarted={onTrialStarted}`) + [내일 할게요](outline sm). [내일 할게요]는 `onLater`가 있으면 그것을 부르고, 없으면 Notice를 숨긴다 |
| `ended` | 보상 Notice(같은 제목·설명) + `ProButton`(sm, "Pro 시작하기") |
| `active` | 정보 Notice(Moon).<br>"오늘 사용량을 모두 썼어요" + "한국 시간 자정에 다시 채워져요. 복습과 레벨업 테스트는 계속할 수 있어요."<br>버튼 없음 |

**LogoutButton**
- Outline [로그아웃]이다. 누르면 `getBrowserSupabase().auth.signOut()`를 부른다.
  - 성공: `window.location.assign("/")`.
  - 실패: 오류 Notice.

### 3. 공개 페이지 (TDD guard 예외 파일)

- **`src/app/page.tsx`** (랜딩, ui.md "화면별 구성" `/` 행):
  - 순서: 공개 내비(sticky, `bg-card`, `shadow-nav`, 워드마크 + `GoogleLoginButton variant="nav"`) → 히어로(`md` 이상 6:5 분할) → 흰 섹션 기능 3개 → `house` 밴드 가나 소개 → 플랜 비교표 + "7일 무료 체험은 계정당 한 번" + `GoogleLoginButton variant="google"` → `house` 푸터(이용약관·개인정보처리방침 링크).
  - 히어로는 눈썹 "영어 · 일본어", 제목, 설명, Google 버튼 + "만 14세 이상 · 무료로 시작"이다. 오른쪽에는 대화와 교정 미리보기를 정적 마크업으로 둔다. 실제 말풍선·교정 카드와 같은 클래스(ui.md "대화 말풍선")를 쓰고, 영어 문장에는 `lang="en"`을 단다.
  - Next 16의 async `searchParams`에서 `login === "failed"`면 히어로 위에 오류 Notice "로그인을 완료하지 못했어요"를 보여 준다.
  - 플랜 비교표:
    - 열: 항목 / Free / Pro.
    - 행: AI 대화 턴(하루 20 / 150), 새 단어(하루 10 / 30), 복습·레벨업 테스트·가나(제한 없음), 가격(무료 / 월 9,900원).
    - 숫자는 `PLAN_LIMITS`·`PRO_PRICE_KRW`에서 가져온다.
  - 로그인 여부는 보지 않는다(spec 6-1: 공개 페이지는 로그인 여부와 무관하게 연다).
- **`src/app/privacy/page.tsx`, `src/app/terms/page.tsx`** (ui.md `/privacy`, `/terms` 행):
  - 상단: [돌아가기] pill(`/`) + 워드마크.
  - 본문: `max-w-prose-doc`. 제목 `text-h1`, 시행일(`SITE.effectiveDate`, `text-micro`).
  - 개인정보처리방침에 반드시 넣을 것:
    - 수집 항목: Google 계정 이메일·이름, 학습 기록, 대화 내용, 로그인 쿠키.
    - 이용 목적, 보유 기간(탈퇴 시까지), 탈퇴·삭제 방법(`SITE.contactEmail`로 요청).
    - **국외 이전**: 대화 내용이 Anthropic(미국)으로 전송된다. 이전받는 자·국가·항목·목적·시기와 방법(대화할 때마다 네트워크 전송)·보유 기간을 적는다. 보유 기간은 Anthropic의 API 데이터 보관 정책을 따른다고 적고, 구체 기간을 지어내지 않는다.
    - 처리 위탁: Vercel(호스팅), Supabase(데이터베이스·인증). 만 14세 미만 가입 불가.
    - 개인정보 보호책임자: `SITE.operatorName`, `SITE.contactEmail`.
  - 이용약관에 반드시 넣을 것:
    - 만 14세 이상만 가입. 서비스 내용.
    - Free/Pro와 7일 무료 체험(결제 정보를 받지 않음, 계정당 1번, 자동 결제 없음).
    - 학습용 응답이 틀릴 수 있다는 점, 금지 행위, 탈퇴, 약관 변경, 문의(`SITE.contactEmail`).
  - 두 파일 맨 위에 `// 정식 출시 전에 법률 검토를 받는다 (spec 6-8)` 주석을 단다. 화면에는 초안 표시를 하지 않는다.

### 4. `/account`: `src/app/(app)/account/page.tsx` (ui.md `/account` 행)

`const { email, account, now } = await requireReady()`, `trial = trialState(account.trialStartedAt, account.proUntil, now)`

- **제목**: "계정" + 이메일(`text-sm`).
- **섹션 "플랜"**: 오른쪽 태그는 체험 중이면 골드 "체험 중", 아니면 회색 "Free"다.
- **플랜 카드 2개**(모바일 1열, `md` 2열):
  - Free는 기본 카드, Pro는 보상 카드다.
  - 순서: 이름 + 태그 → 한도 한 줄 → 가격(`text-h1 font-bold`).
  - 태그: 체험 중이 아니면 Free 카드에 "현재", 체험 중이면 Pro 카드에 골드 "체험 중"을 단다.
- **체험 블록**(버튼 `w-full`, 아래 문구 `text-micro text-ink-muted text-center`):
  - `available`: `TrialButton`(lg, fullWidth, "7일 무료 체험 시작") + "계정당 한 번 · 결제 정보 없이 시작해요".
  - `active`: 보상 Notice "Pro 체험 중 · n일 남음" / "체험이 끝나면 Free로 돌아가요. 자동 결제는 없어요."
  - `ended`: `ProButton`(lg, fullWidth, "Pro 시작하기 · 월 9,900원") + "무료 체험은 이미 사용했어요."
- **목록 묶음**: 이용약관(`/terms`), 개인정보처리방침(`/privacy`), 회원 탈퇴 안내 행. 탈퇴 행은 링크가 아니고 "회원 탈퇴는 {SITE.contactEmail}로 요청해 주세요. 학습 기록이 모두 삭제돼요."를 적는다.
- **맨 아래**: `LogoutButton`.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
! grep -rn "dangerouslySetInnerHTML" src
! grep -rn "getSession(" src --include=*.ts --include=*.tsx
! grep -rnE "(bg|text|border|ring|fill|stroke|from|to)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}" src/app src/components
! grep -rnE "backdrop-blur|bg-gradient|bg-linear|bg-radial|animate-(pulse|bounce|spin|ping)" src/app src/components
! grep -rnE "#[0-9a-fA-F]{3,8}\b" src/app src/components --include=*.tsx | grep -v "GoogleLoginButton"
for f in $(find src/components -name "*.tsx" ! -name "*.test.tsx"); do [ -f "${f%.tsx}.test.tsx" ] || { echo "테스트 없음: $f"; exit 1; }; done
grep -q "TODO(출시 전)" src/site.config.ts
grep -q "Anthropic" src/app/privacy/page.tsx && grep -q "SITE.contactEmail" src/app/privacy/page.tsx && grep -q "14세" src/app/terms/page.tsx
test -f "src/app/(app)/account/page.tsx"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (정적 UI는 `page.tsx`, 상태·API 호출이 있는 것만 Client Component)
   - UI_GUIDE "문구"를 따르는가? (해요체, 돈 얘기는 사실만, AI를 내세우지 않음)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (브라우저는 Supabase를 로그인·로그아웃에만, secret에 `NEXT_PUBLIC_` 없음)
3. 결과에 따라 `phases/3-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. 다음 step이 쓰도록 `LimitNotice`·`TrialButton`·`ProButton`의 props와 동작, `SITE` 경로를 넣는다
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실제 운영자 이름·이메일·주소를 지어내지 마라. 이유: 사용자가 출시 전에 채운다. `SITE` 자리표시 값만 쓴다.
- 결제 정보 입력 UI, 가격 할인, "곧 결제" 같은 약속을 만들지 마라. 이유: 결제는 MVP 제외이고, 돈 얘기는 사실만 쓴다(UI_GUIDE "문구").
- 체험 상태를 클라이언트에서 계산해 저장하거나 API에 보내지 마라. 이유: 플랜·체험은 서버가 DB 시각으로 판정한다(CLAUDE.md). 페이지는 `trialState(…, now)`로 표시만 한다.
- `pro_clicked`를 페이지 방문만으로 기록하지 마라. 이유: 버튼을 누를 때만 기록하는 지표다(spec 1장 "지표 수집").
- 랜딩에 "Powered by AI" 배지, ✨·로봇 아이콘, 그라데이션, blur 원형 장식을 넣지 마라. 이유: UI_GUIDE "AI 슬롭 안티패턴".
- 로그인한 사용자를 `/`에서 다른 곳으로 이동시키지 마라. 이유: spec 6-1(공개 페이지는 로그인 여부와 무관하게 연다).
- step 0·1의 공용 컴포넌트·`apiClient`의 props·동작을 바꾸지 마라. 이유: 다음 step들이 그 계약을 쓴다. 꼭 필요하면 테스트와 함께 고치고 summary에 적는다.
- 기존 테스트를 깨뜨리지 마라
