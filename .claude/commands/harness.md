이 프로젝트는 Harness 프레임워크를 사용한다. 아래 워크플로우에 따라 작업을 진행하라.

---

## 워크플로우

### A. 탐색

`/docs/` 하위 문서(PRD, ARCHITECTURE, ADR 등)를 읽고 프로젝트의 기획·아키텍처·설계 의도를 파악한다. 필요시 Explore 에이전트를 병렬로 사용한다.

### B. 논의

구현을 위해 구체화하거나 기술적으로 결정해야 할 사항이 있으면 사용자에게 제시하고 논의한다.

### C. Step 설계

사용자가 구현 계획 작성을 지시하면 여러 step으로 나뉜 초안을 작성해 피드백을 요청한다.

설계 원칙:

1. **Scope 최소화** — 하나의 step에서 하나의 레이어 또는 모듈만 다룬다. 여러 모듈을 동시에 수정해야 하면 step을 쪼갠다.
2. **자기완결성** — 각 step 파일은 독립된 Claude 세션에서 실행된다. "이전 대화에서 논의한 바와 같이" 같은 외부 참조는 금지한다. 필요한 정보는 전부 파일 안에 적는다.
3. **사전 준비 강제** — 관련 문서 경로와 이전 step에서 생성/수정된 파일 경로를 명시한다. 세션이 코드를 읽고 맥락을 파악한 뒤 작업하도록 유도한다. execute.py는 문서를 프롬프트에 붙이지 않으므로(CLAUDE.md만 `claude -p`가 자동으로 읽는다) 이 step에 필요한 문서와 절만 고른다. 이유: 관련 없는 문서도 매 step 컨텍스트를 차지한다.
4. **시그니처 수준 지시** — 함수/클래스의 인터페이스만 제시하고 내부 구현은 에이전트 재량에 맡긴다. 단, 설계 의도에서 벗어나면 안 되는 핵심 규칙(멱등성, 보안, 데이터 무결성 등)은 반드시 명시한다.
5. **AC는 실행 가능한 커맨드** — "~가 동작해야 한다" 같은 추상적 서술이 아닌 `npm run build && npm test` 같은 실제 실행 가능한 검증 커맨드를 포함한다.
6. **주의사항은 구체적으로** — "조심해라" 대신 "X를 하지 마라. 이유: Y" 형식으로 적는다.
7. **네이밍** — step name은 kebab-case slug로, 해당 step의 핵심 모듈/작업을 한두 단어로 표현한다 (예: `project-setup`, `api-layer`, `auth-flow`).
8. **spec과 어긋나지 않기** — 상세 spec(`docs/spec/`)이 있으면 step 지시는 그 동작과 같아야 한다. 예외 흐름과 에러 코드별 동작도 빠뜨리지 않는다. spec과 다르게 하려면 spec을 먼저 고치고 그 결정을 step에 적는다. 이유: step 세션은 step 파일을 그대로 따르므로, step이 spec과 다르면 구현도 spec과 달라진다(예: "pending 턴을 그리지 마라"라는 지시가 spec의 "전송 중이면 완료를 기다린다"를 빠뜨리게 했다).
9. **외부 API로 데이터를 만드는 일은 step에 넣지 않는다** — 유료·한도가 있는 API 호출, 오래 걸리는 생성(예: 음성 파일 4,071개 약 3.4시간)은 phase 밖에서 사람이 확인하며 돌린다. step 금지사항에 "그 스크립트를 실제로 실행하지 마라"를 적는다. 이유: step 커밋은 `git add -A`라서 생성물이 그대로 커밋되고, 비용이 들며, step 세션은 몇 시간을 기다리지 못한다. 자동 모드에서는 메인 세션이 돌리려 해도 분류기가 결제가 따르는 실행으로 막는다(2026-10-14 `words:pron`). phase가 끝나면 사용자에게 `! npm run …`으로 직접 실행해 달라고 안내하고, 먼저 한 단위(예: 레벨 1)만 돌려 결과를 검수한 뒤 나머지를 부탁한다.
10. **AI 출력을 코드로 검사하면 검사가 거부하는 모양을 프롬프트에서도 금지한다** — 검사 규칙을 정하는 step과 프롬프트를 쓰는 step이 다르면, 프롬프트 step 지시에 "검사가 거부하는 경우"를 옮겨 적고 그것을 만들지 말라는 지시를 요구한다. 거부하지 않아도 되는 경우(정리해서 받아들일 수 있는 것)는 검사 쪽에서 받아들인다. 이유: 2026-10-18 문장 뜯어보기 검사는 문장부호만 있는 조각(`?`)을 거부했는데 프롬프트에는 그 금지가 없었다. 모델이 끝 문장부호를 따로 조각으로 만들면 문장 전체의 뜯어보기가 조용히 사라질 뻔했고, phase 뒤 spec 대조에서야 찾았다.
11. **AI에게 고르거나 판단하게 하는 지시는 제한만 쓰지 말고 고를 것·뺄 것의 예를 넣는다** — "~만 고른다", "없으면 빈 배열" 같은 제한만 있으면 effort low 모델은 빈 결과로 기운다. 프롬프트 step 지시에 spec의 기준 문장을 그대로 옮기지 말고, 고를 것과 뺄 것의 구체적인 예와 "하나도 없을 때만 빈 결과"를 넣으라고 적는다. 이유: 2026-10-20 배운 단어 고르기 프롬프트가 spec 문구("자연스럽게 나올 단어만")를 그대로 써서, 카페 주문에서도 美味しい·少し를 하나도 고르지 않았다. 단위 테스트와 spec 대조 3개는 통과했고 phase 뒤 실제 호출에서야 찾았다.

