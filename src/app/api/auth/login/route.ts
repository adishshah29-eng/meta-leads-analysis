/**
 * POST /api/auth/login
 *
 * Validates the dashboard password and sets an HTTP-only session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const correctPassword = process.env.DASHBOARD_PASSWORD;

  if (!correctPassword || typeof password !== "string" || !safeEqual(password, correctPassword)) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(AUTH_COOKIE, await sessionToken(correctPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}
