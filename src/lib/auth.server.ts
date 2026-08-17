import crypto from "crypto";
import { query, queryOne } from "./db";

export function hashPassword(password: string): string {
  const salt = "jevishpay_secure_salt_2026";
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export async function signUpUser({
  email,
  password,
  businessName,
}: {
  email: string;
  password: string;
  businessName?: string;
}) {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM auth.users WHERE LOWER(email) = LOWER($1)`,
    [normalizedEmail],
  );
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const userId = crypto.randomUUID();
  const passwordHash = hashPassword(password);

  // Insert into auth.users schema
  await query(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at)
     VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3, '{}', $4, false, now(), now())`,
    [userId, normalizedEmail, passwordHash, JSON.stringify({ business_name: businessName || "" })],
  );

  // Insert into public.profiles
  await query(
    `INSERT INTO public.profiles (id, email, business_name, created_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, business_name = EXCLUDED.business_name`,
    [userId, normalizedEmail, businessName || null],
  );

  const token = `${userId}_${crypto.randomBytes(32).toString("hex")}`;
  await query(`INSERT INTO public.user_sessions (user_id, token) VALUES ($1, $2)`, [userId, token]);

  return { token, user: { id: userId, email: normalizedEmail } };
}

export async function signInUser({ email, password }: { email: string; password: string }) {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await queryOne<{ id: string; email: string; encrypted_password: string }>(
    `SELECT id, email, encrypted_password FROM auth.users WHERE LOWER(email) = LOWER($1)`,
    [normalizedEmail],
  );

  if (!user) {
    throw new Error("Invalid email or password");
  }

  const hash = hashPassword(password);
  if (user.encrypted_password !== hash) {
    throw new Error("Invalid email or password");
  }

  const token = `${user.id}_${crypto.randomBytes(32).toString("hex")}`;
  await query(`INSERT INTO public.user_sessions (user_id, token) VALUES ($1, $2)`, [
    user.id,
    token,
  ]);

  return { token, user: { id: user.id, email: user.email } };
}

export async function verifySession(token: string) {
  if (!token) return null;

  const session = await queryOne<{ user_id: string; email: string }>(
    `SELECT s.user_id, u.email 
     FROM public.user_sessions s
     JOIN auth.users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );

  if (!session) return null;

  const adminRole = await queryOne<{ id: string }>(
    `SELECT id FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`,
    [session.user_id],
  );

  return {
    userId: session.user_id,
    email: session.email,
    isAdmin: Boolean(adminRole),
  };
}