### D. 파일 생성

사용자가 승인하면 아래 파일들을 생성한다.

#### D-1. `phases/index.json` (전체 현황)

여러 task를 관리하는 top-level 인덱스. 이미 존재하면 `phases` 배열에 새 항목을 추가한다.

```json
{
  "phases": [
    {
      "dir": "0-mvp",
      "status": "pending"
    }
  ]
}
```

- `dir`: task 디렉토리명.
- `status`: `"pending"` | `"completed"` | `"error"` | `"blocked"`. execute.py가 실행 중 자동으로 업데이트한다.
- 타임스탬프(`completed_at`, `failed_at`, `blocked_at`)는 execute.py가 상태 변경 시 자동 기록한다. 생성 시 넣지 않는다.

#### D-2. `phases/{task-name}/index.json` (task 상세)

```json
{
  "project": "<프로젝트명>",
  "phase": "<task-name>",
  "steps": [
    { "step": 0, "name": "project-setup", "status": "pending" },
    { "step": 1, "name": "core-types", "status": "pending" },
    { "step": 2, "name": "api-layer", "status": "pending" }
  ]
}
```

필드 규칙:

- `project`: 프로젝트명 (CLAUDE.md 참조).
- `phase`: task 이름. 디렉토리명과 일치시킨다.
- `steps[].step`: 0부터 시작하는 순번.
- `steps[].name`: kebab-case slug.
- `steps[].status`: 초기값은 모두 `"pending"`.

상태 전이와 자동 기록 필드:

| 전이 | 기록되는 필드 | 기록 주체 |
|------|-------------|----------|
| → `completed` | `completed_at`, `summary` | Claude 세션 (summary), execute.py (timestamp) |
| → `error` | `failed_at`, `error_message` | Claude 세션 (message), execute.py (timestamp) |
| → `blocked` | `blocked_at`, `blocked_reason` | Claude 세션 (reason), execute.py (timestamp) |

Claude 세션은 index.json을 읽거나 고치지 않는다. `phases/{task-name}/step{N}-result.json`에 `status`와 위 필드를 쓰면 execute.py가 index.json에 옮긴다. 이유: index.json을 통째로 읽으면 앞 step summary가 전부 컨텍스트에 들어온다.

`summary`는 step 산출물 요약으로, execute.py가 다음 step 프롬프트에 컨텍스트로 누적 전달한다. 그래서 500자 이내로, 만들거나 바꾼 파일과 다음 step이 알아야 할 결정만 담는다. 500자를 넘으면 execute.py가 index.json에 옮길 때 자른다(원문은 결과 파일에 남는다).

spec과 다르게 구현한 점은 summary가 아니라 결과 파일의 `spec_diff`에 적는다. `spec_diff`는 index.json에 옮기지 않아 다음 step에 전달되지 않고, phase 끝 spec 대조 점검에서 읽는다.

`created_at`은 execute.py가 최초 실행 시 task 레벨에 한 번만 기록한다. step 레벨의 `started_at`도 execute.py가 각 step 시작 시 자동 기록한다. 생성 시 넣지 않는다.

#### D-3. `phases/{task-name}/step{N}.md` (각 step마다 1개)

```markdown
# Step {N}: {이름}

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- {이 step에 필요한 문서와 절만. 예: `/docs/ARCHITECTURE.md`, `/docs/spec/words.md` "오늘의 학습"}
- {이전 step에서 생성/수정된 파일 경로}

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

{구체적인 구현 지시. 파일 경로, 클래스/함수 시그니처, 로직 설명을 포함.
코드 스니펫은 인터페이스/시그니처 수준만 제시하고, 구현체는 에이전트에게 맡겨라.
단, 설계 의도에서 벗어나면 안 되는 핵심 규칙은 명확히 박아넣어라.}

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 이 step이 구현한 spec 절을 문장 단위로 대조한다(예외 흐름·에러 코드별 동작 포함). step 지시와 spec이 다르면 step 지시를 따르고, 그 차이를 결과 파일의 `spec_diff`에 적는다.
4. 결과를 `phases/{task-name}/step{N}-result.json`에 JSON으로 쓴다. index.json은 고치지 않는다(execute.py가 옮긴다):
   - 성공 → `"status": "completed"`, `"summary": "500자 이내 산출물 요약"`, spec과의 차이가 있으면 `"spec_diff"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- {이 step에서 하지 말아야 할 것. "X를 하지 마라. 이유: Y" 형식}
