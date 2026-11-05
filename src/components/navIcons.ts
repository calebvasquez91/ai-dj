import type { ComponentType } from "react";
import { HomeIcon, LibraryIcon, QueueIcon, SearchIcon } from "@/components/Icons";

export type NavIcon = ComponentType<{ size?: number; className?: string }>;

/** The icon for each tab in lib/navTabs.ts, shared by the phone's bottom tabs and the tablet's rail. */
export const NAV_ICONS: Record<string, NavIcon> = {
  "/": HomeIcon,
  "/library": LibraryIcon,
  "/playlists": QueueIcon,
  "/search": SearchIcon,
};
