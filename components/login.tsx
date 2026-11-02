"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, CalendarClock, Car, Eye, EyeOff, Home, LockKeyhole, Mail, MapPin, ShieldCheck, Users } from "lucide-react";
import { Role } from "@/lib/types";
import { notifyApi } from "@/lib/notify";
import { FormPreview, PreviewState } from "./ui";
import { createClient, createRecoveryClient } from "@/lib/supabase/client";
import { LIMITS, emailError, normalizeEmail, normalizePhone, normalizeUnit, passwordError, phoneError, residentError } from "@/lib/validation";

type View = "landing" | "login" | "register" | "forgot" | "verify";
// Staff (admin / super admin / security) get their email filled in again next time the sign-in page opens.
// Only the email is remembered; the password field always starts empty.
const LAST_EMAIL_KEY = "iv-last-staff-email";
const rememberedEmail = () => { try { return localStorage.getItem(LAST_EMAIL_KEY) || ""; } catch { return ""; } };
const rememberEmail = (value: string) => { try { localStorage.setItem(LAST_EMAIL_KEY, value); } catch { /* storage unavailable */ } };
type ResidentDetails = { firstName: string; lastName: string; email: string; phone: string; block: string; lot: string };
// [name, label, placeholder, maxLength, autoComplete]
const registerFields: [string, string, string, number, string][] = [["firstName", "First name", "Juan", LIMITS.name, "given-name"], ["lastName", "Last name", "Dela Cruz", LIMITS.name, "family-name"], ["email", "Email address", "juan@gmail.com", LIMITS.email, "email"], ["phone", "Phone number", "09171234567", LIMITS.phone, "tel"], ["block", "Block", "23", LIMITS.unit, "off"], ["lot", "Lot", "7", LIMITS.unit, "off"]];

