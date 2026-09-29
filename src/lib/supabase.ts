import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    "[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — DB calls will fail."
  );
}

// Server-side only — never expose service role key to the browser
export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseServiceKey ?? "placeholder"
);

/**
 * Supabase (PostgREST) silently caps every select at the project's
 * "Max rows" setting (1000 by default) — `.limit()` cannot raise it.
 * This helper pages through the result with `.range()` until exhausted.
 *
 * `build` must return a fresh query each call (including any .order()),
 * and the ordering must be deterministic so pages don't overlap.
 */
const PAGE_SIZE = 1000;

interface RangeableQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

export async function fetchAllRows<T>(build: () => RangeableQuery<T>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Advance by the rows actually returned: if the project's max-rows setting is
  // lower than PAGE_SIZE we still walk every page instead of stopping early.
  for (;;) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;
    all.push(...rows);
    from += rows.length;
  }
  return all;
}
