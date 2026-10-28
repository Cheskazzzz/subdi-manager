"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { SCAN, assessScanQuality, type ScanReport } from "@/lib/plate-reader";

// Only the small part of the text-reading library that this screen uses. Describing it here keeps the build
// independent of the library's own type definitions.
type OcrWorker = {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};
type CreateWorker = (lang: string) => Promise<OcrWorker>;
type OcrModule = { createWorker?: CreateWorker; default?: { createWorker?: CreateWorker } };

const WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
// Single-line reading first (best for plates), then block reading as a fallback (helps two-line stickers).
// In testing, either mode alone missed plates that the other read cleanly.
const PASSES = ["7", "6"];
const pct = (v: number) => `${v * 100}%`;

export function PlateScanner({ isMatch, onText }: { isMatch: (text: string) => boolean; onText: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Promise<OcrWorker> | null>(null);
  const scanningRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [readerReady, setReaderReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [aspect, setAspect] = useState(4 / 3);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [message, setMessage] = useState("Start the camera, fit the plate or car pass sticker inside the rectangle, then press Scan.");

  // The text reader downloads once (a few MB, then cached by the browser), so it starts loading when the camera starts.
  const loadReader = useCallback(() => {
    workerRef.current ??= (async () => {
      const mod = (await import("tesseract.js")) as unknown as OcrModule;
      const createWorker = mod.createWorker ?? mod.default?.createWorker;
      if (!createWorker) throw new Error("The text reader could not be loaded.");
      const worker = await createWorker("eng");
      await worker.setParameters({ tessedit_char_whitelist: WHITELIST });
      return worker;
    })();
    return workerRef.current;
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setCameraReady(false); setReport(null);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    workerRef.current?.then(worker => worker.terminate()).catch(() => undefined);
  }, []);

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setMessage("This browser cannot open the camera. Use the typing option instead."); return; }
    try {
      // The rear camera is preferred when there is one. The picture is never mirrored, so the text reads the right way round.
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      // Ask the camera to keep exposure, white balance and focus automatic. Not every device supports this, so failure is ignored.
      try { await stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ exposureMode: "continuous", whiteBalanceMode: "continuous", focusMode: "continuous" } as unknown as MediaTrackConstraintSet] }); } catch { /* unsupported */ }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream; await video.play();
      setAspect(video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3);
      setCameraReady(true); setReaderReady(false);
      setMessage("Loading the text reader (first time only)…");
      loadReader()
        .then(() => { setReaderReady(true); setMessage("Ready. Fit the plate or sticker inside the rectangle, then press Scan."); })
        .catch(() => { workerRef.current = null; setMessage("The text reader could not load. Check the internet connection, or use the typing option."); });
    } catch {
      setMessage("Camera permission was blocked. Allow camera access, or use the typing option.");
    }
  };

  // While the camera is on, measure lighting, glare, text visibility and sharpness inside the rectangle every 0.7 seconds.
  useEffect(() => {
    if (!cameraReady) return;
    let stopped = false;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (stopped || scanningRef.current || !video || !video.videoWidth) return;
      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      const g = SCAN.guide, vw = video.videoWidth, vh = video.videoHeight;
      const width = SCAN.analysisWidth, height = Math.max(1, Math.round((width * vh * g.h) / (vw * g.w)));
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, vw * g.x, vh * g.y, vw * g.w, vh * g.h, 0, 0, width, height);
      setReport(assessScanQuality({ pixels: ctx.getImageData(0, 0, width, height).data, width, height }));
    }, 700);
    return () => { stopped = true; clearInterval(timer); };
  }, [cameraReady]);

  const scan = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || scanningRef.current) return;
    scanningRef.current = true; setScanning(true); setMessage("Reading text…");
    try {
      const worker = await loadReader();
      // Cut out only the part inside the rectangle, at full camera resolution. The picture stays in memory and is never saved.
      const g = SCAN.guide, vw = video.videoWidth, vh = video.videoHeight;
      const sw = Math.round(vw * g.w), sh = Math.round(vh * g.h);
      const canvas = document.createElement("canvas");
      canvas.width = sw; canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available.");
      ctx.drawImage(video, vw * g.x, vh * g.y, sw, sh, 0, 0, sw, sh);
      const texts: string[] = [];
      for (const psm of PASSES) {
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        const { data } = await worker.recognize(canvas);
        texts.push(data.text);
        if (isMatch(texts.join("\n"))) break; // found a registered vehicle already, no need for another pass
      }
      onText(texts.join("\n"));
      setMessage("Scan finished. Check the result below, or scan again.");
    } catch {
      setMessage("Could not read the image. Try again, or use the typing option.");
    } finally {
      scanningRef.current = false; setScanning(false);
    }
  };

  const g = SCAN.guide;
  return <div>
    <div className="relative w-full overflow-hidden rounded-xl bg-slate-950" style={{ aspectRatio: String(aspect) }}>
      <video ref={videoRef} playsInline muted className={`h-full w-full object-cover ${cameraReady ? "" : "hidden"}`} />
      {!cameraReady && <div className="grid h-full min-h-[200px] place-items-center p-6 text-center text-sm text-slate-300">Camera is off.</div>}
      {cameraReady && <div className={`pointer-events-none absolute rounded-lg border-2 ${report && !report.ok ? "border-amber-400/90" : "border-emerald-400/90"}`} style={{ left: pct(g.x), top: pct(g.y), width: pct(g.w), height: pct(g.h), boxShadow: "0 0 0 999px rgba(2,6,23,.5)" }}>
        <span className="absolute -top-6 left-0 text-[11px] font-semibold text-white">Fit the plate or car pass sticker inside</span>
      </div>}
      {scanning && <div className="absolute inset-0 grid place-items-center bg-slate-950/60 text-white"><div className="flex items-center gap-2 text-sm font-semibold"><Loader2 className="h-4 w-4 animate-spin" />Reading text…</div></div>}
    </div>
    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{message}</div>
    {cameraReady && report && <div className="mt-3 grid grid-cols-3 gap-2">{report.checks.map(c => <div key={c.id} className={`rounded-lg border p-2 text-xs ${c.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      <div className="flex items-center gap-1 font-semibold">{c.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}{c.label}</div>
      {!c.ok && <p className="mt-1 leading-4">{c.hint}</p>}
    </div>)}</div>}
    <div className="mt-4 flex flex-wrap gap-3">
      {!cameraReady
        ? <button type="button" className="btn-primary" onClick={startCamera}><Camera className="h-4 w-4" />Start camera</button>
        : <>
          <button type="button" disabled={scanning || !readerReady} className="btn-primary" onClick={scan}>{scanning || !readerReady ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{!readerReady ? "Loading text reader…" : "Scan plate or sticker"}</button>
          <button type="button" className="btn-secondary" onClick={stopCamera}>Stop camera</button>
        </>}
    </div>
    <p className="mt-3 text-[11px] leading-4 text-slate-400">Only the text read from the image is used. The picture is read on this device and is never saved or uploaded. For best results, hold the camera level and avoid glare from sunlight or headlights.</p>
  </div>;
}
