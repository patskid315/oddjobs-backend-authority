"use strict";

function assertToken(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function settlementIdentity(jobId, paymentId, version = 1) {
  return `${assertToken(jobId, "jobId")}:${assertToken(paymentId, "paymentId")}:v${Number(version)}`;
}

function transferIdempotencyKey(identity) {
  return `oddjobs:settlement:${assertToken(identity.replace(/:/g, "_"), "settlement identity")}`;
}

module.exports = { settlementIdentity, transferIdempotencyKey };
