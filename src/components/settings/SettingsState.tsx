import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { loadSettings, saveSettings, settingsErrorMessage, settingsIdempotencyKey } from "../../lib/settings";
import { ApiError } from "../../lib/api";

export type DirtyRegistration = {
  dirty: boolean;
  saving: boolean;
  save: (() => Promise<boolean>) | null;
};

const SettingsStateContext = createContext<((id: symbol, registration: DirtyRegistration | null) => void) | null>(null);
const SettingsRequestContext = createContext({ scopeKey: "", enabled: true });
export function useSettingsEnabled() { return useContext(SettingsRequestContext).enabled; }

export function SettingsStateProvider({
  children,
  onRegistration,
  scopeKey = "",
  enabled = true,
}: {
  children: ReactNode;
  onRegistration: (registration: DirtyRegistration) => void;
  scopeKey?: string;
  enabled?: boolean;
}) {
  const registrations = useRef(new Map<symbol, DirtyRegistration>());
  const update = useCallback((id: symbol, registration: DirtyRegistration | null) => {
    if (registration) registrations.current.set(id, registration);
    else registrations.current.delete(id);
    const entries = [...registrations.current.values()];
    const dirty = entries.filter((entry) => entry.dirty);
    onRegistration({
      dirty: dirty.length > 0,
      saving: entries.some((entry) => entry.saving),
      save: dirty.length && dirty.every((entry) => entry.save) ? async () => {
        for (const entry of dirty) if (!await entry.save?.()) return false;
        return true;
      } : null,
    });
  }, [onRegistration]);
  return <SettingsRequestContext.Provider value={{ scopeKey, enabled }}><SettingsStateContext.Provider value={update}>{children}</SettingsStateContext.Provider></SettingsRequestContext.Provider>;
}

export function useDirtyRegistration(registration: DirtyRegistration) {
  const update = useContext(SettingsStateContext);
  const id = useRef(Symbol("settings-form"));
  const { dirty, save, saving } = registration;
  useLayoutEffect(() => {
    update?.(id.current, { dirty, save, saving });
    const currentId = id.current;
    return () => update?.(currentId, null);
  }, [dirty, save, saving, update]);
}

export function useSettingsDraft<T>() {
  const [draft, setDraft] = useState<T | null>(null);
  const [baseline, setBaseline] = useState<T | null>(null);
  function openDraft(value: T) {
    setBaseline(value);
    setDraft(value);
  }
  return { draft, setDraft, openDraft, dirty: draft !== null && JSON.stringify(draft) !== JSON.stringify(baseline) };
}

type RequestLifetime = {
  identity: symbol;
  active: boolean;
  read: number;
  mutation: number;
  draft: number;
  saving: boolean;
};

function useRequestLifetime(path: string) {
  const { scopeKey, enabled } = useContext(SettingsRequestContext);
  const key = JSON.stringify([scopeKey, path]);
  const identity = useMemo(() => Symbol(`${key}:${enabled}`), [key, enabled]);
  const lifetimeRef = useRef<RequestLifetime | null>(null);
  useLayoutEffect(() => {
    // Each committed lifetime is distinct, including StrictMode's cleanup/setup replay.
    const lifetime: RequestLifetime = { identity, active: enabled, read: 0, mutation: 0, draft: 0, saving: false };
    lifetimeRef.current = lifetime;
    return () => { lifetime.active = false; };
  }, [enabled, identity]);
  return { key, identity, lifetimeRef, enabled };
}

function isCurrent(lifetime: RequestLifetime | null, identity: symbol, current: RequestLifetime | null): lifetime is RequestLifetime {
  return Boolean(lifetime?.active && lifetime.identity === identity && lifetime === current);
}

function differs<T>(left: T, right: T) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

const CONTEXT_CHANGED = "Se conserva el borrador anterior. No puede guardarse en otra sucursal o empresa; confirma la navegación antes de cargar la configuración actual.";
const REFRESH_FAILED = "El cambio se guardó, pero no se pudo actualizar la lista. Vuelve a cargar la sección para ver los datos recientes.";

type ResourceState<T> = {
  key: string;
  data: T;
  baseline: T;
  loading: boolean;
  saving: boolean;
  available: boolean;
  notice: string | null;
  error: string | null;
  savedMessage: string | null;
};

function initialResource<T>(key: string, fallback: T): ResourceState<T> {
  return { key, data: fallback, baseline: fallback, loading: true, saving: false, available: false, notice: null, error: null, savedMessage: null };
}

