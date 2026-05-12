import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Home,
  Package,
  Database,
  Sparkles,
  History,
  Settings,
  Palette,
  Menu,
  Moon,
  Sun,
  Keyboard,
  Command as CommandIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { initThemeOnce, useTheme } from "@/hooks/useTheme";
import { GlobalCommandPaletteHost } from "@/components/CommandPalette";
import { ShortcutsDialog, useShortcutsDialogHotkey } from "@/components/ux";

const SIDEBAR_COLLAPSED_KEY = "cpg_sidebar_collapsed";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Tạo nội dung",
    items: [
      { to: "/", label: "Trang chủ", icon: Home },
      { to: "/templates", label: "Khuôn mẫu", icon: Package },
      { to: "/generate", label: "Tạo nội dung", icon: Sparkles },
    ],
  },
  {
    label: "Dữ liệu",
    items: [
      { to: "/data", label: "Dữ liệu", icon: Database },
      { to: "/history", label: "Lịch sử", icon: History },
    ],
  },
  {
    label: "Khác",
    items: [{ to: "/settings", label: "Cài đặt", icon: Settings }],
  },
];

const FLAT_NAV: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

function isActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

function getActiveLabel(pathname: string) {
  const sorted = [...FLAT_NAV].sort((a, b) => b.to.length - a.to.length);
  return sorted.find((item) => isActive(pathname, item.to))?.label ?? "GenPoster";
}

function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-xl bg-brand-gradient text-[color:var(--color-brand-ink)] shadow-sm",
        className,
      )}
    >
      <Palette className="size-5" />
    </div>
  );
}

