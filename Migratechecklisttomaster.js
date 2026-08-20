// migrate_checklist_to_master.js
//
// One-time migration for the Checklist Master / Checklist Management
// split. Run this ONCE, after deploying the new schema
// (checklist.modal.js + ChecklistMaster.model.js) but before anyone
// starts using the new Checklist Management page.
//
// What it does:
//   1. Reads every existing document in the OLD `checklists` collection
//      (the pre-split schema — each had its own `checklistName` field).
//   2. Extracts the distinct checklistName values and creates one
//      ChecklistMaster document per name (skipping any that already
//      exist, so this is safe to re-run).
//   3. Deletes the old documents from the `checklists` collection —
//      their shape (checklistName + dates + person + document, all on
//      one document) is no longer compatible with the new schema
//      (checklistMasterId + management fields), and per explicit
//      instruction, that per-item detail data does not need to be
//      preserved — only the checklist NAMES do, which step 2 already
//      copied into ChecklistMaster.
//
// Like every other migration script in this project: diagnostic report
// first, mutate nothing unless APPLY_FIX is explicitly set to true.
//
// Usage:
//   node migrate_checklist_to_master.js            # diagnostic report only, no writes
//   APPLY_FIX=true node migrate_checklist_to_master.js   # actually applies the migration
//
// ─────────────────────────────────────────────────────────────────

import "dotenv/config";
import mongoose from "mongoose";

const APPLY_FIX = process.env.APPLY_FIX === "true";

// Deliberately NOT importing the new checklist.modal.js / ChecklistMaster.model.js
// files here — this script talks to the raw `checklists` collection
// directly via mongoose.connection.db, so it works correctly regardless
// of which schema version is currently loaded in the app's own models,
// and so reading the OLD documents' checklistName field never collides
// with the NEW Mongoose schema (which no longer declares that field).

async function main() {
  await mongoose.connect(process.env.DB_URL, { dbName: process.env.DB_NAME });
  console.log(`Connected — DB: ${process.env.DB_NAME}`);
  console.log(`Mode: ${APPLY_FIX ? "APPLY (will write)" : "DIAGNOSTIC (dry run, no writes)"}\n`);

  const db = mongoose.connection.db;
  const oldChecklists = db.collection("checklists");
  const checklistMasters = db.collection("checklistmasters"); // Mongoose's default pluralized/lowercased collection name for "ChecklistMaster"

  const oldDocs = await oldChecklists.find({}).toArray();
  console.log(`Found ${oldDocs.length} document(s) in the old 'checklists' collection.`);

  const namesInOldDocs = [...new Set(
    oldDocs
      .map(d => (typeof d.checklistName === "string" ? d.checklistName.trim() : null))
      .filter(Boolean)
  )];
  console.log(`Distinct checklist names found: ${namesInOldDocs.length}`);
  namesInOldDocs.forEach(n => console.log(`   - "${n}"`));

  const existingMasters = await checklistMasters.find({}).toArray();
  const existingNamesLower = new Set(existingMasters.map(m => String(m.name).toLowerCase()));

  const toCreate = namesInOldDocs.filter(n => !existingNamesLower.has(n.toLowerCase()));
  const alreadyPresent = namesInOldDocs.filter(n => existingNamesLower.has(n.toLowerCase()));

  console.log(`\nChecklistMaster already has ${existingMasters.length} document(s).`);
  console.log(`  → ${alreadyPresent.length} name(s) already present (will be skipped).`);
  console.log(`  → ${toCreate.length} name(s) will be newly created:`);
  toCreate.forEach(n => console.log(`      + "${n}"`));

  console.log(`\nOld 'checklists' documents that will be deleted: ${oldDocs.length}`);
  console.log(`(Only the distinct NAMES above are preserved, copied into ChecklistMaster — the`);
  console.log(` per-item detail fields — dates, concerned person, email, phone, document — on`);
  console.log(` these old documents are not migrated, per explicit instruction that they're not needed.)`);

  if (!APPLY_FIX) {
    console.log(`\nDry run only — no changes made. Re-run with APPLY_FIX=true to apply.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\nApplying...`);

  if (toCreate.length > 0) {
    const now = new Date();
    const inserts = toCreate.map(name => ({
      name,
      isActive: true,
      createdBy: null,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    }));
    const result = await checklistMasters.insertMany(inserts);
    console.log(`✅ Created ${result.insertedCount} ChecklistMaster document(s).`);
  } else {
    console.log(`Nothing new to create in ChecklistMaster.`);
  }

  if (oldDocs.length > 0) {
    const delResult = await oldChecklists.deleteMany({});
    console.log(`✅ Deleted ${delResult.deletedCount} old document(s) from 'checklists'.`);
  } else {
    console.log(`No old documents to delete.`);
  }

  console.log(`\nDone. The 'checklists' collection is now empty and ready for the new`);
  console.log(`schema — Checklist Management rows will be created there via upsert as`);
  console.log(`users start filling in fields for each ChecklistMaster item.`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});