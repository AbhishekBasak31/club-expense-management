import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// Generic atomic sequence counter — one document per named sequence
// (e.g. "employeeId"). findByIdAndUpdate with $inc is atomic at the
// MongoDB server level, so two simultaneous "create" requests can never
// be handed the same number — unlike counting existing documents, which
// has a race window between the count and the insert.
// ─────────────────────────────────────────────────────────────────
const CounterSchema = new mongoose.Schema({
  _id : { type: String, required: true }, // sequence name, e.g. "employeeId"
  seq : { type: Number, default: 0 },
});

export const Counter = mongoose.model("Counter", CounterSchema);

// Returns the next number in the named sequence. The first time a given
// sequence is used, it's seeded via seedFn (an async function returning
// the starting number) rather than always starting at 0 — this lets a
// sequence pick up correctly after records that already existed before
// this counter did, instead of colliding with them.
//
// The seed step and the increment step are two separate operations (not
// one atomic transaction), but that's safe here: $setOnInsert + upsert
// means if two requests race on first-ever use, only one of them actually
// inserts the counter document — the other just no-ops into the
// now-existing document — so the sequence still ends up seeded exactly
// once, and every increment after that is fully atomic regardless.
export async function nextSequence(name, seedFn) {
  const existing = await Counter.findById(name).lean();
  if (!existing) {
    const startAt = seedFn ? await seedFn() : 0;
    await Counter.updateOne({ _id: name }, { $setOnInsert: { seq: startAt } }, { upsert: true });
  }
  const updated = await Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return updated.seq;
}

export default Counter;