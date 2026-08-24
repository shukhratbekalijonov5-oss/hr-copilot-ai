import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { notificationFailure } from "@/lib/notifications/route-errors";
import { getSessionToken } from "@/lib/api/session";

export async function GET(): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  try {
    return NextResponse.json(
      { unread: await api.getUnreadNotificationCount() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const failure = notificationFailure(error, "Could not load notifications.");
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
