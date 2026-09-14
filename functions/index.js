"use strict";
const functions=require("firebase-functions/v1");const admin=require("firebase-admin");
const {FirestoreSettlementRepository}=require("./src/settlement/firestoreSettlementRepository");
const {createCompletionHandler}=require("./src/settlement/completionHandler");
if(!admin.apps.length)admin.initializeApp();
const repository=new FirestoreSettlementRepository({db:admin.firestore()});
const completionHandler=createCompletionHandler({repository,logger:functions.logger});

// Emergency Option A: the production-compatible name is retained, but completion
// only creates an idempotent pending obligation. This file contains no Stripe call.
exports.releasePaymentOnCompletion=functions.firestore.document("jobPost/{jobId}").onUpdate(async change=>completionHandler(change.before,change.after));
