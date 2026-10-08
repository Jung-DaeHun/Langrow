import { BookOpen, CircleAlert, MessagesSquare, TrendingUp } from "lucide-react";
import Link from "next/link";
import { GoogleLoginButton } from "@/components/GoogleLoginButton";
import { KANA } from "@/lib/kana";
import { LEVEL_TEST_SIZE, PASS_SCORE } from "@/lib/levelTest";
import { PLAN_LIMITS, PRO_PRICE_KRW, TRIAL_DAYS } from "@/lib/plan";
import { DAILY_WORD_GOAL } from "@/lib/today";

// 랜딩(공개). 로그인 여부와 무관하게 연다(spec/journey.md "페이지 접근 규칙"). 면 색으로 섹션을 나눈다: 크림 → 흰색 → house → 크림 → house 푸터

const SECTION = "px-4 py-10 md:px-10 md:py-16";
const WORDMARK = "text-h3 font-extrabold tracking-[-0.03em]";
const H2 = "text-h3 font-semibold tracking-[-0.02em] text-balance";
const AI_BUBBLE = "max-w-[84%] self-start rounded-bubble rounded-bl-md bg-card px-3.5 py-3 shadow-card";
const TRANSLATION = "mt-2 border-t border-line pt-2 text-sm text-ink-muted";

const FEATURES = [
  {
    icon: MessagesSquare,
    title: "상황 롤플레이 대화",
    body: "카페 주문, 길 묻기 같은 상황에서 말해 보세요. 문장마다 번역과 더 자연스러운 표현을 보여 줘요.",
  },
  {
    icon: BookOpen,
    title: `하루 새 단어 ${DAILY_WORD_GOAL}개`,
    body: "플래시카드로 뜻을 익히고 빈칸 문제로 확인해요. 틀린 단어는 오답 복습에서 다시 봐요.",
  },
  {
    icon: TrendingUp,
    title: "레벨업 테스트",
    body: `입문부터 고수까지 5단계예요. ${LEVEL_TEST_SIZE}문제 중 ${PASS_SCORE}개를 맞히면 다음 레벨로 올라가요.`,
  },
];

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const PLAN_ROWS = [
  {
    label: "AI 대화 턴",
    free: `하루 ${PLAN_LIMITS.free.chatTurns}턴`,
    pro: `하루 ${PLAN_LIMITS.pro.chatTurns}턴`,
  },
  {
    label: "새 단어",
    free: `하루 ${PLAN_LIMITS.free.newWords}개`,
    pro: `하루 ${PLAN_LIMITS.pro.newWords}개`,
  },
  { label: "복습", free: "제한 없음", pro: "제한 없음" },
  { label: "레벨업 테스트", free: "제한 없음", pro: "제한 없음" },
  { label: "가나", free: "제한 없음", pro: "제한 없음" },
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
                  하루 15분, 말하면서 익히는 영어와 일본어
                </h1>
                <p className="text-h3 text-ink-muted">
                  상황 롤플레이로 대화하고, 더 자연스러운 표현을 바로 확인해요. 단어와 레벨업 테스트로 매일 조금씩
                  늘려 가요.
                </p>
                <div className="mt-2 flex flex-col items-start gap-2">
                  <GoogleLoginButton variant="google" />
                  <p className="text-micro text-ink-muted">만 14세 이상 · 무료로 시작</p>
                </div>
              </div>

              {/* 대화방의 말풍선·교정 카드와 같은 클래스로 그린 정적 미리보기 */}
              <div className="flex flex-col gap-3 rounded-xl bg-page p-4 shadow-raised md:p-5">
                <p className="text-micro text-ink-muted">상황 · 카페에서 주문하기</p>
                <div lang="en" className={AI_BUBBLE}>
                  <p>Hi! What can I get for you today?</p>
                  <p lang="ko" className={TRANSLATION}>
                    안녕하세요! 오늘 뭘 드릴까요?
                  </p>
                </div>
                <p
                  lang="en"
                  className="max-w-[84%] self-end rounded-bubble rounded-br-md bg-house px-3.5 py-3 text-white"
                >
                  I want ice americano.
                </p>
                <div className="flex max-w-[84%] flex-col gap-1 self-end rounded-xl bg-mint p-3">
                  <p className="text-micro text-ink-muted">이렇게 말하면 더 자연스러워요</p>
                  <p lang="en" className="font-bold text-brand">
                    Can I get an iced americano?
                  </p>
                  <p className="text-sm">주문할 때는 I want보다 Can I get이 부드러워요. 차가운 음료는 iced로 써요.</p>
                </div>
                <div lang="en" className={AI_BUBBLE}>
                  <p>Sure! What size would you like?</p>
                  <p lang="ko" className={TRANSLATION}>
                    물론이죠! 어떤 사이즈로 드릴까요?
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={`${SECTION} bg-card`}>
          <div className="mx-auto flex max-w-public flex-col gap-8">
            <h2 className={H2}>오늘 할 일만 하면 돼요</h2>
            <ul className="grid gap-8 md:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex flex-col gap-2">
                  <Icon size={24} aria-hidden="true" className="text-accent" />
                  <h3 className="text-lead font-semibold">{title}</h3>
                  <p className="text-sm text-ink-muted">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={`${SECTION} bg-house text-white`}>
          <div className="mx-auto flex max-w-public flex-col gap-4">
            <h2 className={H2}>일본어가 처음이라면 가나부터</h2>
            <p className="text-white/70">
              히라가나와 가타카나 {KANA.hiragana.length}자씩 플래시카드로 익혀요. 가나 학습은 하루 사용량에 포함되지
              않아요.
            </p>
            <p lang="ja" className="text-word font-medium">
              あ い う え お
            </p>
          </div>
        </section>

        <section className={SECTION}>
          <div className="mx-auto flex max-w-public flex-col gap-6">
            <h2 className={H2}>Free로 시작하고, 더 하고 싶으면 Pro</h2>
            <div className="overflow-x-auto rounded-xl bg-card shadow-card">
              <table className="w-full text-left">
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
