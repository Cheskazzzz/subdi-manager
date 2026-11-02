// Server-only code for notifications (never import this from a component).
// It sends email and SMS through the Brevo API and talks to Supabase with the service key,
// so every secret below stays on the server and is never sent to the browser.
//
// Environment variables (set them in Vercel -> Project -> Settings -> Environment Variables):
//   BREVO_API_KEY               Brevo API key (v3)
//   BREVO_SENDER_EMAIL          a sender address verified in Brevo
//   BREVO_SENDER_NAME           optional, defaults to "Isabel Village"
//   BREVO_SMS_SENDER            SMS sender name, up to 11 letters/numbers (needed for text messages)
//   SUPABASE_SERVICE_ROLE_KEY   Supabase service_role key (secret)
//   NOTIFY_SMS_ALWAYS           optional, "true" = also text residents who registered with an email
//   NEXT_PUBLIC_SITE_URL        optional, the website address used in links
// NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are already set for the site.

import { createHmac, randomInt, timingSafeEqual } from "crypto";

const BREVO = "https://api.brevo.com/v3";
const PHONE_ONLY_DOMAIN = "phone.isabelvillage.invalid";
const CODE_MINUTES = 30;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const MAX_CODES_PER_HOUR = 5;
const FRESH_REGISTRATION_MINUTES = 30;

export type Reply = { status: number; body: Record<string, unknown> };
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });

function config() {
  return {
    brevoKey: process.env.BREVO_API_KEY || "",
    senderEmail: process.env.BREVO_SENDER_EMAIL || "",
    senderName: process.env.BREVO_SENDER_NAME || "Isabel Village",
    smsSender: process.env.BREVO_SMS_SENDER || "",
    smsAlways: process.env.NOTIFY_SMS_ALWAYS === "true",
    supabaseUrl: (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, ""),
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, ""),
  };
}
const serverReady = () => { const c = config(); return !!(c.supabaseUrl && c.serviceKey); };

// ---------------------------------------------------------------- Brevo ---

type Sent = { ok: true } | { ok: false; error: string };

