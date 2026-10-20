import {
  CircleAlert,
  Flame,
  Footprints,
  Glasses,
  Languages,
  Lightbulb,
  MessagesSquare,
  Puzzle,
  TrendingUp,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Furigana } from "@/components/Furigana";
import { GoogleLoginButton } from "@/components/GoogleLoginButton";
import { LandingPreview } from "@/components/LandingPreview";
import { KANA } from "@/lib/kana";
import { LEVEL_TEST_SIZE, PASS_SCORE } from "@/lib/levelTest";
import { FREE_DAILY_EXPLANATIONS, PLAN_LIMITS, PRO_PRICE_KRW, TRIAL_DAYS } from "@/lib/plan";
import { FREE_SCENARIOS_PER_LEVEL, SCENARIOS_PER_LEVEL, findScenario, type ScenarioLine } from "@/lib/scenarios";
import { DAILY_WORD_GOAL, VALID_SESSION_TURNS } from "@/lib/today";

// 랜딩(공개). 로그인 여부와 무관하게 연다(spec/journey.md "페이지 접근 규칙"). 면 색으로 섹션을 나눈다: 크림 → 흰색 → house → 크림 → 흰색 → house 푸터

const SECTION = "px-4 py-10 md:px-10 md:py-16";
const WORDMARK = "text-h3 font-extrabold tracking-[-0.03em]";
const H2 = "text-h3 font-semibold tracking-[-0.02em] text-balance";

// 미리보기와 ② 예시는 무료 입문 상황인 카페 주문으로 보여 준다(spec/ui.md "랜딩"). 데이터 오류라 빌드에서 드러나게 던진다.
// 좁힌 타입이 함수 선언 안까지 가지 않아서 새 상수에 담는다
const found = findScenario("l1-cafe");
if (found === undefined) throw new Error("상황이 없습니다 (l1-cafe)");
const cafe = found;
const en = cafe.roles.en.opening;
const ja = cafe.roles.ja.opening;

// 첫 마디의 문장·번역·발음만 넘긴다. opening을 통째로 넘기면 뜯어보기까지 브라우저로 직렬화된다
const previewLine = ({ text, ko, pronKo }: ScenarioLine) => ({ text, ko, pronKo });

type Feature = { icon: LucideIcon; title: string; body: string; example?: ReactNode };

const BEGINNER: Feature[] = [
  {
    icon: Footprints,
    title: "모두 입문에서 시작해요",
    body: "이미 아는 단계는 레벨업 테스트로 바로 올릴 수 있어요.",
  },
  {
    icon: MessagesSquare,
    title: "한국어로 말해도 돼요",
    body: "뭐라고 할지 모르겠으면 한국어로 쓰세요. “이렇게 말하면 돼요”로 바꿔 줘요.",
  },
  {
    icon: Languages,
    title: "일본어는 가나부터",
    body: `히라가나·가타카나 ${KANA.hiragana.length}자씩 플래시카드로 익혀요. 가나는 하루 사용량에 포함되지 않아요.`,
  },
];

const HELPERS: Feature[] = [
  {
    icon: Puzzle,
    title: "문장 뜯어보기",
    body: "AI 문장과 교정 문장을 의미 조각으로 나눠 뜻을 보여 줘요.",
    // 대화방 BreakdownTiles와 같은 배치이고 색만 밴드용이다
    example: en.breakdown?.length ? (
      <div className="flex flex-wrap gap-1.5">
        {en.breakdown.map((piece, i) => (
          <div key={i} className="rounded-lg bg-uplift px-2 py-1 text-center">
            <p lang="en" className="text-sm font-semibold text-mint">
              {piece.text}
            </p>
            <p className="text-xs text-white/70">{piece.meaning_ko}</p>
          </div>
        ))}
      </div>
    ) : undefined,
  },
  {
    icon: Volume2,
    title: "듣기 · 천천히 듣기",
    body: "대화 문장과 단어·예문을 눌러서 들어요. 천천히 듣기는 0.75배예요.",
  },
  {
    icon: Glasses,
    title: "일본어 읽기 도우미",
    body: "한자 위에 읽는 법을 달고, 입문~중급은 한글 발음도 보여 줘요.",
    example: (
      <div>
        <p lang="ja">
          <Furigana text={ja.text} show />
        </p>
        {ja.pronKo && (
          <p aria-hidden="true" className="mt-1 text-sm text-mint">
            {ja.pronKo}
          </p>
        )}
      </div>
    ),
  },
];

