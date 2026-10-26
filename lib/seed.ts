import { AppData } from "./types";

export const seedData: AppData = {
  homeowners: [
    { id: "h1", firstName: "Juan", lastName: "Dela Cruz", email: "juan@example.com", phone: "0917 123 4567", block: "4", lot: "12", status: "active" },
    { id: "h2", firstName: "Maria", lastName: "Santos", email: "maria@example.com", phone: "0918 234 5678", block: "2", lot: "8", status: "active" },
    { id: "h3", firstName: "Ramon", lastName: "Reyes", email: "ramon@example.com", phone: "0919 345 6789", block: "7", lot: "3", status: "inactive" },
    { id: "h4", firstName: "Ana", lastName: "Garcia", email: "ana@example.com", phone: "0920 456 7890", block: "1", lot: "21", status: "active" },
    { id: "h5", firstName: "Paolo", lastName: "Lim", email: "paolo@example.com", phone: "0917 555 0142", block: "5", lot: "6", status: "pending" },
  ],
  vehicles: [
    { id: "v1", homeownerId: "h1", plateNumber: "ABC-1234", brand: "Toyota", model: "Vios", color: "Silver", passNumber: "IV-2026-001", status: "active", expirationDate: "2027-01-31" },
    { id: "v2", homeownerId: "h2", plateNumber: "NCR-5678", brand: "Honda", model: "City", color: "White", passNumber: "IV-2026-002", status: "active", expirationDate: "2026-12-31" },
    { id: "v3", homeownerId: "h3", plateNumber: "XYZ-9012", brand: "Ford", model: "Everest", color: "Black", passNumber: "IV-2025-041", status: "expired", expirationDate: "2025-12-31" },
    { id: "v4", homeownerId: "h1", plateNumber: "NBO-4821", brand: "Mitsubishi", model: "Montero", color: "Gray", passNumber: "Pending", status: "pending", expirationDate: "" },
  ],
  announcements: [
    { id: "a1", title: "Water Interruption Notice", description: "Water services will temporarily be unavailable on August 25 from 9 AM to 2 PM for scheduled maintenance.", date: "2026-08-18", status: "published" },
    { id: "a2", title: "Updated Gate Access Policy", description: "Please display your active digital car pass when entering the main gate beginning September 1.", date: "2026-08-15", status: "published" },
    { id: "a3", title: "Community Garden Guidelines", description: "New community garden guidelines are currently being reviewed by the homeowners association.", date: "2026-08-12", status: "draft" },
  ],
  events: [
    { id: "e1", title: "Homeowners General Assembly", description: "Quarterly community update and open forum.", date: "2026-09-05", time: "09:00", location: "Isabel Village Clubhouse" },
    { id: "e2", title: "Weekend Clean-up Drive", description: "Help keep our shared spaces clean and green.", date: "2026-09-12", time: "07:00", location: "Main Park" },
  ],
  gateLogs: [
    { id: "g1", homeownerId: "h1", vehicleId: "v1", resident: "Juan Dela Cruz", vehicle: "Toyota Vios", plateNumber: "ABC-1234", verificationType: "Car Pass", status: "approved", verifiedBy: "Officer Mendoza", createdAt: "2026-08-20T08:32:00+08:00" },
    { id: "g2", homeownerId: "h2", vehicleId: "v2", resident: "Maria Santos", vehicle: "Honda City", plateNumber: "NCR-5678", verificationType: "Car Pass", status: "approved", verifiedBy: "Officer Mendoza", createdAt: "2026-08-20T08:21:00+08:00" },
  ],
};
