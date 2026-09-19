import { useSyncExternalStore } from "react";
import { appInstallation } from "./app-installation";

export function useAppInstallation() {
  return useSyncExternalStore(appInstallation.subscribe, appInstallation.getSnapshot, appInstallation.getServerSnapshot);
}
