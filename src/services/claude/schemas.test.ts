import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import {
  breakdownReplySchema,
  explanationSchema,
  feedbackSchema,
  pronFeedbackSchema,
  pronTurnReplySchema,
  turnReplySchema,
  withWordFields,
} from "./schemas";

const keysOf = (schema: Parameters<typeof zodOutputFormat>[0]) =>
  Object.keys((zodOutputFormat(schema).schema as { properties: object }).properties).sort();

describe("turnReplySchema", () => {
  it("교정이 있는 응답을 받는다", () => {
    const value = {
      reply: "Sure! Hot or iced?",
      reply_ko: "네! 따뜻한 걸로 드릴까요, 차가운 걸로 드릴까요?",
      correction: { corrected: "I'd like a latte.", explanation_ko: "주문할 때는 I'd like를 쓰면 더 자연스러워요." },
    };
    expect(turnReplySchema.parse(value)).toEqual(value);
  });

  it("교정이 null인 응답을 받는다", () => {
    const value = { reply: "Hi", reply_ko: "안녕하세요", correction: null };
    expect(turnReplySchema.parse(value).correction).toBeNull();
  });

  it("correction 키가 빠지면 거부한다", () => {
    expect(turnReplySchema.safeParse({ reply: "Hi", reply_ko: "안녕하세요" }).success).toBe(false);
  });

  it("길이 제약이 없어서 빈 reply도 스키마는 통과한다 (검사는 client가 한다)", () => {
    expect(turnReplySchema.safeParse({ reply: "", reply_ko: "", correction: null }).success).toBe(true);
  });
});

// 뜯어보기는 턴에서 받지 않고 처음 열 때 따로 만든다 (spec/chat.md "처음 열 때 만들기", ADR-027)
describe.each([
  ["turnReplySchema", turnReplySchema, ["correction", "reply", "reply_ko"]],
  ["pronTurnReplySchema", pronTurnReplySchema, ["correction", "reply", "reply_ko", "reply_pron_ko"]],
] as const)("%s의 필드", (_, schema, keys) => {
  it("뜯어보기(reply_breakdown, correction.breakdown)가 없다", () => {
    expect(keysOf(schema)).toEqual(keys);
    expect(JSON.stringify(zodOutputFormat(schema).schema)).not.toContain("breakdown");
  });
});

describe("breakdownReplySchema", () => {
  it("{ breakdown } 하나만 받는다", () => {
    const value = {
      breakdown: [
        { text: "I", meaning_ko: "나는" },
        { text: "was resting", meaning_ko: "쉬고 있었어요" },
      ],
    };
    expect(breakdownReplySchema.parse(value)).toEqual(value);
    expect(keysOf(breakdownReplySchema)).toEqual(["breakdown"]);
  });

  it("breakdown이 없거나 조각에 text·meaning_ko가 없으면 거부한다", () => {
    expect(breakdownReplySchema.safeParse({}).success).toBe(false);
    expect(breakdownReplySchema.safeParse({ breakdown: [{ text: "I" }] }).success).toBe(false);
    expect(breakdownReplySchema.safeParse({ breakdown: [{ meaning_ko: "나는" }] }).success).toBe(false);
  });

  it("개수·길이 제약이 없어서 빈 배열·빈 뜻도 스키마는 통과한다 (검사는 client가 한다)", () => {
    expect(breakdownReplySchema.safeParse({ breakdown: [] }).success).toBe(true);
    expect(breakdownReplySchema.safeParse({ breakdown: [{ text: "I", meaning_ko: "" }] }).success).toBe(true);
  });
});

describe("feedbackSchema", () => {
  const item = (point: string) => ({ point, example: "I'd like a latte." });

  it("good과 { point, example } 목록을 받는다", () => {
    const value = { good: "주문을 끝까지 해냈어요.", improve: [item("I want 대신 I'd like를 쓰면 더 공손해요.")] };
    expect(feedbackSchema.parse(value)).toEqual(value);
  });

  it("개수 제약이 없어서 improve 4개도 스키마는 통과한다 (자르기는 client가 한다)", () => {
    expect(feedbackSchema.safeParse({ good: "좋아요", improve: [item("a"), item("b"), item("c"), item("d")] }).success).toBe(true);
  });

  it("improve가 배열이 아니거나 항목이 문자열(옛 형식)이면 거부한다", () => {
    expect(feedbackSchema.safeParse({ good: "좋아요", improve: "a" }).success).toBe(false);
    expect(feedbackSchema.safeParse({ good: "좋아요", improve: ["I want → I'd like"] }).success).toBe(false);
  });

  it("point나 example이 없으면 거부한다", () => {
    expect(feedbackSchema.safeParse({ good: "좋아요", improve: [{ point: "설명" }] }).success).toBe(false);
    expect(feedbackSchema.safeParse({ good: "좋아요", improve: [{ example: "Hi." }] }).success).toBe(false);
  });
});

describe("pronFeedbackSchema", () => {
  const item = { point: "を를 넣어요.", example: "[水|みず]をください。", example_pron_ko: "미즈오 쿠다사이." };

  it("항목마다 example_pron_ko가 있는 피드백을 받는다", () => {
    const value = { good: "주문을 끝까지 해냈어요.", improve: [item] };
    expect(pronFeedbackSchema.parse(value)).toEqual(value);
  });

  it("example_pron_ko가 없거나 항목이 문자열이면 거부한다", () => {
    expect(pronFeedbackSchema.safeParse({ good: "좋아요", improve: [{ point: item.point, example: item.example }] }).success).toBe(
      false,
    );
    expect(pronFeedbackSchema.safeParse({ good: "좋아요", improve: ["を를 넣어요."] }).success).toBe(false);
  });
});

