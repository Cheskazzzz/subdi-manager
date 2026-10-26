"use client";

import { useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LIMITS, passwordError } from "@/lib/validation";

// Shown to staff signing in with a default password from the super admin until they set their own,
// and to residents arriving from a password reset email.
export function ChangePassword({ onDone, onLogout, title = "Set your own password", description = "You signed in with a default password from the super admin. Choose a new password only you know before continuing." }: { onDone: () => void; onLogout: () => void; title?: string; description?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget); const password = String(f.get("password"));
    const problem = passwordError(password) || (password !== String(f.get("confirmPassword")) ? "Passwords do not match." : null);
    if (problem) { setMessage(problem); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setMessage(error.message); return; }
      const { error: flagError } = await supabase.rpc("clear_must_change_password");
      if (flagError) { setMessage(flagError.message); return; }
      onDone();
    } finally { setBusy(false); }
  };

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div className="card w-full max-w-md p-8">
    <div className="w-fit rounded-full bg-emerald-50 p-3 text-emerald-700"><KeyRound className="h-6 w-6"/></div>
    <h2 className="mt-4 text-2xl font-bold">{title}</h2>
    <p className="mt-2 text-sm text-slate-500">{description}</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block"><span className="label">New password</span><input required minLength={LIMITS.passwordMin} maxLength={LIMITS.passwordMax} type="password" autoComplete="new-password" className="field" name="password" placeholder="8+ characters, letters and numbers"/></label>
      <label className="block"><span className="label">Confirm new password</span><input required minLength={LIMITS.passwordMin} maxLength={LIMITS.passwordMax} type="password" autoComplete="new-password" className="field" name="confirmPassword"/></label>
      {message && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{message}</p>}
      <button disabled={busy} className="btn-primary w-full">Save password and continue</button>
    </form>
    <button onClick={onLogout} className="mt-4 w-full text-sm font-semibold text-emerald-700">Log out</button>
  </div></main>;
}
