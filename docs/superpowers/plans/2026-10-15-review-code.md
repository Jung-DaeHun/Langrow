# /review-code 차원별 병렬 리뷰 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/review-code`를 실행하면 현재 브랜치의 변경을 4개 차원으로 병렬 리뷰하고, 지적마다 검증자 3명이 2/3 다수결로 거른 결과를 요약과 인라인 코멘트로 채팅(또는 PR)에 낸다.

**Architecture:** `.claude/commands/review-code.md`(메인 세션)가 범위·PR·가드레일 문서를 모아 저장된 Workflow `review-code-run`을 부른다. `.claude/workflows/review-code-run.js`는 `pipeline(DIMENSIONS, 리뷰, 검증)`으로 리뷰어 4명과 지적마다 검증자 3명을 돌린다. 중복 합치기·판정·출력은 에이전트 없이 코드로 하고 `{ report, review, verdict }`를 돌려준다. 조립 로직은 Workflow 런타임 대신 가짜 `agent`·`parallel`·`pipeline`으로 스크립트를 돌리는 Vitest 테스트로 확인한다.

**Tech Stack:** Claude Code 저장 Workflow(plain JavaScript, `agent`/`parallel`/`pipeline` 전역), Claude Code 커스텀 명령(`.claude/commands/*.md`), Vitest 5.0.3(node 프로젝트, `scripts/**/*.test.ts`), ESLint 9.39.5(flat config), git, gh

**Spec:** `docs/superpowers/specs/2026-10-15-review-code-design.md`

## Global Constraints

