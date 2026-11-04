// ─────────────────────────────────────────────────────────────────────────────
// UOM + product-conversion helpers — pure functions only (no DB, no Express), so
// the exact rules are unit-tested and shared by the controllers.
//
// THE MODEL
//  • A UOM has a TYPE: volume | weight | count | length ("" = not classified yet).
//  • Volume and weight units carry a BASE AMOUNT: how many ml (or g) are in 1 of
//    them — ML = 1, Litre = 1000, Peg = 30, Large Peg = 60. These are global, so
//    ML ↔ Litre ↔ Peg is never entered per product.
//  • A product conversion links a COUNT unit to something measurable, per product:
//    1 Bottle = 750 ML, 1 Crate = 12 Bottle. (Volume→volume is rejected: the base
//    amounts already define it.)
//  • toBase() walks a product's conversions (either direction) from any unit until
//    it reaches a volume/weight unit, e.g. Crate → Bottle → ML = 9,000 ml.
// ─────────────────────────────────────────────────────────────────────────────

export const UOM_TYPES = ["volume", "weight", "count", "length"];
export const BASE_UNIT = { volume: "ml", weight: "g" };

export const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const round3 = (n) => Math.round(n * 1000) / 1000;
const hasValue = (v) => v !== null && v !== undefined && v !== "";
export { hasValue };

// ── A UOM's own shape ───────────────────────────────────────────────────────
// Returns an error message, or null when {type, baseFactor} is a valid pair.
export function validateUomShape({ type, baseFactor }) {
  const t = type || "";
  if (t && !UOM_TYPES.includes(t)) return `Type must be one of: ${UOM_TYPES.join(", ")}.`;
  if (t === "volume" || t === "weight") {
    if (!hasValue(baseFactor)) {
      return `A ${t} unit needs a base amount — how many ${BASE_UNIT[t]} are in 1 of it (Litre = 1000, Peg = 30).`;
    }
    const n = Number(baseFactor);
    if (!Number.isFinite(n) || n <= 0) return "Base amount must be a number greater than 0.";
  } else if (hasValue(baseFactor)) {
    return t
      ? `Only volume and weight units carry a base amount (this one is ${t}).`
      : "Choose the unit type first — a base amount only applies to volume and weight units.";
  }
  return null;
}

// ── Which two UOMs may be joined by a product conversion ───────────────────
export function validatePair(fromUom, toUom) {
  if (String(fromUom._id) === String(toUom._id)) return "From and To unit must be different.";
  const ft = fromUom.type || "";
  const tt = toUom.type || "";
  if (ft && ft === tt && (ft === "volume" || ft === "weight" || ft === "length")) {
    return `${fromUom.name} → ${toUom.name} is a ${ft}-to-${ft} conversion. Those are defined once in the UOM master (base amounts), not per product — put a count unit such as Bottle or Crate on one side.`;
  }
  return null;
}

// ── Walk a product's conversions until a volume/weight unit is reached ─────
// uoms: all UOM docs; conversions: this product's ACTIVE conversions
//   (1 from = factor × to). Reverse direction is used too (divide by factor).
// Returns { ok, kind, base, baseQty, path:[{from,to,factor,reversed}], reason }.
export function toBase({ uoms, conversions, uomId, qty = 1 }) {
  const byId = new Map(uoms.map((u) => [String(u._id), u]));
  const start = byId.get(String(uomId));
  const fail = (reason) => ({ ok: false, kind: null, base: null, baseQty: null, path: [], reason });
  if (!start) return fail("Unit not found.");

  const measurable = (u) => (u.type === "volume" || u.type === "weight") && Number(u.baseFactor) > 0;
  const finish = (unit, mult, path) => ({
    ok: true, kind: unit.type, base: BASE_UNIT[unit.type],
    baseQty: round3(Number(qty) * mult * Number(unit.baseFactor)), path,
  });
  if (measurable(start)) return finish(start, 1, []);

  const adj = new Map();
  const edge = (a, b, factor, reversed) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, factor, reversed });
  };
  for (const c of conversions) {
    if (c.isActive === false) continue;
    const f = Number(c.conversionFactor);
    if (!(f > 0)) continue;
    edge(String(c.fromUomId), String(c.toUomId), f, false);
    edge(String(c.toUomId), String(c.fromUomId), 1 / f, true);
  }

  // Breadth-first: fewest conversion hops wins; `seen` also guards against cycles.
  const seen = new Set([String(start._id)]);
  const queue = [{ id: String(start._id), mult: 1, path: [] }];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of adj.get(cur.id) || []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      const unit = byId.get(e.to);
      if (!unit) continue;
      const fromUnit = byId.get(cur.id);
      const step = { from: fromUnit.name, to: unit.name, factor: round3(e.factor * 1e6) / 1e6, reversed: e.reversed };
      const mult = cur.mult * e.factor;
      const path = [...cur.path, step];
      if (measurable(unit)) return finish(unit, mult, path);
      queue.push({ id: e.to, mult, path });
    }
  }
  return fail(`No conversion path from ${start.name} to a volume or weight unit — add one (e.g. 1 ${start.name} = 750 ML) for this product.`);
}

