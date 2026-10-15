import type { DatabaseRepository } from "./repository.js";
import { InMemoryDatabaseRepository } from "./memory-repository.js";
import { env } from "../config/env.js";

export * from "./repository.js";
export * from "./memory-repository.js";

let activeRepository: DatabaseRepository | null = null;

/**
 * Returns the currently active database repository.
 * Defaults to in-memory storage.
 */
export function getDatabaseRepository(): DatabaseRepository {
  if (!activeRepository) {
    activeRepository = new InMemoryDatabaseRepository();
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