- 작업 폴더는 worktree `C:/Users/정대훈/OneDrive/Desktop/eogns_claude/myProject/Langrow-review-code`(브랜치 `chore-review-code`)다. 원래 폴더 `Langrow`는 다른 세션이 `chore-google-oauth-local`로 쓰고 있으니 건드리지 않는다. 명령은 이 worktree에서 돌린다.
- Workflow 스크립트는 plain JavaScript다. 타입 주석, import, 파일·셸 접근을 쓰지 않는다. `Date.now()`, `Math.random()`, 인자 없는 `new Date()`를 쓰지 않는다. `export const meta = {...}`는 변수·함수 호출이 없는 순수 리터럴이다.
- `meta.name`과 파일 이름은 `review-code-run`이다. command(`review-code`)와 이름이 겹치지 않아야 한다.
- 차원 key와 순서: `correctness`, `security`, `architecture`, `consistency`.
- 심각도 값: `critical` > `major` > `minor` > `nit`, 아이콘 🔴 🟠 🟡 ⚪, 표시 이름 `Critical`·`Major`·`Minor`·`Nit`. 판정 문자열: `Blocked`, `Changes Requested`, `Approve`.
- agent label 형식(테스트가 기댄다): 리뷰어 `review:<key>`, 검증자 `verify:<key>:<file>:<line>#<n>`(n은 1~3, file은 `/` 구분으로 정규화한 경로).
- 검증: Nit 포함 모든 지적에 검증자 3명. `refuted` 2표 이상이면 버리고, `confirmed` 2표 이상이면 남긴다. 그 밖(검증자 실패로 2표가 안 모임)은 남기고 "(검증 실패)"를 붙이며 판정에 센다. 최종 심각도는 `confirmed` 표 심각도의 중앙값(짝수면 덜 심한 쪽)이고, `confirmed`가 없으면 리뷰어 심각도다.
- 커밋은 conventional commits이고 마지막 줄은 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`이다. 커밋 전에 `git status -sb`를 보고 바꾼 파일만 `git add`한다.
- worktree는 다른 세션의 Stop hook이 검사하지 않는다. 각 Task 끝에 worktree에서 `npm run lint`, `npm run build`, `npm run test`를 직접 돌린다.
- 병합 전에는 args를 넣어 Workflow를 실제로 돌리지 않는다(에이전트 비용, 도구 파일이 리뷰 대상에 섞임). args 없는 가드 확인만 한다.

## Review Focus

1. Workflow 가이드가 경고하듯 메인이 `args`를 JSON 문자열로 넘길 수 있다. 문자열도 객체와 같게 받아야 한다 → Task 1 "args가 JSON 문자열로 와도"
2. 리뷰어가 Windows 경로(`src\server\chat.ts`)로 보고하면 같은 줄 지적이 따로 남고 hunk 판정이 빗나간다. `/`로 정규화해야 한다 → Task 1 "경로 구분자가 달라도"
3. 커밋 안 한 새 파일(`??`)은 `git diff <base>`에 나오지 않는다. 리뷰어 프롬프트에 직접 읽으라는 규칙이 있어야 한다 → Task 1 "새 파일 규칙"
4. 지적이 0개인 차원(빈 배열)을 리뷰어 실패(null)로 오인하면 정상 리뷰가 Approve를 못 받는다 → Task 1 "리뷰어가 실패한 차원"
5. Windows에서 넘어온 hunks는 CRLF일 수 있다. 삭제만 있는 hunk(`+n,0`)와 삭제된 파일(`+++ /dev/null`)은 인라인을 달 수 있는 범위가 아니다 → Task 2 "CRLF", "삭제만 있는 hunk"

---

### Task 1: Workflow 리뷰·검증·조립

**Files:**
- Create: `scripts/review-code-run.test.ts`
- Create: `.claude/workflows/review-code-run.js`
- Modify: `eslint.config.mjs` (globalIgnores에 `.claude/workflows/**` 추가)

**Interfaces:**
- Consumes: 없음
- Produces:
  - Workflow `review-code-run`. args `{ base: string, files: { path: string, status: string }[], docs: string[], walkthrough: string, hunks?: string }`(객체 또는 그 JSON 문자열)
  - 반환 `{ report: string, review: null | { body: string, comments: { path, line, side, body }[] }, verdict: null | "Blocked" | "Changes Requested" | "Approve" }`. 이 Task에서 `review`는 늘 `null`이고 Task 2가 채운다.
  - 스크립트 안 함수(Task 2가 쓴다): `normPath(path)`, `renderInline(f)`, `titleLine(f)`, `fixLine(fix)`, `assemble(results, input)`. 합친 지적 `f`의 필드: `file, line, severity, title, tldr, good, fix, dimension, dimensions: string[], status, unverified: boolean`.

- [ ] **Step 1: worktree 의존성 설치**

worktree에는 `node_modules`가 없다.

Run (Bash): `cd "C:/Users/정대훈/OneDrive/Desktop/eogns_claude/myProject/Langrow-review-code" && npm ci`
Expected: `added N packages`, exit 0

- [ ] **Step 2: 실패하는 테스트 작성**

`scripts/review-code-run.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// .claude/workflows/review-code-run.js를 Workflow 런타임 대신 가짜 agent·parallel·pipeline으로 돌린다.
// 런타임은 스크립트 본문을 async 함수로 감싸 실행하므로(맨 위 return 허용) 여기서도 같은 방식으로 감싼다

type Severity = "critical" | "major" | "minor" | "nit";
type Finding = { file: string; line: number; severity: Severity; title: string; tldr: string; good: string; fix: string };
type Review = { findings: Finding[]; strengths?: string[] } | null;
type Vote = { verdict: "confirmed" | "refuted"; severity: Severity; reason: string } | null;
type AgentOptions = { label?: string; phase?: string; schema?: object };
type WorkflowResult = {
  report: string;
  review: { body: string; comments: { path: string; line: number; side: string; body: string }[] } | null;
  verdict: string | null;
};

const SOURCE = readFileSync(resolve(process.cwd(), ".claude/workflows/review-code-run.js"), "utf8");
const AsyncFunction: new (...params: string[]) => (...args: unknown[]) => Promise<unknown> = Object.getPrototypeOf(
  async function () {},
).constructor;

const ARGS = {
  base: "abc123",
  files: [
    { path: "src/server/chat.ts", status: "M" },
    { path: "src/lib/fresh.ts", status: "??" },
  ],
  docs: ["docs/ARCHITECTURE.md", "docs/spec/chat.md"],
  walkthrough: "대화 턴 저장을 고쳤다.",
};

const confirm = (severity: Severity): Vote => ({ verdict: "confirmed", severity, reason: "재현됨" });
const refute = (severity: Severity): Vote => ({ verdict: "refuted", severity, reason: "재현 안 됨" });
const allConfirm = (severity: Severity): Vote[] => [confirm(severity), confirm(severity), confirm(severity)];

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/server/chat.ts",
    line: 42,
    severity: "critical",
    title: "admin 조회에 user_id 없음",
    tldr: "남의 세션을 읽을 수 있다",
    good: "admin 조회는 항상 user_id를 걸고, 없으면 404",
    fix: ".eq('user_id', userId) 추가",
    ...overrides,
  };
}

// reviews: 차원별 리뷰 결과(빠진 차원은 지적 없음, null은 리뷰어 실패)
// votes: "<차원>:<파일>:<줄>"별 검증자 3명의 표(null은 검증자 실패)
async function run(args: unknown, reviews: Record<string, Review> = {}, votes: Record<string, Vote[]> = {}) {
  const calls: { prompt: string; options: AgentOptions }[] = [];
  const agent = async (prompt: string, options: AgentOptions = {}) => {
    calls.push({ prompt, options });
    const label = options.label ?? "";
    if (label.startsWith("review:")) {
      const review = reviews[label.slice("review:".length)];
      if (review === null) return null;
      return { strengths: [], ...(review ?? { findings: [] }) };
    }
    const match = /^verify:(.+)#(\d)$/.exec(label);
    if (!match) throw new Error(`모르는 label: ${label}`);
    const vote = votes[match[1]]?.[Number(match[2]) - 1];
    if (vote === undefined) throw new Error(`표가 없다: ${label}`);
    return vote;
  };
  const parallel = (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map((thunk) => thunk().catch(() => null)));
  const pipeline = (items: unknown[], ...stages: ((previous: unknown, item: unknown, index: number) => unknown)[]) =>
    Promise.all(
      items.map(async (item, index) => {
        let value: unknown = item;
        for (const stage of stages) {
          try {
            value = await stage(value, item, index);
          } catch {
            return null;
          }
        }
        return value;
      }),
    );
  const workflow = new AsyncFunction(
    "agent",
    "parallel",
    "pipeline",
    "phase",
    "log",
    "args",
    SOURCE.replace("export const meta", "const meta"),
  );
  const result = (await workflow(agent, parallel, pipeline, () => {}, () => {}, args)) as WorkflowResult;
  return { result, calls };
}

describe("review-code-run workflow", () => {
  it("args가 없거나 파일이 비면 에이전트 없이 /review-code 안내를 돌려준다", async () => {
    for (const args of [undefined, {}, { ...ARGS, files: [] }, "not json"]) {
      const { result, calls } = await run(args);
      expect(calls).toHaveLength(0);
      expect(result.report).toContain("/review-code로 실행하세요");
      expect(result.verdict).toBeNull();
      expect(result.review).toBeNull();
    }
  });

  it("args가 JSON 문자열로 와도 객체와 같게 리뷰한다", async () => {
    const { result, calls } = await run(JSON.stringify(ARGS));
    expect(calls.map((call) => call.options.label)).toEqual([
      "review:correctness",
      "review:security",
      "review:architecture",
      "review:consistency",
    ]);
    expect(result.verdict).toBe("Approve");
  });

  it("차원 4개 리뷰어를 Review 단계로 부르고 범위·문서·새 파일 규칙을 프롬프트에 넣는다", async () => {
    const { calls } = await run(ARGS);
    expect(calls).toHaveLength(4);
    for (const { prompt, options } of calls) {
      expect(options.phase).toBe("Review");
      expect(options.schema).toBeDefined();
      expect(prompt).toContain("base: abc123");
      expect(prompt).toContain("- M src/server/chat.ts");
      expect(prompt).toContain("- ?? src/lib/fresh.ts");
      expect(prompt).toContain("- docs/spec/chat.md");
      expect(prompt).toContain("git diff에 나오지 않으니 파일을 직접 읽는다");
      expect(prompt).toContain("critical: 병합하면 사고");
    }
    expect(calls[1].prompt).toContain("security 차원 리뷰어");
    expect(calls[1].prompt).toContain("getUser()");
  });

  it("지적이 없으면 검증 없이 Approve를 낸다", async () => {
    const { result, calls } = await run(ARGS);
    expect(calls).toHaveLength(4);
    expect(result.report).toContain("## 리뷰 요약 — Approve");
    expect(result.report).toContain("🔴 0 · 🟠 0 · 🟡 0 · ⚪ 0   (검증에서 버린 지적 0개 · 검증 실패 0개)");
    expect(result.report).toContain("- 병합해도 된다. Minor·Nit는 골라서 고친다");
    expect(result.report).toContain("## 인라인 코멘트\n\n- 없음");
  });

  it("지적마다 검증자 3명을 부르고 confirmed 2표면 남기고 refuted 2표면 버린다", async () => {
    const { result, calls } = await run(
      ARGS,
      {
        security: { findings: [finding({ line: 10, title: "남는 지적" })] },
        correctness: { findings: [finding({ line: 20, severity: "major", title: "버려지는 지적" })] },
      },
      {
        "security:src/server/chat.ts:10": [confirm("critical"), confirm("critical"), refute("critical")],
        "correctness:src/server/chat.ts:20": [refute("major"), refute("major"), confirm("major")],
      },
    );
    const verifies = calls.filter((call) => call.options.label?.startsWith("verify:"));
    expect(verifies).toHaveLength(6);
    expect(verifies.every((call) => call.options.phase === "Verify" && call.options.schema !== undefined)).toBe(true);
    expect(verifies.find((call) => call.options.label?.endsWith("#2"))?.prompt).toContain("2번째 독립 검증자");
    expect(result.report).toContain("남는 지적");
    expect(result.report).not.toContain("버려지는 지적");
    expect(result.report).toContain("(검증에서 버린 지적 1개 · 검증 실패 0개)");
  });

  it("검증자가 실패해 2표가 안 모이면 남기고 (검증 실패)를 붙이며 판정에 센다", async () => {
    const { result } = await run(
      ARGS,
      {
        security: {
          findings: [
            finding({ line: 10, title: "확정 1표" }),
            finding({ line: 11, severity: "minor", title: "반박 1표" }),
          ],
        },
      },
      {
        "security:src/server/chat.ts:10": [confirm("critical"), null, null],
        "security:src/server/chat.ts:11": [refute("minor"), null, null],
      },
    );
    expect(result.verdict).toBe("Blocked");
    expect(result.report).toContain("[🔴 Critical] 확정 1표 (검증 실패)");
    expect(result.report).toContain("[🟡 Minor] 반박 1표 (검증 실패)");
    expect(result.report).toContain("검증 실패 2개");
  });

  it("최종 심각도는 confirmed 표의 중앙값이고 짝수면 덜 심한 쪽을 쓴다", async () => {
    const { result } = await run(
      ARGS,
      {
        security: {
          findings: [
            finding({ line: 10, title: "둘로 갈림" }),
            finding({ line: 11, severity: "minor", title: "셋 중 둘" }),
          ],
        },
      },
      {
        "security:src/server/chat.ts:10": [confirm("critical"), confirm("major"), refute("critical")],
        "security:src/server/chat.ts:11": [confirm("critical"), confirm("critical"), confirm("nit")],
      },
    );
    expect(result.report).toContain("[🟠 Major] 둘로 갈림");
    expect(result.report).toContain("[🔴 Critical] 셋 중 둘");
  });

  it("같은 파일·줄의 지적은 경로 구분자가 달라도 하나로 합치고 가장 심한 지적과 차원 태그를 쓴다", async () => {
    const { result } = await run(
      ARGS,
      {
        security: { findings: [finding()] },
        architecture: {
          findings: [finding({ file: "src\\server\\chat.ts", severity: "major", title: "CRITICAL 규칙 위반" })],
        },
      },
      {
        "security:src/server/chat.ts:42": allConfirm("critical"),
        "architecture:src/server/chat.ts:42": allConfirm("major"),
      },
    );
    expect(result.report).toContain("🔴 1 · 🟠 0 · 🟡 0 · ⚪ 0");
    expect(result.report).toContain("src/server/chat.ts:42 [security, architecture]\n[🔴 Critical] admin 조회에 user_id 없음");
    expect(result.report).not.toContain("CRITICAL 규칙 위반");
  });

  it("Critical이 없고 Major가 있으면 Changes Requested, Minor·Nit만 있으면 Approve", async () => {
    const major = await run(
      ARGS,
      { correctness: { findings: [finding({ severity: "major" })] } },
      { "correctness:src/server/chat.ts:42": allConfirm("major") },
    );
    expect(major.result.verdict).toBe("Changes Requested");
    expect(major.result.report).toContain("- Major를 고친 뒤 병합한다");

    const minor = await run(
      ARGS,
      { correctness: { findings: [finding({ severity: "minor" }), finding({ line: 50, severity: "nit" })] } },
      {
        "correctness:src/server/chat.ts:42": allConfirm("minor"),
        "correctness:src/server/chat.ts:50": allConfirm("nit"),
      },
    );
    expect(minor.result.verdict).toBe("Approve");
    expect(minor.result.report).toContain("Critical · Major\n- 없음");
  });

  it("리뷰어가 실패한 차원은 미완료로 표시하고 Approve 대신 Changes Requested를 낸다", async () => {
    const { result } = await run(ARGS, { security: null });
    expect(result.verdict).toBe("Changes Requested");
    expect(result.report).toContain("⚠ 미완료 차원: security");
    expect(result.report).toContain("다음 액션\n- ⚠ security 리뷰가 실패했다. /review-code를 다시 돌린다");
    // 지적이 없는(빈 배열) 차원은 실패가 아니다
    expect(result.report).not.toContain("correctness 리뷰가 실패");
  });

  it("요약 먼저, 인라인은 위치 줄과 4줄로 낸다", async () => {
    const { result } = await run(
      ARGS,
      { security: { findings: [finding()], strengths: ["발음 검사를 한 곳에 모았다"] } },
      { "security:src/server/chat.ts:42": allConfirm("critical") },
    );
    expect(result.report).toBe(
      [
        "## 리뷰 요약 — Blocked",
        "🔴 1 · 🟠 0 · 🟡 0 · ⚪ 0   (검증에서 버린 지적 0개 · 검증 실패 0개)",
        "",
        "Walkthrough",
        "대화 턴 저장을 고쳤다.",
        "",
        "잘된 점",
        "- 발음 검사를 한 곳에 모았다",
        "",
        "Critical · Major",
        "- 🔴 src/server/chat.ts:42 admin 조회에 user_id 없음 [security]",
        "",
        "다음 액션",
        "- Critical을 고친 뒤 /review-code를 다시 돌린다",
        "",
        "## 인라인 코멘트",
        "",
        "src/server/chat.ts:42 [security]",
        "[🔴 Critical] admin 조회에 user_id 없음",
        "TL;DR: 남의 세션을 읽을 수 있다",
        "Good: admin 조회는 항상 user_id를 걸고, 없으면 404",
        "→ Fix: .eq('user_id', userId) 추가",
      ].join("\n"),
    );
  });

  it("인라인은 심각도 → 파일 → 줄 순이다", async () => {
    const { result } = await run(
      ARGS,
      {
        correctness: {
          findings: [
            finding({ file: "src/b.ts", line: 1, severity: "nit", title: "B1" }),
            finding({ file: "src/z.ts", line: 5, title: "Z5" }),
            finding({ file: "src/a.ts", line: 9, title: "A9" }),
            finding({ file: "src/a.ts", line: 3, title: "A3" }),
          ],
        },
      },
      {
        "correctness:src/b.ts:1": allConfirm("nit"),
        "correctness:src/z.ts:5": allConfirm("critical"),
        "correctness:src/a.ts:9": allConfirm("critical"),
        "correctness:src/a.ts:3": allConfirm("critical"),
      },
    );
    const positions = ["A3", "A9", "Z5", "B1"].map((title) => result.report.indexOf(`] ${title}`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions[0]).toBeGreaterThan(result.report.indexOf("## 인라인 코멘트"));
  });

  it("Fix가 여러 줄이면 코드 블록으로 쓴다", async () => {
    const { result } = await run(
      ARGS,
      { correctness: { findings: [finding({ severity: "minor", fix: "if (!row) {\n  return notFound();\n}" })] } },
      { "correctness:src/server/chat.ts:42": allConfirm("minor") },
    );
    expect(result.report).toContain("→ Fix:\n```\nif (!row) {\n  return notFound();\n}\n```");
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx vitest run scripts/review-code-run.test.ts`
Expected: FAIL. `ENOENT: no such file or directory ... .claude/workflows/review-code-run.js`

- [ ] **Step 4: Workflow 스크립트 작성**

`.claude/workflows/review-code-run.js`:

```js
export const meta = {
  name: 'review-code-run',
  description: '/review-code가 부르는 4차원 병렬 리뷰와 지적마다 검증자 3명(2/3 다수결)',
  whenToUse: '직접 실행하지 않는다. /review-code가 변경 범위와 문서를 모아 args로 넘겨 부른다.',
  phases: [
    { title: 'Review', detail: '차원 4개 병렬 리뷰' },
    { title: 'Verify', detail: '지적마다 검증자 3명, 2/3 다수결' },
  ],
}

// 앞일수록 심하다
const SEVERITIES = ['critical', 'major', 'minor', 'nit']
const ICON = { critical: '🔴', major: '🟠', minor: '🟡', nit: '⚪' }
const NAME = { critical: 'Critical', major: 'Major', minor: 'Minor', nit: 'Nit' }
const VOTERS = 3

const SEVERITY_GUIDE = [
  '심각도 기준:',
  '- critical: 병합하면 사고. 남의 데이터 접근, secret 노출, XSS, 데이터 손상·유실, 주요 흐름(로그인·대화·단어 학습)이 깨짐',
  '- major: 실제로 일어나는 상황에서 틀린 동작. 사용자에게 보이는 spec 불일치, 보안 영향이 없는 CRITICAL 규칙 위반, 레이어 위반',
  '- minor: 드문 경계 상황, 실제 유지보수 비용이 드는 문제, 요약 문서 동기화 누락',
  '- nit: 이름, 표현, 작은 정리. 고치지 않아도 된다',
].join('\n')

const COMMON_RULES = [
  '규칙:',
  '- 읽기 전용이다. 파일을 고치지 않는다. Bash는 git diff, git log, git show처럼 읽는 명령만 쓴다.',
  '- 변경은 "git diff <base> -- <파일>"로 본다. 상태가 ??인 파일은 커밋 안 한 새 파일이라 git diff에 나오지 않으니 파일을 직접 읽는다.',
  '- 변경된 줄이나 변경 때문에 생긴 문제만 보고한다. 원래 있던 문제는 보고하지 않는다.',
  '- lint, build, test, TDD guard가 잡는 것은 보고하지 않는다.',
  '- file은 저장소 루트 기준 경로(/ 구분), line은 변경 후 파일의 줄 번호다. 추측이면 보고하지 않는다.',
  '- 지적이 없으면 findings는 빈 배열이다. 개수를 채우려고 만들지 않는다.',
  '- 다른 차원의 영역은 보고하지 않는다.',
  '- strengths(잘된 점)는 최대 2개다.',
  '- 가드레일 문서 중 이 차원에 필요한 것만 읽는다.',
  '- title은 한 줄 제목, tldr은 무엇이 왜 문제인지 한 줄, good은 이 코드가 어떻게 동작해야 하는지(규칙·기대 동작), fix는 그렇게 만드는 코드나 수정 방법이다.',
].join('\n')

// 차원을 추가하려면 여기에 { key, prompt } 하나를 넣는다
const DIMENSIONS = [
  {
    key: 'correctness',
    prompt: '로직 오류, 경계값, 예외·에러 흐름, 비동기 경쟁(await 누락 포함), null 처리, 상태 전이.',
  },
  {
    key: 'security',
    prompt:
      'admin(secret key) 클라이언트로 하는 조회·변경에 user_id를 거는지, 남의 리소스는 404인지, 사용자 ID를 getUser()로 얻는지(body의 userId 금지), secret에 NEXT_PUBLIC_이 붙지 않았는지, admin 클라이언트가 server-only로 막혀 있는지, dangerouslySetInnerHTML, RPC·RLS 권한(security definer, grant), 클라이언트가 보낸 날짜·플랜·사용량을 믿는지, 로그에 개인정보·secret이 남는지. user_id 규칙은 CLAUDE.md에서 아키텍처 규칙에 있지만 이 차원이 맡는다.',
  },
  {
    key: 'architecture',
    prompt:
      '쓰기와 Claude 호출이 src/app/api/**/route.ts → src/server/ use-case에서만 일어나는지, 페이지(Server Components)는 읽기만 하는지, 의존 방향 app → server → services·lib, src/lib/는 순수 함수인지(I/O·환경변수·fetch 없음), 여러 행의 판정·변경이 RPC 한 번이고 쓰기 RPC가 먼저 profiles FOR UPDATE를 잡는지, Claude 호출 중 DB 잠금을 잡지 않는지, 날짜·플랜·한도를 RPC 안의 DB 시각으로 판정하는지, 구현 파일 경로에 test 문자열이 없는지. user_id 규칙은 security가 맡으니 보고하지 않는다.',
  },
  {
    key: 'consistency',
    prompt:
      '바뀐 동작이 docs/spec/의 해당 절과 같은지, docs/spec/을 바꿨으면 같은 변경에서 요약 문서(기능·한도·화면·지표 → docs/PRD.md, API·데이터 모델·이벤트 → docs/ARCHITECTURE.md, 설계 결정 → docs/ADR.md, 화면 규칙 → docs/UI_GUIDE.md)도 바꿨는지, 파일 사이 타입·API 응답·에러 코드·이벤트 이름이 서로 맞는지.',
  },
]

