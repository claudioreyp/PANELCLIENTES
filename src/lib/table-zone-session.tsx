import { createContext, useContext, useState, type ReactNode } from "react";

type TableZoneSession = {
  read: (businessId: number, branchId: number) => number | null;
  select: (businessId: number, branchId: number, areaId: number | null) => void;
};

const TableZoneSessionContext = createContext<TableZoneSession | null>(null);

export function TableZoneSessionProvider({ children }: { children: ReactNode }) {
  const [session] = useState<TableZoneSession>(() => {
    // Owned by the authenticated provider, never by browser storage or a module singleton.
    const zones = new Map<string, number>();
    return {
      read: (businessId, branchId) => zones.get(`${businessId}:${branchId}`) ?? null,
      select: (businessId, branchId, areaId) => {
        const key = `${businessId}:${branchId}`;
        if (areaId === null) zones.delete(key);
        else zones.set(key, areaId);
      },
    };
  });

  return <TableZoneSessionContext.Provider value={session}>{children}</TableZoneSessionContext.Provider>;
}

export function useTableZoneSession() {
  return useContext(TableZoneSessionContext);
}
