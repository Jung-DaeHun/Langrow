import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { onboardingStart } from "@/lib/onboarding";
import { loadAccount } from "@/server/page";

export const metadata: Metadata = { title: "시작하기 · Langrow" };

// (app) 밖이라 셸과 준비 상태 이동이 없다. 저장된 상태로 시작 단계를 다시 정하므로 이탈해도 그 단계부터 이어진다
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const { account } = await loadAccount();
  const { language } = await searchParams;
  const start = onboardingStart(account, typeof language === "string" ? language : undefined);
  if (start.kind === "home") redirect("/home");

  return (
    <main>
      <OnboardingFlow start={start} />
    </main>
  );
}