const SEVERITY_SCHEMA = { type: 'string', enum: SEVERITIES }

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          severity: SEVERITY_SCHEMA,
          title: { type: 'string' },
          tldr: { type: 'string' },
          good: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'line', 'severity', 'title', 'tldr', 'good', 'fix'],
      },
    },
    strengths: { type: 'array', items: { type: 'string' }, maxItems: 2 },
  },
  required: ['findings', 'strengths'],
}

const VOTE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'refuted'] },
    severity: SEVERITY_SCHEMA,
    reason: { type: 'string' },
  },
  required: ['verdict', 'severity', 'reason'],
}

function rank(severity) {
  return SEVERITIES.indexOf(severity)
}

function normPath(path) {
  return String(path).replace(/\\/g, '/').replace(/^\.\//, '')
}

// args는 객체로 오지만 JSON 문자열로 와도 받는다
function readArgs(raw) {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value.base !== 'string' || !Array.isArray(value.files) || value.files.length === 0) return null
  return {
    base: value.base,
    files: value.files,
    docs: Array.isArray(value.docs) ? value.docs : [],
    walkthrough: typeof value.walkthrough === 'string' ? value.walkthrough : '',
    hunks: typeof value.hunks === 'string' ? value.hunks : null,
  }
}

function scopeText(input) {
  const files = input.files.map((f) => `- ${f.status} ${f.path}`).join('\n')
  const docs = input.docs.length ? input.docs.map((d) => `- ${d}`).join('\n') : '- (없음)'
  return `base: ${input.base}\n\n변경 파일:\n${files}\n\n가드레일 문서:\n${docs}`
}