export function Login({ onLogin, notice = "" }: { onLogin: (role: Role) => void; notice?: string }) {
  const supabase = useMemo(() => createClient(), []);
  // An expired session lands straight on the sign-in form with the reason shown.
  const [view, setView] = useState<View>(notice ? "login" : "landing");
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState(notice);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  // A resident with no email can register with a phone number instead.
  const [regMode, setRegMode] = useState<"email" | "phone">("email");
  // Email verification (a 6-digit code emailed after registering).
  const [verifyAddress, setVerifyAddress] = useState("");
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return; const timer = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(timer); }, [wait]);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  // Confirm a homeowner account exists for the email, then email a link to choose a new password.
  const sendReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const resetEmail = normalizeEmail(String(new FormData(event.currentTarget).get("resetEmail")));
    const problem = emailError(resetEmail); if (problem) { setMessage(problem); return; }
    setSending(true);
    try {
      const { data: exists, error } = await supabase.rpc("homeowner_account_exists", { p_email: resetEmail });
      if (error) { setMessage(error.message); return; }
      if (!exists) { setMessage("No homeowner account was found with that email address."); return; }
      const { error: sendError } = await createRecoveryClient().auth.resetPasswordForEmail(resetEmail, { redirectTo: window.location.origin });
      if (sendError) { setMessage(/rate limit/i.test(sendError.message) ? "Too many reset emails were sent recently. Please try again later." : sendError.message); return; }
      setMessage(`We sent a password reset link to ${resetEmail}. Open it to choose a new password.`);
    } finally { setSending(false); }
  };

  // Supabase validates the password and returns the role stored in the user's profile.
  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const identifier = email.trim();
    // Same message for an unknown account and a wrong password so the form does not reveal which accounts exist.
    const failed = "Incorrect email, phone number or password.";
    if (!identifier || !password || password.length > LIMITS.passwordMax) { setMessage(failed); return; }
    setBusy(true);
    try {
      let loginEmail = normalizeEmail(identifier);
      if (identifier.includes("@")) {
        if (emailError(loginEmail)) { setMessage(failed); return; }
      } else {
        // A phone number is looked up in the database to find the email the account was registered with.
        const phone = normalizePhone(identifier);
        if (phoneError(phone)) { setMessage("Enter your registered email address or Philippine mobile number, e.g. 09171234567."); return; }
        const { data: found, error } = await supabase.rpc("login_email_for_phone", { p_phone: phone });
        if (error || !found) { setMessage(failed); return; }
        loginEmail = String(found).toLowerCase();
      }
      await completeSignIn(loginEmail);
    } finally { setBusy(false); }
  };

  const completeSignIn = async (normalizedEmail: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error || !data.user) { setMessage(/rate limit|too many/i.test(error?.message || "") ? "Too many sign-in attempts. Please wait a few minutes and try again." : "Incorrect email, phone number or password."); return; }
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
    const role = profile?.role as Role | undefined;
    if (!role) { await supabase.auth.signOut(); setMessage("This account has no assigned role. Contact the association office."); return; }
    if (role === "homeowner") { const { data: homeowner } = await supabase.from("homeowners").select("status").eq("user_id", data.user.id).single(); if (homeowner?.status !== "active") { await supabase.auth.signOut(); setMessage(homeowner?.status === "pending" ? "Your registration is still awaiting administrator approval." : homeowner?.status === "denied" ? await deniedMessage(data.user.id) : "This resident account is inactive."); return; } }
    if (role !== "homeowner") rememberEmail(normalizedEmail);
    setMessage(""); onLogin(role);
  };

  // The reason is read in its own query so sign-in still works if that column is missing.
  const deniedMessage = async (userId: string) => {
    const { data: row } = await supabase.from("homeowners").select("denial_reason").eq("user_id", userId).single();
    const reason = String(row?.denial_reason || "").trim();
    return `Your registration was denied.${reason ? ` Reason: ${reason}` : ""} Please contact the association office if you have questions.`;
  };


  // Step 1: check the answers, then show a preview. Nothing is sent until the resident presses Confirm.
  const register = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (busy) return;
    const details: ResidentDetails = { firstName: String(form.get("firstName")).trim(), lastName: String(form.get("lastName")).trim(), email: regMode === "email" ? normalizeEmail(String(form.get("email"))) : "", phone: normalizePhone(String(form.get("phone"))), block: normalizeUnit(String(form.get("block"))), lot: normalizeUnit(String(form.get("lot"))) };
    const newPassword = String(form.get("password"));
    const problem = residentError(details, regMode === "email") || passwordError(newPassword) || (newPassword !== String(form.get("confirmPassword")) ? "Passwords do not match." : null);
    if (problem) { setMessage(problem); return; }
    setMessage("");
    setPreview({
      title: "Review your application",
      confirmLabel: "Confirm & submit",
      rows: [
        { label: "First name", value: details.firstName },
        { label: "Last name", value: details.lastName },
        ...(regMode === "email" ? [{ label: "Email address", value: details.email }] : [{ label: "Sign in with", value: "Phone number and password" }]),
        { label: "Phone number", value: details.phone },
        { label: "Block", value: details.block },
        { label: "Lot", value: details.lot },
        { label: "Password", value: "•".repeat(Math.min(newPassword.length, 20)) },
      ],
      onConfirm: () => submitRegistration(details, newPassword, formElement),
    });
  };

  // Step 2: the resident pressed Confirm, so the application is sent.
  const submitRegistration = async (details: ResidentDetails, newPassword: string, formElement: HTMLFormElement) => {
    if (busy) return;
    // Registered through a database function so no confirmation email is sent; admin approval is the gate.
    // The database re-checks every field, so calling it directly cannot skip these rules.
    setBusy(true);
    const { error } = await supabase.rpc("register_resident", { p_email: details.email, p_password: newPassword, p_first_name: details.firstName, p_last_name: details.lastName, p_phone: details.phone, p_block: details.block, p_lot: details.lot });
    setBusy(false);
    setPreview(null);
    if (error) { setMessage(error.message); return; }
    formElement.reset();
    // The application is saved. Now confirm it: email the verification code, or text a confirmation to phone-only residents.
    setBusy(true);
    const result = await notifyApi({ action: "registration", email: details.email, phone: details.phone });
    setBusy(false);
    const sent = result.data?.sent === true;
    if (regMode === "email") {
      setVerifyAddress(details.email); setCode(""); setWait(sent ? 60 : 0); setView("verify");
      setMessage(sent ? `Application submitted. We sent a 6-digit code to ${details.email}. Enter it below to verify your email.` : "Application submitted. We could not send the verification email just now. Choose \"Send a new code\" below to try again.");
      return;
    }
    setMessage(sent ? "Application submitted. We sent you a text message to confirm it. After the administrator approves it, sign in with your phone number and password." : "Application submitted. After the administrator approves it, sign in with your phone number and password.");
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const address = normalizeEmail(verifyAddress);
    if (emailError(address)) { setMessage("Enter the email address you registered with."); return; }
    setBusy(true);
    const result = await notifyApi({ action: "verify", email: address, code });
    setBusy(false);
    if (!result.data?.verified) { setMessage(String(result.data?.error || "We could not check the code. Please try again.")); return; }
    setCode("");
    setMessage("Email verified. Your application now waits for administrator approval. We will email you as soon as it is approved.");
  };

  const resend = async () => {
    const address = normalizeEmail(verifyAddress);
    if (busy) return;
    if (emailError(address)) { setMessage("Enter the email address you registered with."); return; }
    setBusy(true);
    const result = await notifyApi({ action: "resend", email: address });
    setBusy(false);
    if (!result.ok) { setMessage(String(result.data?.error || "We could not send a new code. Please try again later.")); return; }
    setWait(60);
    setMessage(`If ${address} is waiting to be verified, a new code is on its way.`);
  };

  if (view === "landing") return <Landing open={setView}/>;
  return <main className="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]"><Brand/><section className="flex items-center justify-center bg-white p-6 sm:p-12"><div className="w-full max-w-md">
    <button onClick={() => { setView("landing"); setMessage(""); }} className="mb-8 text-sm font-semibold text-emerald-700">← Back to home</button>
    {view === "login" ? <><Kicker text="Welcome back"/><h2 className="mt-2 text-3xl font-bold">Sign in to your account</h2><form className="mt-8 space-y-5" onSubmit={signIn}><Field label="Email or phone number" name="identifier" type="text" icon={Mail} value={email} onChange={setEmail} autoComplete="username" maxLength={LIMITS.email} placeholder="you@example.com or 09171234567"/><PasswordField label="Password" name="password" value={password} onChange={setPassword} show={show} toggle={() => setShow(!show)} autoComplete="new-password"/>{message && <Notice error text={message}/>}<button type="button" onClick={() => { setView("forgot"); setMessage(""); }} className="block text-sm font-semibold text-emerald-700">Forgot password?</button><button disabled={busy} className="btn-primary w-full py-3.5">{busy ? "Signing in…" : <>Sign in <ArrowRight className="h-4 w-4"/></>}</button></form><p className="mt-6 text-center text-sm text-slate-500">No account? <button onClick={() => { setView("register"); setMessage(""); }} className="font-bold text-emerald-700">Register</button></p><p className="mt-2 text-center text-sm text-slate-500">Registered with an email? <button onClick={() => { setView("verify"); setMessage(""); }} className="font-bold text-emerald-700">Verify email</button></p></>
    : view === "register" ? <><Kicker text="Resident registration"/><h2 className="mt-2 text-3xl font-bold">Apply for an account</h2><p className="mt-2 text-sm text-slate-500">Create your password now. You can sign in after the association office approves your application.</p><form onSubmit={register} className="mt-7 grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2" role="group" aria-label="Register using"><div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">{([["email", "Register using email"], ["phone", "Register using phone number"]] as const).map(([mode, text]) => <button key={mode} type="button" aria-pressed={regMode === mode} onClick={() => { setRegMode(mode); setMessage(""); }} className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${regMode === mode ? "bg-white text-emerald-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{text}</button>)}</div>{regMode === "phone" && <p className="mt-2 text-xs text-slate-500">No email address? Register with your mobile number instead. You will use it to sign in.</p>}</div><p className="text-xs text-slate-500 sm:col-span-2"><Req/> Fields marked with an asterisk are required.</p>{registerFields.filter(([name]) => regMode === "email" || name !== "email").map(([name, label, placeholder, maxLength, autoComplete]) => <label key={name}><span className="label">{label}<Req/></span><input required className="field" name={name} type={name === "email" ? "email" : name === "phone" ? "tel" : "text"} inputMode={name === "phone" ? "tel" : name === "block" || name === "lot" ? "numeric" : undefined} placeholder={placeholder} maxLength={maxLength} autoComplete={autoComplete} aria-describedby={name === "phone" ? "phone-hint" : undefined}/>{name === "phone" && <span id="phone-hint" className="mt-1 block text-[11px] leading-4 text-slate-500">Required. Mobile number starting with 09 (11 digits) or +63.{regMode === "phone" && " You will sign in with this number."}</span>}</label>)}<label><span className="label">Password<Req/></span><input required minLength={LIMITS.passwordMin} maxLength={LIMITS.passwordMax} className="field" name="password" type="password" autoComplete="new-password" placeholder="8+ characters, letters and numbers"/></label><label><span className="label">Confirm password<Req/></span><input required minLength={LIMITS.passwordMin} maxLength={LIMITS.passwordMax} className="field" name="confirmPassword" type="password" autoComplete="new-password"/></label>{message && <div className="sm:col-span-2"><Notice text={message}/></div>}<button disabled={busy} className="btn-primary sm:col-span-2">{busy ? "Submitting…" : "Submit for approval"}</button></form><button onClick={() => { setView("login"); setMessage(""); }} className="mt-6 w-full text-sm font-semibold text-emerald-700">Already registered? Sign in</button></>
    : view === "verify" ? <><Kicker text="Email verification"/><h2 className="mt-2 text-3xl font-bold">Verify your email</h2><p className="mt-2 text-sm text-slate-500">Enter the 6-digit code we emailed to you. The code works for 30 minutes.</p><form className="mt-8 space-y-5" onSubmit={verify}><Field label="Email address" name="verifyEmail" type="email" icon={Mail} value={verifyAddress} onChange={setVerifyAddress}/><label><span className="label">6-digit code</span><input required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" name="code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="field text-center text-xl tracking-[0.4em]"/></label>{message && <Notice text={message}/>}<button disabled={busy} className="btn-primary w-full">{busy ? "Checking…" : "Verify email"}</button></form><button type="button" onClick={resend} disabled={busy || wait > 0} className="mt-4 w-full text-sm font-semibold text-emerald-700 disabled:text-slate-400">{wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}</button><button onClick={() => { setView("login"); setMessage(""); }} className="mt-3 w-full text-sm font-semibold text-slate-500">Back to sign in</button></>
    : <><Kicker text="Account recovery"/><h2 className="mt-2 text-3xl font-bold">Reset your password</h2><p className="mt-2 text-sm text-slate-500">Enter the email address of your homeowner account. If we find it, we will email you a link to choose a new password.</p><p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Registered with a phone number only? Password resets are done at the association office, so please contact them.</p><form className="mt-8 space-y-5" onSubmit={sendReset}><Field label="Email address" name="resetEmail" type="email" icon={Mail}/>{message && <Notice text={message}/>}<button disabled={sending} className="btn-primary w-full">{sending ? "Checking…" : "Send reset link"}</button></form><button onClick={() => { setView("login"); setMessage(""); }} className="mt-6 w-full text-sm font-semibold text-emerald-700">Back to sign in</button></>}
  </div></section><FormPreview preview={preview} busy={busy} onClose={() => setPreview(null)}/></main>;
}

