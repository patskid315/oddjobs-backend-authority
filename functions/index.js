"use strict";
const functions=require("firebase-functions/v1");const admin=require("firebase-admin");
const {FirestoreSettlementRepository}=require("./src/settlement/firestoreSettlementRepository");
const {createCompletionHandler}=require("./src/settlement/completionHandler");
const {createPublicationCallable}=require("./src/v2/publicationCallable");
const {createConfirmedDraftCallable,createJobDraftCallable}=require("./src/v2/confirmedDraftCallable");
const {createProtectedLocationCallable}=require("./src/v2/protectedLocationCallable");
const {createSafetyDecisionCallable}=require("./src/v2/safetyDecisionCallable");
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

exports.confirmV2JobDraft=functions.https.onCall(createJobDraftCallable({
  db:admin.firestore(),HttpsError:functions.https.HttpsError
}));

// Declares a runtime binding only; no secret is read at module initialization.
exports.recordV2ProtectedLocation=functions.runWith({
  secrets:["NYC_GEOCLIENT_SUBSCRIPTION_KEY"]
}).https.onCall(createProtectedLocationCallable({
  db:admin.firestore(),HttpsError:functions.https.HttpsError
}));

// Dedicated server-configured privilege; never legacy admin or request claims.
exports.recordV2SafetyDecision=functions.https.onCall(createSafetyDecisionCallable({
  db:admin.firestore(),HttpsError:functions.https.HttpsError
}));

// Read-only, authenticated advisory interpretation; no confirmed authority.
exports.interpretV2GeneralCleaning=functions.https.onCall(require("./src/v2/cleaningInterpretationCallable").createCleaningInterpretationCallable({
  HttpsError:functions.https.HttpsError
}));

const jobPhotos=require("./src/v2/jobPhotoAuthority");
const jobPhotoStorage=jobPhotos.storageAdapter(admin.storage().bucket());
exports.finalizeV2JobPhotos=functions.https.onCall(jobPhotos.createFinalizePhotosCallable({
  db:admin.firestore(),auth:admin.auth(),storage:jobPhotoStorage,HttpsError:functions.https.HttpsError
}));

exports.v2Marketplace=functions.https.onCall(require("./src/v2/marketplace").createMarketplaceCallable({
  db:admin.firestore(),auth:admin.auth(),storage:jobPhotoStorage,HttpsError:functions.https.HttpsError
}));

const homeAuthorities=require("./src/v2/homeLocation").createHomeAuthorities({
  db:admin.firestore(),auth:admin.auth(),HttpsError:functions.https.HttpsError,
  timestamp:()=>admin.firestore.FieldValue.serverTimestamp()
});
exports.v2SavedHomeLocation=functions.https.onCall(homeAuthorities.savedHome);
exports.finalizeNYCOnboarding=functions.region("us-central1").https.onCall(homeAuthorities.finalize);
