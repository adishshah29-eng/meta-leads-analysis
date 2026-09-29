/**
 * Next.js Proxy — password-gate the dashboard AND the API.
 *
 * - DASHBOARD_PASSWORD unset → everything is open (local dev only).
 * - /dashboard/*  → valid session cookie, else redirect to /login.
 * - /api/*        → valid session cookie OR `Authorization: Bearer <CRON_SECRET>`
 *                   (Vercel Cron sends this header automatically when CRON_SECRET
 *                   is set), else 401. /api/auth/login is always reachable.
 */

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  const cronSecret = process.env.CRON_SECRET;
  const { pathname } = req.nextUrl;

  if (pathname === "/api/auth/login") return NextResponse.next();

  const isApi = pathname.startsWith("/api/");

  if (isApi && cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (safeEqual(auth, `Bearer ${cronSecret}`)) return NextResponse.next();
  }

  // No password set = open access (dev mode)
  if (!password) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && safeEqual(cookie, await sessionToken(password))) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("from", pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
