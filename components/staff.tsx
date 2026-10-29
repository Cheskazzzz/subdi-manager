"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Empty, FormPreview, Modal, PreviewState } from "./ui";

type StaffRole = "admin" | "security";
type Staff = { id: string; email: string; firstName: string; lastName: string; role: StaffRole; superAdmin: boolean; mustChange: boolean };
type Handover = { title: string; email: string; password: string };

// Readable default passwords: no 0/O or 1/l/I to avoid mix-ups when handing them over.
const defaultPassword = () => { const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; const bytes = crypto.getRandomValues(new Uint8Array(10)); return Array.from(bytes, b => chars[b % chars.length]).join(""); };

export function StaffPage() {
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("profiles").select("id,email,first_name,last_name,role,is_super_admin,must_change_password,created_at").in("role", ["admin", "security"]).order("created_at");
    if (error) { setMessage(error.message); setLoading(false); return; }
    setStaff((data || []).map(row => ({ id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name, role: row.role, superAdmin: row.is_super_admin, mustChange: row.must_change_password })));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  // Step 1: show a preview of the new account. Nothing is created until Confirm is pressed.
  const create = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const account = { email: String(f.get("email")).trim().toLowerCase(), password: String(f.get("password")), firstName: String(f.get("firstName")), lastName: String(f.get("lastName")), role: String(f.get("role")) };
    setMessage("");
    setPreview({
      title: "Review new staff account",
      confirmLabel: "Confirm & create",
      rows: [
        { label: "First name", value: account.firstName },
        { label: "Last name", value: account.lastName },
        { label: "Email address", value: account.email },
        { label: "Role", value: account.role === "admin" ? "Admin" : "Security" },
        { label: "Default password", value: account.password },
      ],
      onConfirm: () => createAccount(account),
    });
  };
  // Step 2: the admin pressed Confirm, so the account is created.
  const createAccount = async (account: { email: string; password: string; firstName: string; lastName: string; role: string }) => {
    if (saving) return;
    setSaving(true);
    const { error } = await supabase.rpc("create_staff_account", { p_email: account.email, p_password: account.password, p_first_name: account.firstName, p_last_name: account.lastName, p_role: account.role });
    setSaving(false); setPreview(null);
    if (error) { setMessage(error.message); return; }
    setAdding(false); setMessage(""); setHandover({ title: "Staff account created", email: account.email, password: account.password }); await load();
  };
  const changeRole = async (person: Staff, role: StaffRole) => {
    const { error } = await supabase.rpc("update_staff_role", { p_user_id: person.id, p_role: role });
    setMessage(error ? error.message : `${person.firstName} ${person.lastName} is now ${role === "admin" ? "an admin" : "security staff"}.`); await load();
  };
  const resetPassword = async (person: Staff) => {
    if (!confirm(`Reset ${person.firstName} ${person.lastName}'s password to a new default password?`)) return;
    const password = defaultPassword(); const { error } = await supabase.rpc("reset_staff_password", { p_user_id: person.id, p_password: password });
    if (error) { setMessage(error.message); return; }
    setMessage(""); setHandover({ title: "Password reset", email: person.email, password }); await load();
  };
  const remove = async (person: Staff) => {
    if (!confirm(`Remove ${person.firstName} ${person.lastName}'s account? They will no longer be able to sign in.`)) return;
    const { error } = await supabase.rpc("delete_staff_account", { p_user_id: person.id });
    setMessage(error ? error.message : "Staff account removed."); await load();
  };

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-slate-500">Create admin and security accounts. Each person gets their own email and a default password they must change on first sign-in.</p><div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700"><UserCog className="h-4 w-4"/>{staff.length} staff account{staff.length === 1 ? "" : "s"}</div></div><button className="btn-primary" onClick={() => { setMessage(""); setAdding(true); }}><Plus className="h-4 w-4"/>Add staff account</button></div>
    {message && <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{message}</div>}
    {loading ? <Empty message="Loading staff accounts…"/> : staff.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th><th></th></tr></thead><tbody>{staff.map(person => <tr key={person.id}>
      <td><div className="font-semibold text-slate-900">{person.firstName} {person.lastName}</div>{person.superAdmin && <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5"/>Super admin</div>}</td>
      <td>{person.email}</td>
      <td>{person.superAdmin ? "Admin" : <select className="field max-w-36 py-1.5" value={person.role} onChange={e => void changeRole(person, e.target.value as StaffRole)}><option value="admin">Admin</option><option value="security">Security</option></select>}</td>
      <td><Badge value={person.mustChange ? "Default password" : "Active"}/></td>
      <td>{!person.superAdmin && <div className="flex justify-end gap-1"><button className="rounded p-2 text-slate-500 hover:bg-slate-100" title="Reset to a new default password" onClick={() => void resetPassword(person)}><KeyRound className="h-4 w-4"/></button><button className="rounded p-2 text-rose-500 hover:bg-rose-50" title="Remove account" onClick={() => void remove(person)}><Trash2 className="h-4 w-4"/></button></div>}</td>
    </tr>)}</tbody></table></div> : <Empty message="No staff accounts yet."/>}
    {adding && <Modal title="Add staff account" onClose={() => setAdding(false)}><form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
      <label><span className="label">First name</span><input required className="field" name="firstName"/></label>
      <label><span className="label">Last name</span><input required className="field" name="lastName"/></label>
      <label className="sm:col-span-2"><span className="label">Email address</span><input required type="email" className="field" name="email"/></label>
      <label><span className="label">Role</span><select className="field" name="role" defaultValue="admin"><option value="admin">Admin</option><option value="security">Security</option></select></label>
      <label><span className="label">Default password</span><input required minLength={8} className="field font-mono" name="password" defaultValue={defaultPassword()}/></label>
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 sm:col-span-2">Give this default password to the staff member privately. They will be asked to set their own password the first time they sign in.</p>
      {message && <p className="text-sm text-rose-600 sm:col-span-2">{message}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button><button className="btn-primary">Create account</button></div>
    </form></Modal>}
    <FormPreview preview={preview} busy={saving} onClose={() => setPreview(null)}/>
    {handover && <Modal title={handover.title} onClose={() => setHandover(null)}><div className="space-y-4"><p className="text-sm text-slate-600">Give these sign-in details to the staff member. The password is shown only once; they must change it when they first sign in.</p><div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm"><p className="label">Email</p><p className="font-mono font-semibold">{handover.email}</p><p className="label mt-3">Default password</p><p className="font-mono text-lg font-bold tracking-wide">{handover.password}</p></div><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(`Email: ${handover.email}\nPassword: ${handover.password}`)}>Copy details</button><button className="btn-primary" onClick={() => setHandover(null)}>Done</button></div></div></Modal>}
  </div>;
}
