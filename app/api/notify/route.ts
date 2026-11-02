import { broadcast, registrationNotice, resendCode, statusNotice, verifyEmail } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return Response.json({ ok: false, error: "Invalid request." }, { status: 400 }); }
  const result =
    body.action === "registration" ? await registrationNotice(body)
    : body.action === "verify" ? await verifyEmail(body)
    : body.action === "resend" ? await resendCode(body)
    : body.action === "status" ? await statusNotice(request, body)
    : body.action === "broadcast" ? await broadcast(request, body)
    : { status: 400, body: { ok: false, error: "Unknown action." } };
  return Response.json(result.body, { status: result.status });
}
