import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ModifierGroupSelector } from "./ModifierGroupSelector";

afterEach(cleanup);

const options = [
  { id: 1, name: "BBQ", priceDelta: 0 },
  { id: 2, name: "Búfalo", priceDelta: 2 },
  { id: 3, name: "Mango habanero", priceDelta: 0 },
];

function Harness({
  minimum,
  maximum,
  allowRepeats,
  maxPerOption,
}: {
  minimum: number;
  maximum: number | null;
  allowRepeats: boolean;
  maxPerOption?: number | null;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  return (
    <>
      <ModifierGroupSelector
        groupId="salsas"
        name="Elige las salsas"
        options={options}
        minimum={minimum}
        maximum={maximum}
        allowRepeats={allowRepeats}
        maxPerOption={maxPerOption}
        selected={selected}
        onChange={setSelected}
      />
      <output data-testid="selection">{selected.join(",")}</output>
    </>
  );
}

describe("ModifierGroupSelector", () => {
  it("renders required single selection as radios without preselecting an option", () => {
    render(<Harness minimum={1} maximum={1} allowRepeats={false} />);

    expect(screen.getByText("Selecciona 1")).toBeInTheDocument();
    expect(screen.getByText("obligatorio")).toHaveAttribute("data-state", "pending");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getAllByRole("radio").every((input) => !(input as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "BBQ" }));
    expect(screen.getByText("obligatorio")).toHaveAttribute("data-state", "complete");
    expect(screen.getByText("obligatorio").querySelector("svg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Búfalo" }));
    expect(screen.getByTestId("selection")).toHaveTextContent("2");
  });

  it("renders an optional single selection as checkboxes", () => {
    render(<Harness minimum={0} maximum={1} allowRepeats={false} />);

    expect(screen.queryByText("obligatorio")).not.toBeInTheDocument();
    expect(screen.getByText("Selecciona máximo 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "BBQ" }));
    expect(screen.getByTestId("selection")).toHaveTextContent("1");
  });

  it("increments and decrements repeated options while disabling capped additions", () => {
    render(<Harness minimum={0} maximum={3} allowRepeats maxPerOption={2} />);

    const addBbq = screen.getByRole("button", { name: "Agregar una unidad de BBQ" });
    fireEvent.click(addBbq);
    fireEvent.click(addBbq);
    expect(screen.getByLabelText("Cantidad de BBQ")).toHaveTextContent("2");
    expect(addBbq).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Quitar una unidad de BBQ" }));
    expect(screen.getByLabelText("Cantidad de BBQ")).toHaveTextContent("1");
    expect(addBbq).toBeEnabled();
  });
});
