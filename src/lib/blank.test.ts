import { describe, expect, it } from "vitest";
import { buildOptions, isCorrectChoice, parseBlank, toBlankQuestion } from "./blank";

describe("parseBlank", () => {
  it("{{ }} 앞·안·뒤로 나눈다", () => {
    expect(parseBlank("I {{went}} to school.")).toEqual({ before: "I ", answer: "went", after: " to school." });
  });

  it("빈칸이 문장 맨 앞이나 맨 뒤에 있어도 된다", () => {
    expect(parseBlank("{{Go}} home.")).toEqual({ before: "", answer: "Go", after: " home." });
    expect(parseBlank("Let's {{go}}")).toEqual({ before: "Let's ", answer: "go", after: "" });
  });

  it("일본어 정답은 후리가나 표기 문자열 그대로다", () => {
    expect(parseBlank("[学校|がっこう]に{{[行|い]った}}。")).toEqual({
      before: "[学校|がっこう]に",
      answer: "[行|い]った",
      after: "。",
    });
  });

  it("{{ }}가 없으면 null이다", () => {
    expect(parseBlank("I went to school.")).toBeNull();
  });

  it("{{ }}가 2개 이상이면 null이다", () => {
    expect(parseBlank("I {{went}} to {{school}}.")).toBeNull();
  });

  it("안이 비어 있으면 null이다", () => {
    expect(parseBlank("I {{}} to school.")).toBeNull();
    expect(parseBlank("I {{  }} to school.")).toBeNull();
  });

  it("닫히지 않았거나 여는 표기가 없으면 null이다", () => {
    expect(parseBlank("I {{went to school.")).toBeNull();
    expect(parseBlank("I went}} to school.")).toBeNull();
  });
});

describe("buildOptions", () => {
  const distractors = ["goes", "gone", "going"] as const;

  it("정답과 오답 3개로 보기 4개를 만든다", () => {
    const options = buildOptions("went", distractors);
    expect(options).toHaveLength(4);
    expect([...options].sort()).toEqual(["goes", "going", "gone", "went"]);
  });

  it("주입한 random으로 Fisher–Yates 섞기를 한다", () => {
    // random이 0이면 매번 맨 앞과 바꾼다: [went, goes, gone, going] → [goes, gone, going, went]
    expect(buildOptions("went", distractors, () => 0)).toEqual(["goes", "gone", "going", "went"]);
    // random이 1에 가까우면 자기 자리와 바꾼다(섞이지 않음)
    expect(buildOptions("went", distractors, () => 0.999)).toEqual(["went", "goes", "gone", "going"]);
  });

  it("넘겨받은 오답 배열을 바꾸지 않는다", () => {
    const input = ["goes", "gone", "going"];
    buildOptions("went", input, () => 0);
    expect(input).toEqual(["goes", "gone", "going"]);
  });

  it("후리가나 표기를 그대로 보기로 쓴다", () => {
    const options = buildOptions("[行|い]った", ["[行|い]く", "[行|い]って", "[行|い]かない"], () => 0.999);
    expect(options).toEqual(["[行|い]った", "[行|い]く", "[行|い]って", "[行|い]かない"]);
  });
});

describe("isCorrectChoice", () => {
  it("정답 표기와 같으면 정답이다", () => {
    expect(isCorrectChoice("went", "went")).toBe(true);
    expect(isCorrectChoice("[行|い]った", "[行|い]った")).toBe(true);
  });

  it("대소문자·공백·후리가나를 정규화하지 않는다", () => {
    expect(isCorrectChoice("Went", "went")).toBe(false);
    expect(isCorrectChoice(" went", "went")).toBe(false);
    expect(isCorrectChoice("行った", "[行|い]った")).toBe(false);
  });
});

describe("toBlankQuestion", () => {
  const word = {
    id: "en-1-001",
    example: "I {{went}} to school.",
    exampleKo: "나는 학교에 갔다.",
    distractors: ["goes", "gone", "going"],
  };

  it("빈칸 앞뒤 문장, 번역, 섞은 보기 4개를 만든다", () => {
    expect(toBlankQuestion(word, () => 0.999)).toEqual({
      wordId: "en-1-001",
      before: "I ",
      after: " to school.",
      exampleKo: "나는 학교에 갔다.",
      options: ["went", "goes", "gone", "going"],
    });
  });

  it("결과에 정답 필드가 없고, 보기에는 정답이 들어 있다", () => {
    const question = toBlankQuestion(word, () => 0);
    expect(question).not.toHaveProperty("answer");
    expect(question?.options).toHaveLength(4);
    expect(question?.options).toContain("went");
  });

  it("buildOptions와 같은 순서로 섞는다", () => {
    expect(toBlankQuestion(word, () => 0)?.options).toEqual(buildOptions("went", word.distractors, () => 0));
  });

  it("예문이 깨져 있으면 null이다", () => {
    expect(toBlankQuestion({ ...word, example: "I went to school." })).toBeNull();
    expect(toBlankQuestion({ ...word, example: "I {{went}} {{to}} school." })).toBeNull();
  });
});
