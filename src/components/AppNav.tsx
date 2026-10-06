"use client";

import { BookOpen, CircleUserRound, House, Languages, MessagesSquare, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Language } from "@/lib/levels";

type Item = { href: string; label: string; icon: LucideIcon };

const HOME: Item = { href: "/home", label: "홈", icon: House };
const CHAT: Item = { href: "/chat", label: "대화", icon: MessagesSquare };
const WORDS: Item = { href: "/words", label: "단어", icon: BookOpen };
const LEVEL_UP: Item = { href: "/level-up", label: "레벨업 테스트", icon: TrendingUp };
const KANA: Item = { href: "/kana", label: "가나 익히기", icon: Languages };
const ACCOUNT: Item = { href: "/account", label: "계정", icon: CircleUserRound };

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// 모바일은 하단 탭 4개, lg 이상은 사이드바(레벨업 테스트, 일본어면 가나 익히기 포함)다
export function AppNav({ variant, language }: { variant: "tabs" | "sidebar"; language: Language }) {
  const pathname = usePathname();

  if (variant === "tabs") {
    return (
      <nav aria-label="주 메뉴">
        <ul className="grid grid-cols-4">
          {[HOME, CHAT, WORDS, ACCOUNT].map(({ href, label, icon: Icon }) => {
            const current = isCurrent(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 py-1.5 text-xs font-semibold ${current ? "text-accent" : "text-ink-muted"} ${FOCUS_RING}`}
                >
                  <Icon size={22} aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  const items = language === "ja" ? [HOME, CHAT, WORDS, LEVEL_UP, KANA, ACCOUNT] : [HOME, CHAT, WORDS, LEVEL_UP, ACCOUNT];
  return (
    <nav aria-label="주 메뉴">
      <ul className="flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const current = isCurrent(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={`flex h-11 items-center gap-3 rounded-full px-4 font-semibold transition duration-200 ${current ? "bg-mint text-brand" : "text-ink hover:bg-hover"} ${FOCUS_RING}`}
              >
                <Icon size={20} aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
