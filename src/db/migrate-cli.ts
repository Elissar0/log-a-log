import { loadConfig } from "../config";
import { closeDatabasePools, createDatabasePools } from "./pool";
import { runMigrations } from "./migrate";

const pools = createDatabasePools(loadConfig());
try {
  await runMigrations(pools.maintenance, process.env.MIGRATIONS_DIR);
} finally {
  await closeDatabasePools(pools);
}
