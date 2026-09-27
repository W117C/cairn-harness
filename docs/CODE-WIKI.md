# Core code wiki

This checkout is intentionally core-only. The former Electron shell, renderer, preload, desktop gates, and UI acceptance layers have been removed.

## Runtime flow

`runLoop` receives a provider and tools, emits append-only events, and applies permission/security policy. Provider adapters live under `src/providers/`; tool implementations live under `src/tools/`; orchestration and recovery live under `src/agent/`.

`src/main/agent-runner.ts` remains as an electron-free application service used by headless checks and core integrations. It must not import Electron or renderer code.

## Verification

Use the root `typecheck` and Vitest commands. The gate manifest contains only core checks in this checkout.