function NavLinks({
  collapsed,
  pathname,
  onNavigate,
}: {
  collapsed: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav
      className={cn(
        "flex-1 overflow-y-auto",
        collapsed ? "px-2 py-4 space-y-1" : "px-3 py-4 space-y-1",
      )}
    >
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className={collapsed ? "space-y-1" : "space-y-1"}>
          {section.items.map((item) => {
            const active = isActive(pathname, item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                onClick={onNavigate}
                className={cn(
                  "group relative flex items-center rounded-lg text-sm transition-colors",
                  collapsed ? "justify-center p-2" : "gap-3 px-3 py-2",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                {active && !collapsed && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand-gradient" />
                )}
                <Icon
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    active
                      ? "text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 group-hover:text-sidebar-accent-foreground",
                  )}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
          {collapsed && section !== NAV_SECTIONS[NAV_SECTIONS.length - 1] && (
            <div className="my-1 mx-auto h-px w-8 bg-sidebar-border/70" aria-hidden />
          )}
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  // `mounted` gates client-only state to avoid SSR/CSR hydration mismatch.
  // During SSR + first client paint: render the stable default (collapsed=false).
  // After mount: hydrate collapsed state from localStorage.
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { mode: themeMode, toggle: toggleTheme, effective: effectiveTheme } = useTheme();

  const effectiveCollapsed = mounted && collapsed;
  const themeIsSystem = mounted && themeMode === "system";

  // Apply persisted theme ASAP (before React effects) to minimise flash-of-wrong-theme.
  useEffect(() => {
    initThemeOnce();
  }, []);

  // Load persisted collapsed state after mount (client-only).
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
      }
    } catch {
      /* ignore storage errors (private mode, quota, etc.) */
    }
    setMounted(true);
  }, []);

  // Persist collapsed state after user toggles (skip initial hydration write).
  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [mounted, collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const activeLabel = useMemo(() => getActiveLabel(location.pathname), [location.pathname]);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside
        className={cn(
          "hidden md:flex shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex-col transition-[width] duration-200",
          effectiveCollapsed ? "w-16" : "w-64",
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className={cn(
            "flex border-b border-sidebar-border py-4 text-left transition-colors hover:bg-sidebar-accent/60",
            effectiveCollapsed ? "justify-center px-2" : "items-center gap-2 px-4",
          )}
          title={effectiveCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
          aria-label={effectiveCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
        >
          <BrandMark className="size-9 shrink-0" />
          {!effectiveCollapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-bold leading-tight">GenPoster</div>
            </div>
          )}
        </button>

        <NavLinks collapsed={effectiveCollapsed} pathname={location.pathname} />

        <div
          className={cn(
            "border-t border-sidebar-border",
            effectiveCollapsed ? "p-2" : "p-3 space-y-1",
          )}
        >
          <button
            type="button"
            onClick={() => {
              // Dispatch a synthetic Ctrl+K so GlobalCommandPaletteHost opens.
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "k",
                    ctrlKey: true,
                    bubbles: true,
                  }),
                );
              }
            }}
            className={cn(
              "flex w-full items-center rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              effectiveCollapsed ? "justify-center" : "gap-2",
            )}
            title="Command palette (Ctrl+K)"
            aria-label="Command palette"
          >
            <CommandIcon className="size-4 shrink-0" />
            {!effectiveCollapsed && (
              <span className="flex flex-1 items-center justify-between truncate">
                <span>Tìm lệnh</span>
                <kbd className="rounded border bg-sidebar-accent/40 px-1.5 py-0.5 text-[10px] font-mono text-sidebar-foreground/70">
                  Ctrl K
                </kbd>
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className={cn(
              "flex w-full items-center rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              effectiveCollapsed ? "justify-center" : "gap-2",
            )}
            title={
              mounted
                ? effectiveTheme === "dark"
                  ? "Đổi sang sáng"
                  : "Đổi sang tối"
                : "Đổi theme"
            }
            aria-label="Đổi theme"
          >
            {mounted && effectiveTheme === "dark" ? (
              <Sun className="size-4 shrink-0" />
            ) : (
              <Moon className="size-4 shrink-0" />
            )}
            {!effectiveCollapsed && (
              <span className="truncate">
                {mounted
                  ? effectiveTheme === "dark"
                    ? "Chế độ sáng"
                    : "Chế độ tối"
                  : "Theme"}
                {themeIsSystem ? (
                  <span className="ml-1 text-[10px] text-sidebar-foreground/60">
                    (tự động)
                  </span>
                ) : null}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
              }
            }}
            className={cn(
              "flex w-full items-center rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              effectiveCollapsed ? "justify-center" : "gap-2",
            )}
            title="Xem danh sách phím tắt (?)"
            aria-label="Xem danh sách phím tắt"
          >
            <Keyboard className="size-4 shrink-0" />
            {!effectiveCollapsed && (
              <span className="flex flex-1 items-center justify-between truncate">
                <span>Phím tắt</span>
                <kbd className="rounded border bg-sidebar-accent/40 px-1.5 py-0.5 text-[10px] font-mono text-sidebar-foreground/70">
                  ?
                </kbd>
              </span>
            )}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/90 px-3 py-2 backdrop-blur">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button className="rounded-md p-2 hover:bg-accent" aria-label="Mở menu">
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 flex flex-col">
              <SheetHeader className="border-b border-sidebar-border bg-sidebar px-4 py-4">
                <div className="flex items-center gap-2">
                  <BrandMark className="size-9" />
                  <div>
                    <SheetTitle className="text-sm">GenPoster</SheetTitle>
                  </div>
                </div>
              </SheetHeader>
              <div className="flex flex-1 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
                <NavLinks
                  collapsed={false}
                  pathname={location.pathname}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>
          <Link to="/" className="flex items-center gap-2 min-w-0 flex-1">
            <BrandMark className="size-7" />
            <div className="min-w-0 text-sm font-semibold truncate">{activeLabel}</div>
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-md p-2 hover:bg-accent"
            aria-label="Đổi theme"
            title="Đổi theme"
          >
            {mounted && effectiveTheme === "dark" ? (
              <Sun className="size-5" />
            ) : (
              <Moon className="size-5" />
            )}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <GlobalCommandPaletteHost extraCommands={useAppShellCommands()} />
      <AppShellShortcuts />
    </div>
  );
}

function AppShellShortcuts() {
  const { open, setOpen } = useShortcutsDialogHotkey();
  return <ShortcutsDialog open={open} onOpenChange={setOpen} />;
}

/** Trả về lệnh mở danh sách phím tắt để thêm vào Command Palette. */
function useAppShellCommands() {
  return useMemo(() => [
    {
      id: "help:shortcuts",
      label: "Xem danh sách phím tắt",
      group: "Trợ giúp",
      keywords: ["shortcut", "phim tat", "help"],
      action: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
        }
      },
    },
  ], []);
}