- 기존 테스트를 깨뜨리지 마라
```

### E. 실행

```bash
python3 scripts/execute.py {task-name}        # 순차 실행
python3 scripts/execute.py {task-name} --push  # 실행 후 push
```

- Windows에서 `python3`가 아무것도 실행하지 않고 "Python"만 출력하고 끝나면(exit 49) App Installer의 Python 리디렉터가 가로챈 것이다. `py scripts/execute.py {task-name}`로 실행한다. 이유: 2026-10-12 App Installer 업데이트가 `WindowsApps/python3`를 리디렉터로 바꿨다.

execute.py가 자동으로 처리하는 것:

- `feat-{task-name}` 브랜치 생성/checkout. 브랜치를 바꿔야 하는데 `phases/` 밖에 커밋하지 않은 변경이 있으면 멈춘다. step 커밋이 `git add -A`라서 같은 폴더를 쓰는 다른 세션의 변경이 섞이기 때문이다. phase를 도는 동안에는 같은 폴더에서 다른 세션이 작업하지 않는다(필요하면 git worktree로 나눈다)
- 문서는 붙이지 않음 — CLAUDE.md는 `claude -p`가 자동으로 읽고, docs는 step 파일이 고른 것만 세션이 읽는다
- 컨텍스트 누적 — 완료된 step의 summary(500자에서 자름)를 다음 step 프롬프트에 전달
- 결과 반영 — 세션이 쓴 `step{N}-result.json`을 index.json에 옮긴다. 시도마다 남아 있던 결과 파일을 먼저 지운다
- 자가 교정 — 실패 시 최대 3회 재시도하며, 이전 에러 메시지를 프롬프트에 피드백
- 2단계 커밋 — 코드 변경(`feat`)과 메타데이터(`chore`)를 분리 커밋
- 타임스탬프 — started_at, completed_at, failed_at, blocked_at 자동 기록
- 실행 중 표시 — step마다 `phases/.running`(gitignore)을 쓰고 끝나면 지운다. Stop hook은 이 표시가 35분 안에 쓰였으면 phase를 띄운 바깥 세션의 lint·build·test를 건너뛰고, `HARNESS_STEP=1`로 띄운 step 세션은 그대로 검사한다. 이유: 2026-10-14에 바깥 세션의 Stop hook이 step 세션이 테스트만 먼저 써 둔 TDD 중간 상태를 실패로 보고 고치라고 했다(고쳤다면 step 작업과 충돌하고, 두 build가 `.next`를 같이 쓴다)

phase가 끝나면 main에 병합하기 전에 spec 대조 점검을 한다. 영역별 읽기 전용 에이전트가 spec 문장과 코드를 대조하고, 각 step 결과 파일(`step{N}-result.json`)의 `spec_diff`도 함께 본다. 고칠 항목은 테스트를 먼저 써서 고친 뒤 병합한다.

화면을 바꾼 phase는 병합 전에 바뀐 화면을 휴대폰 너비(390px)로 브라우저에서 열어 본다. 긴 일본어·영어 문장에서 가로로 넘치지 않는지, 일본어 후리가나가 본문 글자를 벌리지 않는지를 확인한다. 이유: 2026-10-17 아이폰에서 긴 일본어 AI 말풍선이 줄을 바꾸지 않고 화면 밖으로 늘어났고(`word-break: keep-all`), `週末`이 "週 末"로 벌어져 보였다. 둘 다 단위 테스트와 spec 대조로는 잡히지 않고 운영에서 사용자가 찾았다.

- 방법: 로컬 Supabase에 테스트 계정(`dev@langrow.local`)의 로그인 쿠키를 만들고, 긴 문장이 든 화면 데이터(예: 대화 세션·턴)를 admin 클라이언트로 넣는다. 브라우저는 프로젝트 밖 임시 폴더에 Playwright(Chromium·WebKit)를 깔아 쓴다(프로젝트 의존성은 늘리지 않는다). 390px·320px에서 토글을 모두 연 뒤 `document.documentElement.scrollWidth`가 화면 폭과 같은지, 루비 본문 이웃 글자 사이 간격이 0인지 재고 스크린샷을 눈으로 본다.
- 가로 스크롤 영역(`overflow-x-auto`)이 있는 화면은 그 안의 요소가 화면 밖에 있는 게 정상이다. 넘침은 문서 `scrollWidth`로 판정하고, 넘쳤을 때만 범인 요소를 찾는다. 스크롤 영역 안의 `sr-only`처럼 절대 위치인 요소는 그 영역에 `relative`가 없으면 잘리지 않고 페이지를 넓힌다. 이유: 2026-10-20 배운 단어 칩의 "썼음"(`sr-only`)이 390px 대화방을 435px로 넓혔는데, 단위 테스트와 spec 대조로는 잡히지 않았다.
- 확인용으로 `next start`를 띄웠으면 끝나는 대로 끈다. 이유: 2026-10-18 떠 있는 동안 Stop hook의 build가 "Another next build process is already running"으로 실패했다.
- Windows에서는 백그라운드 작업을 멈춰도(TaskStop) node 하위 프로세스가 포트를 계속 잡는다. 포트로 프로세스를 찾아(`Get-NetTCPConnection -LocalPort 3100`) 명령줄이 내가 띄운 `next start`인지 확인하고 끈다. `next dev`는 포트를 잡는 쪽이 하위 `start-server.js`라 상위 `next dev`도 함께 끈다. 다시 빌드하기 전에 포트가 비었는지 본다. 이유: 2026-10-20 TaskStop 뒤에도 옛 빌드 서버가 떠 있었고, 그 위에서 다시 빌드했다.
- phase 전부터 켜 둔 `next dev`가 "Jest worker encountered 2 child process exceptions"로 500을 내면 다시 띄운다. 이유: 2026-10-18 phase 도중 build를 10여 번 돌린 뒤 그렇게 됐다(원인 파일은 로그에 없었고, 코드 문제는 아니었다).

AI 프롬프트를 바꾼 phase는 병합 전에 메인 세션이 실제 호출로 확인한다. 유료라 사용자 확인을 먼저 받는다.

- 먼저 `count_tokens`(무료)로 늘어난 입력 토큰을 잰다. 프롬프트 빌더로 바꾸기 전과 후의 프롬프트를 만들어 비교하고, spec·ADR의 비용 추정을 실측으로 고친다. 한국어 지시문은 토큰이 많아 추정이 크게 빗나간다. 이유: 2026-10-20 배운 단어 지시는 추정 +250~600토큰이 실측 +894~1,244였다. 문구를 줄여 +572~907로 낮췄다.
- 그다음 `next start`와 테스트 계정 쿠키로 `/api/**`를 불러 대화 몇 개를 돌린다. 언어·레벨·예외(한국어 입력 등)를 섞는다. 테스트 계정의 레벨·학습 기록을 admin으로 잠시 바꾸면, 바꾸기 전에 그 행들(`user_levels`, `user_words`, `profiles`의 `streak`·`last_study_date`)을 저장해 두고 끝나면 되돌린다. 이유: 턴이 성공하면 학습일·연속일이 바뀐다. 2026-10-20에는 `profiles`를 저장하지 않아 테스트 계정의 연속일을 되돌리지 못했다.

main에 병합한 뒤 push는 운영 배포다(Vercel이 `main`을 자동 배포한다). phase에 마이그레이션이 있으면 push 전에 사용자 확인을 받아 운영 DB에 먼저 적용한다(`npx supabase migration list --linked`로 확인 → `supabase db push`). 마이그레이션은 지금 운영 코드와도 맞게(열 추가, 기본값 있는 인자) 만들어서 먼저 적용해도 깨지지 않게 한다. 이유: 2026-10-18 phase 7-chat-improve의 코드는 새 열 `chat_turns.reply_breakdown`을 읽어서, 마이그레이션 전에 배포했다면 운영의 모든 대화방이 열리지 않았다.

에러 복구:

- **error 발생 시**: `phases/{task-name}/index.json`에서 해당 step의 `status`를 `"pending"`으로 바꾸고 `error_message`를 삭제한 뒤 재실행한다.
- **blocked 발생 시**: `blocked_reason`에 적힌 사유를 해결한 뒤, `status`를 `"pending"`으로 바꾸고 `blocked_reason`을 삭제한 뒤 재실행한다.
- **"프로세스를 시작하지 못했습니다 (0xC0000142)"로 멈췄을 때**: execute.py를 띄운 Claude Code 세션이 닫혀서 생긴다(Windows). step 상태는 바뀌지 않았으니 그대로 재실행한다. 예방하려면 일반 터미널에서 실행하거나, Claude Code 세션 안에서 백그라운드로 띄웠다면 phase가 끝날 때까지 그 세션을 닫지 않는다. 새 세션을 같은 터미널에서 열어도 막지 못한다.
