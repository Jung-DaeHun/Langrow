import { describe, expect, it } from "vitest";
import { cleanPron } from "./pronunciation";

describe("cleanPron", () => {
  it("한글 음절·공백과 -.,?!~…만 있으면 앞뒤 공백을 지워 돌려준다", () => {
    expect(cleanPron("  쿄-와 나니오 시마스카.  ")).toBe("쿄-와 나니오 시마스카.");
    expect(cleanPron("하지메마시테! 오나마에와 난데스카?")).toBe("하지메마시테! 오나마에와 난데스카?");
    expect(cleanPron("아노, 에-토…")).toBe("아노, 에-토…");
    expect(cleanPron("소-데스네~")).toBe("소-데스네~");
  });

  it.each([
    ["빈 문자열", ""],
    ["공백뿐", "   "],
    ["가나", "갓코-니 いった."],
    ["한자", "今日와"],
    ["영문", "OK데스"],
    ["숫자", "3지"],
    ["자모만", "ㅋㅋ"],
    ["그 밖의 기호", "「하이」"],
  ])("%s이면 null이다", (_, text) => {
    expect(cleanPron(text)).toBeNull();
  });

  it("문자열이 아니면 null이다", () => {
    expect(cleanPron(null)).toBeNull();
    expect(cleanPron(undefined)).toBeNull();
    expect(cleanPron(3)).toBeNull();
  });
});
