import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Home,
  Layers,
  Package,
  Database,
  Sparkles,
  FileText,
  History,
  Settings,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { seedDemo, isSeeded } from "@/storage/seed";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

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
      { to: "/designs", label: "Designs", icon: Palette },
      { to: "/templates", label: "Page Templates", icon: Layers },
      { to: "/packs", label: "Pack Templates", icon: Package },
      { to: "/generate", label: "Tạo nội dung", icon: Sparkles },
    ],
  },
  {
    label: "Dữ liệu & Báo cáo",
    items: [
      { to: "/data", label: "Dữ liệu", icon: Database },
      { to: "/reports", label: "Báo cáo & Caption", icon: FileText },
      { to: "/analysis", label: "Phân tích bộ ảnh", icon: Search },
      { to: "/history", label: "Lịch sử", icon: History },
    ],
  },
  {
    label: "Khác",
    items: [{ to: "/settings", label: "Cài đặt", icon: Settings }],
  },
];

const FLAT_NAV: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

const STORAGE_KEY = "appShell.collapsed";

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
        collapsed ? "px-2 py-4 space-y-1" : "px-3 py-4 space-y-5",
      )}
    >
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className={collapsed ? "space-y-1" : "space-y-1"}>
          {!collapsed && (
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {section.label}
            </div>
          )}
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
  const [, setSeeded] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    }
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    (async () => {
      if (!(await isSeeded())) {
        await seedDemo();
        toast.success("Đã tạo dữ liệu demo. Mở 'Tạo nội dung' để thử ngay!");
      }
      setSeeded(true);
    })();
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
        <div
          className={cn(
            "py-4 border-b border-sidebar-border flex items-center",
            collapsed ? "px-2 justify-center" : "px-4 justify-between gap-2",
          )}
        >
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="rounded-xl hover:opacity-90"
              title="Mở rộng"
            >
              <BrandMark className="size-9" />
            </button>
          ) : (
            <>
              <Link to="/" className="flex items-center gap-2 min-w-0">
                <BrandMark className="size-9 shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold text-sm leading-tight truncate">GenPoster</div>
                  <div className="text-[10px] text-muted-foreground leading-tight truncate">
                    Content pack studio
                  </div>
                </div>
              </Link>
              <button
                onClick={() => setCollapsed(true)}
                className="p-1.5 rounded-md hover:bg-sidebar-accent/60 shrink-0"
                title="Thu gọn"
                aria-label="Thu gọn sidebar"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </>
          )}
        </div>

        <NavLinks collapsed={collapsed} pathname={location.pathname} />

        <div className={cn("border-t border-sidebar-border", collapsed ? "p-2" : "p-3")}>
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="w-full p-2 rounded-md hover:bg-sidebar-accent/60 grid place-items-center"
              title="Mở rộng sidebar"
              aria-label="Mở rộng sidebar"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          ) : (
            <div className="rounded-lg border border-sidebar-border/70 bg-sidebar-accent/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <div className="font-medium text-sidebar-foreground/90">Local-first</div>
              Dữ liệu lưu trên trình duyệt, không gửi lên server.
            </div>
          )}
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
                    <SheetDescription className="text-[11px]">Content pack studio</SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="flex-1 overflow-hidden bg-sidebar text-sidebar-foreground">
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
