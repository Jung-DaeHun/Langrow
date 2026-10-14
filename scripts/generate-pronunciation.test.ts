import { describe, expect, it } from "vitest";
import { validWord } from "@/test/wordFiles";
import { main, type GeneratePronunciationDeps, type PronRequest } from "./generate-pronunciation";

const PATH = "data/words/ja-1.json";
const PRON = { pron_ko: "이쿠", example_pron_ko: "갓코-니 잇타." };

// 발음 키가 없는 일본어 단어 (generate-words로 만든 옛 파일)
function bare(rank: number): Record<string, unknown> {
  const word: Record<string, unknown> = { ...validWord("ja", 1, rank) };
  delete word.pron_ko;
  delete word.example_pron_ko;
  return word;
}

function fakeDeps(
  entries: unknown,
  options: { args?: string[]; generate?: (request: PronRequest, call: number) => unknown[] } = {},
) {
  const requests: PronRequest[] = [];
  const writes: string[] = [];
  const logs: string[] = [];
  const deps: GeneratePronunciationDeps = {
    args: options.args ?? ["--language", "ja", "--level", "1"],
    generate: async (request) => {
      requests.push(structuredClone(request));
      if (options.generate) return options.generate(request, requests.length);
      return request.items.map((item) => ({ id: item.id, ...PRON }));
    },
    readFile: async (path) => {
      if (path !== PATH) throw new Error(`없는 파일: ${path}`);
      return JSON.stringify(entries);
    },
    writeFile: async (path, content) => {
      if (path !== PATH) throw new Error(`다른 파일에 씀: ${path}`);
      writes.push(content);
    },
    log: (line) => logs.push(line),
  };
  const last = () => JSON.parse(writes.at(-1)!) as Record<string, unknown>[];
  return { deps, requests, writes, logs, last };
}

describe("generate-pronunciation main", () => {
  it("발음이 빈 단어만 50개씩 요청하고, 정답을 채운 예문(표기 유지)을 넘긴다", async () => {
    const entries = [validWord("ja", 1, 1), ...Array.from({ length: 60 }, (_, i) => bare(i + 2))];
    const { deps, requests, writes, last } = fakeDeps(entries);

    expect(await main(deps)).toBe(0);

    expect(requests.map((r) => r.items.length)).toEqual([50, 10]);
    expect(requests[0].items[0]).toEqual({
      id: "ja-1-002",
      word: "行く2",
      reading: "いく2",
      sentence: "[学校|がっこう]に[行|い]った2。",
    });
    expect(requests.flatMap((r) => r.items.map((item) => item.id))).not.toContain("ja-1-001");
    expect(writes.at(-1)).toBe(`${JSON.stringify(last(), null, 2)}\n`);
    expect(last()).toHaveLength(61);
    expect(last()[60]).toMatchObject({ id: "ja-1-061", ...PRON });
  });

  it("--model을 모든 요청에 넘기고, 없으면 비워 둔다", async () => {
    const withModel = fakeDeps([bare(1)], { args: ["--language", "ja", "--level", "1", "--model", "model-from-args"] });
    await main(withModel.deps);
    expect(withModel.requests.map((r) => r.model)).toEqual(["model-from-args"]);

    const withoutModel = fakeDeps([bare(1)]);
    await main(withoutModel.deps);
    expect(withoutModel.requests.map((r) => r.model)).toEqual([undefined]);
  });

  it("이미 맞는 발음은 바꾸지 않고, 비었거나 맞지 않는 쪽만 채운다", async () => {
    const entries = [
      { ...validWord("ja", 1, 1), example_pron_ko: "" },
      { ...validWord("ja", 1, 2), pron_ko: "いく" },
    ];
    const { deps, last } = fakeDeps(entries, {
      generate: (request) => request.items.map((item) => ({ id: item.id, pron_ko: "유쿠", example_pron_ko: "갓코-니 잇타." })),
    });

    expect(await main(deps)).toBe(0);

    expect(last()[0]).toMatchObject({ pron_ko: "이쿠", example_pron_ko: "갓코-니 잇타." });
    expect(last()[1]).toMatchObject({ pron_ko: "유쿠", example_pron_ko: "갓코-니 잇타." });
  });

  it("응답에 없는 id와 검사에 맞지 않는 발음은 쓰지 않고 실패 목록에 남긴 뒤 1을 돌려준다", async () => {
    const { deps, last, logs } = fakeDeps([bare(1), bare(2), bare(3)], {
      generate: () => [
        { id: "ja-1-001", ...PRON },
        { id: "ja-1-002", pron_ko: "いく", example_pron_ko: "갓코-니 잇타." },
      ],
    });

    expect(await main(deps)).toBe(1);

    expect(last()[0]).toMatchObject(PRON);
    expect(last()[1].pron_ko).toBeUndefined();
    expect(last()[1].example_pron_ko).toBe("갓코-니 잇타.");
    expect(last()[2].pron_ko).toBeUndefined();
    expect(logs.join("\n")).toContain("ja-1-002");
    expect(logs.join("\n")).toContain("ja-1-003");
  });

  it("묶음마다 파일을 써서, 뒤 묶음에서 API 오류가 나도 앞 묶음은 남는다", async () => {
    const { deps, writes, last } = fakeDeps(
      Array.from({ length: 60 }, (_, i) => bare(i + 1)),
      {
        generate: (request, call) => {
          if (call === 2) throw new Error("API 오류");
          return request.items.map((item) => ({ id: item.id, ...PRON }));
        },
      },
    );

    await expect(main(deps)).rejects.toThrow("API 오류");

    expect(writes).toHaveLength(1);
    expect(last()[49]).toMatchObject(PRON);
    expect(last()[50].pron_ko).toBeUndefined();
  });

  it("채울 발음이 없으면 요청하지 않고 파일을 쓰지 않는다", async () => {
    const { deps, requests, writes } = fakeDeps([validWord("ja", 1, 1)]);

    expect(await main(deps)).toBe(0);

    expect(requests).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it.each([
    [["--language", "en", "--level", "1"]],
    [["--language", "ja", "--level", "9"]],
    [["--language", "ja"]],
    [["--language", "ja", "--level", "1", "--unknown"]],
  ])("영어·잘못된 인자(%j)는 AI를 부르지 않고 사용법을 알린다", async (args) => {
    const { deps, requests, logs } = fakeDeps([bare(1)], { args });

    expect(await main(deps)).toBe(1);

    expect(requests).toHaveLength(0);
    expect(logs.join("\n")).toContain("사용법");
  });

  it("파일이 배열이 아니면 요청하지 않고 실패한다", async () => {
    const { deps, requests } = fakeDeps({ words: [] });

    expect(await main(deps)).toBe(1);

    expect(requests).toHaveLength(0);
  });
});
