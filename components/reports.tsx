"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileText, Phone, Plus, Printer, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { notifyApi } from "@/lib/notify";
import { Role } from "@/lib/types";
import { showEmail } from "@/lib/validation";
import { DateFilter, DateFilterValue, Empty, FormPreview, Modal, Pagination, PreviewState, SearchBox, dateKey, longDate, matchesDate, noDateFilter, usePagination } from "./ui";

// Residents file reports (a concern, an incident, a problem). Admins and the super admin review them,
// reply, change the status and generate date-filtered summaries. Every change is kept in a thread.

type Status = "submitted" | "review" | "resolved" | "closed";
type Kind = "reply" | "status" | "note";
type Report = { id: string; reference: string; homeownerId: string; category: string; subject: string; details: string; incidentDate: string; location: string; status: Status; createdAt: string; updatedAt: string; resolvedAt: string };
type Message = { id: string; reportId: string; authorRole: "homeowner" | "admin"; authorName: string; kind: Kind; body: string; createdAt: string };
type Owner = { id: string; name: string; block: string; lot: string; phone: string; email: string };

const STATUSES: Status[] = ["submitted", "review", "resolved", "closed"];
const STATUS_LABEL: Record<Status, string> = { submitted: "Submitted", review: "Under review", resolved: "Resolved", closed: "Closed" };
const PILL: Record<Status, string> = { submitted: "bg-sky-50 text-sky-700", review: "bg-amber-50 text-amber-700", resolved: "bg-emerald-50 text-emerald-700", closed: "bg-slate-100 text-slate-600" };
const CATEGORIES: [string, string][] = [["security", "Security"], ["maintenance", "Maintenance"], ["noise", "Noise or nuisance"], ["car_pass", "Car pass or gate"], ["other", "Other"]];
const categoryLabel = (value: string) => CATEGORIES.find(([id]) => id === value)?.[1] ?? value;

const toReport = (row: Record<string, string | null>): Report => ({
  id: String(row.id), reference: String(row.reference), homeownerId: String(row.homeowner_id), category: String(row.category), subject: String(row.subject), details: String(row.details),
  incidentDate: row.incident_date || "", location: row.location || "", status: String(row.status) as Status, createdAt: String(row.created_at), updatedAt: String(row.updated_at), resolvedAt: row.resolved_at || "",
});
const toMessage = (row: Record<string, string | null>): Message => ({
  id: String(row.id), reportId: String(row.report_id), authorRole: row.author_role === "admin" ? "admin" : "homeowner", authorName: String(row.author_name), kind: String(row.kind) as Kind, body: String(row.body), createdAt: String(row.created_at),
});

const stamp = (iso: string) => new Date(iso).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dayOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const localToday = () => dayOf(new Date().toISOString());
const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
const explain = (message = "") => (/row-level security|permission denied/i.test(message) ? `You do not have permission to do this. (${message})` : message);

const PRESET_LABEL: Record<string, string> = { all: "All dates", today: "Today", last7: "Last 7 days", last30: "Last 30 days", next7: "Next 7 days", next30: "Next 30 days", month: "This month", year: "This year" };
const periodLabel = (f: DateFilterValue) => (f.preset === "custom" ? `${f.from ? longDate(f.from) : "the beginning"} to ${f.to ? longDate(f.to) : "today"}` : PRESET_LABEL[f.preset] || "All dates");