function reviewPrompt(dimension, input) {
  return [
    `너는 Langrow 변경 사항을 리뷰하는 ${dimension.key} 차원 리뷰어다.`,
    `이 차원에서 보는 것: ${dimension.prompt}`,
    COMMON_RULES,
    SEVERITY_GUIDE,
    scopeText(input),
  ].join('\n\n')
}

function verifyPrompt(finding, dimension, input, n) {
  return [
    `너는 코드 리뷰 지적 하나를 검증하는 ${n}번째 독립 검증자다. 반박하는 쪽에서 시작한다.`,
    `지적 (${dimension.key}): ${finding.file}:${finding.line} [${finding.severity}] ${finding.title}`,
    `TL;DR: ${finding.tldr}\nGood: ${finding.good}\nFix: ${finding.fix}`,
    `변경은 "git diff ${input.base} -- ${finding.file}"로 본다. 읽기 전용이다. 파일을 고치지 않는다.`,
    '코드 경로를 직접 따라가 이 문제가 실제로 생기는 상황을 세울 수 있으면 verdict는 confirmed, 세우지 못하거나 확신이 없으면 refuted다.',
    'confirmed면 severity는 아래 기준으로 네가 매긴 심각도, refuted면 리뷰어의 심각도를 그대로 적는다. reason은 근거를 한두 문장으로 쓴다.',
    SEVERITY_GUIDE,
  ].join('\n\n')
}

