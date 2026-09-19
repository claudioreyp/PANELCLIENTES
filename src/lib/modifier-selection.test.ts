import { describe, expect, it } from "vitest";
import {
  changeModifierSelection,
  modifierSelectionState,
  normalizeModifierSelection,
  selectionInstruction,
} from "./modifier-selection";

const options = ["bbq", "bufalo", "mango"];

describe("modifier selection rules", () => {
  it("replaces the previous option for a single required or optional selection", () => {
    const rules = { allowRepeats: false, maximum: 1 };
    expect(changeModifierSelection([], options, "bbq", "toggle", rules).selected).toEqual(["bbq"]);
    expect(changeModifierSelection(["bbq"], options, "bufalo", "toggle", rules).selected).toEqual(["bufalo"]);
    expect(changeModifierSelection(["bbq"], options, "bbq", "toggle", rules).selected).toEqual([]);
  });

  it("uses counters only when repeats are enabled and respects both limits", () => {
    const rules = { allowRepeats: true, maximum: 3, maxPerOption: 2 };
    const twice = changeModifierSelection(["bbq"], options, "bbq", "increment", rules).selected;
    expect(twice).toEqual(["bbq", "bbq"]);
    expect(modifierSelectionState(twice, options, "bbq", rules).canIncrement).toBe(false);

    const full = changeModifierSelection(twice, options, "bufalo", "increment", rules).selected;
    expect(full).toEqual(["bbq", "bbq", "bufalo"]);
    expect(modifierSelectionState(full, options, "mango", rules).canIncrement).toBe(false);
  });

  it("normalizes changed rules in visible option order", () => {
    expect(normalizeModifierSelection(
      ["mango", "mango", "bbq", "bbq", "bufalo"],
      options,
      { allowRepeats: true, maximum: 3, maxPerOption: 2 },
    )).toEqual(["bbq", "bbq", "bufalo"]);

    expect(normalizeModifierSelection(
      ["mango", "mango", "bbq", "bbq"],
      options,
      { allowRepeats: false, maximum: null },
    )).toEqual(["bbq", "mango"]);
  });

  it("describes required, optional and ranged selections", () => {
    expect(selectionInstruction(1, 1)).toBe("Selecciona 1");
    expect(selectionInstruction(0, 1)).toBe("Selecciona máximo 1");
    expect(selectionInstruction(1, null)).toBe("Selecciona mínimo 1");
    expect(selectionInstruction(1, 3)).toBe("Selecciona de 1 a 3");
  });
});
