import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// O jsdom não implementa reprodução de mídia; os componentes só precisam que os métodos existam.
Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: () => undefined });
Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: () => Promise.resolve() });
