import { NextResponse } from "next/server";
import { getServerSession } from "../../../src/infrastructure/auth/session";

/** ログイン中ユーザー情報 (S1等のUIがロール表示に使う) */
export async function GET() {
  const user = await getServerSession();
  return NextResponse.json({ user });
}
