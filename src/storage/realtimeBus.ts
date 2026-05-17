// Bus chuyển sự kiện cross-tab (cùng origin localhost:9090).
//
// Nếu user mở Chrome 2 tab → BroadcastChannel sync giữa 2 tab. Tuy nhiên
// Chrome ↔ Edge KHÔNG share BroadcastChannel (khác browser process). Để cover
// case đó: refetchOnWindowFocus của React Query + staleTime 0 sẽ đảm bảo khi
// user click vào tab Edge, dữ liệu được refetch ngay.
//
// Khi install được `socket.io-client`, swap sang WebSocket cho realtime push
// đầy đủ giữa các browser khác nhau. File này chỉ thay đổi 1 chỗ.

const CHANNEL_NAME = "genposter-data";

class RealtimeBus extends EventTarget {
  private channel: BroadcastChannel | null = null;
  private subscriberCount = 0;

  on(handler: (table: string) => void): () => void {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ table: string }>).detail;
      handler(detail.table);
    };
    this.addEventListener("change", listener);
    this.subscriberCount += 1;
    this.ensureConnected();
    return () => {
      this.removeEventListener("change", listener);
      this.subscriberCount -= 1;
      if (this.subscriberCount <= 0) this.disconnect();
    };
  }

  /** Phát sự kiện ra mọi tab trong cùng browser (cross-tab same-origin). */
  emitLocal(table: string) {
    this.dispatchEvent(new CustomEvent("change", { detail: { table } }));
    this.channel?.postMessage({ table });
  }

  private ensureConnected() {
    if (this.channel || typeof window === "undefined") return;
    if (typeof BroadcastChannel === "undefined") return; // Safari old version
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (event) => {
      const data = event.data as { table?: string };
      if (data?.table) {
        this.dispatchEvent(new CustomEvent("change", { detail: { table: data.table } }));
      }
    };
  }

  private disconnect() {
    this.channel?.close();
    this.channel = null;
  }
}

export const realtimeBus = new RealtimeBus();
