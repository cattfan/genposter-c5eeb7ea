import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useJobStore } from "@/features/generate/jobStore";
import { toast } from "sonner";
import { History } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { EmptyState, SkeletonList } from "@/components/ux";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const jobs = useLiveQuery(() => db.jobs.orderBy("createdAt").reverse().toArray(), []);
  const { setJob } = useJobStore();

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        icon={<History className="size-5" />}
        title="Lịch sử Job"
        description="Các lần export gần đây. Có thể mở lại để tiếp tục chỉnh sửa."
      />
      {jobs === undefined && <SkeletonList count={3} height="h-20" />}
      {jobs && jobs.length === 0 && (
        <EmptyState
          icon={<History />}
          title="Chưa có lịch sử job"
          description="Mỗi lần bạn xuất ZIP, job sẽ được lưu ở đây để mở lại và chỉnh sửa."
        />
      )}
      <div className="space-y-2">
        {jobs?.map((j) => (
          <Card key={j.jobId} className="border-border/70 transition-shadow hover:shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{j.packTemplateName}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(j.createdAt).toLocaleString("vi-VN")} · {j.pages.length} page ·{" "}
                  {j.pages.filter((p) => p.selected).length} chọn ·{" "}
                  {j.pages.flatMap((p) => p.items).filter((i) => i.partnerFlag).length} lần đối tác
                  xuất hiện
                </div>
              </div>
              <Badge variant="secondary">{j.status}</Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setJob(j);
                  toast.success("Đã load job vào màn Tạo nội dung");
                }}
              >
                Mở lại
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!confirm("Xóa job này?")) return;
                  await db.jobs.delete(j.jobId);
                }}
              >
                Xóa
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
