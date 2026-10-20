import type {
  AsyncEndpoint,
  EndpointAction,
  EndpointCheckpoint,
  EndpointCredential,
  EndpointFulfillment,
  EndpointOutcome,
  EndpointScheduling,
} from "@hypit/hypit/endpoint";
import type { CanonicalValue, Need } from "@hypit/hypit/protocol";
import type {
  CapacityResourceClaim,
  ExecutionDiagnostic,
  OperationProgress,
  OperationReceipt,
  ResourceStore,
} from "@hypit/hypit/runtime";

/**
 * One immediate call waits this long for its remote work before it gives up.
 *
 * The bound is the caller's patience, not the Provider's: a Provider that owns its own
 * operation timeout reports its own failure first.
 */
const defaultMaxOperationMs = 30 * 60_000;

/**
 * The smallest gap between two provider actions.
 *
 * A Provider states when it wants to be woken; this floor only stops a Provider that asks for
 * no wait at all from turning one call into a hot loop.
 */
const defaultMinActionDelayMs = 250;

export type AsyncInvocationObservation = {
  readonly reportProgress?: (progress: OperationProgress) => Promise<void>;
  readonly reportDiagnostic?: (diagnostic: ExecutionDiagnostic) => Promise<void>;
};

export type AsyncInvocationLimits = {
  /** Whole-operation wall clock bound for this one call. */
  readonly maxOperationMs?: number;
  /** Smallest delay between two provider actions. */
  readonly minActionDelayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, Math.max(0, ms)));
}

/**
 * In-process rate admission for one immediate call.
 *
 * The durable Runtime owns budgets across Builds; one immediate call owns only its own
 * actions, so the declared rate is honored here and nowhere else.
 */
class SessionRateAdmission {
  readonly #calls = new Map<string, number[]>();

  async admit(claims: readonly CapacityResourceClaim[]): Promise<void> {
    for (const claim of claims) {
      const periodMs = claim.periodMs;
      if (periodMs === undefined) continue;
      const recent = (this.#calls.get(claim.id) ?? [])
        .filter((time) => time > Date.now() - periodMs);
      while (recent.length >= claim.limit) {
        const oldest = recent[0]!;
        await sleep(oldest + periodMs - Date.now() + 1);
        for (let index = recent.length - 1; index >= 0; index -= 1) {
          if ((recent[index] ?? 0) <= Date.now() - periodMs) recent.splice(index, 1);
        }
      }
      recent.push(Date.now());
      this.#calls.set(claim.id, recent);
    }
  }
}

/**
 * Run one asynchronous capability to completion outside any Build.
 *
 * A Provider's asynchronous endpoint is a submit/poll/collect conversation: `start` submits the
 * work, `poll` reports whether the remote job ended, and `collect` fetches the finished
 * artifacts. This drives exactly that conversation in the caller's process, so a paid video
 * generation can be requested directly without a Build, a Worker or a Result.
 *
 * The caller owns the ResourceStore, so the artifacts the Provider returns stay in the
 * caller's hands.
 */
export async function invokeAsyncEndpointNeed(input: {
  readonly endpointId: string;
  readonly endpoint: AsyncEndpoint;
  readonly need: Need;
  readonly resources: ResourceStore;
  readonly credentials: Readonly<Record<string, EndpointCredential>>;
  readonly scheduling?: EndpointScheduling;
  readonly observation?: AsyncInvocationObservation;
  readonly limits?: AsyncInvocationLimits;
}): Promise<EndpointFulfillment> {
  const { endpointId, endpoint, need, resources, credentials } = input;
  const observation = input.observation ?? {};
  const maxOperationMs = input.limits?.maxOperationMs ?? defaultMaxOperationMs;
  const minActionDelayMs = input.limits?.minActionDelayMs ?? defaultMinActionDelayMs;
  const admission = new SessionRateAdmission();
  const command = { kind: "fulfill-need" as const, id: `command:${need.id}`, need };
  const operation = `op_${crypto.randomUUID()}`;
  const deadline = Date.now() + maxOperationMs;
  let handle: CanonicalValue | undefined;
  let remoteEnded = false;
  let receipt: OperationReceipt | undefined;
  let lastActionAt = 0;

  for (;;) {
    if (Date.now() >= deadline) {
      throw new Error(`Endpoint ${endpointId} did not finish ${need.capability.name} within ${
        Math.round(maxOperationMs / 1000)}s; the remote work may still be running`);
    }
    const action: EndpointAction = handle === undefined ? "submit" : remoteEnded ? "collect" : "poll";
    if (action === "collect" && endpoint.collect === undefined) {
      throw new Error(`Endpoint ${endpointId} ended ${need.capability.name} remotely but declares no collect action`);
    }
    await admission.admit(input.scheduling?.actions?.[action] ?? []);
    const wait = Math.max(0, lastActionAt + minActionDelayMs - Date.now());
    if (wait > 0) await sleep(wait);
    lastActionAt = Date.now();
    await observation.reportProgress?.({ phase: action });
    const base = {
      command,
      need,
      resources,
      credentials,
      operation,
      ...(observation.reportProgress === undefined ? {} : { reportProgress: observation.reportProgress }),
      ...(observation.reportDiagnostic === undefined ? {} : { reportDiagnostic: observation.reportDiagnostic }),
      checkpoint: async (checkpoint: EndpointCheckpoint) => {
        handle = checkpoint.handle;
        if (checkpoint.receipt !== undefined) receipt = checkpoint.receipt;
        if (checkpoint.remoteEnded === true) remoteEnded = true;
      },
    };
    let outcome: EndpointOutcome;
    try {
      if (action === "submit") {
        outcome = await endpoint.start(base);
      } else {
        const current = handle;
        if (current === undefined) throw new Error(`Endpoint ${endpointId} has no task handle to continue`);
        const continuing = { ...base, handle: current };
        outcome = action === "poll"
          ? await endpoint.poll(continuing)
          : await endpoint.collect!(continuing);
      }
    } catch (error) {
      throw new Error(`Endpoint ${endpointId} failed ${need.capability.name}: ${
        error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (outcome.receipt !== undefined) receipt = outcome.receipt;
    if (outcome.status === "completed") return outcome.result;
    if (outcome.status === "failed") {
      throw new Error(`Endpoint ${endpointId} failed ${need.capability.name}: ${outcome.failure.message} (${
        outcome.failure.code})${receipt === undefined ? "" : `; task ${receipt.id}`}`);
    }
    if (outcome.status === "ready") {
      remoteEnded = true;
      handle = outcome.handle;
      continue;
    }
    handle = outcome.handle;
    const wakeAt = outcome.wakeAt ?? Date.now();
    if (wakeAt > Date.now()) await sleep(wakeAt - Date.now());
  }
}
