// Dropdown choices for registering a vehicle (SENTINEL).
// To add a brand, model or color, edit the lists below. Nothing else needs to change.
// Residents whose vehicle is not listed can pick "Other" and type it, so nobody is blocked from registering.

export const OTHER = "__other__";

// Models are listed roughly by how common they are in the Philippines. Motorcycles are included under their brands.
export const MODELS: Record<string, string[]> = {
  Audi: ["A3", "A4", "A6", "Q3", "Q5", "Q7", "Q8", "e-tron"],
  Bajaj: ["Pulsar", "Dominar", "Rouser", "Boxer", "CT100"],
  BMW: ["1 Series", "2 Series", "3 Series", "5 Series", "7 Series", "X1", "X3", "X5", "X6", "X7", "Z4", "i4", "iX"],
  BYD: ["Atto 3", "Dolphin", "Seal", "Sealion 7", "Tang", "Han"],
  Changan: ["Alsvin", "CS35 Plus", "CS55 Plus", "CS75 Plus", "UNI-T", "UNI-K"],
  Chery: ["Tiggo 2", "Tiggo 5X", "Tiggo 7 Pro", "Tiggo 8 Pro", "Omoda 5", "Arrizo 5"],
  Chevrolet: ["Spark", "Sail", "Aveo", "Cruze", "Trax", "Trailblazer", "Colorado", "Captiva", "Camaro", "Suburban", "Tahoe"],
  Ford: ["Ranger", "Everest", "Territory", "EcoSport", "Explorer", "Expedition", "Escape", "Focus", "Fiesta", "Mustang", "Transit"],
  Foton: ["Gratour", "Toplander", "Thunder", "Tornado", "View"],
  GAC: ["GS3", "GS4", "GS8", "GN6", "M6", "Emkoo"],
  Geely: ["Coolray", "Azkarra", "Okavango", "Emgrand", "Starray"],
  Honda: ["City", "Civic", "Jazz", "Brio", "BR-V", "HR-V", "CR-V", "WR-V", "Accord", "Odyssey", "Mobilio", "Pilot", "Click", "Beat", "PCX", "ADV", "TMX", "XRM", "Wave", "Winner X"],
  Hyundai: ["Accent", "Elantra", "Eon", "Reina", "Venue", "Creta", "Stargazer", "Kona", "Tucson", "Santa Fe", "Palisade", "Staria", "Starex", "H100", "Ioniq"],
  Isuzu: ["D-Max", "mu-X", "Traviz", "Crosswind", "N-Series", "Elf"],
  "Jeep": ["Wrangler", "Gladiator", "Compass", "Renegade", "Cherokee", "Grand Cherokee"],
  JAC: ["T6", "T8", "S2", "S3"],
  Kawasaki: ["Ninja", "Z", "Versys", "Barako", "KLX", "W800"],
  Kia: ["Picanto", "Soluto", "Stonic", "Sonet", "Seltos", "Sportage", "Sorento", "Carnival", "K2500", "EV6"],
  Kymco: ["Like", "Xciting", "Agility", "AK550"],
  "Land Rover": ["Defender", "Discovery", "Range Rover", "Range Rover Sport", "Evoque", "Velar"],
  Lexus: ["IS", "ES", "LS", "UX", "NX", "RX", "GX", "LX", "LM"],
  Mazda: ["Mazda2", "Mazda3", "Mazda6", "CX-3", "CX-30", "CX-5", "CX-8", "CX-9", "BT-50", "MX-5"],
  "Mercedes-Benz": ["A-Class", "C-Class", "E-Class", "S-Class", "CLA", "GLA", "GLC", "GLE", "GLS", "G-Class", "V-Class", "Sprinter"],
  MG: ["MG 3", "MG 5", "ZS", "HS", "RX5", "One", "4 EV"],
  Mini: ["Cooper", "Countryman", "Clubman"],
  Mitsubishi: ["Mirage", "Mirage G4", "Xpander", "Xpander Cross", "Montero Sport", "Strada", "Triton", "L300", "Outlander", "Lancer", "Pajero", "Adventure"],
  Nissan: ["Almera", "Navara", "Terra", "Kicks", "Juke", "Livina", "Urvan", "Sentra", "X-Trail", "Patrol", "Note", "Leaf", "GT-R"],
  Peugeot: ["208", "2008", "3008", "5008", "Partner"],
  Porsche: ["911", "718", "Cayenne", "Macan", "Panamera", "Taycan"],
  "Royal Enfield": ["Classic 350", "Himalayan", "Meteor", "Interceptor"],
  Subaru: ["Impreza", "XV", "Forester", "Outback", "WRX", "BRZ", "Levorg"],
  Suzuki: ["Celerio", "Swift", "Dzire", "Ertiga", "XL7", "Jimny", "Vitara", "S-Presso", "Ciaz", "Fronx", "Ignis", "APV", "Carry", "Raider", "Burgman", "Skydrive", "Smash", "Gixxer"],
  SYM: ["Bonus", "Jet", "Crox", "Symphony", "Husky"],
  Toyota: ["Vios", "Wigo", "Yaris", "Corolla Altis", "Corolla Cross", "Camry", "Innova", "Avanza", "Veloz", "Rush", "Raize", "Fortuner", "Hilux", "Hiace", "RAV4", "Land Cruiser", "Land Cruiser Prado", "Alphard", "Lite Ace", "Prius", "GR86", "Supra"],
  Vespa: ["Primavera", "Sprint", "GTS", "LX"],
  Volkswagen: ["Lavida", "Santana", "Jetta", "Golf", "Polo", "T-Cross", "Tiguan", "Touareg"],
  Volvo: ["XC40", "XC60", "XC90", "S60", "S90", "V60"],
  Yamaha: ["Mio", "Aerox", "NMAX", "XMAX", "Sniper", "Fino", "R15", "MT-15", "Tricity"],
};

