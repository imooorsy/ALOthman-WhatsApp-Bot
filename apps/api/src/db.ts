import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
function databaseAddress(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    throw new Error("Invalid database connection configuration");
  }
}
@Injectable()
export class Db extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const raw = process.env.DATABASE_URL;
    const url = databaseAddress(raw);
    if (url && !url.searchParams.has("connection_limit"))
      url.searchParams.set("connection_limit", "20");
    if (url && !url.searchParams.has("pool_timeout"))
      url.searchParams.set("pool_timeout", "30");
    super(url ? { datasourceUrl: url.toString() } : undefined);
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
