import type { SignalDispatchStore, TrustedFirstPartySourceResolver } from "./signals-dispatch.js";
import { PlatformDenied } from "./models.js";
import { getFirestore } from "../store/firestore.js";
import { platformEnabled } from "./runtime.js";
import { FirestoreSignalDispatchStore } from "./signals-dispatch.js";
import { createFirestoreFirstPartySourceResolver } from "./first-party-source-store.js";
let runtime:{source:TrustedFirstPartySourceResolver;store:SignalDispatchStore}|undefined;
export function configureFirstPartySignalRuntime(value:typeof runtime):void{runtime=value;}
export function firstPartySignalRuntime():NonNullable<typeof runtime>{if(!runtime)throw new PlatformDenied("TRUSTED_FIRST_PARTY_SOURCE_AND_CHECKPOINT_RUNTIME_REQUIRED");return runtime;}
export function initializeFirstPartySignalRuntime():void{
  const flag=process.env.LUMIN_PLATFORM_SIGNALS_ENABLED;
  if(flag!==undefined && flag!=="true" && flag!=="false")throw new PlatformDenied("INVALID_FIRST_PARTY_SIGNAL_FLAG");
  if(flag!=="true" || !platformEnabled()){runtime=undefined;return;}
  if(runtime)return;
  const adapter=process.env.LUMIN_FIRST_PARTY_ADAPTER_ID;
  if(!adapter || !/^[A-Za-z0-9_.:-]{1,128}$/.test(adapter))throw new PlatformDenied("TRUSTED_SOURCE_INGESTION_ADAPTER_REQUIRED_HOLD");
  const db=getFirestore();runtime={source:createFirestoreFirstPartySourceResolver(db,{approvedIngestionAdapterId:adapter}),store:new FirestoreSignalDispatchStore(db)};
}
