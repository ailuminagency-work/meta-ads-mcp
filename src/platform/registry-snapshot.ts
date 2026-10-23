import type { Collection, PlatformRepository } from "./repository.js";
import { PlatformDenied } from "./models.js";

// Request-local memoization bounds registry reads. These observations never mint
// execution permits; the egress path independently revalidates live records.
export function capabilityReadSnapshot(repository:PlatformRepository):PlatformRepository{
  const reads=new Map<string,Promise<unknown>>();
  const read=async(key:string,fetch:()=>Promise<unknown>):Promise<unknown>=>{let pending=reads.get(key);if(!pending){pending=fetch();reads.set(key,pending);}return structuredClone(await pending);};
  return new Proxy(repository,{get(target,property){
    if(property==="isAppUserLifecycleLocked"&&target.isAppUserLifecycleLocked)return (appId:string,operatorId:string,appUserId?:string)=>read(JSON.stringify(["app-user-lifecycle-lock",appId,operatorId,appUserId??operatorId]),()=>target.isAppUserLifecycleLocked!(appId,operatorId,appUserId));
    if(property==="get")return (collection:Collection,tenant:string,id:string)=>read(JSON.stringify(["get",collection,tenant,id]),()=>target.get(collection,tenant,id));
    if(property==="list")return (collection:Collection,tenant:string)=>read(JSON.stringify(["list",collection,tenant]),()=>target.list(collection,tenant));
    if(["put","prepareOperation","finishOperation","commitControlPlane"].includes(String(property)))return async()=>{throw new PlatformDenied("CAPABILITY_SNAPSHOT_IS_READ_ONLY");};
    const value=Reflect.get(target,property,target);return typeof value==="function"?value.bind(target):value;
  }});
}