// 심각도 중앙값. 짝수면 덜 심한 쪽
function medianSeverity(severities) {
  const sorted = [...severities].sort((a, b) => rank(a) - rank(b))
  return sorted[Math.floor(sorted.length / 2)]
}

// refuted 2표면 버리고, confirmed 2표면 남긴다. 검증자 실패로 어느 쪽도 2표가 안 되면 남기고 검증 실패로 표시한다
function tally(votes, reviewerSeverity) {
  const valid = votes.filter(Boolean)
  const confirmed = valid.filter((v) => v.verdict === 'confirmed').map((v) => v.severity)
  const refuted = valid.filter((v) => v.verdict === 'refuted').length
  if (refuted >= 2) return { status: 'refuted', severity: reviewerSeverity }
  if (confirmed.length >= 2) return { status: 'confirmed', severity: medianSeverity(confirmed) }
  return { status: 'unverified', severity: confirmed.length ? medianSeverity(confirmed) : reviewerSeverity }
}

async function verify(review, dimension, input) {
  if (!review) return null
  const judged = await parallel(
    review.findings.map((finding) => async () => {
      const file = normPath(finding.file)
      const votes = await parallel(
        Array.from({ length: VOTERS }, (_, i) => () =>
          agent(verifyPrompt({ ...finding, file }, dimension, input, i + 1), {
            label: `verify:${dimension.key}:${file}:${finding.line}#${i + 1}`,
            phase: 'Verify',
            schema: VOTE_SCHEMA,
          }),
        ),
      )
      return { ...finding, file, dimension: dimension.key, ...tally(votes, finding.severity) }
    }),
  )
  return { findings: judged.filter(Boolean), strengths: review.strengths ?? [] }
}

// 같은 파일·줄의 지적은 하나로. 가장 심한 지적의 내용을 쓰고 차원 태그를 모은다
function mergeDuplicates(findings) {
  const merged = new Map()
  for (const f of findings) {
    const key = `${f.file}:${f.line}`
    const prev = merged.get(key)
    if (!prev) {
      merged.set(key, { ...f, dimensions: [f.dimension] })
      continue
    }
    const dimensions = prev.dimensions.includes(f.dimension) ? prev.dimensions : [...prev.dimensions, f.dimension]
    const winner = rank(f.severity) < rank(prev.severity) ? f : prev
    merged.set(key, { ...winner, dimensions })
  }
  return [...merged.values()]
}

function compareFindings(a, b) {
  const byFile = a.file < b.file ? -1 : a.file > b.file ? 1 : 0
  return rank(a.severity) - rank(b.severity) || byFile || a.line - b.line
}

// 리뷰가 실패한 차원이 있으면 Approve를 내지 않는다
function decideVerdict(findings, failed) {
  if (findings.some((f) => f.severity === 'critical')) return 'Blocked'
  if (findings.some((f) => f.severity === 'major') || failed.length) return 'Changes Requested'
  return 'Approve'
}

function nextActions(verdict, findings, failed) {
  const actions = failed.length ? [`⚠ ${failed.join(', ')} 리뷰가 실패했다. /review-code를 다시 돌린다`] : []
  if (verdict === 'Blocked') actions.push('Critical을 고친 뒤 /review-code를 다시 돌린다')
  else if (findings.some((f) => f.severity === 'major')) actions.push('Major를 고친 뒤 병합한다')
  else if (verdict === 'Approve') actions.push('병합해도 된다. Minor·Nit는 골라서 고친다')
  return actions
}

function titleLine(f) {
  return `[${ICON[f.severity]} ${NAME[f.severity]}] ${f.title}${f.unverified ? ' (검증 실패)' : ''}`
}

function fixLine(fix) {
  return fix.includes('\n') ? `→ Fix:\n\`\`\`\n${fix}\n\`\`\`` : `→ Fix: ${fix}`
}

function renderInline(f) {
  return [
    `${f.file}:${f.line} [${f.dimensions.join(', ')}]`,
    titleLine(f),
    `TL;DR: ${f.tldr}`,
    `Good: ${f.good}`,
    fixLine(f.fix),
  ].join('\n')
}

function renderSummary({ verdict, findings, failed, refutedCount, walkthrough, strengths }) {
  const count = (severity) => findings.filter((f) => f.severity === severity).length
  const unverified = findings.filter((f) => f.unverified).length
  const serious = findings.filter((f) => rank(f.severity) <= rank('major'))
  const lines = [
    `## 리뷰 요약 — ${verdict}`,
    `${SEVERITIES.map((s) => `${ICON[s]} ${count(s)}`).join(' · ')}   (검증에서 버린 지적 ${refutedCount}개 · 검증 실패 ${unverified}개)`,
  ]
  if (failed.length) lines.push(`⚠ 미완료 차원: ${failed.join(', ')}`)
  lines.push(
    '',
    'Walkthrough',
    walkthrough || '(없음)',
    '',
    '잘된 점',
    ...(strengths.length ? strengths.map((s) => `- ${s}`) : ['- (없음)']),
    '',
    'Critical · Major',
    ...(serious.length
      ? serious.map((f) => `- ${ICON[f.severity]} ${f.file}:${f.line} ${f.title} [${f.dimensions.join(', ')}]`)
      : ['- 없음']),
    '',
    '다음 액션',
    ...nextActions(verdict, findings, failed).map((a) => `- ${a}`),
  )
  return lines.join('\n')
}

function assemble(results, input) {
  const failed = DIMENSIONS.filter((_, i) => !results[i]).map((d) => d.key)
  const judged = results.filter(Boolean).flatMap((r) => r.findings)
  const refutedCount = judged.filter((f) => f.status === 'refuted').length
  const kept = judged
    .filter((f) => f.status !== 'refuted')
    .map((f) => ({ ...f, unverified: f.status === 'unverified' }))
  const findings = mergeDuplicates(kept).sort(compareFindings)
  const strengths = [...new Set(results.filter(Boolean).flatMap((r) => r.strengths))]
  const verdict = decideVerdict(findings, failed)
  const summary = renderSummary({ verdict, findings, failed, refutedCount, walkthrough: input.walkthrough, strengths })
  const inline = findings.length ? findings.map(renderInline).join('\n\n') : '- 없음'
  return { report: `${summary}\n\n## 인라인 코멘트\n\n${inline}`, review: null, verdict }
}

const input = readArgs(args)
if (!input) {
  return {
    report: '이 workflow는 /review-code가 변경 범위와 문서를 모아 부른다. /review-code로 실행하세요.',
    review: null,
    verdict: null,
  }
}

