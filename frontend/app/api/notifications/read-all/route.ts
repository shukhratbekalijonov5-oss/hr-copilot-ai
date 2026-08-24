import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { notificationFailure } from "@/lib/notifications/route-errors";
import { getSessionToken } from "@/lib/api/session";

export async function POST(): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  try {
    return NextResponse.json(await api.markAllNotificationsRead(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const failure = notificationFailure(error, "Could not mark notifications read.");
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
