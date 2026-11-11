import { createMockAdapter } from "./mock-adapter";
import { PROVIDERS } from "./providers";
import type { ProviderAdapter } from "./types";

/**
 * Which adapter serves which provider. Live adapters are registered per provider key when they exist;
 * until then the development mock is the only choice, and the UI says so.
 */
export class AdapterRegistry {
  private live = new Map<string, ProviderAdapter>();
  private mocks = new Map<string, ProviderAdapter>();

  constructor() {
    for (const provider of PROVIDERS) this.mocks.set(provider.key, createMockAdapter(provider));
  }

  registerLive(adapter: ProviderAdapter) {
    if (adapter.isMock) throw new Error("registerLive needs a real adapter");
    this.live.set(adapter.descriptor.key, adapter);
  }

  /** Replace the generic development mock with a provider-specific one (e.g. one that produces metrics). */
  registerMock(adapter: ProviderAdapter) {
    if (!adapter.isMock) throw new Error("registerMock needs a mock adapter");
    this.mocks.set(adapter.descriptor.key, adapter);
  }

  hasLive(key: string) {
    return this.live.has(key);
  }

  /** `mode` comes from the stored account (isMock), never from user input at sync time. */
  get(key: string, mode: "live" | "mock"): ProviderAdapter {
    const adapter = mode === "mock" ? this.mocks.get(key) : this.live.get(key);
    if (!adapter) {
      throw new Error(
        mode === "live" ? `No live adapter is available for ${key}` : `Unknown provider ${key}`,
      );
    }
    return adapter;
  }
}

export const defaultRegistry = new AdapterRegistry();
