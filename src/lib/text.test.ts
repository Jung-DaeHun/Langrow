import { describe, expect, it } from "vitest";
import { CHAT_INPUT_MAX, countChars, hasHangul, isValidChatInput } from "./text";

describe("countChars", () => {
  it("앞뒤 공백을 지운 뒤 센다", () => {
    expect(countChars("  hi there  ")).toBe(8);
    expect(countChars("\n\tok\n")).toBe(2);
  });

  it("공백만 있으면 0이다", () => {
    expect(countChars("")).toBe(0);
    expect(countChars("   \n ")).toBe(0);
  });

  it("한글·일본어는 글자마다 1이다", () => {
    expect(countChars("안녕하세요")).toBe(5);
    expect(countChars("こんにちは")).toBe(5);
    expect(countChars("　漢字です　")).toBe(4); // 앞뒤 전각 공백도 지운다
  });

  it("이모지는 코드 포인트 1개로 센다", () => {
    expect(countChars("😀")).toBe(1);
    expect(countChars("hi😀")).toBe(3);
  });
});

describe("isValidChatInput", () => {
  it("최대 글자 수는 300이다", () => {
    expect(CHAT_INPUT_MAX).toBe(300);
  });

  it("공백만 있는 입력은 거부한다", () => {
    expect(isValidChatInput("")).toBe(false);
    expect(isValidChatInput("    ")).toBe(false);
  });

  it("1자부터 허용한다", () => {
    expect(isValidChatInput("a")).toBe(true);
  });

  it("300자까지 허용하고 301자는 거부한다", () => {
    expect(isValidChatInput("a".repeat(300))).toBe(true);
    expect(isValidChatInput("a".repeat(301))).toBe(false);
  });

  it("앞뒤 공백은 300자에 포함하지 않는다", () => {
    expect(isValidChatInput(`  ${"가".repeat(300)}  `)).toBe(true);
  });

  it("이모지 300개는 UTF-16 길이가 600이어도 허용한다", () => {
    expect(isValidChatInput("😀".repeat(300))).toBe(true);
    expect(isValidChatInput("😀".repeat(301))).toBe(false);
  });
});

describe("hasHangul", () => {
  it("한글 음절이 하나라도 있으면 true다", () => {
    expect(hasHangul("안녕하세요")).toBe(true);
    expect(hasHangul("I want 커피 please")).toBe(true);
  });

  it("자모만 있어도 true다", () => {
    expect(hasHangul("ㅋㅋ")).toBe(true);
    expect(hasHangul("ㅏ")).toBe(true);
  });

  it("영어·일본어·한자·빈 문자열은 false다", () => {
    expect(hasHangul("Hello, how are you?")).toBe(false);
    expect(hasHangul("こんにちは、カタカナ")).toBe(false);
    expect(hasHangul("漢字")).toBe(false);
    expect(hasHangul("")).toBe(false);
  });
});
