export type Role = "admin" | "security" | "homeowner";
export type Homeowner = { id: string; firstName: string; lastName: string; email: string; phone: string; block: string; lot: string; status: "pending" | "active" | "inactive" };
export type Vehicle = { id: string; homeownerId: string; plateNumber: string; brand: string; model: string; color: string; passNumber: string; status: "pending" | "active" | "expired" | "suspended"; expirationDate: string };
export type Announcement = { id: string; title: string; description: string; date: string; status: "published" | "draft" };
export type CommunityEvent = { id: string; title: string; description: string; date: string; time: string; location: string };
export type GateLog = { id: string; homeownerId?: string; vehicleId?: string; resident: string; vehicle: string; plateNumber: string; verificationType: string; status: "approved" | "denied"; verifiedBy: string; createdAt: string };
export type AppData = { homeowners: Homeowner[]; vehicles: Vehicle[]; announcements: Announcement[]; events: CommunityEvent[]; gateLogs: GateLog[] };
