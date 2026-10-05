import { z } from "zod";

// 기본 모델은 이 한 곳에만 적는다. 바꿀 때는 CLAUDE_MODEL을 쓴다
const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001";

// .env.local에 빈 값(KEY=)이 들어 있으므로 빈 문자열은 없는 값으로 본다
const required = z.string().trim().min(1);

// 호출할 때 검증한다. 에러에는 키 이름만 넣고 값은 넣지 않는다
function parseEnv<T extends z.ZodRawShape>(shape: T, values: Record<keyof T, string | undefined>) {
  const result = z.object(shape).safeParse(values);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`환경변수가 없거나 비어 있습니다: ${keys.join(", ")}`);
  }
  return result.data;
}

// 브라우저 번들에도 들어가므로 NEXT_PUBLIC_ 값은 process.env.NEXT_PUBLIC_… 리터럴로 읽는다
export function getPublicEnv(): { supabaseUrl: string; supabasePublishableKey: string } {
  const env = parseEnv(
    { NEXT_PUBLIC_SUPABASE_URL: required, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required },
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
  );
  return { supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, supabasePublishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
}

export function getAdminEnv(): { supabaseUrl: string; supabaseSecretKey: string } {
  const env = parseEnv(
    { NEXT_PUBLIC_SUPABASE_URL: required, SUPABASE_SECRET_KEY: required },
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    },
  );
  return { supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, supabaseSecretKey: env.SUPABASE_SECRET_KEY };
}

export function getClaudeEnv(): { apiKey: string; model: string } {
  const env = parseEnv(
    {
      ANTHROPIC_API_KEY: required,
      CLAUDE_MODEL: z
        .string()
        .trim()
        .optional()
        .transform((model) => model || DEFAULT_CLAUDE_MODEL),
    },
    { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, CLAUDE_MODEL: process.env.CLAUDE_MODEL },
  );
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL };
}
