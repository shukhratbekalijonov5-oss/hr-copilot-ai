import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/api/session";

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    return NextResponse.json(await api.markNotificationRead(id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status || 500 : 500;
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not mark notification read." },
      { status },
    );
  }
}
