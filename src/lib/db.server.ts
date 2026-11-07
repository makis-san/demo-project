import { PrismaPg } from "@prisma/adapter-pg";
import { configService } from "./config.server";
import { PrismaClient } from "../../prisma/generated/client/client";

let _prismaClient: PrismaClient | null = null;

export const getServerSidePrismaClient = async () => {
  if (typeof window !== "undefined") {
    throw new Error("getServerSidePrismaClient should only be called on the server");
  }
  if (!_prismaClient) {
    const adapter = new PrismaPg({ connectionString: configService.getAppConfig().database.url });
    _prismaClient = new PrismaClient({ adapter });
  }
  return _prismaClient;
};

/** True for Prisma's P2002 error: a unique constraint or unique index was violated. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
