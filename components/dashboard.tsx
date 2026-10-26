"use client";

import { useStore } from "@/lib/store";
import { CalendarDays, Car, CheckCircle2, ClipboardCheck, Home, Megaphone, ShieldCheck, Users } from "lucide-react";
import { Badge } from "./ui";

export function AdminDashboard() {
  const { homeowners, vehicles, events, gateLogs, announcements } = useStore();
  const today = "2026-08-20";
  const stats = [
    ["Total Homeowners", homeowners.length, Users, "bg-emerald-50 text-emerald-700"], ["Active Homeowners", homeowners.filter(x => x.status === "active").length, CheckCircle2, "bg-blue-50 text-blue-700"],
    ["Registered Vehicles", vehicles.length, Car, "bg-violet-50 text-violet-700"], ["Active Car Passes", vehicles.filter(x => x.status === "active").length, ShieldCheck, "bg-amber-50 text-amber-700"],
    ["Entries Today", gateLogs.filter(x => x.createdAt.startsWith(today)).length, ClipboardCheck, "bg-cyan-50 text-cyan-700"], ["Upcoming Events", events.filter(x => x.date >= today).length, CalendarDays, "bg-rose-50 text-rose-700"],
  ] as const;
  return <div className="space-y-8"><div><h2 className="text-2xl font-bold text-slate-900">Good morning, Admin</h2><p className="mt-1 text-sm text-slate-500">Here’s what’s happening in Isabel Village today.</p></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{stats.map(([label, value, Icon, color]) => <div className="card p-5" key={label}><div className="flex items-start justify-between"><div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{value}</p></div><div className={`rounded-xl p-3 ${color}`}><Icon className="h-5 w-5"/></div></div></div>)}</div>
    <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]"><section><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold">Recent Gate Activity</h3><span className="text-xs text-slate-500">Live records</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Resident</th><th>Vehicle</th><th>Status</th><th>Time</th></tr></thead><tbody>{gateLogs.slice(0,5).map(log => <tr key={log.id}><td className="font-semibold">{log.resident}</td><td>{log.vehicle}<div className="text-xs text-slate-400">{log.plateNumber}</div></td><td><Badge value={log.status}/></td><td>{new Date(log.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td></tr>)}</tbody></table></div></section>
      <section><h3 className="mb-4 text-lg font-bold">Community Updates</h3><div className="card divide-y divide-slate-100">{announcements.filter(x => x.status === "published").slice(0,3).map(a => <div className="flex gap-3 p-4" key={a.id}><div className="mt-0.5 rounded-lg bg-emerald-50 p-2 text-emerald-700"><Megaphone className="h-4 w-4"/></div><div><p className="text-sm font-semibold">{a.title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{a.description}</p></div></div>)}</div></section></div>
  </div>;
}

export function ResidentDashboard() {
  const { homeowners, vehicles, announcements, events } = useStore(); const me = homeowners[0]; const mine = vehicles.filter(x => x.homeownerId === me?.id);
  return <div className="space-y-8"><div className="overflow-hidden rounded-2xl bg-gradient-to-r from-[#123d2a] to-emerald-700 p-7 text-white shadow-lg"><p className="text-sm text-emerald-100">Resident portal</p><h2 className="mt-2 text-3xl font-bold">Welcome home, {me?.firstName}!</h2><p className="mt-2 text-sm text-emerald-50/80">Block {me?.block}, Lot {me?.lot} • Isabel Village</p></div>
    <div className="grid gap-4 sm:grid-cols-3"><div className="card flex items-center gap-4 p-5"><Home className="h-7 w-7 text-emerald-700"/><div><p className="text-2xl font-bold">Active</p><p className="text-xs text-slate-500">Resident status</p></div></div><div className="card flex items-center gap-4 p-5"><Car className="h-7 w-7 text-blue-700"/><div><p className="text-2xl font-bold">{mine.length}</p><p className="text-xs text-slate-500">Registered vehicles</p></div></div><div className="card flex items-center gap-4 p-5"><CalendarDays className="h-7 w-7 text-violet-700"/><div><p className="text-2xl font-bold">{events.length}</p><p className="text-xs text-slate-500">Upcoming events</p></div></div></div>
    <div className="grid gap-6 lg:grid-cols-2"><section><h3 className="mb-4 text-lg font-bold">Latest announcements</h3><div className="space-y-3">{announcements.filter(x=>x.status==="published").map(a=><article className="card p-5" key={a.id}><p className="text-xs font-semibold uppercase text-emerald-700">{new Date(a.date).toLocaleDateString()}</p><h4 className="mt-2 font-bold">{a.title}</h4><p className="mt-2 text-sm leading-6 text-slate-500">{a.description}</p></article>)}</div></section><section><h3 className="mb-4 text-lg font-bold">Upcoming events</h3><div className="space-y-3">{events.map(e=><article className="card flex gap-4 p-5" key={e.id}><div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><span className="text-xs font-bold uppercase">{new Date(e.date+"T00:00:00").toLocaleDateString([], {month:"short"})}</span><span className="text-xl font-bold">{new Date(e.date+"T00:00:00").getDate()}</span></div><div><h4 className="font-bold">{e.title}</h4><p className="mt-1 text-xs text-slate-500">{e.time} • {e.location}</p><p className="mt-2 text-sm text-slate-500">{e.description}</p></div></article>)}</div></section></div>
  </div>;
}
