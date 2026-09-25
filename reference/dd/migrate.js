import { join } from "node:path";
import { loadConfig } from "./config.js";
import { DatabaseClient } from "./database/client.js";
import { PostgresMigrationRunner } from "./database/migrator.js";
const config = loadConfig();
if (!config.databaseUrl)
    throw new Error("DATABASE_URL is required to run migrations");
const database = new DatabaseClient(config);
try {
    const migrationsPath = join(process.cwd(), "db", "migrations");
    const applied = await new PostgresMigrationRunner(database, migrationsPath).migrate();
    console.log(JSON.stringify({ appliedMigrations: applied }));
}
finally {
    await database.close();
}
