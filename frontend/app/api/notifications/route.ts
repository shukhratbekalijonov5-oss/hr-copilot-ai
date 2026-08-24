import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { notificationFailure } from "@/lib/notifications/route-errors";
import { getSessionToken } from "@/lib/api/session";
import type { NotificationQuery, NotificationType } from "@/lib/types";

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const query: NotificationQuery = {
    page: parsePositiveInt(url.searchParams.get("page"), 1),
    limit: parsePositiveInt(url.searchParams.get("limit"), 20),
    unreadOnly: url.searchParams.get("unreadOnly") === "true",
  };
  const type = url.searchParams.get("type");
  if (type) query.type = type as NotificationType;

  try {
    return NextResponse.json(await api.getNotifications(query), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const failure = notificationFailure(error, "Could not load notifications.");
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
