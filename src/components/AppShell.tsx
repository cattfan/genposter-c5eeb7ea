import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Home, Package, Database, Sparkles, History, Settings, Palette, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { cleanupDemoData } from "@/storage/sampleDataCleanup";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    (async () => {
      const result = await cleanupDemoData();
      if (result.total > 0) {
        toast.success("Đã xóa dữ liệu mẫu.");
      }
    })().catch((error) => {
      toast.error(
        `Không thể xóa dữ liệu mẫu: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, []);

  const activeLabel = getActiveLabel(location.pathname);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside
        className={cn(
          "hidden md:flex shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex-col transition-[width] duration-200",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className={cn(
            "flex border-b border-sidebar-border py-4 text-left transition-colors hover:bg-sidebar-accent/60",
            collapsed ? "justify-center px-2" : "items-center gap-2 px-4",
          )}
          title={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
          aria-label={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
        >
          <BrandMark className="size-9 shrink-0" />
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-bold leading-tight">GenPoster</div>
            </div>
          )}
        </button>

        <NavLinks collapsed={collapsed} pathname={location.pathname} />
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
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <BrandMark className="size-7" />
            <div className="min-w-0 text-sm font-semibold truncate">{activeLabel}</div>
          </Link>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
