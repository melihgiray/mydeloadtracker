// Server-side Supabase client (Server Components, Route Handlers, Server
// Actions). Reads/writes the auth cookies via the Next.js cookie store.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export function createClient() {
  // Next 15+ made cookies() async. Awaiting it inside the (async-capable)
  // cookie callbacks keeps createClient() synchronous, so no caller changes.
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          const cookieStore = await cookies();
          return cookieStore.getAll();
        },
        async setAll(cookiesToSet: CookieToSet[]) {
          try {
            const cookieStore = await cookies();
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component. This can
            // be ignored when middleware is refreshing sessions.
          }
        },
      },
    },
  );
}
