import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { SafeExceptionFilter } from "./errors";
async function main() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters");
  const origins = (process.env.WEB_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim());
  if (process.env.NODE_ENV === "production") {
    if (
      !process.env.COOKIE_DOMAIN ||
      origins.some((s) => !s.startsWith("https://"))
    )
      throw new Error(
        "Production requires COOKIE_DOMAIN and HTTPS WEB_ORIGINS",
      );
    if (process.env.JWT_SECRET.includes("replace-with"))
      throw new Error("Replace the example JWT_SECRET");
  }
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.useGlobalFilters(new SafeExceptionFilter());
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: origins, credentials: true });
  app.use(
    (
      req: import("express").Request,
      res: import("express").Response,
      next: import("express").NextFunction,
    ) => {
      if (
        process.env.NODE_ENV === "production" &&
        !req.secure &&
        req.path !== "/health"
      )
        return res.status(403).json({ message: "يلزم اتصال آمن" });
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
        !/^\/webhooks\/(whatsapp|evolution)\/?$/.test(req.path) &&
        !origins.includes(req.get("origin") || "")
      )
        return res.status(403).json({ message: "مصدر الطلب غير مسموح" });
      next();
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(Number(process.env.PORT || 4000), "0.0.0.0");
}
void main();
