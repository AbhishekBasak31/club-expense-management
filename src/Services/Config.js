import dotenv from "dotenv";
dotenv.config();

const required = ["DB_URL", "DB_NAME", "JWT_SECRET", "JWT_REFRESH_SECRET", "SALT_ROUNDS", "PORT"];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`❌ ${key} is not defined in .env file`);
  }
}

if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
  throw new Error("❌ JWT_SECRET and JWT_REFRESH_SECRET must be different values");
}

const Config = {
  DB_URL             : process.env.DB_URL,
  DB_NAME            : process.env.DB_NAME,
  JWT_SECRET         : process.env.JWT_SECRET,
  JWT_REFRESH_SECRET : process.env.JWT_REFRESH_SECRET,
  SALT_ROUNDS        : Number(process.env.SALT_ROUNDS) || 12,
  NODE_ENV           : process.env.NODE_ENV || "development",
  CONNECT_PORT       : process.env.PORT || 7000,
  FRONTEND_URL       : process.env.FRONTEND_URL || "",
};

export default Config;