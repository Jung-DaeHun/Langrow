import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 실제 DB 통합 테스트. 같은 로컬 Supabase를 쓰므로 파일을 병렬로 돌리지 않는다.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/server/db/**/*.test.ts"],
    fileParallelism: false,
    passWithNoTests: true,
    // 로컬 Supabase의 URL·키를 `supabase status`에서 읽어 env로 넘긴다
    globalSetup: ["./src/test/dbGlobalSetup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
