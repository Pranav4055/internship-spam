import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: positiveInteger(process.env.PORT, 3000),
  trustProxyHops: nonNegativeInteger(process.env.TRUST_PROXY_HOPS, 0),
  mongoUri: process.env.MONGODB_URI ?? '',
  mongoSeedUri: process.env.MONGODB_SEED_URI ?? '',
  mongoDbName: process.env.MONGODB_DB_NAME ?? 'internshield',
});
