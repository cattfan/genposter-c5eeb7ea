import { Module } from "@nestjs/common";
import { TablesModule } from "./tables/tables.module";
import { BlobsModule } from "./blobs/blobs.module";
import { RealtimeModule } from "./realtime/realtime.module";

@Module({
  imports: [TablesModule, BlobsModule, RealtimeModule],
})
export class AppModule {}
