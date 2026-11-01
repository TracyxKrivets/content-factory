import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { LOCAL_USER } from "./util";

/** Accounts are on when Supabase URL + anon key + service key are all set. */
export const authEnabled = () =>
  !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);

export class AuthError extends Error {
  status = 401;
  constructor() {
    super("Please log in again.");
  }
}

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* called from a context that can't set cookies; middleware refreshes them */
        }
      },
    },
  });
}

/** The signed-in user's id (or the single local user when accounts are off). */
export async function currentUser(): Promise<{ id: string; email: string | null }> {
  if (!authEnabled()) return { id: LOCAL_USER, email: null };
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new AuthError();
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Throws "not found" unless the row belongs to the user (don't reveal other users' ids). */
export function own<T extends { userId: string } | null>(row: T, userId: string): NonNullable<T> {
  if (!row || row.userId !== userId) throw new Error("Not found");
  return row as NonNullable<T>;
}
