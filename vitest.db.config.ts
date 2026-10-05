import { defineConfig } from "vitest/config";

// 실제 DB 통합 테스트. 같은 로컬 Supabase를 쓰므로 파일을 병렬로 돌리지 않는다.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/server/db/**/*.test.ts"],
    fileParallelism: false,
    passWithNoTests: true,
  },
});
