import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { getDb } from "./database/sqlite";

async function bootstrap() {
  // Init DB sớm để fail fast nếu schema sai trước khi listen.
  getDb();
  const app = await NestFactory.create(AppModule, { cors: true });
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true }));

  const config = new DocumentBuilder()
    .setTitle("GenPoster Backend")
    .setVersion("0.1.0")
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, doc);

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Swagger UI: http://localhost:${port}/api/docs`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start backend:", err);
  process.exit(1);
});
