import "server-only";
import { createAi, type Ai } from "@/services/claude/client";
import * as account from "./db/account";
import * as chat from "./db/chat";
import * as learning from "./db/learning";

export type Db = typeof account & typeof chat & typeof learning;
export type Deps = { db: Db; ai: Ai };

// db 함수와 createAi()는 첫 호출 때 env를 검증한다. 그래서 env 없이도 getDeps()와 next build가 통과한다
const db: Db = { ...account, ...chat, ...learning };
let ai: Ai | undefined;

export function getDeps(): Deps {
  ai ??= createAi();
  return { db, ai };
}
