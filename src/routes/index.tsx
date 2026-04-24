import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Layers,
  Package,
  Database,
  Sparkles,
  FileText,
  Download,
  Upload,
  Palette,
  ArrowRight,
  Image as ImageIcon,
} from "lucide-react";
import { exportProjectJSON, importProjectJSON } from "@/storage/projectIO";
import { downloadJSON } from "@/features/render/exportPng";
import { toast } from "sonner";
import { useRef } from "react";
import { PageContainer } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

type StatColor = "violet" | "blue" | "teal" | "amber" | "rose" | "slate";

function Dashboard() {
  const project = useLiveQuery(() => db.projects.toCollection().first(), []);
  const counts = useLiveQuery(async () => {
    const [design, tpl, pack, ent, asset, job] = await Promise.all([
      db.designDocuments.count(),
      db.pageTemplates.count(),
      db.packTemplates.count(),
      db.entities.count(),
      db.assets.count(),
      db.jobs.count(),
    ]);
    return { design, tpl, pack, ent, asset, job };
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <PageContainer>
      <section className="relative mb-8 overflow-hidden rounded-2xl bg-brand-gradient p-6 text-[color:var(--color-brand-ink)] shadow-sm md:p-8">
        <div
          className="pointer-events-none absolute -right-10 -top-10 hidden h-56 w-56 rounded-full bg-white/10 blur-2xl md:block"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-16 -left-10 hidden h-48 w-48 rounded-full bg-white/10 blur-3xl md:block"
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <Badge
              variant="outline"
              className="mb-3 border-white/30 bg-white/10 text-[color:var(--color-brand-ink)] backdrop-blur"
            >
              <Sparkles className="mr-1 size-3" /> Content pack studio
            </Badge>
            <h1 className="text-3xl font-bold leading-tight md:text-4xl">
              Chào mừng tới GenPoster
            </h1>
            <p className="mt-2 text-sm text-[color:var(--color-brand-ink)]/80 md:text-base">
              Project hiện tại:{" "}
              <span className="font-semibold">{project?.name ?? "(chưa có)"}</span>. Tạo design,
              ghép pack, và xuất bộ ảnh social chỉ trong vài bước.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                asChild
                size="lg"
                className="bg-white text-[color:var(--primary)] hover:bg-white/90"
              >
                <Link to="/generate">
                  <Sparkles className="mr-2 size-4" /> Tạo content pack
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/40 bg-white/10 text-[color:var(--color-brand-ink)] hover:bg-white/20"
              >
                <Link to="/designs">
                  <Palette className="mr-2 size-4" /> Mở design editor
                </Link>
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Button
              variant="outline"
              size="sm"
              className="border-white/40 bg-white/10 text-[color:var(--color-brand-ink)] hover:bg-white/20"
              onClick={async () => {
                const data = await exportProjectJSON();
                downloadJSON(data, `project-${Date.now()}.json`);
                toast.success("Đã export project JSON");
              }}
            >
              <Download className="mr-2 size-4" />
              Export JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-white/40 bg-white/10 text-[color:var(--color-brand-ink)] hover:bg-white/20"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-2 size-4" />
              Import JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const data = JSON.parse(await f.text());
                  await importProjectJSON(data);
                  toast.success("Đã import project");
                  window.location.reload();
                } catch (err) {
                  toast.error("Lỗi import: " + (err as Error).message);
                }
              }}
            />
          </div>
        </div>
      </section>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Designs"
          value={counts?.design ?? 0}
          icon={Palette}
          color="violet"
          to="/designs"
        />
        <StatCard
          label="Page Templates"
          value={counts?.tpl ?? 0}
          icon={Layers}
          color="blue"
          to="/templates"
        />
        <StatCard
          label="Pack Templates"
          value={counts?.pack ?? 0}
          icon={Package}
          color="teal"
          to="/packs"
        />
        <StatCard
          label="Entities"
          value={counts?.ent ?? 0}
          icon={Database}
          color="amber"
          to="/data"
        />
        <StatCard
          label="Assets"
          value={counts?.asset ?? 0}
          icon={ImageIcon}
          color="rose"
          to="/data"
        />
        <StatCard
          label="Jobs đã tạo"
          value={counts?.job ?? 0}
          icon={FileText}
          color="slate"
          to="/history"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="border-border/70 transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-accent text-primary">
                <Sparkles className="size-4" />
              </span>
              Bắt đầu nhanh
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              App đã có sẵn pack demo Đà Lạt. Bạn có thể chạy generate thử ngay.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/generate">
                  Tạo content pack <ArrowRight className="ml-1 size-3.5" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/designs">Mở design editor</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/templates">Xem templates</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/data">Quản lý dữ liệu</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>Quy trình</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Step n={1} text="Tạo / sửa Page Template (kéo thả)" />
            <Step n={2} text="Ghép thành Pack Template" />
            <Step n={3} text="Import dữ liệu CSV/JSON/Sheet" />
            <Step n={4} text="Generate, tick chọn page" />
            <Step n={5} text="Export PNG/ZIP + caption + report" />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 border-border/70">
        <CardHeader>
          <CardTitle>Local-first</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" className="font-normal">
            <Database className="mr-1 size-3" /> IndexedDB · lưu trên trình duyệt
          </Badge>
          <Badge variant="secondary" className="font-normal">
            <Download className="mr-1 size-3" /> Export/Import JSON
          </Badge>
          <Badge variant="secondary" className="font-normal">
            Không cần đăng nhập
          </Badge>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

const STAT_COLORS: Record<StatColor, string> = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
};

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  to,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: StatColor;
  to: string;
}) {
  return (
    <Link to={to} aria-label={`${label}: ${value}`}>
      <Card className="h-full border-border/70 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
        <CardContent className="flex flex-col gap-2 p-4">
          <span className={cn("grid size-9 place-items-center rounded-lg", STAT_COLORS[color])}>
            <Icon className="size-4" />
          </span>
          <div className="text-2xl font-bold leading-none tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-gradient text-[11px] font-bold text-[color:var(--color-brand-ink)]">
        {n}
      </div>
      <div>{text}</div>
    </div>
  );
}
