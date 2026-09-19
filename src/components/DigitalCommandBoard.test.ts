import { describe, expect, it } from "vitest";
import { commandTimerTone, formatCommandElapsed } from "./DigitalCommandBoard";

describe("digital command timer", () => {
  it("keeps accumulating minutes instead of resetting every hour", () => {
    expect(formatCommandElapsed(65 * 60 + 7)).toBe("65:07");
  });

  it("changes from green to amber at ten minutes and red at twenty", () => {
    expect(commandTimerTone(9 * 60 + 59)).toBe("normal");
    expect(commandTimerTone(10 * 60)).toBe("warning");
    expect(commandTimerTone(19 * 60 + 59)).toBe("warning");
    expect(commandTimerTone(20 * 60)).toBe("critical");
  });
});
