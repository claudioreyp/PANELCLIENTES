import { Check, Minus, Plus } from "lucide-react";
import { useId } from "react";
import {
  changeModifierSelection,
  modifierSelectionState,
  selectionInstruction,
  type ModifierSelectionValue,
} from "../lib/modifier-selection";
import { Money } from "./ui";

export type ModifierSelectorOption<T extends ModifierSelectionValue> = {
  id: T;
  name: string;
  priceDelta?: number;
};

type ModifierGroupSelectorProps<T extends ModifierSelectionValue> = {
  groupId: string | number;
  name: string;
  options: ModifierSelectorOption<T>[];
  minimum: number;
  maximum: number | null;
  allowRepeats: boolean;
  maxPerOption?: number | null;
  selected: T[];
  onChange: (selected: T[]) => void;
  appearance?: "preview" | "order";
  priceDisplay?: "delta" | "absolute";
  emptyMessage?: string;
  disabled?: boolean;
};

export function ModifierGroupSelector<T extends ModifierSelectionValue>({
  groupId,
  name,
  options,
  minimum,
  maximum,
  allowRepeats,
  maxPerOption,
  selected,
  onChange,
  appearance = "order",
  priceDisplay = "delta",
  emptyMessage = "No hay opciones disponibles.",
  disabled = false,
}: ModifierGroupSelectorProps<T>) {
  const descriptionId = useId();
  const statusId = useId();
  const optionIds = options.map((option) => option.id);
  const rules = { allowRepeats, maximum, maxPerOption };
  const total = optionIds.reduce(
    (sum, optionId) => sum + modifierSelectionState(selected, optionIds, optionId, rules).count,
    0,
  );
  const singleRequired = !allowRepeats && minimum === 1 && maximum === 1;
  const minimumMet = minimum > 0 && total >= minimum;

  function update(optionId: T, action: "toggle" | "increment" | "decrement") {
    onChange(changeModifierSelection(selected, optionIds, optionId, action, rules).selected);
  }

  return (
    <fieldset
      disabled={disabled}
      className={`modifier-selector modifier-selector-${appearance}`}
      aria-describedby={`${descriptionId} ${statusId}`}
    >
      <legend className="modifier-selector-heading">
        <span>
          <strong>{name}</strong>
          <small id={descriptionId}>{selectionInstruction(minimum, maximum)}</small>
        </span>
        {minimum > 0 && (
          <i data-state={minimumMet ? "complete" : "pending"}>
            {minimumMet && <Check aria-hidden="true" />}
            obligatorio
          </i>
        )}
      </legend>

      {options.length > 0 ? (
        <div className="modifier-selector-options">
          {options.map((option) => {
            const state = modifierSelectionState(selected, optionIds, option.id, rules);
            const selectedOption = state.count > 0;
            const optionCopy = (
              <span className="modifier-option-copy">
                <strong>{option.name}</strong>
                {(priceDisplay === "absolute" || Number(option.priceDelta) > 0) && (
                  <small>{priceDisplay === "absolute" ? `${Number(option.priceDelta).toLocaleString("es-PE", { maximumFractionDigits: 2 })} S/` : <>+ <Money value={Number(option.priceDelta)} /></>}</small>
                )}
              </span>
            );

            if (allowRepeats) {
              return (
                <div className={`modifier-option-row repeated ${selectedOption ? "selected" : ""}`} key={String(option.id)}>
                  {optionCopy}
                  <div className="modifier-stepper">
                    {selectedOption && (
                      <>
                        <button
                          type="button"
                          onClick={() => update(option.id, "decrement")}
                          aria-label={`Quitar una unidad de ${option.name}`}
                        ><Minus /></button>
                        <output aria-label={`Cantidad de ${option.name}`}>{state.count}</output>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => update(option.id, "increment")}
                      disabled={!state.canIncrement}
                      aria-label={`Agregar una unidad de ${option.name}`}
                    ><Plus /></button>
                  </div>
                </div>
              );
            }

            return (
              <label className={`modifier-option-row ${selectedOption ? "selected" : ""}`} key={String(option.id)}>
                {optionCopy}
                <input
                  type={singleRequired ? "radio" : "checkbox"}
                  name={singleRequired ? `modifier-group-${groupId}` : undefined}
                  checked={selectedOption}
                  disabled={!selectedOption && !state.canIncrement}
                  onChange={() => update(option.id, "toggle")}
                  aria-label={option.name}
                />
              </label>
            );
          })}
        </div>
      ) : (
        <p className="modifier-selector-empty">{emptyMessage}</p>
      )}

      <span className="visually-hidden" id={statusId} aria-live="polite">
        {total} {total === 1 ? "selección" : "selecciones"} en {name}
      </span>
    </fieldset>
  );
}
