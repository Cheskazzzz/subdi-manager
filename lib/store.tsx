"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "./supabase/client";
import { Notice, NoticePopup, NoticeType } from "@/components/notice";
import { Announcement, AppData, CommunityEvent, GateLog, Homeowner, Vehicle } from "./types";

type Store = AppData & {
  loading: boolean;
  notify: (type: NoticeType, message: string) => void;
  saveHomeowner: (item: Homeowner) => void; deleteHomeowner: (id: string) => void;
  saveVehicle: (item: Vehicle) => void; deleteVehicle: (id: string) => void;
  saveAnnouncement: (item: Announcement) => void; deleteAnnouncement: (id: string) => void;
  saveEvent: (item: CommunityEvent) => void; deleteEvent: (id: string) => void;
  addGateLog: (item: GateLog) => void;
};

const empty: AppData = { homeowners: [], vehicles: [], announcements: [], events: [], gateLogs: [] };
const databaseId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : undefined;
const StoreContext = createContext<Store | null>(null);

// Turns raw database errors into something a person can act on.
function friendlyError(message: string) {
  if (/duplicate key|already exists/i.test(message)) return "A record with the same email, plate number or pass number already exists.";
  if (/foreign key/i.test(message)) return "It is still being used by other records.";
  if (/row-level security|permission denied|not allowed/i.test(message)) return "You do not have permission to do this.";
  return message;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<AppData>(empty);
  const [loading, setLoading] = useState(true);
  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback((type: NoticeType, message: string) => { setNotices(list => [...list.slice(-2), { id: Date.now() + Math.random(), type, message }]); }, []);
  const dismiss = useCallback((id: number) => { setNotices(list => list.filter(item => item.id !== id)); }, []);

  // Load only the rows permitted by Supabase Row Level Security for the signed-in user.
  const refresh = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) { setData(empty); setLoading(false); return; }
    setLoading(true);
    const [homeownersResult, vehiclesResult, announcementsResult, eventsResult, logsResult] = await Promise.all([
      supabase.from("homeowners").select("*"), supabase.from("vehicles").select("*"),
      supabase.from("announcements").select("*").order("announcement_date", { ascending: false }),
      supabase.from("events").select("*").order("event_date"), supabase.from("gate_logs").select("*").order("created_at", { ascending: false }),
    ]);
    const homeowners: Homeowner[] = (homeownersResult.data || []).map(row => ({ id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone || "", block: row.block, lot: row.lot, status: row.status, denialReason: row.denial_reason || "" }));
    const vehicles: Vehicle[] = (vehiclesResult.data || []).map(row => ({ id: row.id, homeownerId: row.homeowner_id, plateNumber: row.plate_number, brand: row.brand, model: row.model, color: row.color, passNumber: row.pass_number || "Pending", status: row.status, expirationDate: row.expiration_date || "" }));
    const announcements: Announcement[] = (announcementsResult.data || []).map(row => ({ id: row.id, title: row.title, description: row.description, date: row.announcement_date, status: row.status }));
    const events: CommunityEvent[] = (eventsResult.data || []).map(row => ({ id: row.id, title: row.title, description: row.description, date: row.event_date, time: String(row.event_time).slice(0, 5), location: row.location }));
    const gateLogs: GateLog[] = (logsResult.data || []).map(row => { const vehicle = vehicles.find(item => item.id === row.vehicle_id); const homeowner = homeowners.find(item => item.id === row.homeowner_id); return { id: row.id, homeownerId: row.homeowner_id, vehicleId: row.vehicle_id, resident: homeowner ? `${homeowner.firstName} ${homeowner.lastName}` : "Unknown", vehicle: vehicle ? `${vehicle.brand} ${vehicle.model}` : "—", plateNumber: vehicle?.plateNumber || "—", verificationType: row.verification_type, status: row.status, verifiedBy: "Authorized staff", createdAt: row.created_at }; });
    setData({ homeowners, vehicles, announcements, events, gateLogs }); setLoading(false);
  }, [supabase]);

  useEffect(() => { refresh(); const { data: listener } = supabase.auth.onAuthStateChange(() => refresh()); return () => listener.subscription.unsubscribe(); }, [refresh, supabase]);
  // Runs one change, then shows a pop-up saying whether it worked. An empty `success` stays silent.
  const run = async (operation: PromiseLike<{ error: { message: string } | null }>, success: string, failure: string) => {
    const { error } = await operation;
    if (error) { notify("error", `${failure}. ${friendlyError(error.message)}`); return; }
    if (success) notify("success", success);
    await refresh();
  };
  const personName = (item: { firstName: string; lastName: string }) => `${item.firstName} ${item.lastName}`.trim();
  const value: Store = { ...data, loading, notify,
    saveHomeowner: item => {
      const before = data.homeowners.find(x => x.id === item.id); const name = personName(item); const denied = item.status === "denied";
      const [success, failure] = !before ? [`${name} was added as a homeowner.`, "Could not add the homeowner"]
        : before.status === "pending" && item.status === "active" ? [`${name}'s registration was approved. They can now sign in.`, "Could not approve the registration"]
        : denied && before.status !== "denied" ? [`${name}'s registration was denied.`, "Could not deny the registration"]
        : [`${name}'s record was updated.`, "Could not update the homeowner"];
      // The denial reason column is only touched when a registration is denied (or a denial is lifted).
      const reason = denied || before?.status === "denied" ? { denial_reason: denied ? (item.denialReason || "").trim() || null : null } : {};
      void run(supabase.from("homeowners").upsert({ id: databaseId(item.id), first_name: item.firstName, last_name: item.lastName, email: item.email, phone: item.phone, block: item.block, lot: item.lot, status: item.status, ...reason }), success, failure);
    },
    // Use the database function so deleting a resident also removes their linked
    // Supabase Auth login. A plain table delete would leave that login active.
    deleteHomeowner: id => { const target = data.homeowners.find(x => x.id === id); void run(supabase.rpc("delete_homeowner_account", { p_homeowner_id: id }), `${target ? personName(target) : "The homeowner"}'s account was deleted.`, "Could not delete the homeowner"); },
    saveVehicle: item => {
      const before = data.vehicles.find(x => x.id === item.id); const plate = item.plateNumber;
      const [success, failure] = !before ? (item.status === "pending" ? [`Car pass request for ${plate} was submitted for approval.`, "Could not submit the car pass request"] : [`Vehicle ${plate} was registered.`, "Could not register the vehicle"])
        : before.status === "pending" && item.status === "active" ? [`Car pass for ${plate} was approved.`, "Could not approve the car pass"]
        : [`Vehicle ${plate} was updated.`, "Could not update the vehicle"];
      void run(supabase.from("vehicles").upsert({ id: databaseId(item.id), homeowner_id: item.homeownerId, plate_number: item.plateNumber, brand: item.brand, model: item.model, color: item.color, pass_number: ["", "PENDING"].includes(item.passNumber.trim().toUpperCase()) ? null : item.passNumber, status: item.status, expiration_date: item.expirationDate || null }), success, failure);
    },
    deleteVehicle: id => { const target = data.vehicles.find(x => x.id === id); void run(supabase.from("vehicles").delete().eq("id", id), `Vehicle ${target?.plateNumber ?? ""} was deleted.`.replace("  ", " "), "Could not delete the vehicle"); },
    saveAnnouncement: item => { const before = data.announcements.some(x => x.id === item.id); void run(supabase.from("announcements").upsert({ id: databaseId(item.id), title: item.title, description: item.description, announcement_date: item.date, status: item.status }), `Announcement "${item.title}" was ${before ? "updated" : "created"}.`, `Could not ${before ? "update" : "create"} the announcement`); },
    deleteAnnouncement: id => { const target = data.announcements.find(x => x.id === id); void run(supabase.from("announcements").delete().eq("id", id), target ? `Announcement "${target.title}" was deleted.` : "The announcement was deleted.", "Could not delete the announcement"); },
    saveEvent: item => { const before = data.events.some(x => x.id === item.id); void run(supabase.from("events").upsert({ id: databaseId(item.id), title: item.title, description: item.description, event_date: item.date, event_time: item.time, location: item.location }), `Event "${item.title}" was ${before ? "updated" : "created"}.`, `Could not ${before ? "update" : "create"} the event`); },
    deleteEvent: id => { const target = data.events.find(x => x.id === id); void run(supabase.from("events").delete().eq("id", id), target ? `Event "${target.title}" was deleted.` : "The event was deleted.", "Could not delete the event"); },
    addGateLog: item => { void (async () => { const { data: userData } = await supabase.auth.getUser(); await run(supabase.from("gate_logs").insert({ homeowner_id: item.homeownerId || null, vehicle_id: item.vehicleId || null, verification_type: item.verificationType, status: item.status, verified_by: userData.user?.id || null }), "", "Could not record the gate log"); })(); },
  };
  return <StoreContext.Provider value={value}>{children}<NoticePopup notices={notices} onClose={dismiss}/></StoreContext.Provider>;
}

export function useStore() { const store = useContext(StoreContext); if (!store) throw new Error("StoreProvider missing"); return store; }
