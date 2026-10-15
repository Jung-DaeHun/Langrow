# /review-code 차원별 병렬 리뷰 설계

2026-10-15 설계 승인. 구현 계획 전.

## 목적

- 스킬 → Workflow → 병렬 서브에이전트 패턴을 익히고, Langrow 병합 전 점검에 실제로 쓴다.
- 차원별로 쪼개는 이유: 차원마다 다른 전문 프롬프트(전문성)와 동시 실행(속도).
- hook이 이미 막는 것은 보지 않는다. lint·build·test는 Stop hook, 테스트 파일이 있는지는 TDD guard가 본다. 리뷰는 hook이 못 잡는 것에 집중한다.

## 범위

- MVP 차원 4개: correctness, security, architecture, consistency. 나머지 후보(목표 10개): performance, conventions, test coverage, privacy, CPU/perf patterns, behavioral correctness.
- 리뷰만 한다. 수정은 리뷰를 본 뒤 따로 요청하면 TDD로 한다.
- 기존 `/review`(에이전트 하나, 체크리스트 5개)는 그대로 둔다.
- 이 문서는 제품 기능이 아니라 개발 도구라서 `docs/spec/`에 대응하는 주제 파일이 없다. CLAUDE.md의 "`docs/superpowers/specs/`에 만들지 않는다" 규칙의 예외로 여기에 둔다(사용자 결정).

## 파일

| 파일 | 역할 |
|---|---|
| `.claude/skills/review-code/SKILL.md` | 오케스트레이터 스킬. `/review-code`로 실행한다. 메인 세션이 범위·PR·가드레일 문서를 모으고 Workflow를 부른 뒤 결과를 게시한다. |
| `.claude/workflows/review-code-run.js` | Workflow 스크립트. 리뷰 → 검증 → 조립. 스킬과 같은 이름이면 둘 다 `/review-code`가 되고 어느 쪽이 실행되는지 문서에 없어서 `-run`을 붙인다. |

- TDD guard는 이미 `*/.claude/*`, `*/workflows/*`를 예외로 둔다. hook은 바꾸지 않는다.
- `.claude/agents/` 정의 파일은 만들지 않는다. 리뷰어와 검증자는 workflow 기본 에이전트이고, 읽기 전용은 프롬프트로 지시한다(코드를 고칠 도구 자체는 남는다).

## 흐름

```
/review-code  (메인 세션, .claude/skills/review-code/SKILL.md)
 1. 범위      git status -sb
              base  = git merge-base main HEAD
              files = git diff --name-status <base>           # 커밋한 것 + 커밋 안 한 것
                    + git ls-files --others --exclude-standard # 새 파일
              비어 있으면 "리뷰할 변경 없음"으로 끝낸다
 2. PR        gh pr view --json number,url,headRefOid,baseRefName  (없으면 PR 없음)
 3. 가드레일  항상 docs/ARCHITECTURE.md, docs/ADR.md
              + 변경 파일과 관련된 docs/spec/*.md (CLAUDE.md의 spec 목록 설명으로 고른다)
              + docs/spec/을 바꿨으면 대응하는 요약 문서(PRD·ARCHITECTURE·ADR·UI_GUIDE)
              CLAUDE.md는 에이전트에 자동으로 들어가므로 넘기지 않는다
 4. walkthrough  git log <base>..HEAD --oneline 과 git diff --stat <base> 로 2~3줄
 5. Workflow review-code-run 호출  args = { base, files, docs, walkthrough }
 6. 게시      아래 "게시"

review-code-run.js
 pipeline(DIMENSIONS, review, verify)    # 차원 하나의 리뷰가 끝나면 다른 차원을 기다리지 않고 바로 검증
   review  차원 프롬프트 + 공통 규칙 → schema FINDINGS
   verify  지적마다 검증자 3명 병렬 → schema VOTE → 2/3 다수결
 조립 (에이전트 없이 코드로)  중복 합치기 → 판정·집계 → { report, review, verdict }
```

args 없이 `/review-code-run`을 바로 실행하면 에이전트를 띄우지 않고 "/review-code로 실행하세요"를 반환한다.

## 리뷰어 공통 규칙

workflow 프롬프트에 한 번만 두고 차원 프롬프트 앞에 붙인다.

- 읽기 전용이다. 파일을 고치지 않는다. Bash는 `git diff`·`git log`·`git show`처럼 읽는 명령만 쓴다.
- 변경 범위: `git diff <base> -- <file>`과 새 파일 본문. 변경된 줄이나 변경 때문에 생긴 문제만 보고한다. 원래 있던 문제는 보고하지 않는다.
- lint·build·test·TDD guard가 잡는 것은 보고하지 않는다.
- 지적마다 `파일:줄` 근거를 단다. 추측이면 보고하지 않는다. 지적이 없으면 빈 배열이다. 개수를 채우려고 만들지 않는다.
- 다른 차원의 영역은 보고하지 않는다.
- 잘된 점은 최대 2개.
- 가드레일 문서 목록 중 그 차원에 필요한 것만 읽는다.