const DAILY: Feature[] = [
  {
    icon: Lightbulb,
    title: "왜 정답인지 AI가 설명해요",
    body: "빈칸 문제를 풀고 나면 [AI 해설]로 정답인 이유를 볼 수 있어요. 틀린 단어는 오답 복습에서 다시 봐요.",
  },
  {
    icon: TrendingUp,
    title: "레벨업하면 새 상황이 열려요",
    body: `입문부터 고수까지 5단계예요. ${LEVEL_TEST_SIZE}문제 중 ${PASS_SCORE}개를 맞히면 다음 레벨로 올라가요.`,
  },
];

// 홈 그림의 할 일 줄. 정적 그림이라 버튼·링크 모양을 두지 않는다
const TASKS = [
  { title: `새 단어 ${DAILY_WORD_GOAL}개`, sub: "플래시카드 → 빈칸 문제", progress: `0 / ${DAILY_WORD_GOAL}` },
  { title: "상황 대화 한 번", sub: `${VALID_SESSION_TURNS}턴 이상 말하면 완료`, progress: `0 / ${VALID_SESSION_TURNS}턴` },
];

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const PLAN_ROWS = [
  {
    label: "AI 대화 턴",
    free: `하루 ${PLAN_LIMITS.free.chatTurns}턴`,
    pro: `하루 ${PLAN_LIMITS.pro.chatTurns}턴`,
  },
  {
    label: "대화 상황",
    free: `레벨마다 ${FREE_SCENARIOS_PER_LEVEL}개`,
    pro: `레벨마다 ${SCENARIOS_PER_LEVEL}개`,
  },
  {
    label: "새 단어",
    free: `하루 ${PLAN_LIMITS.free.newWords}개`,
    pro: `하루 ${PLAN_LIMITS.pro.newWords}개`,
  },
  { label: "AI 정답 설명", free: `하루 ${FREE_DAILY_EXPLANATIONS}회`, pro: "제한 없음" },
  { label: "복습 · 레벨업 테스트 · 가나", free: "제한 없음", pro: "제한 없음" },
  { label: "가격", free: "무료", pro: `월 ${won(PRO_PRICE_KRW)}` },
];