async function brevo(path: string, body: unknown): Promise<{ status: number; data: { message?: string } | null }> {
  const response = await fetch(`${BREVO}${path}`, {
    method: "POST",
    headers: { "api-key": config().brevoKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let data: { message?: string } | null = null;
  try { data = await response.json(); } catch { /* empty body */ }
  return { status: response.status, data };
}

function brevoError(status: number, data: { message?: string } | null) {
  if (status === 401) return "Brevo rejected the API key. Check BREVO_API_KEY.";
  if (status === 402) return "Brevo has no SMS credits left.";
  return data?.message ? `Brevo: ${data.message}` : `Brevo returned status ${status}.`;
}

export async function sendEmail(to: { email: string; name?: string }, subject: string, html: string, text: string): Promise<Sent> {
  const c = config();
  if (!c.brevoKey || !c.senderEmail) return { ok: false, error: "Email is not set up yet (BREVO_API_KEY or BREVO_SENDER_EMAIL is missing)." };
  try {
    const { status, data } = await brevo("/smtp/email", {
      sender: { name: c.senderName, email: c.senderEmail },
      to: [{ email: to.email, ...(to.name ? { name: to.name } : {}) }],
      subject, htmlContent: html, textContent: text,
    });
    return status >= 200 && status < 300 ? { ok: true } : { ok: false, error: brevoError(status, data) };
  } catch { return { ok: false, error: "Could not reach Brevo." }; }
}

// Brevo wants the country code without a plus sign: 09171234567 and +639171234567 both become 639171234567.
export function smsNumber(phone: string): string | null {
  const value = phone.replace(/[\s()-]/g, "");
  if (/^09\d{9}$/.test(value)) return `63${value.slice(1)}`;
  if (/^\+639\d{9}$/.test(value)) return value.slice(1);
  return null;
}

// Plain characters keep a message in one SMS (curly quotes, dashes and accents would make it cost more).
const smsSafe = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`);

export async function sendSms(phone: string, content: string): Promise<Sent> {
  const c = config();
  if (!c.brevoKey || !c.smsSender) return { ok: false, error: "Text messages are not set up yet (BREVO_SMS_SENDER is missing)." };
  const recipient = smsNumber(phone);
  if (!recipient) return { ok: false, error: "That is not a valid Philippine mobile number." };
  const body = { sender: c.smsSender, recipient, content: clip(smsSafe(content), 306), type: "transactional" };
  try {
    let result = await brevo("/transactionalSMS/send", body);
    if (result.status === 404 || result.status === 405) result = await brevo("/transactionalSMS/sms", body); // older path
    return result.status >= 200 && result.status < 300 ? { ok: true } : { ok: false, error: brevoError(result.status, result.data) };
  } catch { return { ok: false, error: "Could not reach Brevo." }; }
}

// ------------------------------------------------------------- Supabase ---

async function rest(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const c = config();
  const response = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, {
    method: init.method || "GET",
    // The older service_role key is a JWT and is also sent as a bearer token. The newer sb_secret_ keys are not JWTs and go in the apikey header only.
    headers: { apikey: c.serviceKey, ...(c.serviceKey.startsWith("eyJ") ? { authorization: `Bearer ${c.serviceKey}` } : {}), "content-type": "application/json", ...(init.prefer ? { prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  let data: any = null;
  try { data = await response.json(); } catch { /* empty body */ }
  return { ok: response.ok, status: response.status, data };
}

type Resident = { id: string; first_name: string; last_name: string; email: string; phone: string | null; status: string; created_at: string; email_verified_at: string | null; denial_reason: string | null };
const RESIDENT_COLUMNS = "id,first_name,last_name,email,phone,status,created_at,email_verified_at,denial_reason";

async function residentByEmail(email: string): Promise<Resident | null> {
  const result = await rest(`homeowners?email=eq.${encodeURIComponent(email)}&select=${RESIDENT_COLUMNS}&limit=1`);
  return result.ok && Array.isArray(result.data) && result.data[0] ? (result.data[0] as Resident) : null;
}
async function residentById(id: string): Promise<Resident | null> {
  const result = await rest(`homeowners?id=eq.${encodeURIComponent(id)}&select=${RESIDENT_COLUMNS}&limit=1`);
  return result.ok && Array.isArray(result.data) && result.data[0] ? (result.data[0] as Resident) : null;
}
async function writeLog(homeownerId: string | null, kind: string, channel: string, ok: boolean, detail = "") {
  await rest("notification_log", { method: "POST", body: { homeowner_id: homeownerId, kind, channel, ok, detail: detail.slice(0, 300) }, prefer: "return=minimal" });
}

// Only a signed-in admin may trigger approval messages and broadcasts.
async function requireAdmin(request: Request): Promise<Reply | null> {
  const c = config();
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply(401, { ok: false, error: "Please sign in again." });
  let userId = "";
  try {
    const response = await fetch(`${c.supabaseUrl}/auth/v1/user`, { headers: { apikey: c.anonKey, authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) return reply(401, { ok: false, error: "Please sign in again." });
    userId = String(((await response.json()) as { id?: string }).id || "");
  } catch { return reply(401, { ok: false, error: "Please sign in again." }); }
  const profile = await rest(`profiles?id=eq.${encodeURIComponent(userId)}&select=role&limit=1`);
  if (!profile.ok || profile.data?.[0]?.role !== "admin") return reply(403, { ok: false, error: "Only an administrator can do this." });
  return null;
}

// -------------------------------------------------------------- helpers ---

const isPlaceholder = (email: string) => email.toLowerCase().endsWith(`@${PHONE_ONLY_DOMAIN}`);
const placeholderFor = (phone: string) => `phone-${phone.replace(/\D/g, "").slice(-10)}@${PHONE_ONLY_DOMAIN}`;
const fullName = (r: Resident) => `${r.first_name} ${r.last_name}`.trim();
const hashCode = (residentId: string, code: string) => createHmac("sha256", config().serviceKey).update(`${residentId}:${code}`).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(work));
}

// ------------------------------------------------------------ messages ---

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const prettyDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return y && m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : iso; };
const prettyTime = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return Number.isFinite(h) ? `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}` : hhmm; };

function page(heading: string, paragraphs: string[], extra = "") {
  const body = paragraphs.map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">${p}</p>`).join("");
  return `<div style="background:#f1f5f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden"><div style="background:#123d2a;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">Isabel Village</div><div style="padding:24px"><h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${esc(heading)}</h1>${body}${extra}</div><div style="padding:14px 24px;background:#f8fafc;color:#94a3b8;font-size:12px">Sent by the Isabel Village homeowners' association system. Please do not reply to this email.</div></div></div>`;
}
const codeBox = (code: string) => `<div style="margin:6px 0 18px;padding:14px;text-align:center;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;font-size:30px;letter-spacing:8px;font-weight:bold;color:#065f46">${esc(code)}</div>`;
const button = (label: string, url: string) => (url ? `<p style="margin:18px 0 0"><a href="${esc(url)}" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;font-size:14px">${esc(label)}</a></p>` : "");