const results = await pipeline(
  DIMENSIONS,
  (dimension) =>
    agent(reviewPrompt(dimension, input), {
      label: `review:${dimension.key}`,
      phase: 'Review',
      schema: FINDINGS_SCHEMA,
    }),
  (review, dimension) => verify(review, dimension, input),
)

return assemble(results, input)
```

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `npx vitest run scripts/review-code-run.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 6: ESLint가 workflow 스크립트를 읽지 않게 한다**

ESLint 9 flat config는 점으로 시작하는 폴더도 검사한다. 스크립트 맨 위의 `return`은 모듈 문법 오류라서 lint가 깨진다.

Run: `npm run lint`
Expected: FAIL. `.claude/workflows/review-code-run.js`에 `Parsing error: 'return' outside of function`

lint가 이미 통과하면(이 파일을 원래 검사하지 않음) 아래 변경을 하지 않고, Task 3 Step 2 (a)에서 `eslint.config.mjs` 줄도 넣지 않는다. 실패하면 `eslint.config.mjs`의 globalIgnores에 한 줄을 추가한다:

```js
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Workflow 스크립트는 런타임이 async 함수로 감싸 실행해 맨 위 return이 있다(모듈로 읽으면 문법 오류)
    ".claude/workflows/**",
  ]),
```

Run: `npm run lint && npm run build && npm run test`
Expected: 셋 다 exit 0

- [ ] **Step 7: 커밋**

```bash
git status -sb
git add scripts/review-code-run.test.ts .claude/workflows/review-code-run.js eslint.config.mjs
git commit -m "feat(review): add the review-code-run workflow with 3-voter verification

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: PR 게시용 review (hunks로 인라인·본문 나누기)

**Files:**
- Modify: `.claude/workflows/review-code-run.js` (함수 추가, `assemble`의 `review: null`을 바꿈)
- Modify: `scripts/review-code-run.test.ts` (describe 추가)

**Interfaces:**
- Consumes: Task 1의 `normPath`, `renderInline`, `titleLine`, `fixLine`, `assemble`, `input.hunks`
- Produces: `hunks`가 문자열이면 `review = { body, comments: [{ path, line, side: 'RIGHT', body }] }`, 아니면 `null`. comment body는 `[🔴 Critical] 제목 [차원] / TL;DR / Good / → Fix` 4줄이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/review-code-run.test.ts` 맨 아래에 추가:

```ts
describe("PR 게시용 review", () => {
  // git diff -U0 <base> 중 +++·@@ 줄. chat.ts는 40~43줄과 92줄이 바뀌었고, 121줄 hunk는 삭제만 있다
  const HUNKS = [
    "+++ b/src/server/chat.ts",
    "@@ -40,2 +40,4 @@ export async function sendTurn() {",
    "@@ -90 +92 @@",
    "@@ -120,3 +121,0 @@",
    "+++ /dev/null",
    "@@ -1,5 +0,0 @@",
  ].join("\n");

  it("hunks가 없으면 review는 null이다", async () => {
    const { result } = await run(ARGS, { security: { findings: [finding()] } }, {
      "security:src/server/chat.ts:42": allConfirm("critical"),
    });
    expect(result.review).toBeNull();
  });

  it("hunks 안 줄은 인라인 comments로, 밖의 줄은 본문 'diff 밖 지적'으로 보낸다", async () => {
    const { result } = await run(
      { ...ARGS, hunks: HUNKS },
      {
        security: {
          findings: [
            finding({ line: 42, title: "범위 안 42" }),
            finding({ line: 92, severity: "major", title: "범위 안 92" }),
            finding({ line: 60, severity: "minor", title: "범위 밖 60" }),
            finding({ line: 121, severity: "minor", title: "삭제만 있는 hunk" }),
            finding({ file: "docs/PRD.md", line: 1, severity: "minor", title: "다른 파일" }),
          ],
        },
      },
      {
        "security:src/server/chat.ts:42": allConfirm("critical"),
        "security:src/server/chat.ts:92": allConfirm("major"),
        "security:src/server/chat.ts:60": allConfirm("minor"),
        "security:src/server/chat.ts:121": allConfirm("minor"),
        "security:docs/PRD.md:1": allConfirm("minor"),
      },
    );
    expect(result.review?.comments).toEqual([
      {
        path: "src/server/chat.ts",
        line: 42,
        side: "RIGHT",
        body: [
          "[🔴 Critical] 범위 안 42 [security]",
          "TL;DR: 남의 세션을 읽을 수 있다",
          "Good: admin 조회는 항상 user_id를 걸고, 없으면 404",
          "→ Fix: .eq('user_id', userId) 추가",
        ].join("\n"),
      },
      { path: "src/server/chat.ts", line: 92, side: "RIGHT", body: expect.stringContaining("[🟠 Major] 범위 안 92") },
    ]);
    const body = result.review?.body ?? "";
    expect(body.startsWith("## 리뷰 요약 — Blocked")).toBe(true);
    expect(body).toContain("## diff 밖 지적");
    for (const title of ["범위 밖 60", "삭제만 있는 hunk", "다른 파일"]) expect(body).toContain(title);
    expect(body).not.toContain("## 인라인 코멘트");
  });

  it("diff 밖 지적이 없으면 본문은 요약과 같다", async () => {
    const { result } = await run({ ...ARGS, hunks: HUNKS });
    expect(result.review).toEqual({ body: result.report.split("\n\n## 인라인 코멘트")[0], comments: [] });
  });

  it("CRLF 줄바꿈 hunks도 읽는다", async () => {
    const { result } = await run(
      { ...ARGS, hunks: HUNKS.replace(/\n/g, "\r\n") },
      { security: { findings: [finding()] } },
      { "security:src/server/chat.ts:42": allConfirm("critical") },
    );
    expect(result.review?.comments.map((comment) => comment.line)).toEqual([42]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run scripts/review-code-run.test.ts`
Expected: FAIL. "hunks 안 줄은 인라인…", "diff 밖 지적이 없으면…", "CRLF…"가 `result.review`가 `null`이라서 실패한다. "hunks가 없으면…"은 통과한다.

- [ ] **Step 3: 구현**

`.claude/workflows/review-code-run.js`의 `renderInline` 함수 바로 아래에 추가:

