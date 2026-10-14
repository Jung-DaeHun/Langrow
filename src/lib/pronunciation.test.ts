import { describe, expect, it } from "vitest";
import { cleanPron } from "./pronunciation";

describe("cleanPron", () => {
  it("한글 음절·공백과 -.,?!~…만 있으면 앞뒤 공백을 지워 돌려준다", () => {
    expect(cleanPron("  쿄-와 나니오 시마스카.  ")).toBe("쿄-와 나니오 시마스카.");
    expect(cleanPron("하지메마시테! 오나마에와 난데스카?")).toBe("하지메마시테! 오나마에와 난데스카?");
    expect(cleanPron("아노, 에-토…")).toBe("아노, 에-토…");
    expect(cleanPron("소-데스네~")).toBe("소-데스네~");
  });

  it("받침을 표기 규칙대로 맞춘다: ん에 해당하는 ㅇ·ㅁ받침은 ㄴ, っ에 해당하는 ㄱ·ㄷ·ㅂ받침은 ㅅ", () => {
    expect(cleanPron("옹가쿠오 키키마스.")).toBe("온가쿠오 키키마스.");
    expect(cleanPron("콘니치와, 타나카 상.")).toBe("콘니치와, 타나카 산.");
    expect(cleanPron("심분")).toBe("신분");
    expect(cleanPron("각코-니 읻테 입파이")).toBe("갓코-니 잇테 잇파이");
    expect(cleanPron("갓코-니 잇타.")).toBe("갓코-니 잇타.");
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
    ["한글 없이 기호만", "..."],
    ["한글 없이 장음 기호만", "- ~"],
  ])("%s이면 null이다", (_, text) => {
    expect(cleanPron(text)).toBeNull();
  });

  it("문자열이 아니면 null이다", () => {
    expect(cleanPron(null)).toBeNull();
    expect(cleanPron(undefined)).toBeNull();
    expect(cleanPron(3)).toBeNull();
  });
});
