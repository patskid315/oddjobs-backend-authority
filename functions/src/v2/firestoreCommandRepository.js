"use strict";

const { commandIdentity, commandPayloadDigest } = require("./foundation");

// Internal backend-only primitive. A caller must supply an authenticated actor
// from its server auth context, and transactionWork must perform Firestore
// transaction operations only: Firestore may retry that callback.
class FirestoreV2CommandRepository {
  constructor({ db, collection = "v2CommandReceipts", clock = () => new Date() }) {
    if (!db || typeof db.runTransaction !== "function") throw new TypeError("Firestore transaction authority required");
    this.db = db;
    this.collection = db.collection(collection);
    this.clock = clock;
  }

  async execute({ kind, authenticatedActorRef, idempotencyKey, payload,
    schemaVersion, policyVersion, transactionWork }) {
    const commandId = commandIdentity({ kind, actorRef: authenticatedActorRef, idempotencyKey });
    const payloadDigest = commandPayloadDigest(payload);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 ||
        typeof policyVersion !== "string" || !policyVersion.trim() ||
        typeof transactionWork !== "function") {
      throw new TypeError("Versioned transaction work required");
    }
    const ref = this.collection.doc(commandId);
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (snapshot.exists) {
        const existing = snapshot.data();
        if (existing.record_type !== "V2_COMMAND_RECEIPT" || existing.command_id !== commandId ||
            existing.kind !== kind || existing.actor_ref !== authenticatedActorRef ||
            existing.payload_digest !== payloadDigest || existing.schema_version !== schemaVersion ||
            existing.policy_version !== policyVersion || !Object.hasOwn(existing, "result")) {
          throw new Error("Conflicting or invalid V2 command replay");
        }
        return { created: false, commandId, result: existing.result };
      }

      const result = await transactionWork(tx, { commandId, authenticatedActorRef });
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new TypeError("Backend transaction must produce a result object");
      }
      const record = {
        record_type: "V2_COMMAND_RECEIPT",
        command_id: commandId,
        kind,
        actor_ref: authenticatedActorRef,
        payload_digest: payloadDigest,
        schema_version: schemaVersion,
        policy_version: policyVersion,
        result,
        created_at: this.clock()
      };
      tx.create(ref, record);
      return { created: true, commandId, result };
    });
  }
}

module.exports = { FirestoreV2CommandRepository };
