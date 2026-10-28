// Image-quality checks for facial recognition (SENTINEL).
// Pure functions: no browser or face-api imports, so every rule can be tested and tuned from this one file.
// Pixel values are measured on a downscaled frame (QUALITY.analysisWidth px wide) so results do not depend on camera resolution.

export const QUALITY = {
  analysisWidth: 320,   // frame width used for measuring
  minFaceRatio: 0.22,   // face box width / frame width; below this the face is too far away
  maxFaceRatio: 0.75,   // above this the face is too close
  maxCenterX: 0.2,      // allowed horizontal offset from frame centre (fraction of width)
  maxCenterY: 0.25,     // allowed vertical offset from frame centre (fraction of height)
  minScore: 0.6,        // minimum face-detector confidence
  darkBelow: 70,        // mean face brightness (0-255) under this = too dark
  brightAbove: 195,     // over this = washed out / glare
  backlitGap: 45,       // background must be this much brighter than the face...
  backlitRatio: 1.45,   // ...and at least this many times brighter to count as backlit
  unevenRatio: 0.35,    // left/right brightness difference as a fraction of the brighter side
  minSharpness: 40,     // variance of the Laplacian on the face crop; below this = blurry
  maxNoseOffset: 0.14,  // |nose position between jaw edges - 0.5|; above this the head is turned
} as const;

export type Level = "block" | "warn";
export type Group = "face" | "lighting" | "position" | "focus";
export type QualityIssue = { code: string; level: Level; group: Group; message: string };
export type QualityCheck = { id: Group; label: string; ok: boolean; hint: string };
export type QualityMetrics = { brightness: number; background: number; sharpness: number; faceRatio: number; leftRight: number };
export type QualityReport = { issues: QualityIssue[]; checks: QualityCheck[]; ok: boolean; blocking: boolean; metrics: Partial<QualityMetrics> };
export type FaceBox = { x: number; y: number; width: number; height: number };
export type FaceInput = { box: FaceBox; score: number; noseRatio?: number };

const MESSAGES = {
  "no-face": "No face found. Look straight at the camera.",
  "multiple-faces": "More than one face in view. Only one person at a time.",
  "low-confidence": "Face not clearly visible. Remove anything covering it.",
  "too-dark": "Too dark. Turn on a light or move somewhere brighter.",
  "too-bright": "Too bright or glare on the face. Reduce direct light.",
  "backlit": "Light is behind you. Face the light and move away from windows.",
  "uneven": "Light hits one side of the face. Face the light evenly.",
  "too-small": "Move closer to the camera.",
  "too-large": "Move back a little.",
  "off-center": "Center your face inside the oval.",
  "turned": "Face the camera straight on.",
  "blurry": "Image is blurry. Hold still and wipe the camera lens.",
} as const;

const LABELS: Record<Group, string> = { face: "Face", lighting: "Lighting", position: "Distance & angle", focus: "Sharpness" };
const GROUPS: Group[] = ["face", "lighting", "position", "focus"];

function toGray(pixels: Uint8ClampedArray, width: number, height: number) {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
  return gray;
}

function clampRect(width: number, height: number, x0: number, y0: number, x1: number, y1: number) {
  return { x0: Math.max(0, Math.floor(x0)), y0: Math.max(0, Math.floor(y0)), x1: Math.min(width, Math.ceil(x1)), y1: Math.min(height, Math.ceil(y1)) };
}

function sumRect(gray: Float32Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number) {
  const r = clampRect(width, height, x0, y0, x1, y1);
  let sum = 0, count = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) { sum += gray[y * width + x]; count++; }
  return { sum, count };
}

function meanRect(gray: Float32Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number) {
  const { sum, count } = sumRect(gray, width, height, x0, y0, x1, y1);
  return count ? sum / count : 0;
}

