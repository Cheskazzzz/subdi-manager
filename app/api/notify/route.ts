// One endpoint for every notification action. The real work (and every secret) lives in lib/server.ts.
//   registration  public  right after registering: email the verification code / text a confirmation
//   verify        public  check the 6-digit email code
//   resend        public  send a new email code
//   status        admin   tell a resident their registration was approved or denied
//   broadcast     admin   send an announcement or event by email and/or SMS
//   report_filed  signed-in resident  confirm a new report and alert the admins
//   report_update admin   tell the resident their report changed or was answered
//   staff_create  super admin  create a staff account; the system emails the temporary password
//   staff_reset   super admin  reset a staff password; the system emails the new temporary password
import { broadcast, registrationNotice, reportFiled, reportUpdated, resendCode, staffCreate, staffReset, statusNotice, verifyEmail } from "@/lib/server";

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
    : body.action === "report_filed" ? await reportFiled(request, body)
    : body.action === "report_update" ? await reportUpdated(request, body)
    : body.action === "staff_create" ? await staffCreate(request, body)
    : body.action === "staff_reset" ? await staffReset(request, body)
    : { status: 400, body: { ok: false, error: "Unknown action." } };
  return Response.json(result.body, { status: result.status });
}
