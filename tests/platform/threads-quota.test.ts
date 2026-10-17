import {describe,it,expect} from "vitest";
import {assertThreadsPublicationQuota,requiresThreadsPublicationQuota} from "../../src/platform/threads-quota.js";
describe("Threads publication quota",()=>{
 it("accepts only the current bounded moving-day publication contract",()=>{expect(()=>assertThreadsPublicationQuota({data:[{quota_usage:249,config:{quota_total:250,quota_duration:86400}}]})).not.toThrow();expect(requiresThreadsPublicationQuota("threads_publish_container")).toBe(true);expect(requiresThreadsPublicationQuota("threads_list_threads_publishing_limit")).toBe(false);});
 it("honors both provider and conservative local caps",()=>{for(const [used,total] of [[250,250],[250,1000],[10,10]])expect(()=>assertThreadsPublicationQuota({data:[{quota_usage:used,config:{quota_total:total,quota_duration:86400}}]})).toThrow("THREADS_PUBLISHING_QUOTA_EXHAUSTED");});
 it("does not infer zero from empty, malformed, reply-only or wrong-duration receipts",()=>{for(const value of [{},{data:[]},{data:[{reply_quota_usage:0,reply_config:{quota_total:1000,quota_duration:86400}}]},{data:[{quota_usage:"0",config:{quota_total:250,quota_duration:86400}}]},{data:[{quota_usage:0,config:{quota_total:250,quota_duration:3600}}]}])expect(()=>assertThreadsPublicationQuota(value)).toThrow("THREADS_PUBLISHING_QUOTA_UNVERIFIED");});
});
