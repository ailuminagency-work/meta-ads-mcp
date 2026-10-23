import {getFirestore,isFirestoreEnabled} from "../store/firestore.js";
import {privacySubjectHash} from "./meta-privacy-provenance.js";
/** Existing/expired-present privacy locks remain authoritative even when callback ingress is disabled. */
export async function isMetaPrincipalPrivacyLocked(fbUserId:string):Promise<boolean>{
 const appId=process.env.META_APP_ID;if(!appId||(!isFirestoreEnabled()&&process.env.LUMIN_META_PRIVACY_ENABLED===undefined))return false;if(!/^\d{1,100}$/.test(appId)||!/^\d{1,100}$/.test(fbUserId))return true;return (await getFirestore().collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(appId,fbUserId)).get()).exists;
}
