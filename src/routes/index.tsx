import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
import { getSettings } from "@/storage/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Database,
  Download,
  FileText,
  Image as ImageIcon,
  Package,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { PageContainer } from "@/components/PageHeader";
import { buildDashboardSummary, type DashboardIssue } from "@/routes/dashboardSummary";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

type StatColor = "blue" | "teal" | "amber" | "rose" | "slate";
type StatusTone = DashboardIssue["tone"];

function Dashboard() {
  const dashboard = useLiveQuery(async () => {
    const [
      packTemplates,
      pageTemplates,
      entities,
      assets,
      jobs,
      blobCount,
      presetCount,
      analysisCount,
      settings,
    ] = await Promise.all([
      db.packTemplates.toArray(),
      db.pageTemplates.toArray(),
      db.entities.toArray(),
      db.assets.toArray(),
      db.jobs.orderBy("createdAt").reverse().toArray(),
      db.blobs.count(),
      db.generatePresets.count(),
      db.analyses.count(),
      getSettings(),
    ]);

    return buildDashboardSummary({
      packTemplates,
      pageTemplates,
      entities,
      assets,
      jobs,
      blobCount,
      presetCount,
      analysisCount,
      aiConfigured: Boolean(settings.ai?.baseUrl && settings.ai.model),
    });
  }, []);

  const issues = dashboard?.issues ?? [];

  return (
    <PageContainer className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bảng tổng quan</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/data">
              <UploadCloud className="size-4" />
              Nhập dữ liệu
            </Link>
          </Button>
          {(dashboard?.driveDownloadCandidateCount ?? 0) > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link to="/data" search={{ tab: "images" }}>
                <Download className="size-4" />
                Tải ảnh từ sheet
              </Link>
            </Button>
          )}
          <Button asChild size="sm">
            <Link to="/generate">
              <Sparkles className="size-4" />
              Tạo nội dung
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Khuôn mẫu"
          value={dashboard?.packTemplates ?? 0}
          detail={`${dashboard?.pageTemplates ?? 0} trang khuôn`}
          icon={Package}
          color="teal"
          to="/templates"
        />
        <StatCard
          label="Dữ liệu"
          value={dashboard?.entities ?? 0}
          detail={`${dashboard?.sheetCount ?? 0} bảng, ${dashboard?.activeEntities ?? 0} đang dùng`}
          icon={Database}
          color="amber"
          to="/data"
        />
        <StatCard
          label="Ảnh"
          value={dashboard?.assets ?? 0}
          detail={`${dashboard?.localAssets ?? 0} trong máy, ${dashboard?.linkAssets ?? 0} bằng link`}
          icon={ImageIcon}
          color="rose"
          to="/data"
        />
        <StatCard
          label="Lượt tạo"
          value={dashboard?.jobs ?? 0}
          detail={`${dashboard?.renderedPages ?? 0} trang, ${dashboard?.exportedJobs ?? 0} đã xuất`}
          icon={FileText}
          color="slate"
          to="/history"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        <StatusCard
          title="Dữ liệu"
          icon={Database}
          tone={(dashboard?.entities ?? 0) > 0 ? "good" : "danger"}
          rows={[
            ["Tổng dòng", dashboard?.entities ?? 0],
            ["Đang dùng", dashboard?.activeEntities ?? 0],
            ["Đối tác", dashboard?.partnerEntities ?? 0],
            ["Bảng", dashboard?.sheetCount ?? 0],
          ]}
          actionTo="/data"
          actionLabel="Mở dữ liệu"
        />
        <StatusCard
          title="Ảnh"
          icon={ImageIcon}
          tone={
            (dashboard?.assets ?? 0) === 0
              ? "danger"
              : (dashboard?.brokenAssets ?? 0) + (dashboard?.missingAssets ?? 0) > 0
                ? "danger"
                : "good"
          }
          rows={[
            ["Ảnh", dashboard?.assets ?? 0],
            ["Ảnh trong máy", dashboard?.blobCount ?? 0],
            ["Ảnh dạng link", dashboard?.linkAssets ?? 0],
            ["Chờ ghép/tải", dashboard?.entitiesWithReferenceOnly ?? 0],
            ["Chưa có nguồn ảnh", dashboard?.entitiesWithoutAnyImageSource ?? 0],
          ]}
          actionTo="/data"
          actionSearch={{ tab: "images" }}
          actionLabel={(dashboard?.driveDownloadCandidateCount ?? 0) > 0 ? "Tải ảnh từ sheet" : "Kiểm ảnh"}
        />
        <StatusCard
          title="Khuôn mẫu"
          icon={Package}
          tone={(dashboard?.packTemplates ?? 0) > 0 ? "good" : "danger"}
          rows={[
            ["Bộ khuôn", dashboard?.packTemplates ?? 0],
            ["Trang khuôn", dashboard?.pageTemplates ?? 0],
            ["Ô đã gắn dữ liệu", `${dashboard?.mappedSlots ?? 0}/${dashboard?.totalSlots ?? 0}`],
            ["Khuôn đổ dữ liệu", dashboard?.presetCount ?? 0],
          ]}
          actionTo="/templates"
          actionLabel="Mở khuôn"
        />
        <StatusCard
          title="Tạo nội dung"
          icon={Sparkles}
          tone={(dashboard?.latestJobWarnings ?? 0) > 0 ? "warning" : "neutral"}
          rows={[
            ["Lượt tạo", dashboard?.jobs ?? 0],
            ["Trang đã dựng", dashboard?.renderedPages ?? 0],
            ["Cảnh báo lượt mới", dashboard?.latestJobWarnings ?? 0],
            ["Phân tích AI", dashboard?.analysisCount ?? 0],
          ]}
          actionTo="/generate"
          actionLabel="Tạo nội dung"
        />
      </div>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4" />
            Cần xử lý
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {issues.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
              Không có cảnh báo lớn. Có thể bắt đầu tạo nội dung.
            </div>
          ) : (
            issues.slice(0, 6).map((issue) => (
              <Link
                key={`${issue.label}-${issue.to}`}
                to={issue.to}
                search={issue.search}
                className="flex items-start justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot tone={issue.tone} />
                    <div className="font-medium">{issue.label}</div>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{issue.detail}</div>
                </div>
                <span className="text-xs font-medium text-primary">Mở</span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

const STAT_COLORS: Record<StatColor, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
};

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200",
  danger:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200",
  neutral:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-200",
};

const STATUS_DOT_CLASSES: Record<StatusTone, string> = {
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  neutral: "bg-slate-400",
};

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  color,
  to,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  color: StatColor;
  to: string;
}) {
  return (
    <Link to={to} aria-label={`${label}: ${value}`}>
      <Card className="h-full border-border/70 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-2 p-4">
          <span className={cn("grid size-9 place-items-center rounded-lg", STAT_COLORS[color])}>
            <Icon className="size-4" />
          </span>
          <div className="text-2xl font-bold leading-none tabular-nums">{value}</div>
          <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-xs text-muted-foreground/80">{detail}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function StatusCard({
  title,
  icon: Icon,
  tone,
  rows,
  actionTo,
  actionSearch,
  actionLabel,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: StatusTone;
  rows: Array<[string, string | number]>;
  actionTo: string;
  actionSearch?: { tab: "images" };
  actionLabel: string;
}) {
  return (
    <Card className="border-border/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Icon className="size-4" />
            {title}
          </span>
          <StatusDot tone={tone} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium tabular-nums">{value}</span>
            </div>
          ))}
        </div>
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to={actionTo} search={actionSearch}>
            {actionLabel}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function StatusDot({ tone }: { tone: StatusTone }) {
  return <span className={cn("size-2.5 shrink-0 rounded-full", STATUS_DOT_CLASSES[tone])} />;
}
