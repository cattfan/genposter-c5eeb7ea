// Realtime Gateway: phát sóng table-update qua WebSocket khi data thay đổi
// để các browser khác (Chrome/Edge/Firefox cùng máy) tự refresh React Query
// cache mà không cần polling.

import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Injectable } from "@nestjs/common";
import type { Server } from "socket.io";

@Injectable()
@WebSocketGateway({
  path: "/ws",
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway {
  @WebSocketServer()
  server!: Server;

  /**
   * Broadcast event 'table-update' với payload `{ table: string }`.
   * Frontend listen event này để invalidate `useQuery([table])`.
   */
  broadcastTableUpdate(table: string): void {
    this.server?.emit("table-update", { table, at: Date.now() });
  }

  /**
   * Broadcast event 'ai-job' khi AI job hoàn tất hoặc fail.
   */
  broadcastAiJob(jobId: string, status: "done" | "error", payload?: unknown): void {
    this.server?.emit("ai-job", { jobId, status, payload, at: Date.now() });
  }
}
