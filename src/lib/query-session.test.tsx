import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuerySessionProvider, useQuery } from "./query-session";

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("query session lifecycle", () => {
  it("survives StrictMode and revisits, but clears on scope changes and stops inactive polling", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => "scope data");
    function Probe() {
      const query = useQuery(["orders"], load, 8000);
      return <span>{query.data || "Loading"}</span>;
    }
    const view = (scope: string, visible: boolean) => <StrictMode><QuerySessionProvider key={scope}>{visible && <Probe />}</QuerySessionProvider></StrictMode>;
    const rendered = render(view("first", true));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText("scope data")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    rendered.rerender(view("first", false));
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(load).toHaveBeenCalledTimes(1);
    rendered.rerender(view("first", true));
    expect(screen.getByText("scope data")).toBeInTheDocument();
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(2);
    rendered.rerender(view("second", true));
    expect(screen.getByText("Loading")).toBeInTheDocument();
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(3);
  });
});