describe("구조화 출력 형식", () => {
  it.each([
    ["turnReplySchema", turnReplySchema],
    ["pronTurnReplySchema", pronTurnReplySchema],
    ["feedbackSchema", feedbackSchema],
    ["pronFeedbackSchema", pronFeedbackSchema],
    ["breakdownReplySchema", breakdownReplySchema],
  ])("%s를 설치된 SDK의 zodOutputFormat으로 바꿀 수 있고 길이·개수 제약이 없다", (_, schema) => {
    const format = zodOutputFormat(schema);
    expect(format.type).toBe("json_schema");
    expect(JSON.stringify(format.schema)).not.toMatch(/minLength|maxLength|minItems|maxItems/);
  });

  it("zodOutputFormat의 parse가 JSON 응답을 검증한다", () => {
    const format = zodOutputFormat(feedbackSchema);
    expect(format.parse('{"good":"좋아요","improve":[]}')).toEqual({ good: "좋아요", improve: [] });
    expect(() => format.parse('{"good":"좋아요"}')).toThrow();
  });
});

describe("explanationSchema", () => {
  it("explanation 문자열을 받는다", () => {
    expect(explanationSchema.parse({ explanation: "과거의 일이라 went를 써요." })).toEqual({
      explanation: "과거의 일이라 went를 써요.",
    });
  });

  it("explanation이 없으면 거부한다", () => {
    expect(explanationSchema.safeParse({}).success).toBe(false);
  });

  it("길이 제약이 없어서 빈 설명도 스키마는 통과한다 (공백 검사는 client가 한다)", () => {
    expect(explanationSchema.safeParse({ explanation: "" }).success).toBe(true);
  });
});

describe("pronTurnReplySchema", () => {
  const value = {
    reply: "はい。",
    reply_ko: "네.",
    reply_pron_ko: "하이.",
    correction: { corrected: "はい。", explanation_ko: "설명", corrected_pron_ko: "하이." },
  };

  it("발음 필드가 있는 응답과 교정이 없는 응답을 받는다", () => {
    expect(pronTurnReplySchema.parse(value)).toEqual(value);
    expect(pronTurnReplySchema.parse({ ...value, correction: null })).toEqual({ ...value, correction: null });
  });

  it("reply_pron_ko나 corrected_pron_ko가 없으면 거부한다", () => {
    const noReplyPron = { reply: value.reply, reply_ko: value.reply_ko, correction: value.correction };
    expect(pronTurnReplySchema.safeParse(noReplyPron).success).toBe(false);
    const noCorrectedPron = { corrected: "はい。", explanation_ko: "설명" };
    expect(pronTurnReplySchema.safeParse({ ...value, correction: noCorrectedPron }).success).toBe(false);
  });
});

describe("withWordFields", () => {
  const base = { reply: "Hi", reply_ko: "안녕하세요", correction: null };
  const pron = { ...base, reply_pron_ko: "하이." };

  it("단어가 없는 턴은 받은 스키마 그대로다", () => {
    expect(withWordFields(turnReplySchema, undefined)).toBe(turnReplySchema);
    expect(withWordFields(pronTurnReplySchema, undefined)).toBe(pronTurnReplySchema);
  });

  it.each([
    ["turnReplySchema", turnReplySchema, base, ["correction", "reply", "reply_ko"]],
    ["pronTurnReplySchema", pronTurnReplySchema, pron, ["correction", "reply", "reply_ko", "reply_pron_ko"]],
  ] as const)("%s: pick은 target_words·used_words, practice는 used_words를 더한다", (_, schema, value, keys) => {
    expect(keysOf(withWordFields(schema, "pick"))).toEqual([...keys, "target_words", "used_words"].sort());
    expect(keysOf(withWordFields(schema, "practice"))).toEqual([...keys, "used_words"].sort());
    expect(withWordFields(schema, "pick").parse({ ...value, target_words: [1, 3], used_words: [] })).toEqual({
      ...value,
      target_words: [1, 3],
      used_words: [],
    });
    expect(withWordFields(schema, "practice").parse({ ...value, used_words: [2] })).toEqual({ ...value, used_words: [2] });
  });

  it("단어 필드가 빠지면 거부한다", () => {
    expect(withWordFields(turnReplySchema, "pick").safeParse({ ...base, used_words: [] }).success).toBe(false);
    expect(withWordFields(turnReplySchema, "pick").safeParse({ ...base, target_words: [] }).success).toBe(false);
    expect(withWordFields(turnReplySchema, "practice").safeParse(base).success).toBe(false);
  });

  it("정수·범위 제약이 없어서 0·음수·소수·중복 번호도 스키마는 통과한다 (검사는 lib/targetWords가 한다)", () => {
    const value = { ...base, target_words: [0, -1, 1.5, 9, 9, 1, 2, 3, 4, 5], used_words: [7] };
    expect(withWordFields(turnReplySchema, "pick").safeParse(value).success).toBe(true);
    const json = JSON.stringify(zodOutputFormat(withWordFields(pronTurnReplySchema, "pick")).schema);
    expect(json).not.toMatch(/minimum|maximum|multipleOf|minItems|maxItems|"integer"/);
  });
});
