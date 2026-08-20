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
import { errorHandler, notFound } from "./src/Middleware/Error.middleware.js";

// ── Module routers ───────────────────────────────────────────────
import AuthRouter       from "./src/Routers/User.routes.js";
import VendorRouter     from "./src/Routers/Vendor.routes.js";
import BrandRouter      from "./src/Routers/Brand.routes.js";
import CategoryRouter   from "./src/Routers/Catagory.routes.js";
import ProductRouter    from "./src/Routers/Product.routes.js";
import UOMRouter        from "./src/Routers/Uom.routes.js";
import ConversionRouter from "./src/Routers/ProductConversion.routes.js";
import ExpenseRouter    from "./src/Routers/Expense.routes.js";
import PLRouter         from "./src/Routers/Pl.router.js";
import EmployeeRouter   from "./src/Routers/Employee.routes.js";
import TravelAllowanceRouter   from "./src/Routers/Travelallowence.routes.js";
import StockRouter      from "./src/Routers/Store.routes.js";
import ManualExpenseRouter from "./src/Routers/Manual.route.js";
import ChecklistRouter from "./src/Routers/Checklist.route.js";

const app  = express();
const PORT = process.env.PORT || 7000; 

// ── Disable HTTP caching for this API ────────────────────────────
// Express auto-generates an ETag on every JSON response by default.
// Browsers then send conditional GETs, and when the server replies
// 304 Not Modified, the browser silently reuses whatever body it
// cached from the PREVIOUS request to that same URL — even though the
// underlying data (expense entries, purchases, etc.) may have changed
// since. This is exactly right for static assets, but wrong for a
// live, constantly-changing API: it's what was making entries you'd
// just added look "missing" — the list endpoint kept returning 304,
// and the browser kept showing an old cached snapshot instead of
// re-fetching. `etag: false` stops Express from generating ETags at
// all, and the middleware below additionally tells every browser/proxy
// along the way never to store or reuse these responses — belt and
// suspenders, since some intermediary caches ignore a missing ETag
// alone.
app.set("etag", false);
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

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
app.use("/api/v1/brands",              BrandRouter);
app.use("/api/v1/categories",          CategoryRouter);
app.use("/api/v1/products",            ProductRouter);
app.use("/api/v1/uoms",                UOMRouter);
app.use("/api/v1/product-conversions", ConversionRouter);
app.use("/api/v1/expenses",            ExpenseRouter);
app.use("/api/v1/pl-statements",       PLRouter);
app.use("/api/v1/employees",       EmployeeRouter);
app.use("/api/v1/travel-allowances",  TravelAllowanceRouter);
app.use("/api/v1/stock",              StockRouter);
app.use("/api/v1/manual-expenses",    ManualExpenseRouter);
app.use("/api/v1/checklists", ChecklistRouter);
app.use('/uploads', express.static('uploads'));

// ── Error handling (must be last) ────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────
DB_Connection(process.env.DB_URL, process.env.DB_NAME)
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📋 Modules: auth, vendors, brands, categories, products, uoms, product-conversions, expenses`);
    });
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err.message);
    process.exit(1);
  });