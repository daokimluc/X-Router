import { describe, expect, it } from "vitest";
import { CircuitBreaker, CircuitBreakerOpenError } from "../services/CircuitBreaker.js";

const CONFIG = {
  enabled: true,
  failureThreshold: 1,
  cooldownMs: 1000,
  halfOpenMaxRequests: 1
};

const ID = "provider_test_main";

function openCircuit(cb: CircuitBreaker, now: Date): void {
  // failureThreshold = 1 → a single circuit-class failure opens the circuit.
  cb.recordFailure(ID, CONFIG, now);
  expect(cb.getCircuitState(ID)).toBe("open");
}

describe("CircuitBreaker self-heal", () => {
  it("admits a probe after cooldown and closes on a successful probe", () => {
    const cb = new CircuitBreaker();
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    openCircuit(cb, t0);

    // Before cooldown: not admissible.
    const beforeCooldown = new Date(t0.getTime() + 500);
    expect(cb.canRequest(ID, CONFIG, beforeCooldown)).toBe(false);
    expect(() => cb.beforeRequest(ID, CONFIG, beforeCooldown)).toThrow(
      CircuitBreakerOpenError
    );

    // After cooldown: a single probe is admitted (open → half_open).
    const afterCooldown = new Date(t0.getTime() + 1000);
    expect(cb.canRequest(ID, CONFIG, afterCooldown)).toBe(true);
    cb.beforeRequest(ID, CONFIG, afterCooldown);
    expect(cb.getCircuitState(ID)).toBe("half_open");

    // Probe succeeds → circuit closes and admits traffic.
    cb.recordResult(ID, { ok: true, countsAsFailure: false }, CONFIG, afterCooldown);
    expect(cb.getCircuitState(ID)).toBe("closed");
    expect(cb.canRequest(ID, CONFIG, afterCooldown)).toBe(true);
  });

  it("does NOT strand half-open when the probe fails with a non-circuit error", () => {
    const cb = new CircuitBreaker();
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    openCircuit(cb, t0);

    const t1 = new Date(t0.getTime() + 1000);
    cb.beforeRequest(ID, CONFIG, t1); // half_open, in-flight = 1
    expect(cb.getCircuitState(ID)).toBe("half_open");

    // Probe fails with a NON-circuit error (e.g. an auth error / internal throw).
    cb.recordResult(ID, { ok: false, countsAsFailure: false }, CONFIG, t1);

    // Reopens + restarts cooldown — NOT stuck half-open forever.
    expect(cb.getCircuitState(ID)).toBe("open");

    // After a fresh cooldown a new probe is admitted (the old code stranded here).
    const t2 = new Date(t1.getTime() + 1000);
    expect(cb.canRequest(ID, CONFIG, t2)).toBe(true);
    expect(() => cb.beforeRequest(ID, CONFIG, t2)).not.toThrow();
    expect(cb.getCircuitState(ID)).toBe("half_open");
  });

  it("reopens and restarts cooldown when the probe fails with a circuit error", () => {
    const cb = new CircuitBreaker();
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    openCircuit(cb, t0);

    const t1 = new Date(t0.getTime() + 1000);
    cb.beforeRequest(ID, CONFIG, t1);
    cb.recordResult(ID, { ok: false, countsAsFailure: true }, CONFIG, t1);
    expect(cb.getCircuitState(ID)).toBe("open");

    // Cooldown is measured from t1 (the reopen), not t0.
    expect(cb.canRequest(ID, CONFIG, new Date(t1.getTime() + 500))).toBe(false);
    expect(cb.canRequest(ID, CONFIG, new Date(t1.getTime() + 1000))).toBe(true);
  });

  it("releaseProbe frees the half-open slot so a retry can re-acquire it", () => {
    const cb = new CircuitBreaker();
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    openCircuit(cb, t0);

    const t1 = new Date(t0.getTime() + 1000);
    cb.beforeRequest(ID, CONFIG, t1); // in-flight = 1
    // With max = 1, a second probe would be rejected while the first is in-flight.
    expect(cb.canRequest(ID, CONFIG, t1)).toBe(false);

    // Auth-refresh path releases the probe (retry, not a terminal outcome).
    cb.releaseProbe(ID);
    expect(cb.getCircuitState(ID)).toBe("half_open"); // still half_open, not concluded
    expect(cb.canRequest(ID, CONFIG, t1)).toBe(true);

    // The retry re-acquires the probe slot and then succeeds → closes.
    cb.beforeRequest(ID, CONFIG, t1);
    cb.recordResult(ID, { ok: true, countsAsFailure: false }, CONFIG, t1);
    expect(cb.getCircuitState(ID)).toBe("closed");
  });

  it("canRequest is side-effect free (does not transition state)", () => {
    const cb = new CircuitBreaker();
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    openCircuit(cb, t0);

    const afterCooldown = new Date(t0.getTime() + 2000);
    // Peeking many times must NOT flip the circuit to half_open or admit extra probes.
    expect(cb.canRequest(ID, CONFIG, afterCooldown)).toBe(true);
    expect(cb.canRequest(ID, CONFIG, afterCooldown)).toBe(true);
    expect(cb.getCircuitState(ID)).toBe("open"); // still open until beforeRequest runs
  });

  it("closed-state threshold: only circuit-class failures advance the streak", () => {
    const cb = new CircuitBreaker();
    const config = { ...CONFIG, failureThreshold: 3 };
    const now = new Date("2026-01-01T00:00:00.000Z");

    // Non-circuit failures do not trip the breaker in the closed state.
    cb.recordResult(ID, { ok: false, countsAsFailure: false }, config, now);
    cb.recordResult(ID, { ok: false, countsAsFailure: false }, config, now);
    cb.recordResult(ID, { ok: false, countsAsFailure: false }, config, now);
    expect(cb.getCircuitState(ID)).toBe("closed");

    // Circuit-class failures do, once the threshold is reached.
    cb.recordResult(ID, { ok: false, countsAsFailure: true }, config, now);
    cb.recordResult(ID, { ok: false, countsAsFailure: true }, config, now);
    expect(cb.getCircuitState(ID)).toBe("closed");
    cb.recordResult(ID, { ok: false, countsAsFailure: true }, config, now);
    expect(cb.getCircuitState(ID)).toBe("open");
  });

  it("disabled breaker always admits and records nothing", () => {
    const cb = new CircuitBreaker();
    const config = { ...CONFIG, enabled: false };
    cb.recordFailure(ID, config);
    expect(cb.canRequest(ID, config)).toBe(true);
    expect(() => cb.beforeRequest(ID, config)).not.toThrow();
    expect(cb.getCircuitState(ID)).toBe("closed");
  });
});
