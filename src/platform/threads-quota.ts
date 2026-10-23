import { PlatformDenied } from "./models.js";

/** Current Meta Threads overview: observed quota is not an atomic cross-app lock. */
export const THREADS_PUBLICATION_PREFLIGHT = Object.freeze({method:"GET",path:"/{asset_id}/threads_publishing_limit",fields:"quota_usage,config",localMaximum:250,quotaDuration:86400,source:"https://developers.facebook.com/documentation/threads/overview"});
export function requiresThreadsPublicationQuota(tool:string):boolean{return tool==="threads_publish_container";}
export function assertThreadsPublicationQuota(value:unknown):void{
  const deny=():never=>{throw new PlatformDenied("THREADS_PUBLISHING_QUOTA_UNVERIFIED");};
  if(!value||typeof value!=="object"||Array.isArray(value))deny();
  const data=(value as {data?:unknown}).data;
  if(!Array.isArray(data)||data.length!==1||!data[0]||typeof data[0]!=="object"||Array.isArray(data[0]))deny();
  const row=(data as unknown[])[0] as Record<string,unknown>,config=row.config;
  if(!config||typeof config!=="object"||Array.isArray(config))deny();
  const c=config as Record<string,unknown>;
  if(!Number.isSafeInteger(row.quota_usage)||Number(row.quota_usage)<0||!Number.isSafeInteger(c.quota_total)||Number(c.quota_total)<=0||c.quota_duration!==86400)deny();
  if(Number(row.quota_usage)>=Math.min(250,Number(c.quota_total)))throw new PlatformDenied("THREADS_PUBLISHING_QUOTA_EXHAUSTED");
}
