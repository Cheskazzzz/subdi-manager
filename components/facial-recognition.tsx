"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RefreshCw, ScanFace, ShieldAlert, Trash2, UserPlus, XCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { Pagination, uid, usePagination } from "./ui";
import { assessFaceQuality, QUALITY, type FaceInput, type QualityReport } from "@/lib/face-quality";

type FaceApi = typeof import("@vladmandic/face-api");
type Template = { homeownerId: string; descriptor: number[]; enrolledAt: string };
type Result = { status: "approved" | "denied"; homeownerId?: string; distance?: number; message: string };
const MATCH_THRESHOLD = 0.55;
const MODEL_VERSION = "face-api-1.7";
// A finished capture waiting for the person to approve it. The photo exists only in browser memory.
type Pending = { homeownerId: string; descriptor: number[]; photo: string };
const ENROLL_FRAMES = 3;        // enrollment averages several good frames instead of trusting a single shot
const MAX_FRAME_SPREAD = 0.35;  // frames of the same person should be this close; larger means they moved

type Found = { detection: { box: { x: number; y: number; width: number; height: number }; score: number }; landmarks: { positions: { x: number }[] } };
type Frame = { pixels: Uint8ClampedArray; width: number; height: number; scale: number };

// Copy the current video frame to a small canvas so lighting and sharpness can be measured.
function sampleFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Frame | null {
  const width = QUALITY.analysisWidth, height = Math.round(video.videoHeight * width / video.videoWidth);
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return { pixels: ctx.getImageData(0, 0, width, height).data, width, height, scale: width / video.videoWidth };
}

// Mirrored still of the current frame so the review photo looks like the on-screen preview. Kept in memory only.
function snapshot(video: HTMLVideoElement): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = 480; canvas.height = Math.round(video.videoHeight * 480 / video.videoWidth);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Turn face-api detections into the plain numbers the quality checker needs (box, confidence, head angle).
function assess(frame: Frame, found: Found[]): QualityReport {
  const faces: FaceInput[] = found.map(f => {
    const p = f.landmarks.positions, span = p[16].x - p[0].x, box = f.detection.box;
    return {
      box: { x: box.x * frame.scale, y: box.y * frame.scale, width: box.width * frame.scale, height: box.height * frame.scale },
      score: f.detection.score,
      noseRatio: span > 0 ? (p[30].x - p[0].x) / span : undefined,
    };
  });
  return assessFaceQuality({ pixels: frame.pixels, width: frame.width, height: frame.height, faces });
}

