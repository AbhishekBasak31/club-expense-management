import { setDefaultResultOrder } from "dns";
setDefaultResultOrder("ipv4first");
import mongoose from "mongoose";

const DB_Connection = async (db_uri, db_name) => {
  console.log("db name:", db_name);
  try {
    // Split on ? to safely insert db name before query string
    const [base, query] = db_uri.split("?");
    const cleanBase = base.replace(/\/+$/, "");
    const uri = query
      ? `${cleanBase}/${db_name}?${query}`
      : `${cleanBase}/${db_name}`;

    console.log("Connecting to:", uri.replace(/:([^@]+)@/, ":****@")); // log uri safely

    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS : 10000,
      family                   : 4,
    });

    console.log(`✅ MongoDB connected — host: ${conn.connection.host}`);
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  }
};

export default DB_Connection;