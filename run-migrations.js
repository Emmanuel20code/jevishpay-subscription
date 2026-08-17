import fs from "fs";
import path from "path";
import pkg from "pg";
const { Client } = pkg;

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("No DATABASE_URL found in environment variables.");
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("Connected to the database. Wiping old schema items for this app...");

    // Drop all custom items created by the app to start fresh
    await client.query(`
      DROP TABLE IF EXISTS public.subscriptions CASCADE;
      DROP TABLE IF EXISTS public.platform_credentials CASCADE;
      DROP TABLE IF EXISTS public.user_roles CASCADE;
      DROP TABLE IF EXISTS public.transactions CASCADE;
      DROP TABLE IF EXISTS public.api_keys CASCADE;
      DROP TABLE IF EXISTS public.merchant_settings CASCADE;
      DROP TABLE IF EXISTS public.profiles CASCADE;
      
      DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
      DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;
      DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
      
      DROP TYPE IF EXISTS public.app_role CASCADE;
    `);

    console.log("Old schema wiped. Running migrations...");

    const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      console.log(`Running migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf8");
      await client.query(sql);
      console.log(`Successfully applied ${file}`);
    }

    console.log("All migrations applied successfully.");
  } catch (error) {
    console.error("Error running migrations:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
