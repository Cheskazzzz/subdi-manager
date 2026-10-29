"use client";

import { ReactNode, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";

export function Badge({ value }: { value: string }) {
  const good = ["active", "approved", "published"].includes(value.toLowerCase());
  const bad = ["expired", "denied", "inactive"].includes(value.toLowerCase());
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${good ? "bg-emerald-50 text-emerald-700" : bad ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{value}</span>;
}

export function SearchBox({ value, onChange, placeholder = "Search..." }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input className="field pl-9" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/></div>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4"><h2 className="text-lg font-bold">{title}</h2><button aria-label="Close" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={onClose}><X className="h-5 w-5"/></button></div>
      <div className="p-6">{children}</div>
    </div>
  </div>;
}

export function Empty({ message = "No records found." }: { message?: string }) { return <div className="card py-16 text-center text-sm text-slate-500">{message}</div>; }
export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ---- Form preview: shows what the person typed so they can check it before the final submit ----
export type PreviewRow = { label: string; value: string };
export type PreviewState = { title?: string; confirmLabel?: string; rows: PreviewRow[]; onConfirm: () => void | Promise<void> };

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const longDate = (date: string) => date ? new Date(date + "T00:00:00").toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }) : "";
export const longTime = (time: string) => time ? new Date("1970-01-01T" + time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

export function FormPreview({ preview, onClose, busy = false }: { preview: PreviewState | null; onClose: () => void; busy?: boolean }) {
  if (!preview) return null;
  return <Modal title={preview.title ?? "Review your details"} onClose={() => { if (!busy) onClose(); }}>
    <p className="text-sm text-slate-600">Please check that everything below is correct. Choose <strong>Edit</strong> to go back and change anything.</p>
    <dl className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      {preview.rows.map(row => <div key={row.label} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</dt>
        <dd className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere] sm:text-right">{row.value || "—"}</dd>
      </div>)}
    </dl>
    <div className="mt-6 flex justify-end gap-2">
      <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Edit</button>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void preview.onConfirm()}>{busy ? "Submitting…" : preview.confirmLabel ?? "Confirm & submit"}</button>
    </div>
  </Modal>;
}

// ---- Pagination: every list shows 10 records per page ----
export const PAGE_SIZE = 10;

export function usePagination<T>(items: T[], resetKey = "") {
  const [requested, setRequested] = useState(1);
  // Searching or filtering starts again from page 1.
  useEffect(() => { setRequested(1); }, [resetKey]);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(requested, totalPages);
  const start = (page - 1) * PAGE_SIZE;
  return { page, setPage: setRequested, totalPages, total: items.length, start, pageItems: items.slice(start, start + PAGE_SIZE) };
}

export type PagerState = { page: number; setPage: (page: number) => void; totalPages: number; total: number; start: number; pageItems: readonly unknown[] };

function pageNumbers(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const wanted = Array.from(new Set([1, totalPages, page - 1, page, page + 1])).filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  wanted.forEach((n, i) => { if (i > 0 && n - wanted[i - 1] > 1) out.push("…"); out.push(n); });
  return out;
}

export function Pagination({ pager, compact = false }: { pager: PagerState; compact?: boolean }) {
  const { page, setPage, totalPages, total, start, pageItems } = pager;
  if (!total) return null;
  const from = start + 1;
  const to = start + pageItems.length;
  const arrow = "btn-secondary px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50";
  if (compact) return <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
    <span>{from}–{to} of {total}</span>
    <div className="flex items-center gap-2">
      <button type="button" className={arrow} disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4"/></button>
      <span>Page {page} of {totalPages}</span>
      <button type="button" className={arrow} disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4"/></button>
    </div>
  </div>;
  return <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
    <p className="text-sm text-slate-500">Showing {from}–{to} of {total} record{total === 1 ? "" : "s"}</p>
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-1">
      <button type="button" className={arrow} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4"/>Previous</button>
      {pageNumbers(page, totalPages).map((n, i) => n === "…"
        ? <span key={`gap-${i}`} className="px-2 text-slate-400">…</span>
        : <button key={n} type="button" aria-current={n === page ? "page" : undefined} onClick={() => setPage(n)} className={`h-9 min-w-9 rounded-lg px-3 text-sm font-semibold ${n === page ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{n}</button>)}
      <button type="button" className={arrow} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next<ChevronRight className="h-4 w-4"/></button>
    </nav>
  </div>;
}
