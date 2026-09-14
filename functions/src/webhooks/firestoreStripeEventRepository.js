"use strict";

const TERMINAL = new Set(["processed", "ignored"]);

class FirestoreStripeEventRepository {
  constructor({ db, collection = "stripeEvents", clock = () => new Date(), leaseMs = 120000 }) {
    this.db = db;
    this.collection = db.collection(collection);
    this.clock = clock;
    this.leaseMs = leaseMs;
  }

  async claim(eventId, metadata, { retryFailed = false } = {}) {
    validateEventId(eventId);
    const ref = this.collection.doc(eventId);
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const now = this.clock();
      if (!snapshot.exists) {
        const record = {
          eventId,
          eventType: safe(metadata.type),
          status: "processing",
          receivedAt: now,
          processedAt: null,
          attemptCount: 1,
          providerCreatedAt: Number.isSafeInteger(metadata.created) ? metadata.created : null,
          providerApiVersion: safe(metadata.apiVersion),
          providerLivemode: Boolean(metadata.livemode),
          handlerVersion: safe(metadata.handlerVersion || "gate5.5-v1"),
          failureClassification: null,
          leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
          result: null
        };
        tx.create(ref, record);
        return { kind: "acquired", record };
      }

      const existing = snapshot.data();
      assertImmutable(existing, metadata);
      if (TERMINAL.has(existing.status)) return { kind: "duplicate", record: existing };
      if (existing.status === "failed" && !retryFailed) return { kind: "duplicate", record: existing };
      const leaseActive = toDate(existing.leaseExpiresAt) > now;
      if (existing.status === "processing" && leaseActive) return { kind: "busy", record: existing };
      const resumed = {
        status: "processing",
        attemptCount: Number(existing.attemptCount || 0) + 1,
        failureClassification: null,
        leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
        lastAttemptAt: now
      };
      tx.update(ref, resumed);
      return { kind: "acquired", record: { ...existing, ...resumed } };
    });
  }

  async complete(eventId, { status = "processed", result = null } = {}) {
    if (!TERMINAL.has(status)) throw new Error("Invalid terminal Stripe event status");
    return this._finish(eventId, { status, result: safe(result), failureClassification: null });
  }

  async fail(eventId, { code = "handler_error" } = {}) {
    return this._finish(eventId, { status: "failed", result: null, failureClassification: safe(code) });
  }

  async _finish(eventId, patch) {
    const ref = this.collection.doc(eventId);
    const now = this.clock();
    await ref.update({ ...patch, processedAt: now, leaseExpiresAt: null });
    return { ...patch, processedAt: now };
  }
}

function validateEventId(value) {
  if (typeof value !== "string" || !/^evt_[A-Za-z0-9_]{1,240}$/.test(value)) throw new Error("Invalid Stripe event ID");
}
function safe(value) { return value == null ? null : String(value).slice(0, 120); }
function toDate(value) { return value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(0); }
function assertImmutable(existing, metadata) {
  if (existing.eventType !== safe(metadata.type) || existing.providerLivemode !== Boolean(metadata.livemode)) throw new Error("Immutable Stripe event metadata mismatch");
}

module.exports = { FirestoreStripeEventRepository };
