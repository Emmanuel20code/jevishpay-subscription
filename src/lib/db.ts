import pkg from "pg";
const { Pool } = pkg;

let pool: pkg.Pool | null = null;

// The deployed app runs on a Cloudflare Worker, whose TLS stack cannot be told to
// accept Supabase's self-signed certificate chain (`rejectUnauthorized: false` is a
// no-op there). Every query then dies with "Connection terminated unexpectedly",
// which is what turned the deployed site into a blank screen. Detect the Worker
// runtime and connect without pg's TLS negotiation there.
function isWorkerRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

function sslConfig(connectionString: string) {
  if (connectionString.includes("localhost") || /\bsslmode=disable\b/.test(connectionString)) {
    return false;
  }
  if (isWorkerRuntime()) return false;
  return { rejectUnauthorized: false };
}

export function getDb() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is missing");
    }
    pool = new Pool({
      connectionString,
      ssl: sslConfig(connectionString),
      max: isWorkerRuntime() ? 2 : 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
    pool.on("error", (err) => {
      console.error("[db] idle client error", err);
    });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const client = getDb();
  const res = await client.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
