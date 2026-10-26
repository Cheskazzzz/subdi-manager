"use client";

import { Role } from "@/lib/types";
import { useState } from "react";
import { Building2, CalendarDays, Car, ClipboardList, Home, LayoutDashboard, LogOut, Megaphone, Menu, ScanFace, ShieldCheck, UserCog, UserRound, Users, X } from "lucide-react";

export type PageKey = "dashboard" | "homeowners" | "vehicles" | "verify" | "logs" | "announcements" | "events" | "facial" | "profile" | "my-vehicles" | "staff";
const allItems: { key: PageKey; label: string; icon: typeof Home; roles: Role[]; superAdminOnly?: boolean }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "homeowner"] },
  { key: "homeowners", label: "Homeowners", icon: Users, roles: ["admin"] },
  { key: "vehicles", label: "Car Passes", icon: Car, roles: ["admin"] },
  { key: "verify", label: "Verify Car Pass", icon: ShieldCheck, roles: ["security"] },
  { key: "logs", label: "Gate Logs", icon: ClipboardList, roles: ["admin", "security"] },
  { key: "profile", label: "My Profile", icon: UserRound, roles: ["homeowner"] },
  { key: "my-vehicles", label: "My Vehicles", icon: Car, roles: ["homeowner"] },
  { key: "announcements", label: "Announcements", icon: Megaphone, roles: ["admin", "homeowner"] },
  { key: "events", label: "Events", icon: CalendarDays, roles: ["admin", "homeowner"] },
  { key: "facial", label: "Facial Recognition", icon: ScanFace, roles: ["admin", "security"] },
  { key: "staff", label: "Staff Accounts", icon: UserCog, roles: ["admin"], superAdminOnly: true },
];

export function Shell({ role, name, superAdmin, page, setPage, logout, children }: { role: Role; name: string; superAdmin: boolean; page: PageKey; setPage: (p: PageKey) => void; logout: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false); const items = allItems.filter(x => x.roles.includes(role) && (!x.superAdminOnly || superAdmin)); const active = items.find(x => x.key === page);
  // Name comes from the signed-in account's profile; fall back to the role while it loads.
  const displayName = name || role;
  const sidebar = <aside className="flex h-full w-64 flex-col bg-[#123d2a] text-white">
    <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5"><div className="rounded-xl bg-emerald-500 p-2"><Building2 className="h-6 w-6"/></div><div><div className="font-bold">Isabel Village</div><div className="text-xs text-emerald-100/70">Community Manager</div></div></div>
    <nav className="flex-1 space-y-1 overflow-y-auto p-3">{items.map(item => <button key={item.key} onClick={() => { setPage(item.key); setOpen(false); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${page === item.key ? "bg-white text-emerald-900 shadow-sm" : "text-emerald-50/80 hover:bg-white/10 hover:text-white"}`}><item.icon className="h-4.5 w-4.5"/><span>{item.label}</span></button>)}</nav>
    <div className="border-t border-white/10 p-3"><div className="mb-2 flex items-center gap-3 px-3 py-2"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 font-bold">{displayName[0]}</div><div><div className="text-sm font-semibold capitalize">{displayName}</div><div className="text-xs capitalize text-emerald-100/60">{superAdmin ? "Super admin" : role}</div></div></div><button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-emerald-50/80 hover:bg-white/10"><LogOut className="h-4 w-4"/>Log out</button></div>
  </aside>;
  return <div className="min-h-screen lg:flex"><div className="hidden lg:fixed lg:inset-y-0 lg:block">{sidebar}</div>{open && <div className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"><div className="h-full">{sidebar}</div><button className="absolute left-[17rem] top-5 rounded-lg bg-white p-2" onClick={() => setOpen(false)}><X className="h-5 w-5"/></button></div>}
    <main className="min-w-0 flex-1 lg:ml-64"><header className="sticky top-0 z-30 flex h-20 items-center border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-8"><div className="flex items-center gap-3"><button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5"/></button><div><h1 className="text-xl font-bold text-slate-900">{active?.label || "Dashboard"}</h1><p className="hidden text-xs text-slate-500 sm:block">Isabel Village • Community Operations</p></div></div></header><div className="p-4 sm:p-8">{children}</div></main>
  </div>;
}
