import { execSync } from "node:child_process";

// test:db 전용. `.env.local` 없이 로컬 Supabase의 값으로 getAdminSupabase()·getPublicEnv()가 동작하게 한다.
// 키는 로컬 기본값이지만 로그에 찍지 않는다
export default function setup() {
  let output: string;
  try {
    // Windows에서 npx는 shell을 거쳐야 실행된다 (execSync는 문자열 명령을 shell로 실행한다)
    output = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("로컬 Supabase에 연결하지 못했습니다. `npx supabase start`를 먼저 실행하세요.");
  }

  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z_]+)="(.*)"$/.exec(line.trim());
    if (match) values.set(match[1], match[2]);
  }

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: values.get("API_URL"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: values.get("PUBLISHABLE_KEY"),
    SUPABASE_SECRET_KEY: values.get("SECRET_KEY"),
  };
  for (const [key, value] of Object.entries(env)) {
    if (!value) throw new Error(`\`npx supabase status -o env\`에 ${key}에 쓸 값이 없습니다. \`npx supabase start\`를 확인하세요.`);
    process.env[key] = value;
  }
}
