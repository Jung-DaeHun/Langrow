---
name: review-code
description: 변경 사항을 4개 차원(correctness·security·architecture·consistency)으로 병렬 리뷰하고 지적마다 검증자 3명으로 거른다
disable-model-invocation: true
---

# /review-code

현재 브랜치의 변경(main과 갈라진 지점부터 커밋 안 한 변경까지)을 4개 차원으로 병렬 리뷰한다. 리뷰와 검증은 Workflow `review-code-run`이 한다. 너는 범위·PR·가드레일 문서를 모아 넘기고 결과를 게시한다. 리뷰만 한다. 코드를 고치지 않는다.

## 1. 범위

1. `git status -sb`로 브랜치를 확인한다.
2. `git merge-base main HEAD`로 base를 구한다.
3. 변경 파일을 모은다.
   - `git diff --name-status <base>`: 커밋한 것과 커밋 안 한 것. 줄마다 `{ "path": 경로, "status": 상태의 첫 글자 }`를 만든다. 이름 변경(`R100<TAB>옛 경로<TAB>새 경로`)은 새 경로를 쓴다. 삭제(D)도 넣는다.
   - `git ls-files --others --exclude-standard`: 커밋 안 한 새 파일. `{ "path": 경로, "status": "??" }`.
4. 둘 다 비어 있으면 "리뷰할 변경 없음"이라고 말하고 끝낸다.

## 2. PR

`gh pr view --json number,url,headRefOid,baseRefName,state`를 돌린다. 실패하면(PR 없음, gh 없음, 로그인 안 됨) PR 없음으로 본다.

PR이 있고 아래가 모두 맞으면 "PR 게시 가능"이다.
- `state`가 `OPEN`
- `baseRefName`이 `main`
- `git rev-parse main`과 `git rev-parse origin/main`이 같음
- `git status --porcelain` 출력이 비어 있음
- `git rev-parse HEAD`가 `headRefOid`와 같음

PR이 있는데 게시 가능이 아니면 맞지 않은 조건을 기억해 둔다.

## 3. 가드레일 문서

- 항상 `docs/ARCHITECTURE.md`, `docs/ADR.md`
- 변경 파일과 관련된 `docs/spec/*.md`. CLAUDE.md의 spec 목록 설명(예: `chat.md` AI 대화, `usage.md` 플랜 한도)으로 고른다. 확실하지 않으면 넣는다.
- `docs/spec/`을 바꿨으면 대응하는 요약 문서: 기능·한도·화면·지표 → `docs/PRD.md`, API·데이터 모델·이벤트 → `docs/ARCHITECTURE.md`, 설계 결정 → `docs/ADR.md`, 화면 규칙 → `docs/UI_GUIDE.md`
- CLAUDE.md는 리뷰 에이전트에 자동으로 들어가니 넣지 않는다.

## 4. Walkthrough

`git log <base>..HEAD --oneline`과 `git diff --stat <base>`, 커밋 안 한 새 파일 목록을 보고 무엇을 바꿨는지 2~3줄로 쓴다. 평가는 넣지 않는다.

## 5. Workflow 실행

Workflow 도구를 `name: "review-code-run"`으로 부른다. `args`는 JSON 문자열이 아니라 객체로 넘긴다.

```json
{ "base": "<base>", "files": [{ "path": "...", "status": "M" }], "docs": ["docs/ARCHITECTURE.md"], "walkthrough": "...", "hunks": "..." }
```

`hunks`는 PR 게시 가능일 때만 넣는다. Bash 도구로(PowerShell에는 `grep`이 없다) `git diff -U0 <base> | grep -E '^(\+\+\+ |@@ )'` 출력을 그대로 넣는다. 게시 가능이 아니면 `hunks`를 뺀다.

Workflow는 `{ report, review, verdict }`를 돌려준다. Workflow가 실패하거나 중단되면 에러를 그대로 알리고 끝낸다.

## 6. 게시

- PR 게시 가능이고 `review`가 null이 아니면:
  1. `gh repo view --json nameWithOwner`로 `<owner>/<repo>`를 구한다.
  2. 세션 스크래치패드에 `{ "commit_id": "<headRefOid>", "event": "COMMENT", "body": review.body, "comments": review.comments }`를 JSON 파일로 쓴다. 자기 PR에는 Approve·Request changes를 달 수 없어서 event는 늘 `COMMENT`다.
  3. `gh api repos/<owner>/<repo>/pulls/<number>/reviews --method POST --input <파일>`
  4. 성공하면 채팅에 `판정: <verdict>`, PR 링크, `review.body`를 낸다.
  5. 실패하면 `report`를 채팅에 그대로 내고 에러 메시지를 덧붙인다.
- 그 밖에는 `report`를 채팅에 **그대로** 낸다. 고치거나 줄이지 않는다. PR이 있었는데 게시 가능이 아니었으면 맨 아래에 "PR에 올리지 않음: <맞지 않은 조건>"을 한 줄 붙인다.