export default async function Landing({ searchParams }: PageProps<"/">) {
  const { login } = await searchParams;

  return (
    <>
      <header className="sticky top-0 z-10 bg-card shadow-nav">
        <div className="mx-auto flex h-14 max-w-public items-center justify-between gap-3 px-4 md:px-10">
          <p className={`${WORDMARK} text-brand`}>Langrow</p>
          <GoogleLoginButton variant="nav" />
        </div>
      </header>

      <main>
        <section className={SECTION}>
          <div className="mx-auto flex max-w-public flex-col gap-8">
            {login === "failed" && (
              <div role="alert" className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-danger ring-inset">
                <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
                <div className="flex flex-col gap-1">
                  <p className="font-bold">로그인을 완료하지 못했어요</p>
                  <p className="text-sm text-ink-muted">Google로 시작하기를 다시 눌러 보세요.</p>
                </div>
              </div>
            )}

            <div className="grid gap-10 md:grid-cols-[6fr_5fr] md:items-center">
              <div className="flex flex-col gap-4">
                <p className="text-micro font-bold text-ink-muted">영어 · 일본어</p>
                <h1 className="text-display font-semibold tracking-[-0.02em] text-balance text-brand md:text-display-lg">
                  하루 15분, 대화하면서 익히는 영어와 일본어
                </h1>
                <p className="text-h3 text-ink-muted">
                  카페 주문, 편의점 계산 같은 상황에서 AI와 대화해요. 말이 막히면 한국어로 써도 돼요.
                </p>
                <div className="mt-2 flex flex-col items-start gap-2">
                  <GoogleLoginButton variant="google" />
                  <p className="text-micro text-ink-muted">만 14세 이상 · 무료로 시작</p>
                </div>
              </div>

              <LandingPreview title={cafe.title} openings={{ en: previewLine(en), ja: previewLine(ja) }} />
            </div>
          </div>
        </section>

        <section className={`${SECTION} bg-card`}>
          <div className="mx-auto flex max-w-public flex-col gap-8">
            <h2 className={H2}>처음이어도 괜찮아요</h2>
            <ul className="grid gap-8 md:grid-cols-3">
              {BEGINNER.map((feature) => (
                <FeatureItem key={feature.title} feature={feature} />
              ))}
            </ul>
          </div>
        </section>

        <section className={`${SECTION} bg-house text-white`}>
          <div className="mx-auto flex max-w-public flex-col gap-8">
            <h2 className={H2}>대화하다 막히면</h2>
            <ul className="grid gap-8 md:grid-cols-3">
              {HELPERS.map((feature) => (
                <FeatureItem key={feature.title} feature={feature} band />
              ))}
            </ul>
          </div>
        </section>

        <section className={SECTION}>
          <div className="mx-auto flex max-w-public flex-col gap-8">
            <h2 className={H2}>매일 조금씩, 할 일은 두 개</h2>
            <div className="grid gap-8 md:grid-cols-2 md:items-center">
              <div className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-card">
                <div className="flex flex-col gap-2">
                  <p className="text-micro text-ink-muted">홈 화면</p>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold">오늘 할 일 2개 남았어요</p>
                    <span
                      role="img"
                      aria-label="연속 학습일 5일"
                      className="inline-flex items-center gap-1.5 rounded-full bg-gold-wash px-3 py-1.5 text-sm font-bold text-on-gold tabular-nums ring-1 ring-gold-light ring-inset"
                    >
                      <Flame size={16} aria-hidden="true" className="text-gold" />
                      5일
                    </span>
                  </div>
                </div>
                <ul className="flex flex-col gap-2">
                  {TASKS.map((task) => (
                    <li
                      key={task.title}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5"
                    >
                      <div className="flex flex-col">
                        <p className="font-bold">{task.title}</p>
                        <p className="text-micro text-ink-muted">{task.sub}</p>
                      </div>
                      <p className="text-micro tabular-nums">{task.progress}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="flex flex-col gap-8">
                {DAILY.map((feature) => (
                  <FeatureItem key={feature.title} feature={feature} />
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={`${SECTION} bg-card`}>
          <div className="mx-auto flex max-w-public flex-col gap-6">
            <h2 className={H2}>Free로 시작하고, 더 하고 싶으면 Pro</h2>
            <div className="overflow-x-auto rounded-xl bg-card shadow-card">
              {/* 전역 overflow-wrap: anywhere는 칸 최소 너비를 글자 하나로 줄여 320px에서 "14,90 / 0원"처럼 끊는다 */}
              <table className="w-full text-left wrap-break-word">
                <thead>
                  <tr className="border-b border-line text-micro font-bold text-ink-muted">
                    <th scope="col" className="px-4 py-3">
                      항목
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Free
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Pro
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {PLAN_ROWS.map((row) => (
                    <tr key={row.label}>
                      <th scope="row" className="px-4 py-3.5 font-normal">
                        {row.label}
                      </th>
                      <td className="px-4 py-3.5 text-right tabular-nums">{row.free}</td>
                      <td className="px-4 py-3.5 text-right font-bold tabular-nums">{row.pro}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-ink-muted">
              {TRIAL_DAYS}일 무료 체험은 계정당 한 번이에요. 결제 정보는 받지 않아요.
            </p>
            <div>
              <GoogleLoginButton variant="google" />
            </div>
          </div>
        </section>
      </main>

      <footer className={`${SECTION} bg-house text-white`}>
        <div className="mx-auto flex max-w-public flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p className={`${WORDMARK} text-white`}>Langrow</p>
          <nav aria-label="약관" className="flex gap-4 text-sm">
            <Link href="/terms" className="text-white/70 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              이용약관
            </Link>
            <Link href="/privacy" className="text-white/70 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              개인정보처리방침
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}

// 소개 항목: 아이콘 → 제목 → 설명(→ 예시). house 밴드 위에서는 아이콘 mint, 설명 white/70이다
function FeatureItem({ feature: { icon: Icon, title, body, example }, band = false }: { feature: Feature; band?: boolean }) {
  return (
    <li className="flex flex-col gap-2">
      <Icon size={24} aria-hidden="true" className={band ? "text-mint" : "text-accent"} />
      <h3 className="text-lead font-semibold">{title}</h3>
      <p className={`text-sm ${band ? "text-white/70" : "text-ink-muted"}`}>{body}</p>
      {example}
    </li>
  );
}
