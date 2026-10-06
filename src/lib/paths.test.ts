import { describe, expect, it } from "vitest";
import { PROTECTED_PAGES, isProtectedPage } from "./paths";

describe("isProtectedPage", () => {
  it.each(["/", "/privacy", "/terms", "/auth/callback"])("공개 경로 %s는 보호 페이지가 아니다", (path) => {
    expect(isProtectedPage(path)).toBe(false);
  });

  it.each(PROTECTED_PAGES)("보호 경로 %s는 보호 페이지다", (path) => {
    expect(isProtectedPage(path)).toBe(true);
  });

  it.each(["/chat/abc", "/chat/abc/end", "/home/", "/words/review"])("보호 경로의 하위 경로 %s도 보호 페이지다", (path) => {
    expect(isProtectedPage(path)).toBe(true);
  });

  it.each(["/homework", "/chatty", "/level-upgrade", "/kanazawa"])("접두어만 같은 %s는 보호 페이지가 아니다", (path) => {
    expect(isProtectedPage(path)).toBe(false);
  });
});