```js
// PR 인라인 코멘트. 위치는 코멘트가 달린 줄이 대신하므로 차원 태그를 제목 줄에 붙인다
function renderComment(f) {
  return [`${titleLine(f)} [${f.dimensions.join(', ')}]`, `TL;DR: ${f.tldr}`, `Good: ${f.good}`, fixLine(f.fix)].join('\n')
}

// git diff -U0의 "+++ b/<파일>"과 "@@ -a,b +c,d @@" 줄에서 파일별 변경 후 줄 범위를 읽는다.
// 삭제만 있는 hunk(+c,0)와 삭제된 파일(+++ /dev/null)은 인라인을 달 수 있는 범위가 아니다
function parseHunks(text) {
  const ranges = new Map()
  let file = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim()
      file = path === '/dev/null' ? null : normPath(path.replace(/^b\//, ''))
      continue
    }
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!match || !file) continue
    const start = Number(match[1])
    const count = match[2] === undefined ? 1 : Number(match[2])
    if (count === 0) continue
    if (!ranges.has(file)) ranges.set(file, [])
    ranges.get(file).push([start, start + count - 1])
  }
  return ranges
}

// hunks가 없으면(PR 게시 불가) null. diff 밖 줄의 지적은 인라인으로 달 수 없어 본문으로 옮긴다
function buildReview(findings, summary, hunks) {
  if (hunks === null) return null
  const ranges = parseHunks(hunks)
  const inDiff = (f) => (ranges.get(f.file) ?? []).some(([from, to]) => f.line >= from && f.line <= to)
  const outside = findings.filter((f) => !inDiff(f))
  return {
    body: outside.length ? `${summary}\n\n## diff 밖 지적\n\n${outside.map(renderInline).join('\n\n')}` : summary,
    comments: findings
      .filter(inDiff)
      .map((f) => ({ path: f.file, line: f.line, side: 'RIGHT', body: renderComment(f) })),
  }
}
```

`assemble`의 마지막 줄을 바꾼다:

```js
  return { report: `${summary}\n\n## 인라인 코멘트\n\n${inline}`, review: buildReview(findings, summary, input.hunks), verdict }
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `npx vitest run scripts/review-code-run.test.ts`
Expected: PASS (17 tests)

Run: `npm run lint && npm run build && npm run test`
Expected: 셋 다 exit 0

- [ ] **Step 5: 커밋**

```bash
git status -sb
git add scripts/review-code-run.test.ts .claude/workflows/review-code-run.js
git commit -m "feat(review): split PR inline comments by diff hunks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `/review-code` 오케스트레이터와 spec 맞추기

**Files:**
- Create: `.claude/commands/review-code.md`
- Modify: `docs/superpowers/specs/2026-10-15-review-code-design.md`

**Interfaces:**
- Consumes: Workflow `review-code-run`의 args·반환(Task 1·2 Interfaces)
- Produces: `/review-code` 슬래시 명령

- [ ] **Step 1: command 작성**

`.claude/commands/review-code.md`:

````markdown
---
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

`gh pr view --json number,url,headRefOid,baseRefName`을 돌린다. 실패하면(PR 없음, gh 없음, 로그인 안 됨) PR 없음으로 본다.

PR이 있고 아래가 모두 맞으면 "PR 게시 가능"이다.
- `baseRefName`이 `main`
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

`hunks`는 PR 게시 가능일 때만 넣는다. `git diff -U0 <base> | grep -E '^(\+\+\+ |@@ )'` 출력을 그대로 넣는다. 게시 가능이 아니면 `hunks`를 뺀다.

Workflow는 `{ report, review, verdict }`를 돌려준다. Workflow가 실패하거나 중단되면 에러를 그대로 알리고 끝낸다.

## 6. 게시

- PR 게시 가능이고 `review`가 null이 아니면:
  1. `gh repo view --json nameWithOwner`로 `<owner>/<repo>`를 구한다.
  2. 세션 스크래치패드에 `{ "commit_id": "<headRefOid>", "event": "COMMENT", "body": review.body, "comments": review.comments }`를 JSON 파일로 쓴다. 자기 PR에는 Approve·Request changes를 달 수 없어서 event는 늘 `COMMENT`다.
  3. `gh api repos/<owner>/<repo>/pulls/<number>/reviews --method POST --input <파일>`
  4. 성공하면 채팅에 `판정: <verdict>`, PR 링크, `review.body`를 낸다.
  5. 실패하면 `report`를 채팅에 그대로 내고 에러 메시지를 덧붙인다.
- 그 밖에는 `report`를 채팅에 **그대로** 낸다. 고치거나 줄이지 않는다. PR이 있었는데 게시 가능이 아니었으면 맨 아래에 "PR에 올리지 않음: <맞지 않은 조건>"을 한 줄 붙인다.
````

- [ ] **Step 2: spec을 구현에 맞춘다**

`docs/superpowers/specs/2026-10-15-review-code-design.md`에서 아래를 바꾼다.

(a) 파일 표의 workflow 줄 아래에 두 줄을 추가하고, command 줄에 `disable-model-invocation`을 적는다.

old:
```
| `.claude/commands/review-code.md` | 오케스트레이터. `/review-code`로 실행한다. 메인 세션이 범위·PR·가드레일 문서를 모으고 Workflow를 부른 뒤 결과를 게시한다. |
| `.claude/workflows/review-code-run.js` | Workflow 스크립트. 리뷰 → 검증 → 조립. command와 같은 이름이면 둘 다 `/review-code`가 되고 어느 쪽이 실행되는지 문서에 없어서 `-run`을 붙인다. |
```
new:
```
| `.claude/commands/review-code.md` | 오케스트레이터. `/review-code`로 실행한다. 메인 세션이 범위·PR·가드레일 문서를 모으고 Workflow를 부른 뒤 결과를 게시한다. 비용이 커서 `disable-model-invocation: true`로 Claude가 스스로 부르지 않게 한다. |
| `.claude/workflows/review-code-run.js` | Workflow 스크립트. 리뷰 → 검증 → 조립. command와 같은 이름이면 둘 다 `/review-code`가 되고 어느 쪽이 실행되는지 문서에 없어서 `-run`을 붙인다. |
| `scripts/review-code-run.test.ts` | 가짜 `agent`·`parallel`·`pipeline`으로 workflow 스크립트를 돌려 조립 로직(다수결·중앙값·중복·판정·출력·hunks)을 확인하는 Vitest 테스트 |
| `eslint.config.mjs` | `.claude/workflows/**`를 무시한다. 런타임이 스크립트를 async 함수로 감싸 맨 위 `return`이 있어 모듈로 읽으면 문법 오류다 |
```

(b) 흐름 5번 줄.

old:
```
 5. Workflow review-code-run 호출  args = { base, files, docs, walkthrough }
```
new:
```
 5. Workflow review-code-run 호출  args = { base, files, docs, walkthrough, hunks? }
              hunks는 PR 게시 가능일 때만: git diff -U0 <base> 의 "+++ "·"@@ " 줄
```

(c) 반환 줄.

old:
```
- **반환**: `{ report, review: { body, comments: [{ path, line, body }] }, verdict }`. `report`는 채팅용 마크다운 전체, `review`는 PR 게시용이다.
```
new:
```
- **반환**: `{ report, review: { body, comments: [{ path, line, side: "RIGHT", body }] } | null, verdict }`. `report`는 채팅용 마크다운 전체, `review`는 PR 게시용이고 `hunks`가 없으면 `null`이다.
```

(d) 게시의 diff 밖 줄.

old:
```
- **diff 밖 줄의 지적**은 인라인으로 달 수 없다. 메인이 `git diff -U0 <base>`의 hunk로 판단해서 본문의 "diff 밖 지적" 절로 옮긴다.
```
new:
```
- **diff 밖 줄의 지적**은 인라인으로 달 수 없다. 메인이 넘긴 `hunks`로 workflow가 판단해 본문의 "diff 밖 지적" 절로 옮긴다. 삭제만 있는 hunk와 삭제된 파일은 범위로 치지 않는다.
```

(e) 검증 방법 첫 문장과 1번.

old:
```
`.md`와 `.js` 설정 파일이라 단위 테스트 대신 실제로 돌려 본다.

