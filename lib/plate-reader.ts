// Reading a plate or car-pass sticker from the camera (SENTINEL).
// Pure functions: no browser or OCR-library imports, so every rule can be tested and tuned from this one file.
import type { Vehicle } from "./types";

export const SCAN = {
  guide: { x: 0.1, y: 0.33, w: 0.8, h: 0.34 }, // the on-screen rectangle, as fractions of the video frame
  analysisWidth: 320,   // width of the small copy used for live quality checks
  darkP95Below: 45,     // if even the brightest 5% of pixels are darker than this, the view is too dark
  washedP5Above: 170,   // if even the darkest 5% of pixels are lighter than this, the view is washed out
  minContrast: 15,      // std-dev of brightness; a flatter view has no readable text
  minSharpness: 75,     // variance of the Laplacian; below this the text is blurred
  glareColumns: 3,      // this many neighbouring columns washed out inside the text area = glare hiding characters
  glareInkRatio: 0.6,   // a column whose dark ink falls below this share of the normal text level counts as washed out
  minPlateLength: 5,    // shortest plate worth matching (e.g. AB-123)
} as const;

// ---------- Matching OCR text to registered vehicles ----------

// Letters that OCR often swaps for digits (and the other way round). Both sides are folded onto one symbol before comparing.
const LOOKALIKE: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", S: "5", B: "8", Z: "2", G: "6" };

export const normalizeId = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, "");
const fold = (text: string) => normalizeId(text).replace(/[A-Z]/g, c => LOOKALIKE[c] ?? c);

// Placeholders such as "Pending" (a pass not issued yet) are not real pass numbers. Real ones always contain digits.
const isRealPass = (pass: string) => /\d/.test(pass);

// Exact lookup for typed input. Ignores case, spaces and hyphens, so "abc1234" finds "ABC-1234".
export function findVehicle(vehicles: Vehicle[], query: string): Vehicle | undefined {
  const q = normalizeId(query);
  if (!q) return undefined;
  return vehicles.find(v => normalizeId(v.plateNumber) === q || (isRealPass(v.passNumber) && normalizeId(v.passNumber) === q));
}

export type ScanMatch =
  | { kind: "match"; vehicle: Vehicle; matchedOn: "plate" | "pass"; text: string }
  | { kind: "ambiguous"; vehicles: Vehicle[]; text: string }
  | { kind: "none"; text: string };

// Best guess of what was printed, shown to the guard when nothing matched: the line with the most letters and digits.
function bestLine(raw: string) {
  const lines = raw.split(/\r?\n/).map(l => l.toUpperCase().replace(/[^A-Z0-9-]/g, "")).filter(l => normalizeId(l).length >= 4);
  lines.sort((a, b) => normalizeId(b).length - normalizeId(a).length);
  return (lines[0] ?? "").slice(0, 14);
}

// Look for any registered plate or pass number inside the OCR text. Only registered values can match, which is far more
// reliable than guessing a plate from scratch. Several similar matches are never auto-picked: the guard must confirm.
export function matchFromText(raw: string, vehicles: Vehicle[]): ScanMatch {
  const text = bestLine(raw);
  const lines = raw.split(/\r?\n/).map(fold).filter(Boolean);
  const haystacks = [...lines, fold(raw)];
  const hits: { vehicle: Vehicle; matchedOn: "plate" | "pass"; target: string }[] = [];
  for (const vehicle of vehicles) {
    const candidates: ["plate" | "pass", string][] = [["plate", fold(vehicle.plateNumber)], ["pass", isRealPass(vehicle.passNumber) ? fold(vehicle.passNumber) : ""]];
    for (const [matchedOn, target] of candidates) {
      if (target.length < SCAN.minPlateLength) continue;
      if (haystacks.some(h => h.includes(target))) { hits.push({ vehicle, matchedOn, target }); break; }
    }
  }
  // "ABC-123" is contained in "ABC-1234": when both appear to match, the longer one is the real reading.
  const longest = hits.filter(a => !hits.some(b => b !== a && b.target.length > a.target.length && b.target.includes(a.target)));
  const unique = longest.filter((h, i) => longest.findIndex(o => o.vehicle.id === h.vehicle.id) === i);
  if (unique.length === 1) return { kind: "match", vehicle: unique[0].vehicle, matchedOn: unique[0].matchedOn, text };
  if (unique.length > 1) return { kind: "ambiguous", vehicles: unique.map(u => u.vehicle), text };
  return { kind: "none", text };
}