export const messages = {
  registrationWithCode: (first: string, code: string) => ({
    subject: "Welcome to Isabel Village - please verify your email",
    html: page("We received your registration", [`Hi ${esc(first)},`, "Thank you for registering with Isabel Village. To finish setting up your account, verify your email address with this code:"], codeBox(code) + `<p style="margin:0 0 14px;font-size:14px;color:#475569">The code works for ${CODE_MINUTES} minutes. On the website, choose <b>Verify email</b> and enter it. After that, the association office will review your application and we will email you again once it is approved.</p><p style="margin:0;font-size:13px;color:#94a3b8">If you did not register, you can ignore this email.</p>`),
    text: `Hi ${first},\n\nThank you for registering with Isabel Village. Your email verification code is ${code}. It works for ${CODE_MINUTES} minutes. On the website choose "Verify email" and enter it. After that the association office will review your application and we will email you again once it is approved.\n\nIf you did not register, ignore this email.`,
  }),
  newCode: (first: string, code: string) => ({
    subject: "Your Isabel Village verification code",
    html: page("Your new verification code", [`Hi ${esc(first)},`, "Use this code to verify your email address:"], codeBox(code) + `<p style="margin:0;font-size:14px;color:#475569">The code works for ${CODE_MINUTES} minutes.</p>`),
    text: `Hi ${first},\n\nYour Isabel Village verification code is ${code}. It works for ${CODE_MINUTES} minutes.`,
  }),
  registrationSms: (first: string) => `Isabel Village: Hi ${first}, we received your registration. We will text you once the association office approves it.`,
  approved: (first: string, siteUrl: string) => ({
    subject: "Your Isabel Village registration was approved",
    html: page("You're approved!", [`Hi ${esc(first)},`, "The association office approved your registration. You can now sign in to the Isabel Village portal with your email or phone number and the password you created."], button("Sign in", siteUrl)),
    text: `Hi ${first},\n\nThe association office approved your registration. You can now sign in with your email or phone number and the password you created.${siteUrl ? `\n\n${siteUrl}` : ""}`,
    sms: `Isabel Village: Hi ${first}, your registration was approved. You can now sign in with your email or phone number and your password.`,
  }),
  denied: (first: string, reason: string) => ({
    subject: "Update on your Isabel Village registration",
    html: page("Your registration was not approved", [`Hi ${esc(first)},`, "Unfortunately the association office could not approve your registration."], `<div style="margin:0 0 14px;padding:12px 14px;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;font-size:14px;color:#9f1239"><b>Reason:</b> ${esc(reason || "No reason was given.")}</div><p style="margin:0;font-size:14px;color:#475569">If you have questions, please contact the association office.</p>`),
    text: `Hi ${first},\n\nUnfortunately the association office could not approve your registration.\nReason: ${reason || "No reason was given."}\n\nIf you have questions, please contact the association office.`,
    sms: `Isabel Village: Hi ${first}, your registration was not approved. Reason: ${reason || "none given"}. Please contact the association office.`,
  }),
  announcement: (title: string, description: string, date: string, siteUrl: string) => ({
    subject: `Isabel Village announcement: ${title}`,
    html: page(title, [`<span style="color:#047857;font-weight:bold;font-size:12px;text-transform:uppercase;letter-spacing:1px">Announcement${date ? ` - ${esc(prettyDate(date))}` : ""}</span>`, esc(description).replace(/\n/g, "<br>")], button("Open the portal", siteUrl)),
    text: `Isabel Village announcement${date ? ` (${prettyDate(date)})` : ""}\n\n${title}\n\n${description}${siteUrl ? `\n\n${siteUrl}` : ""}`,
    sms: `Isabel Village: ${title}. ${description}`,
  }),
  event: (title: string, description: string, date: string, time: string, place: string, siteUrl: string) => ({
    subject: `Isabel Village event: ${title}`,
    html: page(title, [`<span style="color:#047857;font-weight:bold;font-size:12px;text-transform:uppercase;letter-spacing:1px">Community event</span>`, esc(description).replace(/\n/g, "<br>"), `<b>When:</b> ${esc(prettyDate(date))}${time ? ` at ${esc(prettyTime(time))}` : ""}<br><b>Where:</b> ${esc(place || "To be announced")}`], button("Open the portal", siteUrl)),
    text: `Isabel Village event\n\n${title}\n\n${description}\n\nWhen: ${prettyDate(date)}${time ? ` at ${prettyTime(time)}` : ""}\nWhere: ${place || "To be announced"}${siteUrl ? `\n\n${siteUrl}` : ""}`,
    sms: `Isabel Village event: ${title} on ${prettyDate(date)}${time ? ` at ${prettyTime(time)}` : ""}${place ? `, ${place}` : ""}. ${description}`,
  }),
};

