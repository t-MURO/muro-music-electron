import { bridge, type DatabaseLocation } from "./bridge";

export type { DatabaseLocation };

// The main process owns the library database location. The renderer can read
// it for display and ask the main process to let the user pick another file,
// but it never names the database in commands.

export const getDatabaseLocation = (): Promise<DatabaseLocation> =>
  bridge().databaseLocation();

export const chooseDatabaseLocation = (
  mode: "open" | "create",
): Promise<DatabaseLocation | null> => bridge().chooseDatabaseLocation({ mode });

export const resetDatabaseLocation = (): Promise<DatabaseLocation | null> =>
  bridge().resetDatabaseLocation();
