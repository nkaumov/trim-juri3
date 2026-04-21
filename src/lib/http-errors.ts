import { NextResponse } from "next/server";

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && error.message === "UNAUTHORIZED";
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
}