// Whole servings plus the leftover, never fractional pegs: 700 ml of 30 ml pegs
// is 23 pegs + 10 ml.
export function splitServings(baseQty, servingBase) {
  const s = Math.floor(baseQty / servingBase + 1e-9);
  return { servings: s, remainder: round3(baseQty - s * servingBase) };
}

// "JAGERMEISTER 700ML" → 700 · "Absolut 1L" → 1000 · "70CL" → 700. Used ONLY to
// suggest a bottle size for a person to confirm — never applied automatically.
export function parseSizeFromName(name) {
  const m = String(name || "").match(/(\d+(?:[.,]\d+)?)\s*(ml|cl|ltr|lt|litre|liter|l)\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  const unit = m[2].toLowerCase();
  const ml = unit === "ml" ? n : unit === "cl" ? n * 10 : n * 1000;
  return ml > 0 && ml <= 20000 ? round3(ml) : null;
}

// ── Standard units for alcohol, and a plan for setting them up ─────────────
export const ALCOHOL_UOM_SEED = [
  { name: "Millilitre", abbreviation: "ml", type: "volume", baseFactor: 1, aliases: ["ml", "millilitre", "milliliter"] },
  { name: "Litre", abbreviation: "ltr", type: "volume", baseFactor: 1000, aliases: ["l", "ltr", "litre", "liter"] },
  { name: "Peg", abbreviation: "peg", type: "volume", baseFactor: 30, aliases: ["peg", "pg"] },
  { name: "Large Peg", abbreviation: "lpeg", type: "volume", baseFactor: 60, aliases: ["large peg", "lpeg"] },
  { name: "Wine Glass", abbreviation: "wglass", type: "volume", baseFactor: 150, aliases: ["wine glass", "wglass"] },
  { name: "Bottle", abbreviation: "btl", type: "count", baseFactor: null, aliases: ["bottle", "btl"] },
  { name: "Crate", abbreviation: "crate", type: "count", baseFactor: null, aliases: ["crate", "case"] },
  { name: "Can", abbreviation: "can", type: "count", baseFactor: null, aliases: ["can"] },
  { name: "Keg", abbreviation: "keg", type: "count", baseFactor: null, aliases: ["keg"] },
];

// existing = the ACTIVE UOMs. Nothing is changed by this function — it only plans:
//   create    — standard unit not found
//   classify  — found but with no type yet → will be given the standard type/base
//   ok        — already matches
//   conflicts — already set to something else (left alone) or a duplicate
export function planSeed(existing) {
  const plan = { create: [], classify: [], conflicts: [], ok: [] };
  for (const seed of ALCOHOL_UOM_SEED) {
    const matches = existing.filter((u) => seed.aliases.includes(norm(u.name)) || seed.aliases.includes(norm(u.abbreviation)));
    if (!matches.length) {
      plan.create.push({ name: seed.name, abbreviation: seed.abbreviation, type: seed.type, baseFactor: seed.baseFactor });
      continue;
    }
    const [first, ...dupes] = matches;
    const sameBase = (first.baseFactor ?? null) === (seed.baseFactor ?? null);
    if (!first.type) {
      plan.classify.push({ _id: String(first._id), name: first.name, abbreviation: first.abbreviation, type: seed.type, baseFactor: seed.baseFactor });
    } else if (first.type === seed.type && sameBase) {
      plan.ok.push({ name: first.name });
    } else {
      plan.conflicts.push({
        _id: String(first._id), name: first.name,
        reason: `Already set as ${first.type}${first.baseFactor != null ? ` (${first.baseFactor})` : ""}; the standard is ${seed.type}${seed.baseFactor != null ? ` (${seed.baseFactor})` : ""}. Left unchanged.`,
      });
    }
    dupes.forEach((d) => plan.conflicts.push({ _id: String(d._id), name: d.name, reason: `Duplicate of "${first.name}" — merge or deactivate it.` }));
  }
  return plan;
}