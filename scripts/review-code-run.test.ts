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
