import { useCallback, useEffect, useState } from "react";
import {
  chooseDatabaseLocation,
  getDatabaseLocation,
  resetDatabaseLocation,
  type DatabaseLocation,
} from "../desktop/database";
import { notify } from "../stores";

/**
 * Display and change the library database location. The main process owns the
 * location; switching databases reloads the window so no state from the
 * previous library survives.
 */
export const useDatabaseLocation = () => {
  const [location, setLocation] = useState<DatabaseLocation | null>(null);

  useEffect(() => {
    let active = true;
    getDatabaseLocation()
      .then((current) => {
        if (active) setLocation(current);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const switchDatabase = useCallback(
    async (change: () => Promise<DatabaseLocation | null>) => {
      try {
        const next = await change();
        if (next) window.location.reload();
      } catch (error) {
        notify.error(error instanceof Error ? error.message : String(error));
      }
    },
    [],
  );

  const openDatabase = useCallback(
    () => switchDatabase(() => chooseDatabaseLocation("open")),
    [switchDatabase],
  );
  const createDatabase = useCallback(
    () => switchDatabase(() => chooseDatabaseLocation("create")),
    [switchDatabase],
  );
  const switchToDefaultLocation = useCallback(
    () => switchDatabase(resetDatabaseLocation),
    [switchDatabase],
  );

  return { location, openDatabase, createDatabase, switchToDefaultLocation };
};