1. **문법과 가드**: `/review-code-run`을 args 없이 실행하면 안내 문구가 나온다.
```
new:
```
조립 로직은 `scripts/review-code-run.test.ts`가 가짜 런타임으로 확인한다. 에이전트와 command는 실제로 돌려 본다.

1. **문법과 가드**: Workflow를 `scriptPath`로 args 없이 실행하면 에이전트 없이 안내 문구가 나온다.
```

- [ ] **Step 3: 실제 런타임에서 args 없는 가드를 확인**

이 단계는 사용자 확인 창이 뜨는 Workflow 실행이다. args가 없으니 에이전트는 뜨지 않는다.

Workflow 도구: `scriptPath: "C:/Users/정대훈/OneDrive/Desktop/eogns_claude/myProject/Langrow-review-code/.claude/workflows/review-code-run.js"`, args 없음
Expected: 반환 `report`가 "이 workflow는 /review-code가 변경 범위와 문서를 모아 부른다. /review-code로 실행하세요."이고 `verdict`는 null, 에이전트 0개. 문법 오류가 나면 실제 런타임이 테스트 하네스와 다르다는 뜻이니 오류를 기록하고 고친다.

- [ ] **Step 4: 전체 검사**

Run: `npm run lint && npm run build && npm run test`
Expected: 셋 다 exit 0

- [ ] **Step 5: 커밋**

```bash
git status -sb
git add .claude/commands/review-code.md docs/superpowers/specs/2026-10-15-review-code-design.md
git commit -m "feat(review): add the /review-code orchestrator command

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 병합 뒤 실제 실행 시험

spec "검증 방법" 2~5. 리뷰 도구 파일이 리뷰 대상에 섞이지 않게 main에 병합한 뒤 main에서 딴 일회용 브랜치에서 한다. command와 workflow는 세션을 연 폴더의 `.claude/`에서 읽으므로 사용자가 시험 폴더에서 새 Claude 세션을 연다.

**Files:** 커밋하지 않는 일회용 변경만(시험 브랜치는 지운다)

- [ ] **Step 1: 병합**

superpowers:finishing-a-development-branch로 사용자가 병합 방식을 고른다. main에 병합한 뒤에만 다음 단계로 간다.

- [ ] **Step 2: 시험 worktree와 심은 버그**

병합 과정에서 `Langrow-review-code` worktree가 정리될 수 있으니 git 명령은 원래 저장소(`Langrow`, 다른 세션이 쓰는 폴더지만 worktree 추가·삭제는 그 폴더의 파일을 바꾸지 않는다)를 기준으로 한다.

```bash
cd "C:/Users/정대훈/OneDrive/Desktop/eogns_claude/myProject"
git -C Langrow worktree add ../Langrow-review-test -b tmp-review-seeded main
cd Langrow-review-test && npm ci
```

차원마다 하나씩 심는다. reviewer는 lint·build·test가 잡는 것을 보고하지 않으므로 심은 뒤에도 셋이 통과해야 한다.

| 차원 | 위치 | 바꿈 | 기대 |
|---|---|---|---|
| security | `src/server/db/account.ts` `getReadiness`의 `admin.from("user_levels")...` | `.eq("user_id", userId)`를 지운다 | 🔴 Critical [security] |
| architecture | `src/lib/plan.ts` `export const TRIAL_DAYS = 7;` | `export const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 7);` | 🟠 Major 이상 [architecture] |
| correctness | `src/server/learning.ts` `await saveExplanation(deps, word, key, explanation);` | 앞의 `await`를 지운다 | 🟡 Minor 이상 [correctness] |
| consistency | `docs/spec/usage.md` 표의 Free "AI 대화 (턴 수)" | `하루 20회` → `하루 25회` (코드 `PLAN_LIMITS`·PRD는 그대로) | 🟠 Major 이상 [consistency] |

Run: `npm run lint && npm run build && npm run test`
Expected: 셋 다 exit 0. 실패하면 그 버그는 테스트가 잡는 것이니 같은 차원의 다른 자리로 바꾸고 표를 고친다.

```bash
git add src/server/db/account.ts src/lib/plan.ts src/server/learning.ts docs/spec/usage.md
git commit -m "chore: seed review bugs (do not merge)"
```

- [ ] **Step 3: 심은 버그 리뷰 (사용자)**

사용자가 `Langrow-review-test` 폴더에서 새 Claude 세션을 열고 `/review-code`를 실행한다. Workflow 확인 창을 승인한다. Stop hook이 실패를 알리면 심은 버그 때문이니 고치지 말라고 답한다.

통과 기준:
- `/review-code`가 command를 실행한다(workflow가 바로 돌지 않는다)
- 4개가 모두 표의 차원 태그로 나온다
- security 지적이 🔴 Critical이고 판정이 `Blocked`다
- 출력이 spec "출력 형식"과 같다(요약 먼저, 인라인 위치 줄 + 4줄)

결과(차원·심각도·거짓 양성·에이전트 수)를 이 세션에 붙여 넣어 받는다.

- [ ] **Step 4: 대조군 (사용자)**

```bash
cd "C:/Users/정대훈/OneDrive/Desktop/eogns_claude/myProject"
git -C Langrow-review-test switch -c tmp-review-control main
```

`docs/spec/usage.md`에서 문장 하나의 오타나 띄어쓰기를 고쳐 커밋한다(의미는 그대로). 사용자가 `/review-code`를 다시 실행한다.

통과 기준: 판정 `Approve`, Critical·Major 0개.

- [ ] **Step 5: PR 게시 (사용자 확인 필요)**

GitHub에 PR을 만드는 외부 게시다. 사용자가 하겠다고 할 때만 한다.

```bash
cd "C:/Users/정대훈/OneDrive/Desktop/eogns_claude/myProject/Langrow-review-test"
git switch tmp-review-seeded
git push -u origin tmp-review-seeded
gh pr create --draft --base main --head tmp-review-seeded --title "tmp: review-code PR posting test (do not merge)" --body "/review-code 게시 시험용. 끝나면 닫는다."
```

사용자가 `/review-code`를 실행한다. 통과 기준: PR에 COMMENT 리뷰 하나가 올라가고, 바뀐 줄을 가리키는 지적(심은 버그 4개)은 그 줄의 코멘트로 달린다. 바뀌지 않은 줄을 가리키는 지적(예: spec과 어긋난 `src/lib/plan.ts`의 `PLAN_LIMITS` 줄)이 있으면 본문 "diff 밖 지적"에 있다.

끝나면:
```bash
gh pr close <PR 번호> --delete-branch
```

- [ ] **Step 6: 정리와 기록**

```bash
cd "C:/Users/정대훈/OneDrive/Desktop/eogns_claude/myProject"
git -C Langrow worktree remove ../Langrow-review-test --force
git -C Langrow branch -D tmp-review-seeded tmp-review-control
```

통과하지 못한 기준이 있으면 새 브랜치에서 테스트를 먼저 고쳐(Task 1·2 테스트 파일) 수정한다. 결과는 메모리 `langrow-review-code`에 적는다.
