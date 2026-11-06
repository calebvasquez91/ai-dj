"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/AccountMenu";
import { SlidersIcon, SparklesIcon } from "@/components/Icons";
import { NAV_ICONS, type NavIcon } from "@/components/navIcons";
import { NAV_TABS, activeTabHref } from "@/lib/navTabs";

function RailLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: NavIcon; active: boolean }) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
      className={`relative flex h-12 w-12 items-center justify-center rounded-lg transition-colors ${
        active ? "bg-surface-raised text-foreground" : "text-muted hover:bg-surface-hover hover:text-foreground"
      }`}
    >
      {active && <span aria-hidden="true" className="accent-gradient absolute -left-2 top-3 bottom-3 w-0.5 rounded-full" />}
      <Icon size={22} />
    </Link>
  );
}

/**
 * The tablet's navigation: a narrow rail of icons down the left (600-1023px). Phones have the tabs under the player bar
 * and desktops the full side panel, so it is displayed only between the two. The account menu opens upward from the
 * bottom of the rail, where the side panel keeps Dark mode and Log out.
 */
export function NavRail() {
  const pathname = usePathname();
  const active = activeTabHref(pathname);
  return (
    <nav
      aria-label="Main"
      className="hidden w-16 shrink-0 flex-col items-center gap-1 border-r border-border/10 surface-glass py-3 pl-[env(safe-area-inset-left)] tablet:flex desktop:hidden"
    >
      <span className="wordmark mb-2 text-lg" aria-hidden="true">
        AI
      </span>
      {NAV_TABS.map((tab) => (
        <RailLink key={tab.href} href={tab.href} label={tab.label} icon={NAV_ICONS[tab.href]} active={tab.href === active} />
      ))}
      <RailLink href="/inspiration" label="DJ Inspiration" icon={SparklesIcon} active={pathname === "/inspiration"} />
      <RailLink href="/settings" label="Settings" icon={SlidersIcon} active={pathname === "/settings"} />
      <div className="mt-auto pt-2">
        <AccountMenu placement="above-start" />
      </div>
    </nav>
  );
}
