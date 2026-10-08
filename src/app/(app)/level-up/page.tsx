import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LevelTestRunner } from "@/components/LevelTestRunner";
import { toBlankQuestion, type BlankQuestion } from "@/lib/blank";
import { canTakeLevelTest } from "@/lib/levels";
import { LEVEL_TEST_SIZE, pickTestWords } from "@/lib/levelTest";
import { readLevelWords } from "@/server/db/reads";
import { requireReady } from "@/server/page";

export const metadata: Metadata = { title: "레벨업 테스트 · Langrow" };

// 현재 레벨 단어에서 무작위 20문제를 낸다. 정답(예문의 {{ }} 안)은 props로 넘기지 않는다.
// 클라이언트에는 word_id·빈칸 문장·번역·섞은 보기만 가고, 채점은 /api/level-up이 한다(spec/words.md "레벨업 테스트")

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const PRIMARY = `inline-flex h-11 items-center justify-center gap-2 self-start rounded-full bg-accent px-5 font-semibold text-white transition duration-200 hover:bg-brand active:scale-95 ${FOCUS_RING}`;

export default async function LevelUpPage() {
  const { supabase, language, level } = await requireReady();
  if (!canTakeLevelTest(level)) {
    return <Unavailable title="이미 최고 레벨이에요" text="고수 단계는 레벨업 테스트 없이 계속 학습해요." />;
  }

  const picked = pickTestWords(await readLevelWords(supabase, language, level)) ?? [];
  const questions = picked.map((w) => toBlankQuestion(w)).filter((q): q is BlankQuestion => q !== null);
  // 단어 seed 전이거나 예문이 깨져 20문제를 만들지 못하면 시험을 열지 않는다
  if (questions.length < LEVEL_TEST_SIZE) {
    return <Unavailable title="아직 문제를 준비하지 못했어요" text="단어를 준비하고 있어요. 다음에 다시 와 주세요." />;
  }

  return (
    <div className="pt-6 animate-enter">
      {/* [다시 보기]가 새 문제를 읽으면 key가 바뀌어 시작 화면부터 다시 그린다 */}
      <LevelTestRunner
        key={questions.map((q) => q.wordId).join(",")}
        language={language}
        fromLevel={level}
        questions={questions}
      />
    </div>
  );
}

function Unavailable({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-6 pt-6 animate-enter">
      <h1 className="text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">레벨업 테스트</h1>
      <div className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-card">
        <Info size={20} aria-hidden="true" className="shrink-0 text-accent" />
        <div className="flex flex-col gap-1">
          <p className="font-bold">{title}</p>
          <p className="text-sm text-ink-muted">{text}</p>
        </div>
      </div>
      <Link href="/home" className={PRIMARY}>
        홈으로
      </Link>
    </div>
  );
}
