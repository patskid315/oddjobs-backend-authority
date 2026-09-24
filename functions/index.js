"use strict";
const functions=require("firebase-functions/v1");const admin=require("firebase-admin");
const {FirestoreSettlementRepository}=require("./src/settlement/firestoreSettlementRepository");
const {createCompletionHandler}=require("./src/settlement/completionHandler");
const {createPublicationCallable}=require("./src/v2/publicationCallable");
const {createConfirmedDraftCallable}=require("./src/v2/confirmedDraftCallable");
const {createProtectedLocationCallable}=require("./src/v2/protectedLocationCallable");
if(!admin.apps.length)admin.initializeApp();
const repository=new FirestoreSettlementRepository({db:admin.firestore()});
const completionHandler=createCompletionHandler({repository,logger:functions.logger});

// Emergency Option A: the production-compatible name is retained, but completion
// only creates an idempotent pending obligation. This file contains no Stripe call.
exports.releasePaymentOnCompletion=functions.firestore.document("jobPost/{jobId}").onUpdate(async change=>completionHandler(change.before,change.after));

// Inert until server-owned V2 publication controls are explicitly configured.
// Firebase callable auth, never a body-supplied owner, supplies the actor UID.
exports.publishV2GeneralCleaning=functions.https.onCall(createPublicationCallable({
  db:admin.firestore(),auth:admin.auth(),env:process.env,
  HttpsError:functions.https.HttpsError
}));

// Draft ownership comes exclusively from verified callable authentication.
exports.confirmV2GeneralCleaningDraft=functions.https.onCall(createConfirmedDraftCallable({
  db:admin.firestore(),HttpsError:functions.https.HttpsError
}));

// Declares a runtime binding only; no secret is read at module initialization.
exports.recordV2ProtectedLocation=functions.runWith({
  secrets:["NYC_GEOCLIENT_SUBSCRIPTION_KEY"]
}).https.onCall(createProtectedLocationCallable({
  db:admin.firestore(),HttpsError:functions.https.HttpsError
}));
