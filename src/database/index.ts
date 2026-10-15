import type { DatabaseRepository } from "./repository.js";
import { InMemoryDatabaseRepository } from "./memory-repository.js";
import { SqliteDatabaseRepository } from "./sqlite-repository.js";
import { env } from "../config/env.js";

export * from "./repository.js";
export * from "./memory-repository.js";
export * from "./sqlite-repository.js";

let activeRepository: DatabaseRepository | null = null;

/**
 * Returns the currently active database repository.
 * Defaults to in-memory storage ("in memory for now").
 * Can be switched dynamically or configured via DB_ADAPTER in .env.
 */
export function getDatabaseRepository(): DatabaseRepository {
  if (!activeRepository) {
    const adapterType = (env as any).DB_ADAPTER || "memory";
    if (adapterType === "sqlite") {
      activeRepository = new SqliteDatabaseRepository();
    } else {
      activeRepository = new InMemoryDatabaseRepository();
    }
  }
  return activeRepository;
}

/**
 * Dynamically swaps the active database repository at runtime.
 * Allows swapping to SQLite, PostgreSQL, Supabase, Redis, or mock test databases seamlessly.
 */
function setDatabaseRepository(repository: DatabaseRepository): void {
  activeRepository = repository;
}

/**
 * Resets repository back to default.
 */
function resetDatabaseRepository(): void {
  activeRepository = null;
}

