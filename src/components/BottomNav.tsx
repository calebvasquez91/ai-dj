"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";
import { NAV_TABS, activeTabHref } from "@/lib/navTabs";
import { NAV_ICONS } from "@/components/navIcons";

/**
 * The phone's navigation: Home, Music Library, Playlists and Search in a row under the player bar. Phones only (below
 * the tablet width, 600px, where the side panel and its hamburger are gone); a tablet has the rail (NavRail) and a
 * desktop the side panel, so there it is not displayed. The current tab is marked with the one gradient the tabs get.
 *
 * It sits in the page's column after the player bar, so the player bar rides on top of it. Its measured height is
 * published as --bottom-nav-h (0 when it is not displayed) for everything that is sized to stop above the bottom chrome:
 * the mascot's dock and the deck / mixer / queue overlays (see --dock-h in globals.css).
 */
export function BottomNav() {
  const pathname = usePathname();
  const nowPlayingExpanded = useStore((s) => s.nowPlayingExpanded);
  const navRef = useRef<HTMLElement>(null);
  const active = activeTabHref(pathname);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--bottom-nav-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--bottom-nav-h");
    };
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      inert={nowPlayingExpanded ? true : undefined}
      className="tablet:hidden shrink-0 surface-glass border-t border-border/10 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      <ul className="grid grid-cols-4">
        {NAV_TABS.map((tab) => {
          const Icon = NAV_ICONS[tab.href];
          const isActive = tab.href === active;
          return (
            <li key={tab.href} className="min-w-0">
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold leading-tight transition-colors ${
                  isActive ? "text-foreground" : "text-muted active:text-foreground"
                }`}
              >
                {isActive && <span aria-hidden="true" className="accent-gradient absolute top-0 h-0.5 w-8 rounded-full" />}
                <Icon size={22} />
                <span className="max-w-full truncate">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