function Landing({ open }: { open: (view: View) => void }) { return <main className="min-h-screen bg-white"><header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5"><Logo/><div className="flex gap-2"><button className="btn-secondary" onClick={() => open("login")}>Log in</button><button className="btn-primary" onClick={() => open("register")}>Register</button></div></header><section className="bg-[#123d2a] px-6 py-20 text-white sm:py-28"><div className="mx-auto max-w-7xl"><Kicker text="A safer, connected community"/><h1 className="mt-5 max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">Everything your neighborhood needs, in one place.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-emerald-50/70">Stay informed, manage vehicle passes, and access community services securely from home.</p><button className="btn-primary mt-9 bg-emerald-500" onClick={() => open("register")}>Register as a resident <ArrowRight className="h-4 w-4"/></button></div></section><section className="mx-auto max-w-7xl px-6 py-16"><div className="grid gap-5 md:grid-cols-3">{[[ShieldCheck,"Secure access","Verified resident accounts and dependable gate records."],[Car,"Digital car passes","Request and manage household vehicle passes online."],[Users,"Stay connected","Receive announcements and join community events."]].map(([Icon,title,description]) => <article className="card p-6" key={String(title)}><Icon className="h-7 w-7 text-emerald-700"/><h2 className="mt-5 text-lg font-bold">{String(title)}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{String(description)}</p></article>)}</div><div className="mt-12 grid gap-6 rounded-2xl bg-slate-50 p-7 md:grid-cols-2"><Info icon={MapPin} title="Association Office">Isabel Village<br/>Tabang, Plaridel, Bulacan</Info><Info icon={CalendarClock} title="Office Hours">Monday–Friday, 8:00 AM–5:00 PM<br/>Saturday, 8:00 AM–12:00 PM</Info></div></section></main>; }
function Logo() { return <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-700 p-2 text-white"><Building2/></div><div><b>Isabel Village</b><p className="text-xs text-slate-500">Homeowners Association</p></div></div>; }
function Brand() { return <section className="hidden bg-[#123d2a] p-12 text-white lg:flex lg:flex-col lg:justify-between"><Logo/><div><ShieldCheck className="h-10 w-10 text-emerald-400"/><h1 className="mt-5 text-5xl font-bold">Community access you can trust.</h1></div><p className="text-xs text-emerald-100/50">© 2026 Isabel Village HOA</p></section>; }
function Kicker({ text }: { text: string }) { return <p className="text-sm font-bold uppercase tracking-widest text-emerald-600">{text}</p>; }
function Req() { return <span className="ml-0.5 font-bold text-rose-600" aria-hidden="true">*</span>; }
function Field({ label, name, type, icon: Icon, value, onChange, placeholder, autoComplete, maxLength }: { label: string; name: string; type: string; icon: typeof Home; value?: string; onChange?: (value: string) => void; placeholder?: string; autoComplete?: string; maxLength?: number }) { return <label><span className="label">{label}</span><div className="relative"><Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input required className="field pl-10" name={name} type={type} maxLength={maxLength ?? (type === "email" ? LIMITS.email : undefined)} autoComplete={autoComplete ?? (type === "email" ? "email" : undefined)} placeholder={placeholder} value={value} onChange={onChange ? event => onChange(event.target.value) : undefined}/></div></label>; }
function PasswordField({ label, name, value, onChange, show, toggle, autoComplete = "current-password" }: { label: string; name: string; value: string; onChange: (value: string) => void; show: boolean; toggle: () => void; autoComplete?: string }) { return <label><span className="label">{label}</span><div className="relative"><LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input required className="field px-10" name={name} type={show ? "text" : "password"} maxLength={LIMITS.passwordMax} autoComplete={autoComplete} value={value} onChange={event => onChange(event.target.value)}/><button type="button" aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" onClick={toggle}>{show ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button></div></label>; }
function Notice({ text, error }: { text: string; error?: boolean }) { return <p className={`rounded-lg p-3 text-sm ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{text}</p>; }
function Info({ icon: Icon, title, children }: { icon: typeof Home; title: string; children: React.ReactNode }) { return <div className="flex gap-4"><Icon className="text-emerald-700"/><div><h3 className="font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{children}</p></div></div>; }