export function FacialRecognitionPage() {
  const { homeowners, vehicles, addGateLog } = useStore();
  const supabase = useMemo(() => createClient(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const apiRef = useRef<FaceApi | null>(null);
  const [mode, setMode] = useState<"verify" | "enroll">("verify");
  const [modelsReady, setModelsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading recognition models…");
  const [selected, setSelected] = useState("");
  const [consent, setConsent] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const enrolledPager = usePagination(templates);
  const [result, setResult] = useState<Result | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<Pending | null>(null);

  // Templates are shared across devices through Supabase; RLS limits reads to admin/security and writes to admins.
  const loadTemplates = useCallback(async () => {
    const { data, error } = await supabase.from("biometric_templates").select("homeowner_id, descriptor, updated_at");
    if (error) { setMessage(`Could not load enrolled residents: ${error.message}`); return; }
    setTemplates((data || []).map(row => ({ homeownerId: row.homeowner_id, descriptor: row.descriptor, enrolledAt: row.updated_at })));
  }, [supabase]);

  useEffect(() => {
    void loadTemplates();
    let active = true;
    import("@vladmandic/face-api").then(async api => {
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri("/models"),
        api.nets.faceLandmark68TinyNet.loadFromUri("/models"),
        api.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      if (active) { apiRef.current = api; setModelsReady(true); setMessage("Models ready. Start the camera to continue."); }
    }).catch(() => active && setMessage("Recognition models could not be loaded. Refresh the page and try again."));
    return () => { active = false; streamRef.current?.getTracks().forEach(track => track.stop()); };
  }, [loadTemplates]);

  useEffect(() => { busyRef.current = busy; }, [busy]);

  // While the camera is on, re-check lighting, distance, angle and sharpness a little more than once a second
  // so the person at the gate sees what to fix before pressing the button.
  useEffect(() => {
    if (!cameraReady || !modelsReady || pending) return;
    let stopped = false, running = false;
    const tick = async () => {
      const api = apiRef.current, video = videoRef.current;
      if (running || busyRef.current || stopped || !api || !video || !video.videoWidth) return;
      running = true;
      try {
        const found = await api.detectAllFaces(video, new api.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })).withFaceLandmarks(true);
        const frame = sampleFrame(video, (canvasRef.current ??= document.createElement("canvas")));
        if (frame && !stopped) setQuality(assess(frame, found));
      } catch { /* a skipped check is harmless; the next tick tries again */ } finally { running = false; }
    };
    const timer = setInterval(tick, 800);
    return () => { stopped = true; clearInterval(timer); };
  }, [cameraReady, modelsReady, pending]);

  const startCamera = useCallback(async () => {
    setResult(null);
    try {
      streamRef.current?.getTracks().forEach(track => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      // Ask the camera to keep exposure and white balance automatic. Not every device supports this, so failure is ignored.
      try { await stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ exposureMode: "continuous", whiteBalanceMode: "continuous" } as unknown as MediaTrackConstraintSet] }); } catch { /* unsupported */ }
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraReady(true); setMessage("Camera ready. Center one face inside the frame.");
    } catch { setCameraReady(false); setMessage("Camera access was blocked. Allow camera permission in your browser and try again."); }
  }, []);

  const stopCamera = () => { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; setCameraReady(false); setQuality(null); setPending(null); if (videoRef.current) videoRef.current.srcObject = null; };
  // Detect faces in the live frame and score its quality before any template is created or compared.
  // The frame is only measured in memory; no image is saved.
  const analyse = async () => {
    const api = apiRef.current, video = videoRef.current;
    if (!api || !video || !video.videoWidth) return null;
    const found = await api.detectAllFaces(video, new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })).withFaceLandmarks(true).withFaceDescriptors();
    const frame = sampleFrame(video, (canvasRef.current ??= document.createElement("canvas")));
    if (!frame) return null;
    const report = assess(frame, found);
    setQuality(report);
    const face = found.length ? found.reduce((a, b) => (b.detection.box.width * b.detection.box.height > a.detection.box.width * a.detection.box.height ? b : a)) : undefined;
    return { report, descriptor: face?.descriptor };
  };
  const permissionMessage = (text: string) => /row-level security|permission denied/i.test(text) ? "Only administrators can enroll or delete biometric templates." : text;

  // Step 1 of enrollment: take quality-checked frames, then hold the result for the person to review. Nothing is saved yet.
  const capture = async () => {
    if (!selected || !consent) return;
    setBusy(true); setResult(null); setMessage("Scanning face… Keep still.");
    try {
      // A bad enrollment photo causes wrong results for months, so every frame must pass every quality check.
      const descriptors: Float32Array[] = [];
      for (let i = 0; i < ENROLL_FRAMES; i++) {
        const shot = await analyse();
        if (!shot) { setMessage("Camera is not ready. Start the camera and try again."); return; }
        if (shot.report.issues.length || !shot.descriptor) { setMessage(`Enrollment stopped: ${shot.report.issues[0]?.message ?? "No clear face detected."} Nothing was saved.`); return; }
        descriptors.push(shot.descriptor);
        if (i < ENROLL_FRAMES - 1) await new Promise(resolve => setTimeout(resolve, 300));
      }
      const api = apiRef.current!;
      let spread = 0;
      for (let a = 0; a < descriptors.length; a++) for (let b = a + 1; b < descriptors.length; b++) spread = Math.max(spread, api.euclideanDistance(descriptors[a], descriptors[b]));
      if (spread > MAX_FRAME_SPREAD) { setMessage("The face moved or changed between captures. Hold still and try again. Nothing was saved."); return; }
      // Average the good frames so a single odd frame (blink, shadow) has less influence on the saved template.
      const mean = new Float32Array(descriptors[0].length);
      for (const d of descriptors) for (let k = 0; k < mean.length; k++) mean[k] += d[k] / descriptors.length;
      const photo = videoRef.current ? snapshot(videoRef.current) : null;
      if (!photo) { setMessage("Could not prepare the photo preview. Try again. Nothing was saved."); return; }
      setPending({ homeownerId: selected, descriptor: Array.from(mean), photo });
      setMessage("Review the photo. Use it if the face is clear, or retake it. Nothing is saved yet.");
    } finally { setBusy(false); }
  };

  // Step 2: the person approved the photo, so save the template and discard the preview.
  const confirmEnroll = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser(); const now = new Date().toISOString();
      const { error } = await supabase.from("biometric_templates").upsert({ homeowner_id: pending.homeownerId, descriptor: pending.descriptor, model_version: MODEL_VERSION, consented_at: now, consent_recorded_by: userData.user?.id || null, updated_at: now }, { onConflict: "homeowner_id" });
      if (error) { setMessage(permissionMessage(error.message)); return; }
      const person = homeowners.find(x => x.id === pending.homeownerId);
      setPending(null); await loadTemplates();
      setResult({ status: "approved", homeownerId: pending.homeownerId, message: `${person?.firstName} ${person?.lastName} was enrolled successfully.` });
      setMessage(`Enrollment complete. ${ENROLL_FRAMES} clear frames were averaged into one numeric template. The review photo was discarded; no photo was retained.`);
    } finally { setBusy(false); }
  };

  const retake = () => { setPending(null); setResult(null); setMessage("Photo discarded. Get in position and capture again."); };

  const verify = async () => {
    setBusy(true); setResult(null); setMessage("Comparing face with enrolled residents…");
    try {
      const shot = await analyse();
      if (!shot) { setMessage("Camera is not ready. Start the camera and try again."); return; }
      const blocker = shot.report.issues.find(i => i.level === "block");
      // A dark, blurry or off-angle image says nothing about identity, so it is not logged as a denied entry.
      if (blocker || !shot.descriptor) { setMessage(`Cannot verify: ${blocker?.message ?? "No clear face detected."} No entry was logged. If the lighting cannot be fixed, use Car Pass verification.`); return; }
      const detection = { descriptor: shot.descriptor };
      if (!templates.length) { setMessage("No residents are enrolled yet. Use Enrollment first."); return; }
      const api = apiRef.current!;
      const matches = templates.map(t => ({ template: t, distance: api.euclideanDistance(detection.descriptor, new Float32Array(t.descriptor)) })).sort((a,b) => a.distance-b.distance);
      const best = matches[0]; const matched = best.distance <= MATCH_THRESHOLD; const person = matched ? homeowners.find(x => x.id === best.template.homeownerId) : undefined;
      const status = person?.status === "active" ? "approved" : "denied";
      const message = status === "approved" ? `Identity verified: ${person!.firstName} ${person!.lastName}` : person ? "Identity matched, but the resident account is inactive." : "Face is not recognized as an enrolled resident.";
      setResult({ status, homeownerId: person?.id, distance: best.distance, message }); setMessage(message);
      const vehicle = person ? vehicles.find(v => v.homeownerId === person.id) : undefined;
      addGateLog({ id: uid(), homeownerId: person?.id, vehicleId: vehicle?.id, resident: person ? `${person.firstName} ${person.lastName}` : "Unrecognized visitor", vehicle: vehicle ? `${vehicle.brand} ${vehicle.model}` : "—", plateNumber: vehicle?.plateNumber || "—", verificationType: "Facial Recognition", status, verifiedBy: "Facial Recognition Kiosk", createdAt: new Date().toISOString() });
    } finally { setBusy(false); }
  };

  const remove = async (homeownerId: string) => {
    if (!confirm("Remove this resident’s biometric template?")) return;
    // RLS silently skips rows a non-admin may not delete, so ask for the deleted row back to confirm.
    const { data, error } = await supabase.from("biometric_templates").delete().eq("homeowner_id", homeownerId).select("id");
    if (error || !data?.length) { setMessage(permissionMessage(error?.message || "permission denied")); return; }
    await loadTemplates(); setMessage("Biometric template deleted.");
  };
  const matchedPerson = result?.homeownerId ? homeowners.find(x => x.id === result.homeownerId) : undefined;

  return <div className="space-y-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-slate-500">On-device identity verification for registered residents.</p><p className="mt-1 text-xs text-slate-400">Biometric templates are shared securely with authorized staff devices. Camera images are processed in memory and discarded.</p></div><div className="flex rounded-xl border border-slate-200 bg-white p-1"><button className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode==="verify"?"bg-emerald-700 text-white":"text-slate-500"}`} onClick={()=>{setMode("verify");setResult(null);setPending(null)}}><ScanFace className="mr-2 inline h-4 w-4"/>Gate verification</button><button className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode==="enroll"?"bg-emerald-700 text-white":"text-slate-500"}`} onClick={()=>{setMode("enroll");setResult(null);setPending(null)}}><UserPlus className="mr-2 inline h-4 w-4"/>Enrollment</button></div></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><b>Biometric privacy:</b> Face photos are never saved. The camera frame is converted in memory into a numeric face descriptor, then the frame is discarded. Descriptors are stored in the association’s secured database, readable only by administrators and security staff and changeable only by administrators. Each enrollment records when consent was given and which administrator recorded it. Use “Delete biometric template” to remove a resident’s descriptor from every device. During enrollment the captured photo is shown on screen only so it can be reviewed; it stays in this browser’s memory, is never uploaded, and is discarded as soon as you choose “Use this photo” or “Retake photo”.</div>
    <div className="grid gap-6 xl:grid-cols-[1.4fr_.8fr]"><section className="card overflow-hidden"><div className="relative aspect-[4/3] bg-slate-950"><video ref={videoRef} muted playsInline className={`h-full w-full object-cover -scale-x-100 ${cameraReady?"":"hidden"}`}/>{!cameraReady&&<div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-white"><div className="rounded-full bg-white/10 p-5"><Camera className="h-10 w-10 text-emerald-300"/></div><h3 className="mt-4 text-lg font-bold">Camera is off</h3><p className="mt-2 max-w-sm text-sm text-slate-400">Camera access requires localhost or a secure HTTPS connection.</p></div>}{cameraReady&&!pending&&<div className={`pointer-events-none absolute inset-[12%] rounded-[45%] border-2 ${quality&&!quality.ok?"border-amber-400/90":"border-emerald-400/80"} shadow-[0_0_0_999px_rgba(2,6,23,.28)]`}/>}{pending&&<img src={pending.photo} alt="Captured photo for review" className="absolute inset-0 h-full w-full object-cover"/>}{busy&&<div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 text-white"><Loader2 className="mr-3 h-7 w-7 animate-spin"/><b>Processing on this device…</b></div>}</div><div className="border-t border-slate-100 p-5"><div className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{modelsReady?<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/>:<Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-600"/>}<p>{message}</p></div>{cameraReady&&!pending&&quality&&<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{quality.checks.map(c=><div key={c.id} className={`rounded-lg border p-2 text-xs ${c.ok?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-amber-200 bg-amber-50 text-amber-900"}`}><div className="flex items-center gap-1 font-semibold">{c.ok?<CheckCircle2 className="h-3.5 w-3.5"/>:<ShieldAlert className="h-3.5 w-3.5"/>}{c.label}</div>{!c.ok&&<p className="mt-1 leading-4">{c.hint}</p>}</div>)}</div>}{cameraReady&&!pending&&<p className="mt-3 text-[11px] leading-4 text-slate-400">For best results: face a light source, keep windows behind the camera rather than behind the person, and keep the lens clean.</p>}{pending?<div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-bold text-emerald-900">Are you sure you want to use this photo?</p><p className="mt-1 text-sm leading-5 text-emerald-800">Check that the face is clear, well lit and looking straight at the camera. If not, choose “Retake photo”. Nothing is saved until you press “Use this photo”.</p><div className="mt-4 flex flex-wrap gap-3"><button disabled={busy} className="btn-primary" onClick={confirmEnroll}><CheckCircle2 className="h-4 w-4"/>Use this photo</button><button disabled={busy} className="btn-secondary" onClick={retake}><RefreshCw className="h-4 w-4"/>Retake photo</button></div></div>:<div className="mt-4 flex flex-wrap gap-3">{!cameraReady?<button disabled={!modelsReady} className="btn-primary" onClick={startCamera}><Camera className="h-4 w-4"/>Start camera</button>:<><button className="btn-secondary" onClick={stopCamera}>Stop camera</button>{mode==="verify"&&<button disabled={busy||!templates.length} className="btn-primary" onClick={verify}><ScanFace className="h-4 w-4"/>Verify identity</button>}</>}</div>}</div></section>
      <aside className="space-y-5">{mode==="enroll"?<div className="card p-5"><h3 className="font-bold">Enroll a resident</h3><p className="mt-1 text-xs leading-5 text-slate-500">The resident must give consent first. You will review the photo and approve it before anything is saved.</p><label className="mt-5 block"><span className="label">Resident</span><select className="field" disabled={!!pending} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select homeowner</option>{homeowners.filter(h=>h.status==="active").map(h=><option value={h.id} key={h.id}>{h.firstName} {h.lastName} — B{h.block} L{h.lot}</option>)}</select></label><label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-xs leading-5 text-slate-600"><input type="checkbox" className="mt-1 accent-emerald-700" checked={consent} disabled={!!pending} onChange={e=>setConsent(e.target.checked)}/><span>I confirm that the resident has voluntarily consented to biometric enrollment and understands they may request deletion.</span></label><button disabled={!cameraReady||!selected||!consent||busy||!!pending||(!!quality&&!quality.ok)} className="btn-primary mt-4 w-full" onClick={capture}><Camera className="h-4 w-4"/>Capture photo</button></div>:<div className={`card p-6 text-center ${result?.status==="approved"?"border-emerald-300":result?.status==="denied"?"border-rose-300":""}`}>{!result?<><div className="mx-auto w-fit rounded-full bg-emerald-50 p-4 text-emerald-700"><ScanFace className="h-9 w-9"/></div><h3 className="mt-4 font-bold">Ready to verify</h3><p className="mt-2 text-sm text-slate-500">{templates.length} resident{templates.length===1?"":"s"} enrolled.</p></>:<><div className={`mx-auto w-fit rounded-full p-4 ${result.status==="approved"?"bg-emerald-50 text-emerald-600":"bg-rose-50 text-rose-600"}`}>{result.status==="approved"?<CheckCircle2 className="h-9 w-9"/>:<XCircle className="h-9 w-9"/>}</div><p className={`mt-4 text-xs font-bold uppercase tracking-[.18em] ${result.status==="approved"?"text-emerald-600":"text-rose-600"}`}>Access {result.status}</p>{matchedPerson&&<h3 className="mt-2 text-xl font-bold">{matchedPerson.firstName} {matchedPerson.lastName}</h3>}<p className="mt-2 text-sm text-slate-500">{result.message}</p>{result.distance!==undefined&&<p className="mt-3 text-xs text-slate-400">Match distance: {result.distance.toFixed(3)} · threshold {MATCH_THRESHOLD}</p>}</>}</div>}
        <div className="card p-5"><div className="flex items-center justify-between"><h3 className="font-bold">Enrolled residents</h3><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{templates.length}</span></div><div className="mt-3 divide-y divide-slate-100">{templates.length?enrolledPager.pageItems.map(t=>{const h=homeowners.find(x=>x.id===t.homeownerId);return <div className="flex items-center justify-between py-3" key={t.homeownerId}><div><p className="text-sm font-semibold">{h?`${h.firstName} ${h.lastName}`:"Deleted resident"}</p><p className="text-[11px] text-slate-400">Enrolled {new Date(t.enrolledAt).toLocaleDateString()}</p></div><button className="rounded-lg p-2 text-rose-500 hover:bg-rose-50" onClick={()=>remove(t.homeownerId)} title="Delete biometric template"><Trash2 className="h-4 w-4"/></button></div>}):<div className="py-6 text-center text-xs text-slate-400"><ShieldAlert className="mx-auto mb-2 h-5 w-5"/>No biometric templates yet.</div>}</div><Pagination pager={enrolledPager} compact/></div>
      </aside></div></div>;
}