export type SettingsResource<T> = {
  data: T;
  setData: React.Dispatch<React.SetStateAction<T>>;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  available: boolean;
  notice: string | null;
  error: string | null;
  savedMessage: string | null;
  save: () => Promise<boolean>;
  savePatch: (patch: Partial<T>) => Promise<boolean>;
  acceptSavedFields: (saved: T, fields: (keyof T)[]) => void;
  reset: () => void;
  reload: () => Promise<void>;
};

export function useSettingsResource<T extends { version?: number }>(
  path: string,
  fallback: T,
  successMessage = "Los cambios se guardaron correctamente.",
): SettingsResource<T> {
  const { key, identity, lifetimeRef, enabled } = useRequestLifetime(path);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const [state, setState] = useState(() => initialResource(key, fallback));
  const stateRef = useRef(state);
  const patchIntent = useRef<{ signature: string; key: string } | null>(null);
  stateRef.current = state;
  const commit = useCallback((next: ResourceState<T>) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useLayoutEffect(() => {
    const current = stateRef.current;
    if (current.key !== key && !differs(current.data, current.baseline)) commit(initialResource(key, fallbackRef.current));
    else commit({ ...current, saving: false });
  }, [commit, identity, key]);

  const reload = useCallback(async () => {
    const lifetime = lifetimeRef.current;
    const current = stateRef.current;
    if (!isCurrent(lifetime, identity, lifetimeRef.current) || lifetime.saving || differs(current.data, current.baseline)) return;
    const read = ++lifetime.read;
    // A read cannot supersede edits or writes that happened after it started.
    const mutation = lifetime.mutation;
    const draft = lifetime.draft;
    const valid = () => isCurrent(lifetime, identity, lifetimeRef.current) && lifetime.read === read && lifetime.mutation === mutation && lifetime.draft === draft;
    commit({ ...current, loading: true, error: null });
    try {
      const result = await loadSettings(path, fallbackRef.current);
      if (!valid()) return;
      const latest = stateRef.current;
      if (differs(latest.data, latest.baseline)) return;
      if (latest.key === key && typeof result.data.version === "number" && typeof latest.baseline.version === "number" && result.data.version < latest.baseline.version) return;
      commit({ ...latest, key, baseline: result.data, data: result.data, available: result.available, notice: result.message });
    } catch (caught) {
      if (valid()) commit({ ...stateRef.current, error: settingsErrorMessage(caught, "No se pudo cargar esta configuración.") });
    } finally {
      if (valid()) commit({ ...stateRef.current, loading: false });
    }
  }, [commit, identity, key, lifetimeRef, path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async () => {
    const lifetime = lifetimeRef.current;
    const current = stateRef.current;
    if (!isCurrent(lifetime, identity, lifetimeRef.current) || lifetime.saving || current.key !== key) return false;
    if (!differs(current.data, current.baseline)) return true;
    if (!current.available) {
      commit({ ...current, error: current.notice || "La API todavía no permite guardar esta configuración." });
      return false;
    }
    lifetime.saving = true;
    lifetime.read += 1;
    const mutation = ++lifetime.mutation;
    const valid = () => isCurrent(lifetime, identity, lifetimeRef.current) && lifetime.mutation === mutation;
    commit({ ...current, loading: false, saving: true, error: null, savedMessage: null });
    try {
      const payload = { ...current.data, expected_version: current.baseline.version ?? current.data.version ?? 0 };
      const saved = await saveSettings<typeof payload, T>(path, payload);
      if (!valid()) return false;
      const next = saved && typeof saved === "object" ? saved : current.data;
      const latest = stateRef.current;
      const data = differs(latest.data, current.data) ? { ...latest.data, version: next.version } : next;
      lifetime.read += 1;
      commit({ ...latest, baseline: next, data, savedMessage: successMessage });
      return !differs(data, next);
    } catch (caught) {
      if (valid()) commit({ ...stateRef.current, error: settingsErrorMessage(caught, "No se pudieron guardar los cambios.") });
      return false;
    } finally {
      if (isCurrent(lifetime, identity, lifetimeRef.current)) {
        lifetime.saving = false;
        commit({ ...stateRef.current, saving: false });
      }
    }
  }, [commit, identity, key, lifetimeRef, path, successMessage]);

  const savePatch = useCallback(async (patch: Partial<T>) => {
    const lifetime = lifetimeRef.current;
    const current = stateRef.current;
    if (!isCurrent(lifetime, identity, lifetimeRef.current) || lifetime.saving || current.key !== key || !current.available) return false;
    const selected = (Object.keys(patch) as (keyof T)[]).filter((field) => field !== "version");
    const matches = (value: T) => selected.every((field) => !differs(value[field], patch[field]));
    const payload = { ...current.baseline, ...patch, expected_version: current.baseline.version ?? 0 };
    const signature = JSON.stringify([key, payload]);
    if (patchIntent.current?.signature !== signature) patchIntent.current = { signature, key: settingsIdempotencyKey("settings-patch") };
    const intent = patchIntent.current;
    lifetime.saving = true;
    lifetime.read += 1;
    const mutation = ++lifetime.mutation;
    const valid = () => isCurrent(lifetime, identity, lifetimeRef.current) && lifetime.mutation === mutation;
    let written: T | null = null;
    const accept = (saved: T, confirmed: boolean) => {
      const latest = stateRef.current;
      const data = { ...saved };
      // Independent editors must neither save nor discard each other's pending changes.
      for (const field of Object.keys(latest.data) as (keyof T)[]) {
        if (field === "version") continue;
        const changedDuringSave = differs(latest.data[field], current.data[field]);
        const unrelatedDraft = !selected.includes(field) && differs(latest.data[field], current.baseline[field]);
        if (changedDuringSave || unrelatedDraft) data[field] = latest.data[field];
      }
      commit({ ...latest, baseline: saved, data, savedMessage: confirmed ? successMessage : null });
    };
    commit({ ...current, loading: false, saving: true, error: null, savedMessage: null });
    try {
      if (!matches(current.baseline)) {
        written = await saveSettings<typeof payload, T>(path, payload, "PATCH", intent.key);
        if (!valid()) return false;
      }
      const verified = await loadSettings(path, written ?? current.baseline);
      if (!valid()) return false;
      if (!verified.available || (verified.data.version ?? -1) < (written?.version ?? current.baseline.version ?? 0)) {
        throw new Error("El cambio se guardó, pero no pudo verificarse. Comprueba la conexión y vuelve a intentarlo.");
      }
      const confirmed = matches(verified.data);
      accept(verified.data, confirmed);
      patchIntent.current = null;
      if (!confirmed) commit({ ...stateRef.current, error: "La API no confirmó los ajustes solicitados. Revisa la configuración y vuelve a intentarlo." });
      return confirmed;
    } catch (caught) {
      if (!valid()) return false;
      const rejected = caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 408;
      if (!rejected) {
        // A lost write response is not proof of rollback. Verify before retrying the write.
        try {
          const verified = await loadSettings(path, current.baseline);
          if (!valid()) return false;
          if (verified.available && matches(verified.data)
            && (verified.data.version ?? -1) >= (written?.version ?? current.baseline.version ?? 0)) {
            accept(verified.data, true);
            patchIntent.current = null;
            return true;
          }
        } catch { /* Keep the same idempotency key while the result remains uncertain. */ }
      } else patchIntent.current = null;
      if (valid()) {
        if (written) accept(written, false);
        commit({ ...stateRef.current, error: settingsErrorMessage(caught, "No se pudo confirmar el guardado. Revisa la conexión y vuelve a intentarlo.") });
      }
      return false;
    } finally {
      if (isCurrent(lifetime, identity, lifetimeRef.current)) {
        lifetime.saving = false;
        commit({ ...stateRef.current, saving: false });
      }
    }
  }, [commit, identity, key, lifetimeRef, path, successMessage]);

  const setData = useCallback<React.Dispatch<React.SetStateAction<T>>>((update) => {
    const lifetime = lifetimeRef.current;
    const current = stateRef.current;
    if (!isCurrent(lifetime, identity, lifetimeRef.current) || current.key !== key) return;
    lifetime.draft += 1;
    lifetime.read += 1;
    commit({ ...current, loading: false, data: typeof update === "function" ? (update as (previous: T) => T)(current.data) : update });
  }, [commit, identity, key, lifetimeRef]);

  const reset = useCallback(() => {
    const lifetime = lifetimeRef.current;
    if (!isCurrent(lifetime, identity, lifetimeRef.current) || lifetime.saving) return;
    lifetime.draft += 1;
    lifetime.read += 1;
    const current = stateRef.current;
    if (current.key !== key) {
      commit(initialResource(key, fallbackRef.current));
      void reload();
    } else commit({ ...current, data: current.baseline, loading: false, error: null, savedMessage: null });
  }, [commit, identity, key, lifetimeRef, reload]);

  const acceptSavedFields = useCallback((saved: T, fields: (keyof T)[]) => {
    const lifetime = lifetimeRef.current;
    const current = stateRef.current;
    if (!isCurrent(lifetime, identity, lifetimeRef.current) || current.key !== key) return;
    if (typeof saved.version === "number" && typeof current.baseline.version === "number" && saved.version < current.baseline.version) return;
    lifetime.mutation += 1;
    lifetime.read += 1;
    const patch = Object.fromEntries(fields.map((field) => [field, saved[field]]));
    commit({ ...current, loading: false, baseline: { ...current.baseline, ...patch, version: saved.version }, data: { ...current.data, ...patch, version: saved.version } });
  }, [commit, identity, key, lifetimeRef]);

  const dirty = differs(state.data, state.baseline);
  const belongsHere = state.key === key && enabled;
  useDirtyRegistration({ dirty, saving: belongsHere && state.saving, save: belongsHere ? save : null });

  return {
    ...state,
    data: belongsHere || dirty ? state.data : fallback,
    setData,
    loading: belongsHere ? state.loading : enabled && !dirty,
    saving: belongsHere && state.saving,
    dirty,
    available: belongsHere && state.available,
    notice: belongsHere ? state.notice : CONTEXT_CHANGED,
    error: belongsHere ? state.error : null,
    savedMessage: belongsHere ? state.savedMessage : null,
    save,
    savePatch,
    acceptSavedFields,
    reset,
    reload,
  };
}

export type SettingsQuery<T> = {
  data: T;
  setData: React.Dispatch<React.SetStateAction<T>>;
  loading: boolean;
  available: boolean;
  notice: string | null;
  error: string | null;
  reload: (afterMutation?: boolean) => Promise<void>;
};

export function useSettingsQuery<T>(path: string, fallback: T): SettingsQuery<T> {
  const { key, identity, lifetimeRef, enabled } = useRequestLifetime(path);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const [state, setState] = useState(() => initialResource(key, fallback));
  const stateRef = useRef(state);
  stateRef.current = state;
  const commit = useCallback((next: ResourceState<T>) => {
    stateRef.current = next;
    setState(next);
  }, []);
  useLayoutEffect(() => {
    if (stateRef.current.key !== key) commit(initialResource(key, fallbackRef.current));
  }, [commit, key]);

  const reload = useCallback(async (afterMutation = false) => {
    const lifetime = lifetimeRef.current;
    if (!isCurrent(lifetime, identity, lifetimeRef.current)) return;
    const read = ++lifetime.read;
    if (afterMutation) lifetime.mutation += 1;
    const mutation = lifetime.mutation;
    const valid = () => isCurrent(lifetime, identity, lifetimeRef.current) && lifetime.read === read && lifetime.mutation === mutation;
    commit({ ...stateRef.current, loading: true, error: null });
    try {
      const result = await loadSettings(path, fallbackRef.current);
      if (!valid()) return;
      if (afterMutation && !result.available) commit({ ...stateRef.current, available: false, notice: REFRESH_FAILED });
      else commit({ ...stateRef.current, key, data: result.data, available: result.available, notice: result.message });
    } catch (caught) {
      if (valid()) commit({ ...stateRef.current, ...(afterMutation ? { notice: REFRESH_FAILED } : { error: settingsErrorMessage(caught, "No se pudo cargar la información.") }) });
    } finally {
      if (valid()) commit({ ...stateRef.current, loading: false });
    }
  }, [commit, identity, key, lifetimeRef, path]);

  const setData = useCallback<React.Dispatch<React.SetStateAction<T>>>((update) => {
    const lifetime = lifetimeRef.current;
    const current = stateRef.current;
    if (!isCurrent(lifetime, identity, lifetimeRef.current) || current.key !== key) return;
    lifetime.mutation += 1;
    lifetime.read += 1;
    commit({ ...current, loading: false, data: typeof update === "function" ? (update as (previous: T) => T)(current.data) : update });
  }, [commit, identity, key, lifetimeRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const belongsHere = state.key === key && enabled;
  return { data: belongsHere ? state.data : fallback, setData, loading: belongsHere ? state.loading : enabled, available: belongsHere && state.available, notice: belongsHere ? state.notice : CONTEXT_CHANGED, error: belongsHere ? state.error : null, reload };
}