// Variance of the 3x3 Laplacian: high when edges are crisp, low when the image is blurred.
function laplacianVariance(gray: Float32Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number) {
  const r = clampRect(width, height, x0, y0, x1, y1);
  let sum = 0, sumSq = 0, n = 0;
  for (let y = Math.max(1, r.y0); y < Math.min(height - 1, r.y1); y++) {
    for (let x = Math.max(1, r.x0); x < Math.min(width - 1, r.x1); x++) {
      const i = y * width + x;
      const v = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      sum += v; sumSq += v * v; n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function assessFaceQuality(input: { pixels: Uint8ClampedArray; width: number; height: number; faces: FaceInput[] }): QualityReport {
  const { pixels, width, height, faces } = input;
  const gray = toGray(pixels, width, height);
  const issues: QualityIssue[] = [];
  const metrics: Partial<QualityMetrics> = {};
  const add = (code: keyof typeof MESSAGES, level: Level, group: Group) => issues.push({ code, level, group, message: MESSAGES[code] });

  // No face: the only thing we can still judge is the overall light level of the scene.
  if (!faces.length) {
    add("no-face", "block", "face");
    const scene = meanRect(gray, width, height, 0, 0, width, height);
    metrics.brightness = Math.round(scene);
    if (scene < QUALITY.darkBelow) add("too-dark", "block", "lighting");
    else if (scene > QUALITY.brightAbove) add("too-bright", "block", "lighting");
    return finish(issues, metrics, false);
  }

  // Judge the largest face; extra faces are a separate problem.
  const face = faces.reduce((a, b) => (b.box.width * b.box.height > a.box.width * a.box.height ? b : a));
  if (faces.length > 1) add("multiple-faces", "block", "face");
  if (face.score < QUALITY.minScore) add("low-confidence", "block", "face");

  // Lighting: brightness of the central face area, compared with the rest of the frame and across the face.
  const { x, y, width: bw, height: bh } = face.box;
  const coreX0 = x + bw * 0.2, coreX1 = x + bw * 0.8, coreY0 = y + bh * 0.15, coreY1 = y + bh * 0.85;
  const brightness = meanRect(gray, width, height, coreX0, coreY0, coreX1, coreY1);
  const total = sumRect(gray, width, height, 0, 0, width, height);
  const around = sumRect(gray, width, height, x - bw * 0.15, y - bh * 0.15, x + bw * 1.15, y + bh * 1.15);
  const background = total.count - around.count > 0 ? (total.sum - around.sum) / (total.count - around.count) : brightness;
  const midX = (coreX0 + coreX1) / 2;
  const left = meanRect(gray, width, height, coreX0, coreY0, midX, coreY1);
  const right = meanRect(gray, width, height, midX, coreY0, coreX1, coreY1);
  const leftRight = Math.abs(left - right) / Math.max(left, right, 1);
  metrics.brightness = Math.round(brightness); metrics.background = Math.round(background); metrics.leftRight = Number(leftRight.toFixed(2));

  const backlit = background - brightness > QUALITY.backlitGap && background > brightness * QUALITY.backlitRatio;
  if (backlit) add("backlit", "block", "lighting");
  else if (brightness < QUALITY.darkBelow) add("too-dark", "block", "lighting");
  else if (brightness > QUALITY.brightAbove) add("too-bright", "block", "lighting");
  else if (leftRight > QUALITY.unevenRatio) add("uneven", "warn", "lighting");

  // Position: distance, centring and head angle.
  const faceRatio = bw / width;
  metrics.faceRatio = Number(faceRatio.toFixed(2));
  if (faceRatio < QUALITY.minFaceRatio) add("too-small", "block", "position");
  else if (faceRatio > QUALITY.maxFaceRatio) add("too-large", "warn", "position");
  const offX = Math.abs(x + bw / 2 - width / 2) / width, offY = Math.abs(y + bh / 2 - height / 2) / height;
  if (offX > QUALITY.maxCenterX || offY > QUALITY.maxCenterY) add("off-center", "warn", "position");
  if (face.noseRatio !== undefined && Math.abs(face.noseRatio - 0.5) > QUALITY.maxNoseOffset) add("turned", "block", "position");

  // Focus: crisp edges on the face crop.
  const sharpness = laplacianVariance(gray, width, height, x, y, x + bw, y + bh);
  metrics.sharpness = Math.round(sharpness);
  if (sharpness < QUALITY.minSharpness) add("blurry", "block", "focus");

  return finish(issues, metrics, true);
}

function finish(issues: QualityIssue[], metrics: Partial<QualityMetrics>, faceFound: boolean): QualityReport {
  const checks: QualityCheck[] = GROUPS.map(id => {
    const first = issues.find(i => i.group === id);
    const notMeasured = !faceFound && (id === "position" || id === "focus");
    return { id, label: LABELS[id], ok: !first && !notMeasured, hint: first?.message ?? (notMeasured ? "Waiting for a face." : "") };
  });
  return { issues, checks, ok: issues.length === 0, blocking: issues.some(i => i.level === "block"), metrics };
}