function StatusPill({ status }: { status: Status }) { return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${PILL[status]}`}>{STATUS_LABEL[status]}</span>; }

// ----------------------------------------------------------------- export ---

// Spreadsheets run text that starts with = + - @ as a formula, so such cells get a leading quote.
const csvCell = (value: string) => { let text = value.replace(/\r?\n/g, " "); if (/^[=+\-@\t]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function buildRows(items: Report[], ownerOf: (r: Report) => Owner | undefined, admin: boolean) {
  const head = ["Reference", "Date filed", "Category", "Subject", "Details", "Status", "Resolved on", "Days to resolve", ...(admin ? ["Homeowner", "Block", "Lot", "Phone"] : [])];
  const body = items.map(r => {
    const owner = ownerOf(r);
    return [r.reference, dayOf(r.createdAt), categoryLabel(r.category), r.subject, r.details, STATUS_LABEL[r.status], r.resolvedAt ? dayOf(r.resolvedAt) : "", r.resolvedAt ? String(daysBetween(r.createdAt, r.resolvedAt)) : "",
      ...(admin ? [owner?.name || "", owner?.block || "", owner?.lot || "", owner?.phone || ""] : [])];
  });
  return { head, body };
}

function summarize(items: Report[]) {
  const byStatus = Object.fromEntries(STATUSES.map(s => [s, items.filter(r => r.status === s).length])) as Record<Status, number>;
  const resolved = items.filter(r => r.resolvedAt);
  const average = resolved.length ? resolved.reduce((sum, r) => sum + daysBetween(r.createdAt, r.resolvedAt), 0) / resolved.length : null;
  return { total: items.length, byStatus, byCategory: CATEGORIES.map(([id, label]) => [label, items.filter(r => r.category === id).length] as [string, number]), average };
}

function ReportGenerator({ reports, ownerOf, admin, initialDate, onClose, onError }: { reports: Report[]; ownerOf: (r: Report) => Owner | undefined; admin: boolean; initialDate: DateFilterValue; onClose: () => void; onError: (message: string) => void }) {
  const [date, setDate] = useState<DateFilterValue>(initialDate);
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const picked = reports.filter(r => (status === "all" || r.status === status) && (category === "all" || r.category === category) && matchesDate(r.createdAt, date));
  const summary = summarize(picked);
  const subtitle = `${periodLabel(date)}${status !== "all" ? ` · ${STATUS_LABEL[status as Status]}` : ""}${category !== "all" ? ` · ${categoryLabel(category)}` : ""}`;

  const download = () => {
    const { head, body } = buildRows(picked, ownerOf, admin);
    const csv = [head, ...body].map(row => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `reports-${localToday()}.csv`; link.click();
    URL.revokeObjectURL(url);
  };
  const print = () => {
    const { head, body } = buildRows(picked, ownerOf, admin);
    const view = window.open("", "_blank");
    if (!view) { onError("Your browser blocked the print window. Allow pop-ups for this site and try again."); return; }
    const tiles = [["Total", summary.total], ...STATUSES.map(s => [STATUS_LABEL[s], summary.byStatus[s]] as [string, number])];
    view.document.write(`<!doctype html><html><head><title>Isabel Village reports</title><style>body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:24px}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 12px;color:#475569;font-size:13px}table{border-collapse:collapse;width:100%;margin-bottom:18px}th,td{border:1px solid #cbd5e1;padding:5px 7px;font-size:11px;text-align:left;vertical-align:top}th{background:#f1f5f9}</style></head><body><h1>Isabel Village - Reports</h1><p>${esc(subtitle)} · Generated ${esc(stamp(new Date().toISOString()))}</p><table><tr>${tiles.map(([label]) => `<th>${esc(String(label))}</th>`).join("")}</tr><tr>${tiles.map(([, count]) => `<td>${count}</td>`).join("")}</tr></table><p>${summary.average === null ? "No resolved reports in this selection." : `Average time to resolve: ${summary.average.toFixed(1)} days.`}</p><table><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr>${body.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</table></body></html>`);
    view.document.close(); view.focus(); view.print();
  };

  return <Modal title="Generate report" onClose={onClose}>
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <DateFilter value={date} onChange={setDate} label="report period"/>
      <select aria-label="Filter by status" className="field max-w-44" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
      <select aria-label="Filter by category" className="field max-w-48" value={category} onChange={e => setCategory(e.target.value)}><option value="all">All categories</option>{CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    </div>
    <p className="mt-4 text-sm font-semibold text-slate-700">{subtitle}</p>
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {([["Total", summary.total], ...STATUSES.map(s => [STATUS_LABEL[s], summary.byStatus[s]])] as [string, number][]).map(([label, count]) => <div key={label} className="rounded-xl bg-slate-50 p-3 text-center"><div className="text-2xl font-bold text-slate-900">{count}</div><div className="text-xs text-slate-500">{label}</div></div>)}
    </div>
    <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">{summary.byCategory.filter(([, n]) => n > 0).map(([label, n]) => <span key={label} className="rounded-full bg-slate-100 px-3 py-1">{label}: <b>{n}</b></span>)}</div>
    <p className="mt-3 text-sm text-slate-500">{summary.average === null ? "No resolved reports in this selection yet." : `Average time to resolve: ${summary.average.toFixed(1)} days.`}</p>
    {picked.length ? <div className="table-wrap mt-4 max-h-64 overflow-y-auto"><table className="data-table"><thead><tr><th>Reference</th><th>Filed</th><th>Subject</th><th>Status</th></tr></thead><tbody>{picked.map(r => <tr key={r.id}><td className="font-mono text-xs">{r.reference}</td><td>{dayOf(r.createdAt)}</td><td>{r.subject}</td><td><StatusPill status={r.status}/></td></tr>)}</tbody></table></div> : <p className="mt-4 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No reports match these choices.</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary" disabled={!picked.length} onClick={download}><Download className="h-4 w-4"/>Download CSV</button>
      <button type="button" className="btn-primary" disabled={!picked.length} onClick={print}><Printer className="h-4 w-4"/>Print / save as PDF</button>
    </div>
  </Modal>;
}

// ------------------------------------------------------------ one report ---

function ReportDetail({ report, thread, owner, admin, busy, onClose, onReply, onStatus, onDelete }: {
  report: Report; thread: Message[]; owner?: Owner; admin: boolean; busy: boolean; onClose: () => void;
  onReply: (text: string, internal: boolean) => Promise<boolean>; onStatus: (next: Status, note: string) => Promise<boolean>; onDelete: () => void;
}) {
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [next, setNext] = useState<Status>(report.status);
  const [note, setNote] = useState("");
  const visible = thread.filter(m => admin || m.kind !== "note");
  return <Modal title={`${report.reference} · ${report.subject}`} onClose={onClose}>
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600"><StatusPill status={report.status}/><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{categoryLabel(report.category)}</span><span>Filed {stamp(report.createdAt)}</span></div>
    {admin && owner && <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm"><div className="font-semibold text-slate-900">{owner.name} <span className="font-normal text-slate-500">· Block {owner.block}, Lot {owner.lot}</span></div><div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-slate-600"><a className="inline-flex items-center gap-1 font-semibold text-emerald-700" href={`tel:${owner.phone}`}><Phone className="h-4 w-4"/>{owner.phone}</a><span>{showEmail(owner.email)}</span></div></div>}
    <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="whitespace-pre-wrap text-sm text-slate-800 [overflow-wrap:anywhere]">{report.details}</p>{(report.incidentDate || report.location) && <p className="mt-3 text-xs text-slate-500">{report.incidentDate && `Happened on ${longDate(report.incidentDate)}`}{report.incidentDate && report.location && " · "}{report.location && `Where: ${report.location}`}</p>}</div>

    <h3 className="mt-6 text-sm font-bold text-slate-900">Conversation</h3>
    <div className="mt-2 space-y-3">
      {visible.length === 0 && <p className="text-sm text-slate-500">No replies yet.</p>}
      {visible.map(m => <div key={m.id} className={`rounded-xl border p-3 text-sm ${m.kind === "note" ? "border-amber-200 bg-amber-50" : m.kind === "status" ? "border-slate-200 bg-slate-50" : m.authorRole === "admin" ? "border-emerald-200 bg-emerald-50" : "border-sky-200 bg-sky-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span className="font-semibold text-slate-700">{m.authorName}{m.authorRole === "admin" ? " · Association office" : ""}{m.kind === "note" ? " · Internal note (only admins can see this)" : m.kind === "status" ? " · Status update" : ""}</span><span>{stamp(m.createdAt)}</span></div>
        <p className="mt-1 whitespace-pre-wrap text-slate-800 [overflow-wrap:anywhere]">{m.body}</p>
      </div>)}
    </div>

    {report.status !== "closed" ? <form className="mt-4 space-y-3" onSubmit={async e => { e.preventDefault(); if (text.trim() && await onReply(text.trim(), internal)) { setText(""); setInternal(false); } }}>
      <label><span className="label">{admin ? "Reply to the resident" : "Add a message"}</span><textarea required name="reply" rows={3} maxLength={2000} className="field" value={text} onChange={e => setText(e.target.value)} placeholder={admin ? "Write your reply..." : "Add more details or answer the association office..."}/></label>
      <div className="flex flex-wrap items-center justify-between gap-3">{admin ? <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="internal" checked={internal} onChange={e => setInternal(e.target.checked)}/>Internal note (only admins can see it)</label> : <span/>}<button disabled={busy || !text.trim()} className="btn-primary">{busy ? "Sending…" : internal ? "Save note" : "Send"}</button></div>
    </form> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">This report is closed, so no more messages can be added.</p>}

    {admin && <div className="mt-6 rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-bold text-slate-900">Change status</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr]">
        <select aria-label="New status" className="field" value={next} onChange={e => setNext(e.target.value as Status)}>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        <input aria-label="Message to the resident" className="field" maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder={next === "closed" ? "Reason for closing (required)" : "Message to the resident (optional)"}/>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-rose-600" onClick={onDelete}><Trash2 className="h-4 w-4"/>Delete report</button><button type="button" disabled={busy || next === report.status} className="btn-primary" onClick={async () => { if (await onStatus(next, note)) setNote(""); }}>Update status</button></div>
    </div>}
  </Modal>;
}

// ------------------------------------------------------------------- page ---

export function ReportsPage({ role }: { role: Role }) {
  const supabase = useMemo(() => createClient(), []);
  const { homeowners, notify } = useStore();
  const admin = role === "admin";
  const [reports, setReports] = useState<Report[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [load, setLoad] = useState<"loading" | "ready" | "setup" | "error">("loading");
  const [problem, setProblem] = useState("");
  const [me, setMe] = useState({ id: "", name: "" });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [date, setDate] = useState<DateFilterValue>(noDateFilter);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [r, m] = await Promise.all([supabase.from("reports").select("*").order("created_at", { ascending: false }), supabase.from("report_messages").select("*").order("created_at", { ascending: true })]);
    const failure = r.error || m.error;
    if (failure) { setProblem(failure.message); setLoad(/does not exist|schema cache|could not find/i.test(failure.message) ? "setup" : "error"); return; }
    setReports((r.data || []).map(toReport)); setMessages((m.data || []).map(toMessage)); setLoad("ready");
  }, [supabase]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { data: profile } = await supabase.from("profiles").select("first_name,last_name").eq("id", data.user.id).single();
      setMe({ id: data.user.id, name: profile ? `${profile.first_name} ${profile.last_name}`.trim() : "" });
    })();
  }, [supabase]);

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token;
  const ownerOf = useCallback((report: Report): Owner | undefined => {
    const h = homeowners.find(x => x.id === report.homeownerId);
    return h ? { id: h.id, name: `${h.firstName} ${h.lastName}`.trim(), block: h.block, lot: h.lot, phone: h.phone, email: h.email } : undefined;
  }, [homeowners]);
  const threadOf = (id: string) => messages.filter(m => m.reportId === id);
  // An open report needs an answer when the resident spoke last, or nobody from the office has replied yet.
  const needsReply = (report: Report) => {
    if (report.status === "resolved" || report.status === "closed") return false;
    const replies = threadOf(report.id).filter(m => m.kind === "reply");
    return replies.length === 0 || replies[replies.length - 1].authorRole === "homeowner";
  };

  const list = reports.filter(r => (status === "all" || r.status === status) && (category === "all" || r.category === category) && matchesDate(r.createdAt, date)
    && `${r.reference} ${r.subject} ${ownerOf(r)?.name || ""}`.toLowerCase().includes(search.toLowerCase()));
  const pager = usePagination(list, `${search}|${status}|${category}|${dateKey(date)}`);
  const open = reports.find(r => r.id === openId) || null;

  // --- resident: file a report (with a review step first) ---
  const submitNew = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const draft = { category: String(form.get("category")), subject: String(form.get("subject")).trim(), details: String(form.get("details")).trim(), incidentDate: String(form.get("incidentDate") || ""), location: String(form.get("location") || "").trim() };
    const invalid = draft.subject.length < 3 ? "The subject needs at least 3 characters." : draft.details.length < 10 ? "Please describe the problem in at least 10 characters." : "";
    if (invalid) { notify("error", invalid); return; }
    setPreview({
      title: "Review your report", confirmLabel: "Confirm & submit",
      rows: [{ label: "Category", value: categoryLabel(draft.category) }, { label: "Subject", value: draft.subject }, { label: "Details", value: draft.details }, { label: "Date it happened", value: draft.incidentDate ? longDate(draft.incidentDate) : "Not given" }, { label: "Where", value: draft.location || "Not given" }],
      onConfirm: () => fileReport(draft),
    });
  };
  const fileReport = async (draft: { category: string; subject: string; details: string; incidentDate: string; location: string }) => {
    const owner = homeowners[0];
    if (!owner) { setPreview(null); notify("error", "Your resident record could not be found. Please sign in again."); return; }
    setBusy(true);
    const { data, error } = await supabase.from("reports").insert({ homeowner_id: owner.id, category: draft.category, subject: draft.subject, details: draft.details, incident_date: draft.incidentDate || null, location: draft.location || null }).select("id,reference").single();
    setBusy(false); setPreview(null);
    if (error || !data) { notify("error", `Could not submit the report. ${explain(error?.message)}`.trim()); return; }
    setCreating(false);
    notify("success", `Your report ${data.reference} was submitted.`);
    await reload();
    const result = await notifyApi({ action: "report_filed", reportId: data.id }, await token());
    const sent: { channel: string; ok: boolean; to: string; error?: string }[] = Array.isArray(result.data?.results) ? result.data.results : [];
    for (const entry of sent) {
      if (entry.ok) notify("success", `A confirmation was emailed to ${entry.to}.`);
      else notify("error", `The confirmation email to ${entry.to} was not sent. ${entry.error || ""}`.trim());
    }
  };

  // --- shared: the conversation ---
  const postMessage = async (report: Report, body: string, kind: Kind) => {
    const { error } = await supabase.from("report_messages").insert({ report_id: report.id, author_id: me.id, author_role: admin ? "admin" : "homeowner", author_name: me.name || (admin ? "Association office" : "Resident"), kind, body });
    return error;
  };
  const tell = async (report: Report, event: "status" | "reply") => {
    const result = await notifyApi({ action: "report_update", reportId: report.id, event }, await token());
    const sent: { channel: string; ok: boolean; to: string; error?: string }[] = Array.isArray(result.data?.results) ? result.data.results : [];
    for (const entry of sent) {
      if (entry.ok) notify("success", `The resident was told by email (${entry.to}).`);
      else notify("error", `The email to ${entry.to} was not sent. ${entry.error || ""}`.trim());
    }
    if (!sent.length && result.data?.note) notify("success", String(result.data.note));
    else if (!sent.length && !result.ok) notify("error", `The resident could not be notified. ${result.data?.error || ""}`.trim());
  };
  const reply = async (report: Report, body: string, internal: boolean) => {
    setBusy(true);
    const error = await postMessage(report, body, internal ? "note" : "reply");
    setBusy(false);
    if (error) { notify("error", `Could not send the message. ${explain(error.message)}`); return false; }
    await reload();
    notify("success", internal ? "The note was saved. Only admins can see it." : admin ? "Your reply was saved." : "Your message was sent.");
    if (admin && !internal) await tell(report, "reply");
    return true;
  };
  const changeStatus = async (report: Report, next: Status, note: string) => {
    if (next === "closed" && note.trim().length < 5) { notify("error", "Please give a reason for closing the report (at least 5 characters)."); return false; }
    setBusy(true);
    const { error } = await supabase.from("reports").update({ status: next }).eq("id", report.id);
    if (error) { setBusy(false); notify("error", `Could not change the status. ${explain(error.message)}`); return false; }
    await postMessage(report, note.trim() ? `${STATUS_LABEL[next]}: ${note.trim()}` : `Status changed to ${STATUS_LABEL[next]}.`, "status");
    setBusy(false);
    await reload();
    notify("success", `Report ${report.reference} is now ${STATUS_LABEL[next]}.`);
    await tell(report, "status");
    return true;
  };
  const remove = async (report: Report) => {
    if (!confirm(`Permanently delete report ${report.reference}?\n\nThe resident will no longer see it. This cannot be undone.`)) return;
    const { error } = await supabase.from("reports").delete().eq("id", report.id);
    if (error) { notify("error", `Could not delete the report. ${explain(error.message)}`); return; }
    setOpenId(null); await reload();
    notify("success", `Report ${report.reference} was deleted.`);
  };

  if (load === "loading") return <Empty message="Loading reports…"/>;
  if (load === "setup") return <div className="card p-8 text-sm text-slate-600"><h2 className="text-lg font-bold text-slate-900">Reports are not set up yet</h2><p className="mt-2">{admin ? "The database tables for reports are missing. Run reports.sql in the Supabase SQL Editor, then reload this page." : "This feature is not available yet. Please contact the association office."}</p></div>;
  if (load === "error") return <div className="card p-8 text-sm text-rose-700"><h2 className="text-lg font-bold">Reports could not be loaded</h2><p className="mt-2">{problem}</p></div>;

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <p className="max-w-xl text-sm text-slate-500">{admin ? "Review reports filed by residents, reply to them and track their status." : "Report a concern, incident or problem to the association office and follow its progress here."}</p>
      <div className="flex gap-2"><button className="btn-secondary" onClick={() => setGenerating(true)}><FileText className="h-4 w-4"/>Generate report</button>{!admin && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4"/>New report</button>}</div>
    </div>
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <SearchBox value={search} onChange={setSearch} placeholder={admin ? "Search reference, subject or resident..." : "Search reference or subject..."}/>
      <select aria-label="Filter by status" className="field max-w-44" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
      <select aria-label="Filter by category" className="field max-w-48" value={category} onChange={e => setCategory(e.target.value)}><option value="all">All categories</option>{CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <DateFilter value={date} onChange={setDate} label="date filed"/>
    </div>
    {list.length ? <><div className="table-wrap"><table className="data-table"><thead><tr><th>Report</th>{admin && <th>Resident</th>}<th>Category</th><th>Filed</th><th>Status</th><th></th></tr></thead><tbody>
      {pager.pageItems.map(r => { const owner = ownerOf(r); return <tr key={r.id}>
        <td><div className="font-semibold text-slate-900">{r.subject}</div><div className="font-mono text-xs text-slate-400">{r.reference}</div></td>
        {admin && <td>{owner ? <>{owner.name}<div className="text-xs text-slate-400">Block {owner.block}, Lot {owner.lot}</div></> : "—"}</td>}
        <td>{categoryLabel(r.category)}</td><td>{dayOf(r.createdAt)}</td>
        <td><StatusPill status={r.status}/>{admin && needsReply(r) && <div className="mt-1 text-[11px] font-semibold text-amber-600">Needs a reply</div>}</td>
        <td><div className="flex justify-end"><button className="btn-secondary" onClick={() => setOpenId(r.id)}>Open</button></div></td></tr>; })}
    </tbody></table></div><Pagination pager={pager}/></> : <Empty message={reports.length ? "No reports match these filters." : admin ? "No reports have been filed yet." : "You have not filed any reports yet."}/>}

    {creating && <Modal title="New report" onClose={() => setCreating(false)}><form onSubmit={submitNew} className="grid gap-4 sm:grid-cols-2">
      <label><span className="label">Category</span><select required name="category" className="field" defaultValue=""><option value="" disabled>Choose a category</option>{CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label><span className="label">Date it happened (optional)</span><input type="date" name="incidentDate" max={localToday()} className="field"/></label>
      <label className="sm:col-span-2"><span className="label">Subject</span><input required name="subject" minLength={3} maxLength={120} className="field" placeholder="e.g. Broken streetlight near Block 5"/></label>
      <label className="sm:col-span-2"><span className="label">Details</span><textarea required name="details" minLength={10} maxLength={2000} rows={5} className="field" placeholder="Tell us what happened and anything that helps us find the problem."/></label>
      <label className="sm:col-span-2"><span className="label">Where (optional)</span><input name="location" maxLength={120} className="field" placeholder="e.g. Corner of Rose St. and Block 5"/></label>
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="btn-primary">Review report</button></div>
    </form></Modal>}
    <FormPreview preview={preview} busy={busy} onClose={() => setPreview(null)}/>
    {open && <ReportDetail key={open.id} report={open} thread={threadOf(open.id)} owner={ownerOf(open)} admin={admin} busy={busy} onClose={() => setOpenId(null)} onReply={(text, internal) => reply(open, text, internal)} onStatus={(next, note) => changeStatus(open, next, note)} onDelete={() => void remove(open)}/>}
    {generating && <ReportGenerator reports={reports} ownerOf={ownerOf} admin={admin} initialDate={date} onClose={() => setGenerating(false)} onError={message => notify("error", message)}/>}
  </div>;
}
