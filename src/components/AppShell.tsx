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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { seedDemo, isSeeded } from "@/storage/seed";
import { toast } from "sonner";

const NAV = [
  { to: "/", label: "Trang chủ", icon: Home },
  { to: "/templates", label: "Page Templates", icon: Layers },
  { to: "/packs", label: "Pack Templates", icon: Package },
  { to: "/data", label: "Dữ liệu", icon: Database },
  { to: "/generate", label: "Tạo nội dung", icon: Sparkles },
  { to: "/reports", label: "Báo cáo & Caption", icon: FileText },
  { to: "/history", label: "Lịch sử", icon: History },
  { to: "/settings", label: "Cài đặt", icon: Settings },
] as const;

const STORAGE_KEY = "appShell.collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [seeded, setSeeded] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    }
  }, [collapsed]);

  useEffect(() => {
    (async () => {
      if (!(await isSeeded())) {
        await seedDemo();
        toast.success("Đã tạo dữ liệu demo. Mở 'Tạo nội dung' để thử ngay!");
      }
      setSeeded(true);
    })();
  }, []);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside
        className={cn(
          "shrink-0 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col transition-[width] duration-200",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div
          className={cn(
            "py-5 border-b border-sidebar-border flex items-center",
            collapsed ? "px-2 justify-center" : "px-5 justify-between gap-2",
          )}
        >
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="size-9 rounded-xl bg-primary text-primary-foreground grid place-items-center hover:opacity-90"
              title="Mở rộng"
            >
              <Palette className="size-5" />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <div className="size-9 rounded-xl bg-primary text-primary-foreground grid place-items-center shrink-0">
                  <Palette className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm leading-tight truncate">Content Pack</div>
                  <div className="text-xs text-muted-foreground leading-tight truncate">
                    Generator · VN
                  </div>
                </div>
              </div>
              <button
                onClick={() => setCollapsed(true)}
                className="p-1.5 rounded hover:bg-sidebar-accent/60 shrink-0"
                title="Thu gọn"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </>
          )}
        </div>

        <nav className={cn("flex-1 overflow-y-auto py-4 space-y-1", collapsed ? "px-2" : "px-3")}>
          {NAV.map((item) => {
            const active =
              item.to === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center rounded-lg text-sm transition-colors",
                  collapsed ? "justify-center p-2" : "gap-3 px-3 py-2",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "hover:bg-sidebar-accent/60 text-sidebar-foreground/80",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className={cn("border-t border-sidebar-border", collapsed ? "p-2" : "p-3")}>
          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              className="w-full p-2 rounded hover:bg-sidebar-accent/60 grid place-items-center"
              title="Mở rộng sidebar"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {seeded ? children : <div className="p-10 text-muted-foreground">Đang khởi tạo...</div>}
      </main>
    </div>
  );
}
