import { setDefaultResultOrder } from "dns";
setDefaultResultOrder("ipv4first");

import dotenv from "dotenv";
dotenv.config();
import os from "os";
import express      from "express";
import cors         from "cors";
import cookieParser from "cookie-parser";
import helmet       from "helmet";
import compression  from "compression";

import DB_Connection from "./src/Db/Db.js";
import { errorHandler, notFound } from "./src/Middleware/error.middleware.js";

// ── Module routers ───────────────────────────────────────────────
import AuthRouter       from "./src/Routers/User.routes.js";
import VendorRouter     from "./src/Routers/Vendor.routes.js";
import CategoryRouter   from "./src/Routers/Catagory.routes.js";
import ProductRouter    from "./src/Routers/Product.routes.js";
import UOMRouter        from "./src/Routers/Uom.routes.js";
import ConversionRouter from "./src/Routers/ProductConversion.routes.js";
import ExpenseRouter    from "./src/Routers/Expense.routes.js";

const app  = express();
const PORT = process.env.PORT || 7000;

// ── Global middleware ────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
/* -------------------------------------------------------
   GET LOCAL NETWORK IP (for dev logging only)
------------------------------------------------------- */
function getLocalIP() {
  try {
    const nets = os.networkInterfaces();
    for (const name in nets) {
      for (const iface of nets[name]) {
        if ((iface.family === "IPv4" || iface.family === 4) && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (err) {
    console.warn("Local IP error:", err);
  }
  return "127.0.0.1";
}

const localIP = getLocalIP();

// ── CORS ─────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:8080",
  "http://localhost:8086",
  `http://${localIP}:5173`,
  `http://${localIP}:5174`,
  `http://${localIP}:8080`,
  `http://${localIP}:8086`,
  "https://fingertip.co.in",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman / curl
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("CORS: Origin not allowed"));
    },
    credentials: true,
  })
);

// ── Health check ─────────────────────────────────────────────────
app.get("/api/health", (req, res) =>
  res.json({ ok: true, uptime: process.uptime() })
);

// ── API routes ───────────────────────────────────────────────────
app.use("/api/v1/auth",                AuthRouter);
app.use("/api/v1/vendors",             VendorRouter);
app.use("/api/v1/categories",          CategoryRouter);
app.use("/api/v1/products",            ProductRouter);
app.use("/api/v1/uoms",                UOMRouter);
app.use("/api/v1/product-conversions", ConversionRouter);
app.use("/api/v1/expenses",            ExpenseRouter);

// ── Error handling (must be last) ────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────
DB_Connection(process.env.DB_URL, process.env.DB_NAME)
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📋 Modules: auth, vendors, categories, products, uoms, product-conversions, expenses`);
    });
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err.message);
    process.exit(1);
  });