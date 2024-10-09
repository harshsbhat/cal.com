import type { Prisma } from "@prisma/client";
import { PrismaClient as PrismaClientWithoutExtension } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { withOptimize } from "@prisma/extension-optimize";

import { bookingIdempotencyKeyExtension } from "./extensions/booking-idempotency-key";
import { disallowUndefinedDeleteUpdateManyExtension } from "./extensions/disallow-undefined-delete-update-many";
import { excludePendingPaymentsExtension } from "./extensions/exclude-pending-payment-teams";
import { usageTrackingExtention } from "./extensions/usage-tracking";
import { bookingReferenceMiddleware } from "./middleware";

const prismaOptions: Prisma.PrismaClientOptions = {};

const globalForPrisma = global as unknown as {
  prismaWithoutClientExtensions: PrismaClientWithoutExtension;
  prismaWithClientExtensions: PrismaClientWithExtensions;
};

const loggerLevel = parseInt(process.env.NEXT_PUBLIC_LOGGER_LEVEL ?? "", 10);

if (!isNaN(loggerLevel)) {
  switch (loggerLevel) {
    case 5:
    case 6:
      prismaOptions.log = ["error"];
      break;
    case 4:
      prismaOptions.log = ["warn", "error"];
      break;
    case 3:
      prismaOptions.log = ["info", "error", "warn"];
      break;
    default:
      // For values 0, 1, 2 (or anything else below 3)
      prismaOptions.log = ["query", "info", "error", "warn"];
      break;
  }
}

// Prevents flooding with idle connections
const prismaWithoutClientExtensions =
  globalForPrisma.prismaWithoutClientExtensions || new PrismaClientWithoutExtension(prismaOptions);

export const customPrisma = (options?: Prisma.PrismaClientOptions) => buildCustomPrisma(options);

const buildCustomPrisma = (options) => {
  let client = new PrismaClientWithoutExtension({ ...prismaOptions, ...options })
    .$extends(usageTrackingExtention())
    .$extends(excludePendingPaymentsExtension())
    .$extends(bookingIdempotencyKeyExtension())
    .$extends(disallowUndefinedDeleteUpdateManyExtension());

  if (!!process.env.PRISMA_OPTIMIZE_API_KEY) {
    client = client.$extends(withOptimize({ apiKey: process.env.PRISMA_OPTIMIZE_API_KEY }));
  }

  // INFO: withAccelerate has to come after withOptimize
  client = client.$extends(withAccelerate());

  return client;
};

// If any changed on middleware server restart is required
// TODO: Migrate it to $extends
bookingReferenceMiddleware(prismaWithoutClientExtensions);

// FIXME: Due to some reason, there are types failing in certain places due to the $extends. Fix it and then enable it
// Specifically we get errors like `Type 'string | Date | null | undefined' is not assignable to type 'Exact<string | Date | null | undefined, string | Date | null | undefined>'`
let prismaWithClientExtensions = prismaWithoutClientExtensions
  .$extends(usageTrackingExtention())
  .$extends(excludePendingPaymentsExtension())
  .$extends(bookingIdempotencyKeyExtension())
  .$extends(disallowUndefinedDeleteUpdateManyExtension());

if (!!process.env.PRISMA_OPTIMIZE_API_KEY) {
  prismaWithClientExtensions = prismaWithClientExtensions.$extends(
    withOptimize({ apiKey: process.env.PRISMA_OPTIMIZE_API_KEY })
  );
}

// INFO: withAccelerate has to come after withOptimize
prismaWithClientExtensions = prismaWithClientExtensions.$extends(withAccelerate());

export const prisma = globalForPrisma.prismaWithClientExtensions || prismaWithClientExtensions;

// This prisma instance is meant to be used only for READ operations.
// If self hosting, feel free to leave INSIGHTS_DATABASE_URL as empty and `readonlyPrisma` will default to `prisma`.
export const readonlyPrisma = process.env.INSIGHTS_DATABASE_URL
  ? customPrisma({
      datasources: { db: { url: process.env.INSIGHTS_DATABASE_URL } },
    })
  : prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaWithoutClientExtensions = prismaWithoutClientExtensions;
  globalForPrisma.prismaWithClientExtensions = prisma;
}

type PrismaClientWithExtensions = typeof prismaWithClientExtensions;
export type PrismaClient = PrismaClientWithExtensions;
export default prisma;

export * from "./selects";
