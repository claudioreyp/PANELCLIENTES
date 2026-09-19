import { describe, expect, it } from "vitest";
import { canUseDevAuthentication, isLoopbackApiUrl } from "./runtime";

describe("runtime authentication boundaries", () => {
  it("recognizes only loopback API hosts as local", () => {
    expect(isLoopbackApiUrl("http://localhost:8000/api/v1")).toBe(true);
    expect(isLoopbackApiUrl("http://127.0.0.1:8000/api/v1")).toBe(true);
    expect(isLoopbackApiUrl("https://escalar-ai-pos-api.onrender.com/api/v1")).toBe(false);
  });

  it("never enables development credentials for a remote API", () => {
    expect(canUseDevAuthentication({
      isDevelopment: true,
      token: "local-token",
      apiBase: "https://escalar-ai-pos-api.onrender.com/api/v1",
    })).toBe(false);
    expect(canUseDevAuthentication({
      isDevelopment: true,
      token: "local-token",
      apiBase: "http://localhost:8000/api/v1",
    })).toBe(true);
  });
});
