import postgres from "postgres";

export const sql = postgres(
  "postgresql://doadmin:AVNS_mL9eKCRdEEavEM3bzIX@reporting-db-do-user-9485359-0.m.db.ondigitalocean.com:25060/defaultdb?sslmode=require",
  {
    idle_timeout: 1000,
    transform: {
      undefined: null,
    },
  }
);