// ---------- Quality of the view inside the on-screen rectangle ----------

export type ScanIssue = { code: string; group: "lighting" | "text" | "focus"; message: string };
export type ScanCheck = { id: "lighting" | "text" | "focus"; label: string; ok: boolean; hint: string };
export type ScanReport = { issues: ScanIssue[]; checks: ScanCheck[]; ok: boolean; metrics: { p5: number; p95: number; contrast: number; sharpness: number; blownColumns: number } };

const MESSAGES = {
  glare: "Glare on the plate. Tilt the camera slightly or shade it from direct light.",
  "too-bright": "Washed out by bright light. Reduce direct light on the plate.",
  "too-dark": "Too dark. Add light so the characters stand out.",
  "low-contrast": "No readable text yet. Move closer and fit the plate inside the rectangle.",
  blurry: "Blurry. Hold steady and wipe the camera lens.",
} as const;

export function assessScanQuality(input: { pixels: Uint8ClampedArray; width: number; height: number }): ScanReport {
  const { pixels, width, height } = input;
  const n = width * height;
  const gray = new Float32Array(n), hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    gray[i] = v; sum += v; hist[Math.min(255, Math.round(v))]++;
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (gray[i] - mean) ** 2;
  const contrast = Math.sqrt(varSum / n);
  const percentile = (q: number) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * q) return v; } return 255; };
  const p5 = percentile(0.05), p95 = percentile(0.95);

  // Glare matters when it hides characters. A bright white plate is fine, so compare columns across the text area: glare
  // thins out the dark ink in a stretch of neighbouring columns while turning them white.
  const BINS = 24, ink = new Array<number>(BINS).fill(0), white = new Array<number>(BINS).fill(0), count = new Array<number>(BINS).fill(0);
  const inkLimit = p5 + (p95 - p5) * 0.35;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const b = Math.min(BINS - 1, Math.floor((x * BINS) / width)), v = gray[y * width + x];
    count[b]++; if (v <= inkLimit) ink[b]++; if (v >= 250) white[b]++;
  }
  const share = ink.map((k, b) => k / count[b]);
  // text-bearing columns have some ink but are not uniformly dark (uniformly dark columns are the car around the plate)
  const textCols = share.map((v, b) => ({ v, b })).filter(c => c.v > 0.03 && c.v < 0.7);
  let run = 0, blownColumns = 0;
  if (p95 - p5 >= 30 && textCols.length >= 4) {
    const sortedShare = textCols.map(c => c.v).sort((a, b) => a - b);
    const normal = sortedShare[Math.floor((sortedShare.length - 1) * 0.75)];
    if (normal >= 0.15) for (let b = textCols[0].b; b <= textCols[textCols.length - 1].b; b++) {
      const washed = share[b] < normal * SCAN.glareInkRatio && white[b] / count[b] > 0.4;
      run = washed ? run + 1 : 0; blownColumns = Math.max(blownColumns, run);
    }
  }

  let lapSum = 0, lapSq = 0, lapN = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    const v = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
    lapSum += v; lapSq += v * v; lapN++;
  }
  const lapMean = lapN ? lapSum / lapN : 0;
  const sharpness = lapN ? lapSq / lapN - lapMean * lapMean : 0;

  const issues: ScanIssue[] = [];
  const add = (code: keyof typeof MESSAGES, group: ScanIssue["group"]) => issues.push({ code, group, message: MESSAGES[code] });
  if (blownColumns >= SCAN.glareColumns) add("glare", "lighting");
  else if (p5 > SCAN.washedP5Above) add("too-bright", "lighting");
  else if (p95 < SCAN.darkP95Below) add("too-dark", "lighting");
  if (contrast < SCAN.minContrast) add("low-contrast", "text");
  else if (sharpness < SCAN.minSharpness) add("blurry", "focus"); // a flat view is also "not sharp", so report only the real cause

  const labels = { lighting: "Lighting", text: "Text in view", focus: "Sharpness" } as const;
  const checks = (["lighting", "text", "focus"] as const).map(id => {
    const first = issues.find(i => i.group === id);
    return { id, label: labels[id], ok: !first, hint: first?.message ?? "" };
  });
  return { issues, checks, ok: issues.length === 0, metrics: { p5, p95, contrast: Math.round(contrast), sharpness: Math.round(sharpness), blownColumns } };
}
