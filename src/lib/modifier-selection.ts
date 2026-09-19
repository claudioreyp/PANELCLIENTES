export type ModifierSelectionValue = string | number;
export type ModifierSelectionAction = "toggle" | "increment" | "decrement";

export type ModifierSelectionRules = {
  allowRepeats: boolean;
  maximum: number | null;
  maxPerOption?: number | null;
};

export type ModifierSelectionChange<T extends ModifierSelectionValue> = {
  selected: T[];
  error?: string;
};

export function modifierSelectionCount<T extends ModifierSelectionValue>(selected: T[], optionId: T) {
  return selected.reduce((count, value) => count + (value === optionId ? 1 : 0), 0);
}

export function selectionInstruction(minimum: number, maximum: number | null) {
  if (maximum !== null && minimum > 0 && minimum === maximum) {
    return `Selecciona ${minimum}`;
  }
  if (minimum > 0 && maximum === null) {
    return `Selecciona mínimo ${minimum}`;
  }
  if (minimum > 0 && maximum !== null) {
    return `Selecciona de ${minimum} a ${maximum}`;
  }
  if (maximum !== null) {
    return `Selecciona máximo ${maximum}`;
  }
  return "Selecciona las opciones que quieras";
}

export function normalizeModifierSelection<T extends ModifierSelectionValue>(
  selected: T[],
  optionIds: T[],
  rules: ModifierSelectionRules,
) {
  const counts = new Map<T, number>();
  selected.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));

  let remaining = rules.maximum ?? Number.POSITIVE_INFINITY;
  const normalized: T[] = [];
  optionIds.forEach((optionId) => {
    const requested = counts.get(optionId) || 0;
    const perOptionLimit = rules.allowRepeats
      ? rules.maxPerOption ?? Number.POSITIVE_INFINITY
      : 1;
    const allowed = Math.min(requested, perOptionLimit, remaining);
    for (let index = 0; index < allowed; index += 1) normalized.push(optionId);
    remaining -= allowed;
  });
  return normalized;
}

export function modifierSelectionState<T extends ModifierSelectionValue>(
  selected: T[],
  optionIds: T[],
  optionId: T,
  rules: ModifierSelectionRules,
) {
  const normalized = normalizeModifierSelection(selected, optionIds, rules);
  const count = modifierSelectionCount(normalized, optionId);
  const maximumReached = rules.maximum !== null && normalized.length >= rules.maximum;
  const optionMaximumReached = rules.allowRepeats
    && rules.maxPerOption !== null
    && rules.maxPerOption !== undefined
    && count >= rules.maxPerOption;
  const canIncrement = rules.allowRepeats
    ? !maximumReached && !optionMaximumReached
    : count === 0 && (rules.maximum === 1 || !maximumReached);

  return {
    count,
    total: normalized.length,
    canIncrement,
    canDecrement: count > 0,
  };
}

export function changeModifierSelection<T extends ModifierSelectionValue>(
  selected: T[],
  optionIds: T[],
  optionId: T,
  action: ModifierSelectionAction,
  rules: ModifierSelectionRules,
): ModifierSelectionChange<T> {
  const normalized = normalizeModifierSelection(selected, optionIds, rules);
  if (!optionIds.includes(optionId)) return { selected: normalized };

  const count = modifierSelectionCount(normalized, optionId);
  const removeOne = () => {
    const index = normalized.lastIndexOf(optionId);
    return index < 0 ? normalized : normalized.filter((_, position) => position !== index);
  };

  if (action === "decrement" || (!rules.allowRepeats && action === "toggle" && count > 0)) {
    return { selected: removeOne() };
  }

  if (!rules.allowRepeats) {
    if (count > 0) return { selected: normalized };
    if (rules.maximum === 1) return { selected: [optionId] };
    if (rules.maximum !== null && normalized.length >= rules.maximum) {
      return { selected: normalized, error: `Puedes elegir como máximo ${rules.maximum} opciones.` };
    }
    return { selected: [...normalized, optionId] };
  }

  if (rules.maximum !== null && normalized.length >= rules.maximum) {
    return { selected: normalized, error: `Puedes elegir como máximo ${rules.maximum} opciones.` };
  }
  if (rules.maxPerOption !== null && rules.maxPerOption !== undefined && count >= rules.maxPerOption) {
    return { selected: normalized, error: `Puedes elegir esta opción como máximo ${rules.maxPerOption} veces.` };
  }
  return { selected: [...normalized, optionId] };
}
