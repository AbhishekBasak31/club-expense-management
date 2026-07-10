/**
 * migrate_category_hierarchy.js
 *
 * Run ONCE on your MongoDB instance to upgrade existing Category documents
 * from the 3-level schema (main / sub / base) to the new 5-level schema
 * (groupHead / group / main / sub / base).
 *
 * This script is NON-DESTRUCTIVE — it only adds the new fields; it does NOT
 * touch the existing name / level / parentId / path / fullPath on any doc.
 * After running, you must then:
 *   1. Create your Group Head documents (COGS, OC) manually in the UI.
 *   2. Create Group documents (Food Cost, Beverage Cost, Employee Expense …)
 *      and link them to the correct Group Head.
 *   3. Reassign existing "main" categories (Bar, Kitchen) to their new Group
 *      parent (instead of null) by updating their parentId + groupId / groupName.
 *
 * Usage:
 *   node migrate_category_hierarchy.js
 * (Set MONGO_URI in .env or replace the connection string below.)
 *
 * Safe to run multiple times — skips docs that already have groupHeadId set.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/clubexp";

// ── Minimal schema stub — just enough to run updateMany ──────────────────────
const CategorySchema = new mongoose.Schema({}, { strict: false });
const Category = mongoose.model("Category", CategorySchema);

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB:", MONGO_URI);

  // ── Step 1: Add new fields with empty defaults to ALL existing docs ─────────
  // This makes every existing document compatible with the new schema without
  // breaking the running app.
  const { modifiedCount: step1 } = await Category.updateMany(
    { groupHeadId: { $exists: false } },  // docs that predate the new schema
    {
      $set: {
        groupHeadId   : null,
        groupHeadName : "",
        groupId       : null,
        groupName     : "",
      },
    }
  );
  console.log(`Step 1 — added new ancestor fields to ${step1} documents.`);

  // ── Step 2: Rename existing level "main" docs → keep level "main" but ──────
  // the old "main" is now the 3rd level.  The parentId of these docs used to
  // be null (root), which will break the new chain.  We mark them with a tag
  // so you can reassign their parentId to the correct "group" in the UI.
  // (No automatic reassignment here — that requires business knowledge.)
  const { modifiedCount: step2 } = await Category.updateMany(
    { level: "main", parentId: null },
    { $set: { _needsGroupParent: true } }
  );
  console.log(`Step 2 — tagged ${step2} root-level "main" docs as needing a Group parent.`);
  console.log("         After you create Group documents in the UI, edit each of these");
  console.log('         to set their parentId to the correct Group (e.g. "Food Cost", "Bev Cost").');

  // ── Step 3: Report ───────────────────────────────────────────────────────────
  const counts = await Category.aggregate([
    { $group: { _id: "$level", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  console.log("\nLevel counts after migration:");
  counts.forEach(c => console.log(`  ${c._id}: ${c.count}`));

  const needsParent = await Category.countDocuments({ _needsGroupParent: true });
  console.log(`\n  ${needsParent} "main" categories need a Group parent assigned in the UI.`);

  await mongoose.disconnect();
  console.log("\nMigration complete.");
}

migrate().catch(err => { console.error(err); process.exit(1); });