## 차원

| 차원 | 보는 것 |
|---|---|
| correctness | 로직 오류, 경계값, 예외·에러 흐름, 비동기 경쟁, null 처리, 상태 전이 |
| security | admin 조회에 user_id, 남의 리소스는 404, `getUser()`(body의 userId 금지), `NEXT_PUBLIC_` secret, `server-only`, `dangerouslySetInnerHTML`, RPC·RLS 권한, 클라이언트가 보낸 날짜·플랜·사용량을 믿는지, 로그에 개인정보·secret |
| architecture | 쓰기·Claude 호출은 route→server에서만, 페이지는 읽기만, 의존 방향 app→server→services·lib, lib는 순수 함수, 여러 행 판정·변경은 RPC 한 번 + `profiles FOR UPDATE`, Claude 호출 중 잠금 금지, DB 시각으로 판정, 구현 경로에 `test` 금지 |
| consistency | 바뀐 동작과 `docs/spec/` 해당 절 대조, spec을 바꿨으면 요약 문서도 바꿨는지, 파일 사이 타입·API 응답·에러 코드·이벤트 이름 일치 |

user_id 규칙은 CLAUDE.md에서 아키텍처 규칙으로 분류돼 있지만 성격상 security가 맡는다. 그래도 겹치는 지적은 조립 단계에서 합친다.

차원 추가는 `DIMENSIONS` 배열에 `{ key, prompt }` 하나를 넣는 것으로 끝난다. 스킬은 바꾸지 않는다.

## 심각도

리뷰어와 검증자가 같은 기준을 쓴다.

| 심각도 | 기준 |
|---|---|
| 🔴 Critical | 병합하면 사고. 남의 데이터 접근, secret 노출, XSS, 데이터 손상·유실, 주요 흐름(로그인·대화·단어 학습)이 깨짐 |
| 🟠 Major | 실제로 일어나는 상황에서 틀린 동작. 사용자에게 보이는 spec 불일치, 보안 영향이 없는 CRITICAL 규칙 위반, 레이어 위반 |
| 🟡 Minor | 드문 경계 상황, 실제 유지보수 비용이 드는 문제, 요약 문서 동기화 누락 |
| ⚪ Nit | 이름, 표현, 작은 정리. 고치지 않아도 된다 |

## 검증 (검증자 3명, 2/3 다수결)

- Nit까지 모든 지적에 독립 검증자 3명을 붙인다.
- 검증자는 반박하는 쪽에서 시작한다. 코드 경로를 직접 따라가 문제가 실제로 생기는 상황을 세우지 못하면 `refuted`다.
- `confirmed` 2표 이상이면 남기고, `refuted` 2표 이상이면 버린다. 검증자가 실패(null)해서 어느 쪽도 2표가 안 되면 남기고 "(검증 실패)"를 붙인다. 판정에 영향을 줄 수 있는 지적이 조용히 사라지지 않게 하기 위해서다.
- 최종 심각도는 `confirmed`를 낸 검증자들이 매긴 심각도의 중앙값이다. 짝수면 낮은 쪽을 쓴다. `confirmed`가 하나도 없이 검증 실패로 남은 지적은 리뷰어가 매긴 심각도를 쓴다.
- 검증 실패로 남은 지적도 판정과 집계에 센다.
- 에이전트 수는 4 + 3 × 지적 수다(지적 10개면 34개, 동시 실행 최대 16개).

## 스키마

```
FINDINGS = {
  findings: [{ file, line, severity: "critical"|"major"|"minor"|"nit",
               title, tldr, good, fix }],
  strengths: string[]          // 최대 2개
}
VOTE = { verdict: "confirmed"|"refuted", severity, reason }
```

`good`은 이 코드가 어떻게 동작해야 하는지(규칙·기대 동작)를 적고, `fix`는 그렇게 만드는 코드나 수정 방법이다.

## 조립 (코드)

- **중복**: 같은 `file`·`line`의 지적은 하나로 합친다. 심각도가 가장 높은 지적의 제목과 본문을 쓰고, 차원 태그를 모은다(예: `[security, architecture]`).
- **판정**
  - Critical이 하나라도 있으면 Blocked
  - Major가 있으면 Changes Requested
  - 둘 다 없으면 Approve
  - 단, 리뷰가 실패한 차원이 있으면 Approve 대신 Changes Requested를 낸다
- **집계**: 🔴·🟠·🟡·⚪ 개수, 검증에서 버린 수, 검증 실패 수
- **다음 액션**: 판정에 따라 정한다.
  - Blocked: "Critical을 고친 뒤 /review-code를 다시 돌린다"
  - Changes Requested: "Major를 고친 뒤 병합한다"
  - Approve: "병합해도 된다. Minor·Nit는 골라서 고친다"
  - 실패한 차원이 있으면 맨 앞에 "⚠ <차원> 리뷰가 실패했다. 다시 돌린다"를 넣는다
