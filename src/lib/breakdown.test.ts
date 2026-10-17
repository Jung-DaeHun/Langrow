import { describe, expect, it } from "vitest";
import { alignBreakdown } from "./breakdown";

describe("alignBreakdown", () => {
  describe("통과하면 원래 문장을 조각 경계에서 잘라 돌려준다", () => {
    it("일본어: 문장의 [漢字|かな] 표기를 조각에 나눠 붙인다", () => {
      expect(
        alignBreakdown("[家|いえ]で[休|やす]んでいました。", [
          { text: "家で", meaning_ko: "집에서" },
          { text: "休んでいました", meaning_ko: "쉬고 있었어요" },
        ]),
      ).toEqual([
        { text: "[家|いえ]で", meaning_ko: "집에서" },
        { text: "[休|やす]んでいました。", meaning_ko: "쉬고 있었어요" },
      ]);
    });

    it("영어: 대소문자·문장부호는 문장을 따르고, 조각 사이 공백·문장부호는 앞 조각에 붙인다", () => {
      expect(
        alignBreakdown("Hi! What's your name?", [
          { text: "hi", meaning_ko: "안녕하세요" },
          { text: "what's", meaning_ko: "뭐예요" },
          { text: "your name", meaning_ko: "이름이" },
        ]),
      ).toEqual([
        { text: "Hi!", meaning_ko: "안녕하세요" },
        { text: "What's", meaning_ko: "뭐예요" },
        { text: "your name?", meaning_ko: "이름이" },
      ]);
    });

    it("AI 조각에 표기가 있든 없든 결과가 같다", () => {
      const sentence = "[家|いえ]で[休|やす]んでいました。";
      const plain = [
        { text: "家で", meaning_ko: "집에서" },
        { text: "休んでいました", meaning_ko: "쉬고 있었어요" },
      ];
      const marked = [
        { text: "[家|いえ]で", meaning_ko: "집에서" },
        { text: "[休|やす]んでいました。", meaning_ko: "쉬고 있었어요" },
      ];
      expect(alignBreakdown(sentence, marked)).toEqual(alignBreakdown(sentence, plain));
    });

    it("문장 맨 앞의 공백·문장부호는 첫 조각에 붙이고, text·meaning_ko의 앞뒤 공백은 지운다", () => {
      expect(
        alignBreakdown("「[本|ほん]」を[読|よ]む", [
          { text: " 本を ", meaning_ko: " 책을 " },
          { text: "読む", meaning_ko: "읽어요" },
        ]),
      ).toEqual([
        { text: "「[本|ほん]」を", meaning_ko: "책을" },
        { text: "[読|よ]む", meaning_ko: "읽어요" },
      ]);
    });

    it("조각이 하나면 문장 전체다", () => {
      expect(alignBreakdown("  Thanks!  ", [{ text: "thanks", meaning_ko: "고마워요" }])).toEqual([
        { text: "Thanks!", meaning_ko: "고마워요" },
      ]);
    });

    it("조각 안의 공백·문장부호 차이는 무시한다", () => {
      expect(
        alignBreakdown("お[弁当|べんとう]、[温|あたた]めますか？", [
          { text: "お弁当", meaning_ko: "도시락" },
          { text: "温め ます か", meaning_ko: "데울까요" },
        ]),
      ).toEqual([
        { text: "お[弁当|べんとう]、", meaning_ko: "도시락" },
        { text: "[温|あたた]めますか？", meaning_ko: "데울까요" },
      ]);
    });

    it("조각 사이의 여는 괄호·따옴표와 통화 기호는 뒤 조각에 붙인다", () => {
      expect(
        alignBreakdown("[彼|かれ]は「[行|い]く」と[言|い]った。", [
          { text: "彼は", meaning_ko: "그는" },
          { text: "行くと", meaning_ko: "간다고" },
          { text: "言った", meaning_ko: "말했다" },
        ]),
      ).toEqual([
        { text: "[彼|かれ]は", meaning_ko: "그는" },
        { text: "「[行|い]く」と", meaning_ko: "간다고" },
        { text: "[言|い]った。", meaning_ko: "말했다" },
      ]);
      expect(
        alignBreakdown("I paid $5 (in cash).", [
          { text: "I paid", meaning_ko: "냈어요" },
          { text: "$5", meaning_ko: "5달러를" },
          { text: "in cash", meaning_ko: "현금으로" },
        ]),
      ).toEqual([
        { text: "I paid", meaning_ko: "냈어요" },
        { text: "$5", meaning_ko: "5달러를" },
        { text: "(in cash).", meaning_ko: "현금으로" },
      ]);
    });

    it("공백·문장부호만 있는 조각은 빼고 검사한다 (그 글자는 문장대로 이웃 조각에 붙는다)", () => {
      expect(
        alignBreakdown("Hi! What's up?", [
          { text: "hi", meaning_ko: "안녕" },
          { text: "!", meaning_ko: "느낌표" },
          { text: "what's up", meaning_ko: "잘 지내?" },
          { text: " ? ", meaning_ko: "" },
        ]),
      ).toEqual([
        { text: "Hi!", meaning_ko: "안녕" },
        { text: "What's up?", meaning_ko: "잘 지내?" },
      ]);
    });
  });

  describe("맞지 않으면 null이다", () => {
    it("한자 표기 하나가 두 조각에 걸친다", () => {
      expect(
        alignBreakdown("[週末|しゅうまつ]は", [
          { text: "週", meaning_ko: "주" },
          { text: "末は", meaning_ko: "말은" },
        ]),
      ).toBeNull();
    });

    it("형태가 바뀌었다(사전형)", () => {
      expect(alignBreakdown("[食|た]べたり", [{ text: "食べる", meaning_ko: "먹다" }])).toBeNull();
    });

    it("한자를 가나로 바꿨다", () => {
      expect(alignBreakdown("[食|た]べます", [{ text: "たべます", meaning_ko: "먹어요" }])).toBeNull();
    });

    it("조각 하나를 빼먹었다", () => {
      expect(
        alignBreakdown("Hi! What's your name?", [
          { text: "hi", meaning_ko: "안녕하세요" },
          { text: "your name", meaning_ko: "이름이" },
        ]),
      ).toBeNull();
    });

    it("조각 순서가 문장과 다르다", () => {
      expect(
        alignBreakdown("your name", [
          { text: "name", meaning_ko: "이름" },
          { text: "your", meaning_ko: "당신의" },
        ]),
      ).toBeNull();
    });

    it("조각 배열이 비었다", () => {
      expect(alignBreakdown("Hi!", [])).toBeNull();
      expect(alignBreakdown("", [])).toBeNull();
    });

    it("글자가 있는 조각의 meaning_ko가 공백뿐이다", () => {
      expect(alignBreakdown("Hi!", [{ text: "hi", meaning_ko: "  " }])).toBeNull();
    });

    it("공백·문장부호만 있는 조각을 빼면 남는 조각이 없다", () => {
      expect(alignBreakdown("Hi!", [{ text: " ! ", meaning_ko: "느낌표" }])).toBeNull();
    });
  });
});
