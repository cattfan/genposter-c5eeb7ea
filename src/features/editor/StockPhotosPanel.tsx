// Stock Photos Panel — search + insert ảnh từ Unsplash ngay trong editor.
//
// Dùng Unsplash API (free tier 50 req/hour). User cần nhập API key trong
// Settings. Panel hiển thị grid thumbnails, click để insert vào canvas.
//
// Nếu chưa có API key, hiện hướng dẫn đăng ký.

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface UnsplashPhoto {
  id: string;
  urls: { small: string; regular: string; full: string };
  alt_description: string | null;
  user: { name: string; links: { html: string } };
  width: number;
  height: number;
}

interface StockPhotosPanelProps {
  /** API key Unsplash (từ Settings). Nếu rỗng, hiện hướng dẫn. */
  apiKey?: string;
  /** Callback khi user chọn ảnh. Trả về URL full-res để caller download + insert. */
  onInsert: (photo: { url: string; width: number; height: number; attribution: string }) => void;
}

const UNSPLASH_API = "https://api.unsplash.com";

export function StockPhotosPanel({ apiKey, onInsert }: StockPhotosPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnsplashPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [inserting, setInserting] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (searchQuery: string, searchPage = 1) => {
      if (!apiKey) {
        toast.error("Chưa có Unsplash API key. Vào Cài đặt để nhập.");
        return;
      }
      if (!searchQuery.trim()) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const params = new URLSearchParams({
          query: searchQuery.trim(),
          page: String(searchPage),
          per_page: "20",
          orientation: "portrait",
        });
        const res = await fetch(`${UNSPLASH_API}/search/photos?${params}`, {
          headers: { Authorization: `Client-ID ${apiKey}` },
          signal: controller.signal,
        });
        if (!res.ok) {
          if (res.status === 401) toast.error("Unsplash API key không hợp lệ.");
          else if (res.status === 403) toast.error("Unsplash rate limit. Thử lại sau.");
          else toast.error(`Unsplash lỗi ${res.status}`);
          return;
        }
        const data = (await res.json()) as {
          results: UnsplashPhoto[];
          total_pages: number;
        };
        if (searchPage === 1) {
          setResults(data.results);
        } else {
          setResults((prev) => [...prev, ...data.results]);
        }
        setPage(searchPage);
        setTotalPages(data.total_pages);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          toast.error("Lỗi tìm ảnh: " + (err instanceof Error ? err.message : String(err)));
        }
      } finally {
        setLoading(false);
      }
    },
    [apiKey],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void search(query, 1);
  };

  const handleInsert = async (photo: UnsplashPhoto) => {
    setInserting(photo.id);
    try {
      // Trigger Unsplash download endpoint (required by API guidelines)
      if (apiKey) {
        fetch(`${UNSPLASH_API}/photos/${photo.id}/download`, {
          headers: { Authorization: `Client-ID ${apiKey}` },
        }).catch(() => {});
      }
      onInsert({
        url: photo.urls.regular,
        width: photo.width,
        height: photo.height,
        attribution: `Photo by ${photo.user.name} on Unsplash`,
      });
      toast.success("Đã thêm ảnh vào canvas");
    } finally {
      setInserting(null);
    }
  };

  if (!apiKey) {
    return (
      <div className="space-y-3 p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Ảnh stock (Unsplash)</p>
        <p>
          Để tìm ảnh miễn phí từ Unsplash, bạn cần API key:
        </p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>Vào <a href="https://unsplash.com/developers" target="_blank" rel="noopener" className="underline">unsplash.com/developers</a></li>
          <li>Tạo app mới (miễn phí, 50 req/giờ)</li>
          <li>Copy "Access Key"</li>
          <li>Dán vào Cài đặt → Unsplash API Key</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <form onSubmit={handleSubmit} className="flex gap-1.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm ảnh... (vd: dalat, cafe, nature)"
          className="h-8 text-xs"
        />
        <Button type="submit" size="sm" className="h-8 shrink-0" disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
        </Button>
      </form>

      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {results.map((photo) => (
            <button
              key={photo.id}
              type="button"
              className="group relative overflow-hidden rounded-md border transition-all hover:ring-2 hover:ring-primary"
              onClick={() => void handleInsert(photo)}
              disabled={inserting === photo.id}
            >
              <img
                src={photo.urls.small}
                alt={photo.alt_description ?? "Stock photo"}
                className="aspect-[3/4] w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                {inserting === photo.id ? (
                  <Loader2 className="size-5 animate-spin text-white" />
                ) : (
                  <ImagePlus className="size-5 text-white" />
                )}
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="text-[9px] text-white/80 truncate block">
                  {photo.user.name}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {results.length > 0 && page < totalPages && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => void search(query, page + 1)}
          disabled={loading}
        >
          {loading ? <Loader2 className="mr-2 size-3 animate-spin" /> : null}
          Tải thêm
        </Button>
      )}

      {results.length === 0 && !loading && query && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Không tìm thấy ảnh cho "{query}"
        </p>
      )}
    </div>
  );
}