- **정렬**: 심각도 → 파일 → 줄
- **반환**: `{ report, review: { body, comments: [{ path, line, body }] }, verdict }`. `report`는 채팅용 마크다운 전체, `review`는 PR 게시용이다.

## 출력 형식

요약을 먼저, 인라인을 뒤에 둔다.

```
## 리뷰 요약 — Blocked
🔴 1 · 🟠 2 · 🟡 3 · ⚪ 1   (검증에서 버린 지적 2개 · 검증 실패 0개)

Walkthrough
대화 종료 피드백에 한글 발음 규칙을 넣고, 단어 데이터 표기를 맞췄다.

잘된 점
- 발음 검사를 cleanPron 하나로 모아 화면·프롬프트가 같은 규칙을 쓴다

Critical · Major
- 🔴 src/server/chat.ts:42 admin 조회에 user_id 없음 [security]
- 🟠 ...

다음 액션
- Critical을 고친 뒤 /review-code를 다시 돌린다

## 인라인 코멘트
src/server/chat.ts:42 [security]
[🔴 Critical] admin 조회에 user_id 없음
TL;DR: 남의 세션을 읽을 수 있다
Good: admin 조회는 항상 user_id를 걸고, 없으면 404
→ Fix: `.eq('user_id', userId)` 추가
```

인라인 코멘트는 위치 줄 아래 4줄(`[심각도] 제목` / `TL;DR` / `Good` / `→ Fix`)이다. Fix가 여러 줄 코드면 짧은 코드 블록으로 쓴다. 검증 실패한 지적은 제목 뒤에 "(검증 실패)"를 붙인다.

## 게시

- **PR이 없으면** `report`를 채팅에 그대로 낸다.
- **PR이 있고 base가 main이며, 작업 트리가 깨끗하고 HEAD가 PR의 `headRefOid`와 같으면** `gh api`로 PR 리뷰 하나를 올린다.
  - `body`가 요약, `comments`가 인라인이다(`path`, `line`, `side: RIGHT`).
  - 자기 PR에는 Approve·Request changes를 달 수 없으므로 event는 `COMMENT`로 고정하고 판정은 본문 텍스트로만 쓴다.
  - 채팅에는 판정 한 줄, PR 링크, 요약을 낸다.
- **diff 밖 줄의 지적**은 인라인으로 달 수 없다. 메인이 `git diff -U0 <base>`의 hunk로 판단해서 본문의 "diff 밖 지적" 절로 옮긴다.
- **PR은 있지만 커밋 안 한 변경이나 push 안 한 커밋이 있으면** 줄 번호가 PR과 어긋날 수 있다. 채팅으로 내고 그 이유를 말한다.
- **게시가 실패하면** 채팅으로 내고 에러를 말한다.

## 실패 처리

| 상황 | 동작 |
|---|---|
| 리뷰어 에이전트 실패(null) | 요약에 "⚠ 미완료 차원: <차원>", Approve를 내지 않음 |
| 검증자 실패 | 위 "검증" 규칙(남기고 "(검증 실패)") |
| Workflow 자체 실패·중단 | 메인이 에러를 그대로 알린다 |
| args 없이 `/review-code-run` | 안내 문구만 반환 |

## 권한과 비용

- 실행할 때 Workflow 권한 확인 창이 뜬다. 수동 모드는 매번, auto 모드는 처음에만 뜨고, 저장된 workflow는 "다시 묻지 않기"를 고를 수 있다.
- 리뷰 한 번에 에이전트 4 + 3 × 지적 수.

## 검증 방법

`.md`와 `.js` 설정 파일이라 단위 테스트 대신 실제로 돌려 본다.

1. **문법과 가드**: `/review-code-run`을 args 없이 실행하면 안내 문구가 나온다.
2. **이름 분리**: `/review-code`가 스킬(오케스트레이터)을 실행한다.
3. **심은 버그**: 차원마다 버그를 하나씩 심은 일회용 브랜치에서 돌린다. 4개가 모두 맞는 차원으로 잡히고 심각도가 기준에 맞으며 판정이 Blocked여야 한다. 확인 뒤 브랜치를 지운다.
4. **대조군**: 문서 오타 하나만 고친 일회용 브랜치에서 Approve가 나오고 Critical·Major가 0개여야 한다(거짓 양성 확인).
5. **PR 게시**: 사용자 확인을 받은 뒤 심은 버그 브랜치로 draft PR을 만들어 인라인과 요약이 올라가는지 본다. 끝나면 PR을 닫고 원격 브랜치를 지운다.

3~5는 main에 병합한 뒤 main에서 딴 브랜치로 한다. base가 main과 갈라진 지점이라, 리뷰 도구 브랜치 위에서 시험하면 도구 파일 자체가 리뷰 대상에 섞이기 때문이다. 시험하는 세션은 그 worktree 폴더에서 연다(스킬과 workflow는 세션을 연 폴더의 `.claude/`에서 읽는다).
