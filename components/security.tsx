"use client";
import { useState } from "react";
import { Camera, CheckCircle2, Keyboard, Search, ShieldCheck, XCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { Vehicle } from "@/lib/types";
import { findVehicle, matchFromText } from "@/lib/plate-reader";
import { Badge, DateFilter, DateFilterValue, Empty, Pagination, SearchBox, dateKey, matchesDate, noDateFilter, uid, usePagination } from "./ui";
import { PlateScanner } from "./plate-scanner";

export function VerifyPage() {
  const { vehicles, homeowners, addGateLog } = useStore();
  const [mode, setMode] = useState<"type" | "scan">("type");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Vehicle | null | undefined>(undefined);
  const [fromCamera, setFromCamera] = useState(false);
  const [recorded, setRecorded] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<{ kind: "none" | "ambiguous"; text: string } | null>(null);

  const show = (vehicle: Vehicle | null | undefined, camera: boolean) => { setResult(vehicle); setFromCamera(camera); setRecorded(null); };
  const switchMode = (next: "type" | "scan") => { setMode(next); setScanNote(null); show(undefined, false); };
  // Typed search ignores case, spaces and hyphens, so "abc1234" finds "ABC-1234".
  const search = () => { setScanNote(null); show(findVehicle(vehicles, query) ?? null, false); };
  // The camera only suggests a vehicle. The guard still compares the result with the car before approving entry.
  const onScan = (raw: string) => {
    const found = matchFromText(raw, vehicles);
    if (found.kind === "match") { setScanNote(null); setQuery(found.vehicle.plateNumber); show(found.vehicle, true); return; }
    show(undefined, true); setScanNote({ kind: found.kind, text: found.text });
  };

  const h = result ? homeowners.find(x => x.id === result.homeownerId) : undefined;
  const notExpired = !!result?.expirationDate && new Date(result.expirationDate + "T23:59:59") >= new Date();
  const denyReason = !result ? "" : result.status !== "active" ? `Pass is ${result.status}.` : !notExpired ? "Pass has expired." : h?.status !== "active" ? "Resident account is not active." : "";
  const valid = !!result && denyReason === "";
  const record = (status: "approved" | "denied") => {
    if (!result) return;
    addGateLog({ id: uid(), homeownerId: h?.id, vehicleId: result.id, resident: h ? `${h.firstName} ${h.lastName}` : "Unknown", vehicle: `${result.brand} ${result.model}`, plateNumber: result.plateNumber, verificationType: fromCamera ? "Car Pass (Camera)" : "Car Pass", status, verifiedBy: "Officer Mendoza", createdAt: new Date().toISOString() });
    setRecorded(status);
  };

  return <div className="mx-auto max-w-4xl space-y-7">
    <div className="rounded-2xl bg-[#123d2a] p-7 text-center text-white">
      <ShieldCheck className="mx-auto h-11 w-11 text-emerald-300" />
      <h2 className="mt-3 text-2xl font-bold">Car Pass Verification</h2>
      <p className="mt-1 text-sm text-emerald-100/75">Check the vehicle before allowing entry. Type the plate or pass number, or scan it with the camera.</p>
      <div className="mx-auto mt-5 inline-flex rounded-xl bg-white/10 p-1">
        {([["type", "Type plate / pass", Keyboard], ["scan", "Scan with camera", Camera]] as const).map(([id, label, Icon]) =>
          <button key={id} type="button" onClick={() => switchMode(id)} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${mode === id ? "bg-emerald-400 text-emerald-950" : "text-emerald-100/80 hover:text-white"}`}><Icon className="h-4 w-4" />{label}</button>)}
      </div>
      {mode === "type"
        ? <form className="mx-auto mt-6 flex max-w-2xl flex-col gap-3 sm:flex-row" onSubmit={e => { e.preventDefault(); search(); }}>
          <div className="relative flex-1"><Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input autoFocus className="w-full rounded-xl border-0 py-4 pl-12 pr-4 text-lg font-semibold text-slate-900 outline-none ring-4 ring-white/10 placeholder:font-normal placeholder:text-slate-400" value={query} onChange={e => setQuery(e.target.value)} placeholder="Plate or car pass number" /></div>
          <button className="rounded-xl bg-emerald-400 px-7 py-4 font-bold text-emerald-950 hover:bg-emerald-300">Verify pass</button>
        </form>
        : <div className="mx-auto mt-6 max-w-2xl rounded-xl bg-white p-4 text-left text-slate-900"><PlateScanner isMatch={t => matchFromText(t, vehicles).kind === "match"} onText={onScan} /></div>}
    </div>
    {scanNote && <div className="card border-t-4 border-t-amber-400 p-6">
      <h3 className="text-lg font-bold text-amber-800">{scanNote.kind === "ambiguous" ? "Several similar plates matched" : "No registered plate or car pass matched"}</h3>
      <p className="mt-1 text-sm text-slate-600">{scanNote.kind === "ambiguous" ? "The camera could not tell them apart. Type the plate to be sure." : "The camera may have misread it, or the vehicle may not be registered."}{scanNote.text && <> Detected text: <span className="font-mono font-bold">{scanNote.text}</span>.</>}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" onClick={() => setScanNote(null)}>Scan again</button>
        <button type="button" className="btn-primary" onClick={() => { setQuery(scanNote.text); switchMode("type"); }}><Keyboard className="h-4 w-4" />Type it instead</button>
      </div>
    </div>}
    {result !== undefined && (result
      ? <div className={`card overflow-hidden border-t-4 ${valid ? "border-t-emerald-500" : "border-t-rose-500"}`}>
        <div className="flex flex-col items-center border-b border-slate-100 p-7 text-center">
          <div className={`rounded-full p-3 ${valid ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>{valid ? <CheckCircle2 className="h-10 w-10" /> : <XCircle className="h-10 w-10" />}</div>
          <p className={`mt-3 text-sm font-bold uppercase tracking-[.2em] ${valid ? "text-emerald-600" : "text-rose-600"}`}>{valid ? "Access approved" : "Access denied"}</p>
          {!valid && denyReason && <p className="mt-1 text-sm font-semibold text-rose-600">{denyReason}</p>}
          <h3 className="mt-2 text-2xl font-bold">{h?.firstName} {h?.lastName}</h3>
          <p className="text-sm text-slate-500">Block {h?.block}, Lot {h?.lot}</p>
        </div>
        <div className="grid gap-5 p-6 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Plate number" value={result.plateNumber} />
          <Info label="Vehicle" value={`${result.color} ${result.brand} ${result.model}`} />
          <Info label="Car pass" value={result.passNumber} />
          <div><p className="label">Pass status</p><Badge value={result.status} /></div>
          <Info label="Expiration" value={result.expirationDate ? new Date(result.expirationDate + "T00:00:00").toLocaleDateString() : "—"} />
        </div>
        {fromCamera && <p className="px-6 pb-4 text-xs text-slate-500">Read by camera. Check that this plate and vehicle match the car at the gate.</p>}
        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 p-5 sm:flex-row sm:justify-end">
          {recorded
            ? <p className="self-center text-sm font-semibold capitalize text-slate-600">Entry recorded as {recorded}.</p>
            : <><button className="btn-secondary border-rose-200 text-rose-700" onClick={() => record("denied")}><XCircle className="h-4 w-4" />Deny entry</button><button disabled={!valid} className="btn-primary" onClick={() => record("approved")}><CheckCircle2 className="h-4 w-4" />Approve entry</button></>}
        </div>
      </div>
      : <div className="card border-t-4 border-t-rose-500 py-12 text-center"><XCircle className="mx-auto h-12 w-12 text-rose-500" /><h3 className="mt-3 text-xl font-bold text-rose-700">ACCESS DENIED</h3><p className="mt-2 text-sm text-slate-500">Car pass or vehicle not found.</p></div>)}
  </div>;
}

function Info({label,value}:{label:string;value:string}){return <div><p className="label">{label}</p><p className="font-semibold">{value}</p></div>}

export function GateLogsPage(){const {gateLogs}=useStore();const [search,setSearch]=useState("");const [filter,setFilter]=useState("all");const [date,setDate]=useState<DateFilterValue>(noDateFilter);const list=gateLogs.filter(x=>(filter==="all"||x.status===filter)&&matchesDate(x.createdAt,date)&&`${x.resident} ${x.vehicle} ${x.plateNumber} ${x.verifiedBy}`.toLowerCase().includes(search.toLowerCase()));const pager=usePagination(list,`${search}|${filter}|${dateKey(date)}`);return <div className="space-y-6"><p className="text-sm text-slate-500">Review all approved and denied vehicle entry attempts.</p><div className="flex flex-col gap-3 sm:flex-row"><SearchBox value={search} onChange={setSearch} placeholder="Search resident, vehicle or officer..."/><select className="field max-w-44" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All entries</option><option value="approved">Approved</option><option value="denied">Denied</option></select><DateFilter value={date} onChange={setDate}/></div>{list.length?<><div className="table-wrap"><table className="data-table"><thead><tr><th>Resident / Vehicle</th><th>Plate</th><th>Verification</th><th>Status</th><th>Security</th><th>Date & time</th></tr></thead><tbody>{pager.pageItems.map(x=><tr key={x.id}><td><p className="font-semibold text-slate-900">{x.resident}</p><p className="text-xs text-slate-400">{x.vehicle}</p></td><td className="font-mono font-bold">{x.plateNumber}</td><td>{x.verificationType}</td><td><Badge value={x.status}/></td><td>{x.verifiedBy}</td><td>{new Date(x.createdAt).toLocaleDateString()}<div className="text-xs text-slate-400">{new Date(x.createdAt).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}</div></td></tr>)}</tbody></table></div><Pagination pager={pager}/></>:<Empty/>}</div>}
