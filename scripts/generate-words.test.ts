import { describe, expect, it } from "vitest";
import { validateWordFile, WORDS_PER_LEVEL } from "@/lib/words";
import { MAX_GENERATE_CALLS, main, type GenerateRequest, type GenerateWordsDeps } from "./generate-words";

// AI가 돌려주는 항목 (id·rank·language·level은 스크립트가 붙인다)
function aiWord(n: number) {
  return {
    word: `go${n}`,
    reading: null,
    meaning_ko: `가다${n}`,
    example: `I {{went${n}}} to school.`,
    example_ko: "나는 학교에 갔다.",
    distractors: [`goes${n}`, `gone${n}`, `going${n}`],
  };
}

function fakeDeps(
  options: {
    args?: string[];
    existing?: string[];
    generate?: (request: GenerateRequest, call: number) => unknown[];
  } = {},
) {
  const requests: GenerateRequest[] = [];
  const written = new Map<string, string>();
  const logs: string[] = [];
  let next = 1;
  const deps: GenerateWordsDeps = {
    args: options.args ?? ["--language", "en", "--level", "1"],
    generate: async (request) => {
      requests.push(structuredClone(request));
      if (options.generate) return options.generate(request, requests.length);
      return Array.from({ length: request.count }, () => aiWord(next++));
    },
    fileExists: async (path) => (options.existing ?? []).includes(path),
    writeFile: async (path, content) => {
      written.set(path, content);
    },
    log: (line) => logs.push(line),
  };
  return { deps, requests, written, logs };
}

describe("generate-words main", () => {
  it("묶음으로 나눠 받은 200개에 rank·id를 순서대로 붙여 검증된 JSON을 쓴다", async () => {
    const { deps, requests, written } = fakeDeps();

    expect(await main(deps)).toBe(0);

    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) expect(request.count).toBeLessThan(WORDS_PER_LEVEL);
    expect([...written.keys()]).toEqual(["data/words/en-1.json"]);
    const content = written.get("data/words/en-1.json")!;
    expect(content).toContain('\n  {\n    "id": "en-1-001"');
    const words = JSON.parse(content);
    expect(validateWordFile("en", 1, words).ok).toBe(true);
    expect(words[0]).toMatchObject({ id: "en-1-001", rank: 1, word: "go1", language: "en", level: 1 });
    expect(words[199]).toMatchObject({ id: "en-1-200", rank: 200, word: "go200" });
  });

  it("이미 받은 단어 목록을 다음 요청에 넘긴다", async () => {
    const { deps, requests } = fakeDeps({ args: ["--language", "ja", "--level", "3"], generate: () => [] });
    await main(deps);
    expect(requests[0]).toMatchObject({ language: "ja", level: 3, exclude: [] });

    const second = fakeDeps();
    await main(second.deps);
    const firstCount = second.requests[0].count;
    expect(second.requests[1].exclude).toEqual(Array.from({ length: firstCount }, (_, i) => `go${i + 1}`));
  });

  it("규칙에 어긋나는 항목과 중복 단어는 버리고 200개가 될 때까지 더 요청한다", async () => {
    let next = 1;
    const { deps, requests, written } = fakeDeps({
      generate: (request, call) => {
        const items: unknown[] = Array.from({ length: request.count }, () => aiWord(next++));
        if (call === 1) {
          items[0] = { ...aiWord(9001), example: "I went to school." };
          items[1] = { ...aiWord(9002), distractors: ["went9002", "gone9002", "going9002"] };
          items[2] = { ...aiWord(9003), reading: "go" };
          items[3] = aiWord(6); // 같은 묶음 뒤(index 5)의 go6과 중복
          items[4] = "word";
        }
        return items;
      },
    });

    expect(await main(deps)).toBe(0);

    const words = JSON.parse(written.get("data/words/en-1.json")!);
    expect(validateWordFile("en", 1, words).ok).toBe(true);
    const texts = words.map((w: { word: string }) => w.word);
    expect(texts).not.toContain("go9001");
    expect(texts).not.toContain("go9002");
    expect(texts).not.toContain("go9003");
    expect(texts.filter((t: string) => t === "go6")).toHaveLength(1);
    expect(requests.reduce((sum, r) => sum + r.count, 0)).toBe(WORDS_PER_LEVEL + 5);
  });

  it("호출 상한을 넘으면 파일을 쓰지 않고 실패한다", async () => {
    const { deps, requests, written, logs } = fakeDeps({ generate: () => [aiWord(requests.length)] });

    expect(await main(deps)).toBe(1);

    expect(requests).toHaveLength(MAX_GENERATE_CALLS);
    expect(written.size).toBe(0);
    expect(logs.join("\n")).toContain("쓰지 않았습니다");
  });

  it("파일이 이미 있으면 생성하지 않고 실패한다", async () => {
    const { deps, requests, written, logs } = fakeDeps({ existing: ["data/words/en-1.json"] });

    expect(await main(deps)).toBe(1);

    expect(requests).toHaveLength(0);
    expect(written.size).toBe(0);
    expect(logs.join("\n")).toContain("data/words/en-1.json");
  });

  it("--model을 모든 생성 요청에 넘기고, 없으면 비워 둔다", async () => {
    const withModel = fakeDeps({ args: ["--language", "en", "--level", "1", "--model", "model-from-args"] });
    await main(withModel.deps);
    expect(withModel.requests.every((r) => r.model === "model-from-args")).toBe(true);

    const withoutModel = fakeDeps();
    await main(withoutModel.deps);
    expect(withoutModel.requests.every((r) => r.model === undefined)).toBe(true);
  });

  it.each([
    [[]],
    [["--language", "en"]],
    [["--level", "1"]],
    [["--language", "fr", "--level", "1"]],
    [["--language", "en", "--level", "6"]],
    [["--language", "en", "--level", "1", "--force"]],
  ])("인자가 %j이면 사용법을 출력하고 실패한다", async (args) => {
    const { deps, requests, logs } = fakeDeps({ args });

    expect(await main(deps)).toBe(1);

    expect(requests).toHaveLength(0);
    expect(logs.join("\n")).toContain("사용법");
  });
});
