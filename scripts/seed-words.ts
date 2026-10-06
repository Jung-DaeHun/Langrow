import * as fs from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Language, Level } from "@/lib/levels";
import { validateWordFile, type WordEntry } from "@/lib/words";
import { getAdminEnv } from "@/services/env";
import type { Database } from "@/types/database";

const WORDS_DIR = "data/words";
const WORD_FILE = /^(en|ja)-([1-5])\.json$/;
const UPSERT_CHUNK = 500;

export type SeedWordsDeps = {
  listWordFiles: () => Promise<string[]>; // data/words/ 안의 파일 이름
  readFile: (name: string) => Promise<string>;
  upsertWords: (rows: WordEntry[]) => Promise<void>;
  log: (line: string) => void;
};

export async function main(deps: SeedWordsDeps): Promise<number> {
  const files = (await deps.listWordFiles()).sort().flatMap((name) => {
    const match = WORD_FILE.exec(name);
    return match ? [{ name, language: match[1] as Language, level: Number(match[2]) as Level }] : [];
  });
  if (files.length === 0) {
    deps.log(`${WORDS_DIR}/에 단어 파일({en,ja}-{1..5}.json)이 없습니다. npm run words:generate로 만들고 검수한 뒤 실행하세요`);
    return 1;
  }

  // 언어·레벨은 파일 이름으로 정하고 내용이 그와 같은지 검사한다
  const rows: WordEntry[] = [];
  const errors: string[] = [];
  for (const { name, language, level } of files) {
    const text = await deps.readFile(name);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      errors.push(`${name}: JSON을 읽지 못했습니다`);
      continue;
    }
    const result = validateWordFile(language, level, data);
    if (result.ok) rows.push(...result.words);
    else errors.push(...result.errors.map((error) => `${name}: ${error}`));
  }
  // 일부만 들어가지 않도록 하나라도 틀리면 아무것도 넣지 않는다
  if (errors.length > 0) {
    errors.forEach((error) => deps.log(error));
    deps.log(`오류 ${errors.length}개가 있어서 아무것도 넣지 않았습니다`);
    return 1;
  }

  // 단어 ID는 재사용하지 않으므로 다시 돌려도 학습 기록(user_words)이 깨지지 않는다
  for (let start = 0; start < rows.length; start += UPSERT_CHUNK) {
    await deps.upsertWords(rows.slice(start, start + UPSERT_CHUNK));
  }
  deps.log(`words에 ${rows.length}개를 넣었습니다 (${files.map((f) => f.name).join(", ")})`);
  return 0;
}

// ---- 실제 deps (파일, Supabase). 테스트는 가짜 deps만 쓴다 ----

function realDeps(): SeedWordsDeps {
  let client: SupabaseClient<Database> | undefined;
  return {
    listWordFiles: () =>
      fs.readdir(WORDS_DIR).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      }),
    readFile: (name) => fs.readFile(join(WORDS_DIR, name), "utf8"),
    upsertWords: async (rows) => {
      if (!client) {
        const { supabaseUrl, supabaseSecretKey } = getAdminEnv();
        client = createClient<Database>(supabaseUrl, supabaseSecretKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      }
      const { error } = await client.from("words").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(`words upsert 실패: ${error.message}`);
    },
    log: (line) => console.log(line),
  };
}

// import만 해서는 실행하지 않는다 (테스트가 import한다)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(realDeps()).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
