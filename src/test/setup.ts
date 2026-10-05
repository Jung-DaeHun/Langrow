import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals를 켜지 않아서 Testing Library의 자동 cleanup이 돌지 않는다
afterEach(() => {
  cleanup();
});
