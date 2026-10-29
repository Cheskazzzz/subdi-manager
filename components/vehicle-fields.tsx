"use client";

import { useId, useState } from "react";
import { BRANDS, COLORS, OTHER, draftFrom, modelsFor, valuesOf, withBrand } from "@/lib/vehicle-options";

// Brand, Model and Color as dropdowns. It renders three form cells and puts the final text into hidden fields named
// brand, model and color, so the forms that contain it read them exactly as they did with typed text.
export function VehicleFields({ brand = "", model = "", color = "" }: { brand?: string; model?: string; color?: string }) {
  const id = useId();
  const [d, setD] = useState(() => draftFrom(brand, model, color));
  const v = valuesOf(d);
  const models = modelsFor(d.brand);
  const unlistedBrand = d.brand === OTHER;

  return <>
    <input type="hidden" name="brand" value={v.brand} />
    <input type="hidden" name="model" value={v.model} />
    <input type="hidden" name="color" value={v.color} />

    <div>
      <label className="label" htmlFor={`${id}-brand`}>Brand</label>
      <select id={`${id}-brand`} className="field" required value={d.brand} onChange={e => setD(cur => withBrand(cur, e.target.value))}>
        <option value="" disabled>Select brand</option>
        {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
        <option value={OTHER}>Other (type the brand)</option>
      </select>
      {unlistedBrand && <input className="field mt-2" required maxLength={30} placeholder="Type the brand" aria-label="Brand" value={d.brandOther} onChange={e => setD(cur => ({ ...cur, brandOther: e.target.value }))} />}
    </div>

    <div>
      <label className="label" htmlFor={`${id}-model`}>Model</label>
      {unlistedBrand
        ? <input id={`${id}-model`} className="field" required maxLength={30} placeholder="Type the model" value={d.modelOther} onChange={e => setD(cur => ({ ...cur, modelOther: e.target.value }))} />
        : <select id={`${id}-model`} className="field" required disabled={!d.brand} value={d.model} onChange={e => setD(cur => ({ ...cur, model: e.target.value, modelOther: "" }))}>
          <option value="" disabled>{d.brand ? "Select model" : "Select brand first"}</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
          {d.brand && <option value={OTHER}>Other (type the model)</option>}
        </select>}
      {!unlistedBrand && d.model === OTHER && <input className="field mt-2" required maxLength={30} placeholder="Type the model" aria-label="Model" value={d.modelOther} onChange={e => setD(cur => ({ ...cur, modelOther: e.target.value }))} />}
    </div>

    <div>
      <label className="label" htmlFor={`${id}-color`}>Color</label>
      <select id={`${id}-color`} className="field" required value={d.color} onChange={e => setD(cur => ({ ...cur, color: e.target.value, colorOther: "" }))}>
        <option value="" disabled>Select color</option>
        {COLORS.map(c => <option key={c} value={c}>{c}</option>)}
        <option value={OTHER}>Other (type the color)</option>
      </select>
      {d.color === OTHER && <input className="field mt-2" required maxLength={30} placeholder="Type the color" aria-label="Color" value={d.colorOther} onChange={e => setD(cur => ({ ...cur, colorOther: e.target.value }))} />}
    </div>
  </>;
}
