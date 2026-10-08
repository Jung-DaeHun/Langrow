import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { explanationSchema, feedbackSchema, turnReplySchema } from "./schemas";

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
    expect(turnReplySchema.parse({ reply: "Hi", reply_ko: "안녕하세요", correction: null }).correction).toBeNull();
  });

  it("correction 키가 빠지면 거부한다", () => {
    expect(turnReplySchema.safeParse({ reply: "Hi", reply_ko: "안녕하세요" }).success).toBe(false);
  });

  it("길이 제약이 없어서 빈 reply도 스키마는 통과한다 (공백 검사는 client가 한다)", () => {
    expect(turnReplySchema.safeParse({ reply: "", reply_ko: "", correction: null }).success).toBe(true);
  });
});

describe("feedbackSchema", () => {
  it("good과 improve 목록을 받는다", () => {
    const value = { good: "주문을 끝까지 해냈어요.", improve: ["I want → I'd like"] };
    expect(feedbackSchema.parse(value)).toEqual(value);
  });

  it("개수 제약이 없어서 improve 4개도 스키마는 통과한다 (자르기는 client가 한다)", () => {
    expect(feedbackSchema.safeParse({ good: "좋아요", improve: ["a", "b", "c", "d"] }).success).toBe(true);
  });

  it("improve가 배열이 아니면 거부한다", () => {
    expect(feedbackSchema.safeParse({ good: "좋아요", improve: "a" }).success).toBe(false);
  });
});

describe("구조화 출력 형식", () => {
  it.each([
    ["turnReplySchema", turnReplySchema],
    ["feedbackSchema", feedbackSchema],
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