// ------------------------------------------------- verification codes ---

// Makes a fresh 6-digit code for a resident, stores only its hash, and returns the code to email out.
async function issueCode(resident: Resident): Promise<string> {
  const code = String(randomInt(100000, 1000000));
  await rest("email_verifications?on_conflict=homeowner_id", {
    method: "POST",
    body: { homeowner_id: resident.id, code_hash: hashCode(resident.id, code), expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), attempts: 0, sent_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  return code;
}

// ------------------------------------------------------------- actions ---

const notReady = (): Reply => reply(200, { ok: true, sent: false, error: "Notifications are not set up on the server yet." });

// Right after someone registers: email the code (email registrants) or text a confirmation (phone-only registrants).
// Works only once, and only for a pending registration made in the last few minutes, so it cannot be used to spam anyone.
export async function registrationNotice(body: Record<string, unknown>): Promise<Reply> {
  if (!serverReady()) return notReady();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").replace(/[\s()-]/g, "");
  const key = email || (smsNumber(phone) ? placeholderFor(phone) : "");
  if (!key) return reply(400, { ok: false, error: "An email address or phone number is required." });
  const resident = await residentByEmail(key);
  if (!resident || resident.status !== "pending" || Date.parse(resident.created_at) < Date.now() - FRESH_REGISTRATION_MINUTES * 60_000) return reply(200, { ok: true, sent: false });
  const already = await rest(`notification_log?homeowner_id=eq.${resident.id}&kind=eq.registration&ok=eq.true&select=id&limit=1`);
  if (already.ok && already.data?.length) return reply(200, { ok: true, sent: false });

  if (isPlaceholder(resident.email)) {
    if (!resident.phone) return reply(200, { ok: true, sent: false });
    const sent = await sendSms(resident.phone, messages.registrationSms(resident.first_name));
    await writeLog(resident.id, "registration", "sms", sent.ok, sent.ok ? "" : sent.error);
    return reply(200, { ok: true, sent: sent.ok, channel: "sms", ...(sent.ok ? {} : { error: sent.error }) });
  }
  const code = await issueCode(resident);
  const mail = messages.registrationWithCode(resident.first_name, code);
  const sent = await sendEmail({ email: resident.email, name: fullName(resident) }, mail.subject, mail.html, mail.text);
  await writeLog(resident.id, "registration", "email", sent.ok, sent.ok ? "" : sent.error);
  return reply(200, { ok: true, sent: sent.ok, channel: "email", ...(sent.ok ? {} : { error: sent.error }) });
}

export async function verifyEmail(body: Record<string, unknown>): Promise<Reply> {
  if (!serverReady()) return reply(503, { ok: false, error: "Email verification is not set up on the server yet." });
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  const wrong = reply(400, { ok: false, error: "That code is not correct." });
  if (!email || !/^\d{6}$/.test(code)) return wrong;
  const resident = await residentByEmail(email);
  if (!resident || isPlaceholder(resident.email)) return wrong;
  if (resident.email_verified_at) return reply(200, { ok: true, verified: true });
  const stored = await rest(`email_verifications?homeowner_id=eq.${resident.id}&select=code_hash,expires_at,attempts&limit=1`);
  const row = stored.ok && stored.data?.[0] ? (stored.data[0] as { code_hash: string; expires_at: string; attempts: number }) : null;
  if (!row) return reply(400, { ok: false, error: "There is no active code. Please request a new one." });
  if (Date.parse(row.expires_at) < Date.now()) return reply(400, { ok: false, error: "This code has expired. Please request a new one." });
  if (row.attempts >= MAX_ATTEMPTS) return reply(400, { ok: false, error: "Too many wrong attempts. Please request a new code." });
  await rest(`email_verifications?homeowner_id=eq.${resident.id}`, { method: "PATCH", body: { attempts: row.attempts + 1 }, prefer: "return=minimal" });
  if (!sameHash(hashCode(resident.id, code), row.code_hash)) {
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return reply(400, { ok: false, error: left > 0 ? `That code is not correct. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong attempts. Please request a new code." });
  }
  await rest(`homeowners?id=eq.${resident.id}`, { method: "PATCH", body: { email_verified_at: new Date().toISOString() }, prefer: "return=minimal" });
  await rest(`email_verifications?homeowner_id=eq.${resident.id}`, { method: "DELETE", prefer: "return=minimal" });
  await writeLog(resident.id, "email_verified", "email", true);
  return reply(200, { ok: true, verified: true });
}

export async function resendCode(body: Record<string, unknown>): Promise<Reply> {
  if (!serverReady()) return reply(503, { ok: false, error: "Email verification is not set up on the server yet." });
  const email = String(body.email || "").trim().toLowerCase();
  const resident = email ? await residentByEmail(email) : null;
  // Same answer whether or not the email exists, so this cannot be used to discover who is registered.
  if (!resident || isPlaceholder(resident.email) || resident.email_verified_at) return reply(200, { ok: true });
  const last = await rest(`email_verifications?homeowner_id=eq.${resident.id}&select=sent_at&limit=1`);
  const sentAt = last.ok && last.data?.[0]?.sent_at ? Date.parse(last.data[0].sent_at) : 0;
  if (sentAt && Date.now() - sentAt < RESEND_SECONDS * 1000) return reply(429, { ok: false, error: "Please wait a minute before asking for another code." });
  const recent = await rest(`notification_log?homeowner_id=eq.${resident.id}&channel=eq.email&ok=eq.true&kind=in.(registration,verification)&created_at=gte.${encodeURIComponent(minutesAgo(60))}&select=id`);
  if (recent.ok && Array.isArray(recent.data) && recent.data.length >= MAX_CODES_PER_HOUR) return reply(429, { ok: false, error: "Too many codes were requested. Please try again in an hour." });
  const code = await issueCode(resident);
  const mail = messages.newCode(resident.first_name, code);
  const sent = await sendEmail({ email: resident.email, name: fullName(resident) }, mail.subject, mail.html, mail.text);
  await writeLog(resident.id, "verification", "email", sent.ok, sent.ok ? "" : sent.error);
  return sent.ok ? reply(200, { ok: true }) : reply(502, { ok: false, error: sent.error });
}

type Delivery = { channel: "email" | "sms"; ok: boolean; to: string; error?: string };

// After the admin approves or denies a registration: email the resident, or text them if they have no email.
export async function statusNotice(request: Request, body: Record<string, unknown>): Promise<Reply> {
  if (!serverReady()) return notReady();
  const blocked = await requireAdmin(request);
  if (blocked) return blocked;
  const resident = await residentById(String(body.homeownerId || ""));
  if (!resident) return reply(404, { ok: false, error: "That homeowner was not found." });
  if (resident.status !== "active" && resident.status !== "denied") return reply(400, { ok: false, error: "There is nothing to send for this status." });
  const c = config();
  const approved = resident.status === "active";
  const kind = approved ? "approved" : "denied";
  const text = approved ? messages.approved(resident.first_name, c.siteUrl) : messages.denied(resident.first_name, resident.denial_reason || "");
  const results: Delivery[] = [];
  const hasEmail = !isPlaceholder(resident.email);
  if (hasEmail) {
    const sent = await sendEmail({ email: resident.email, name: fullName(resident) }, text.subject, text.html, text.text);
    results.push({ channel: "email", ok: sent.ok, to: resident.email, ...(sent.ok ? {} : { error: sent.error }) });
  }
  if ((!hasEmail || c.smsAlways) && resident.phone) {
    const sent = await sendSms(resident.phone, text.sms);
    results.push({ channel: "sms", ok: sent.ok, to: resident.phone, ...(sent.ok ? {} : { error: sent.error }) });
  }
  for (const r of results) await writeLog(resident.id, kind, r.channel, r.ok, r.error || "");
  return reply(200, { ok: results.some(r => r.ok), results });
}

// Sends an announcement or event to every active resident by email and/or text message.
export async function broadcast(request: Request, body: Record<string, unknown>): Promise<Reply> {
  if (!serverReady()) return notReady();
  const blocked = await requireAdmin(request);
  if (blocked) return blocked;
  const kind = body.kind === "event" ? "event" : body.kind === "announcement" ? "announcement" : "";
  const title = String(body.title || "").trim().slice(0, 200);
  const description = String(body.description || "").trim().slice(0, 3000);
  const channels = (body.channels || {}) as { email?: unknown; sms?: unknown };
  const wantEmail = channels.email === true;
  const wantSms = channels.sms === true;
  if (!kind || !title || !description || (!wantEmail && !wantSms)) return reply(400, { ok: false, error: "Add a title, a description and at least one channel." });
  const date = String(body.date || "").slice(0, 10);
  const time = String(body.time || "").slice(0, 5);
  const place = String(body.location || "").trim().slice(0, 200);
  const siteUrl = config().siteUrl;
  const mail = kind === "event" ? messages.event(title, description, date, time, place, siteUrl) : messages.announcement(title, description, date, siteUrl);

  const people = await rest("homeowners?status=eq.active&select=id,first_name,last_name,email,phone&limit=1000");
  if (!people.ok || !Array.isArray(people.data)) return reply(500, { ok: false, error: "Could not load the residents." });
  const residents = people.data as Pick<Resident, "id" | "first_name" | "last_name" | "email" | "phone">[];

  const emailTargets = wantEmail ? residents.filter(r => !isPlaceholder(r.email)) : [];
  const seen = new Set<string>();
  const smsTargets = wantSms ? residents.filter(r => { const n = r.phone ? smsNumber(r.phone) : null; if (!n || seen.has(n)) return false; seen.add(n); return true; }) : [];
  const counts = { emailSent: 0, emailFailed: 0, smsSent: 0, smsFailed: 0 };
  let firstError = "";
  await inBatches(emailTargets, 5, async r => {
    const sent = await sendEmail({ email: r.email, name: `${r.first_name} ${r.last_name}`.trim() }, mail.subject, mail.html, mail.text);
    if (sent.ok) counts.emailSent++; else { counts.emailFailed++; firstError = firstError || sent.error; }
  });
  await inBatches(smsTargets, 3, async r => {
    const sent = await sendSms(r.phone || "", mail.sms);
    if (sent.ok) counts.smsSent++; else { counts.smsFailed++; firstError = firstError || sent.error; }
  });
  if (wantEmail) await writeLog(null, kind, "email", counts.emailFailed === 0, `sent ${counts.emailSent}, failed ${counts.emailFailed}: ${title}`);
  if (wantSms) await writeLog(null, kind, "sms", counts.smsFailed === 0, `sent ${counts.smsSent}, failed ${counts.smsFailed}: ${title}`);
  return reply(200, { ok: counts.emailSent + counts.smsSent > 0 || (emailTargets.length + smsTargets.length === 0), ...counts, emailRecipients: emailTargets.length, smsRecipients: smsTargets.length, ...(firstError ? { error: firstError } : {}) });
}
