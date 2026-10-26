"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "./supabase/client";
import { Announcement, AppData, CommunityEvent, GateLog, Homeowner, Vehicle } from "./types";

type Store = AppData & {
  loading: boolean;
  saveHomeowner: (item: Homeowner) => void; deleteHomeowner: (id: string) => void;
  saveVehicle: (item: Vehicle) => void; deleteVehicle: (id: string) => void;
  saveAnnouncement: (item: Announcement) => void; deleteAnnouncement: (id: string) => void;
  saveEvent: (item: CommunityEvent) => void; deleteEvent: (id: string) => void;
  addGateLog: (item: GateLog) => void;
};

const empty: AppData = { homeowners: [], vehicles: [], announcements: [], events: [], gateLogs: [] };
const databaseId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : undefined;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<AppData>(empty);
  const [loading, setLoading] = useState(true);

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
    const homeowners: Homeowner[] = (homeownersResult.data || []).map(row => ({ id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone || "", block: row.block, lot: row.lot, status: row.status }));
    const vehicles: Vehicle[] = (vehiclesResult.data || []).map(row => ({ id: row.id, homeownerId: row.homeowner_id, plateNumber: row.plate_number, brand: row.brand, model: row.model, color: row.color, passNumber: row.pass_number || "Pending", status: row.status, expirationDate: row.expiration_date || "" }));
    const announcements: Announcement[] = (announcementsResult.data || []).map(row => ({ id: row.id, title: row.title, description: row.description, date: row.announcement_date, status: row.status }));
    const events: CommunityEvent[] = (eventsResult.data || []).map(row => ({ id: row.id, title: row.title, description: row.description, date: row.event_date, time: String(row.event_time).slice(0, 5), location: row.location }));
    const gateLogs: GateLog[] = (logsResult.data || []).map(row => { const vehicle = vehicles.find(item => item.id === row.vehicle_id); const homeowner = homeowners.find(item => item.id === row.homeowner_id); return { id: row.id, homeownerId: row.homeowner_id, vehicleId: row.vehicle_id, resident: homeowner ? `${homeowner.firstName} ${homeowner.lastName}` : "Unknown", vehicle: vehicle ? `${vehicle.brand} ${vehicle.model}` : "—", plateNumber: vehicle?.plateNumber || "—", verificationType: row.verification_type, status: row.status, verifiedBy: "Authorized staff", createdAt: row.created_at }; });
    setData({ homeowners, vehicles, announcements, events, gateLogs }); setLoading(false);
  }, [supabase]);

  useEffect(() => { refresh(); const { data: listener } = supabase.auth.onAuthStateChange(() => refresh()); return () => listener.subscription.unsubscribe(); }, [refresh, supabase]);
  const run = async (operation: PromiseLike<{ error: { message: string } | null }>) => { const { error } = await operation; if (error) alert(error.message); else await refresh(); };
  const value: Store = { ...data, loading,
    saveHomeowner: item => { void run(supabase.from("homeowners").upsert({ id: databaseId(item.id), first_name: item.firstName, last_name: item.lastName, email: item.email, phone: item.phone, block: item.block, lot: item.lot, status: item.status })); },
    // Use the database function so deleting a resident also removes their linked
    // Supabase Auth login. A plain table delete would leave that login active.
    deleteHomeowner: id => { void run(supabase.rpc("delete_homeowner_account", { p_homeowner_id: id })); },
    saveVehicle: item => { void run(supabase.from("vehicles").upsert({ id: databaseId(item.id), homeowner_id: item.homeownerId, plate_number: item.plateNumber, brand: item.brand, model: item.model, color: item.color, pass_number: ["", "PENDING"].includes(item.passNumber.trim().toUpperCase()) ? null : item.passNumber, status: item.status, expiration_date: item.expirationDate || null })); },
    deleteVehicle: id => { void run(supabase.from("vehicles").delete().eq("id", id)); },
    saveAnnouncement: item => { void run(supabase.from("announcements").upsert({ id: databaseId(item.id), title: item.title, description: item.description, announcement_date: item.date, status: item.status })); },
    deleteAnnouncement: id => { void run(supabase.from("announcements").delete().eq("id", id)); },
    saveEvent: item => { void run(supabase.from("events").upsert({ id: databaseId(item.id), title: item.title, description: item.description, event_date: item.date, event_time: item.time, location: item.location })); },
    deleteEvent: id => { void run(supabase.from("events").delete().eq("id", id)); },
    addGateLog: item => { void (async () => { const { data: userData } = await supabase.auth.getUser(); await run(supabase.from("gate_logs").insert({ homeowner_id: item.homeownerId || null, vehicle_id: item.vehicleId || null, verification_type: item.verificationType, status: item.status, verified_by: userData.user?.id || null })); })(); },
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() { const store = useContext(StoreContext); if (!store) throw new Error("StoreProvider missing"); return store; }
