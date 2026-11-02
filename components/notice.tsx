"use client";

import { useEffect } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";

// Pop-up alerts shown after every change the system makes (approve, edit, delete, ...),
// telling the user clearly whether it worked or failed.
export type NoticeType = "success" | "error";
export type Notice = { id: number; type: NoticeType; message: string };

function NoticeCard({ notice, onClose }: { notice: Notice; onClose: (id: number) => void }) {
  // Successes close by themselves; failures stay a little longer so the reason can be read.
  useEffect(() => {
    const timer = window.setTimeout(() => onClose(notice.id), notice.type === "success" ? 4500 : 9000);
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.type, onClose]);
  const ok = notice.type === "success";
  return <div role={ok ? "status" : "alert"} className={`pointer-events-auto flex w-full items-start gap-3 rounded-xl border bg-white p-4 shadow-xl ${ok ? "border-emerald-200" : "border-rose-200"}`}>
    {ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"/> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"/>}
    <div className="min-w-0 flex-1">
      <p className={`text-sm font-bold ${ok ? "text-emerald-800" : "text-rose-800"}`}>{ok ? "Success" : "Action failed"}</p>
      <p className="mt-0.5 text-sm text-slate-600 [overflow-wrap:anywhere]">{notice.message}</p>
    </div>
    <button type="button" aria-label="Dismiss" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => onClose(notice.id)}><X className="h-4 w-4"/></button>
  </div>;
}

export function NoticePopup({ notices, onClose }: { notices: Notice[]; onClose: (id: number) => void }) {
  if (!notices.length) return null;
  return <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4">
    <div className="flex w-full max-w-md flex-col gap-2">{notices.map(notice => <NoticeCard key={notice.id} notice={notice} onClose={onClose}/>)}</div>
  </div>;
}