export const BRANDS = Object.keys(MODELS).sort((a, b) => a.localeCompare(b));

export const COLORS = ["White", "Black", "Silver", "Gray", "Red", "Blue", "Green", "Brown", "Beige", "Yellow", "Orange", "Gold", "Maroon", "Purple", "Pink"];

// ---------- The state behind the three dropdowns ----------

export type VehicleDraft = { brand: string; brandOther: string; model: string; modelOther: string; color: string; colorOther: string };

// Finds the list entry that matches what was saved earlier, ignoring capital letters ("toyota" -> "Toyota").
const canonical = (list: string[], value: string) => list.find(item => item.toLowerCase() === value.trim().toLowerCase());

// Builds the dropdown state from a saved vehicle. Values that are not on a list show up under "Other" so nothing is lost.
export function draftFrom(brand = "", model = "", color = ""): VehicleDraft {
  const draft: VehicleDraft = { brand: "", brandOther: "", model: "", modelOther: "", color: "", colorOther: "" };
  const b = canonical(BRANDS, brand);
  if (b) {
    draft.brand = b;
    const m = canonical(MODELS[b], model);
    if (m) draft.model = m; else if (model.trim()) { draft.model = OTHER; draft.modelOther = model.trim(); }
  } else if (brand.trim()) {
    draft.brand = OTHER; draft.brandOther = brand.trim(); draft.modelOther = model.trim();
  }
  const c = canonical(COLORS, color);
  if (c) draft.color = c; else if (color.trim()) { draft.color = OTHER; draft.colorOther = color.trim(); }
  return draft;
}

// Choosing a different brand clears the model, because the model list belongs to the brand.
export const withBrand = (d: VehicleDraft, brand: string): VehicleDraft => ({ ...d, brand, brandOther: brand === OTHER ? d.brandOther : "", model: "", modelOther: "" });

export const modelsFor = (brand: string) => (brand && brand !== OTHER ? MODELS[brand] ?? [] : []);

// The text that is saved. A brand that is not on the list has no model list, so its model is always typed.
export function valuesOf(d: VehicleDraft) {
  const brand = d.brand === OTHER ? d.brandOther.trim() : d.brand;
  const model = d.brand === OTHER || d.model === OTHER ? d.modelOther.trim() : d.model;
  const color = d.color === OTHER ? d.colorOther.trim() : d.color;
  return { brand, model, color };
}
