import { getAuth } from "../../../../server/auth/better-auth";

// Better Auth's endpoints (FR-201). proxy.ts answers 404 for /api/auth/* on every host except the
// admin origin. The auth instance is created on the first request, so builds need no auth secrets.

export async function GET(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export async function POST(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
