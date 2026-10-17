import express from "express";
import {expect,it,vi} from "vitest";
import {createAttachmentEnrollmentRouter} from "../../src/platform/attachment-review-router.js";
import type {AttachmentEnrollmentService} from "../../src/platform/attachment-enrollment.js";

it("binds the human review to its origin, actor, exact proposal and signed form",async()=>{
 const origin="https://lumin.fixture.invalid",id="a".repeat(64),planHash="b".repeat(64),principal={tenantId:"tenant",operatorId:"human"};let actor=principal;
 const enroll=vi.fn(async()=>({assetId:"mp4_"+id})),service={review:vi.fn(async()=>({proposal:{clientId:"client",expiresAt:Date.now()+240000,planHash},accountId:"201",plan:{url:"https://media.fixture.invalid/approved.mp4",evidence:{kind:"approved_pdf",byteLength:1000}}})),enroll} as unknown as AttachmentEnrollmentService;
 const app=express();app.use(createAttachmentEnrollmentRouter({origin,csrfSecret:"synthetic-review-secret".repeat(3),service,resolveSession:async()=>actor}));const listener=app.listen(0,"127.0.0.1");await new Promise<void>(r=>listener.once("listening",r));
 try{const base=`http://127.0.0.1:${(listener.address() as {port:number}).port}/${id}`,page=await fetch(base),html=await page.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)![1],cookie=page.headers.get("set-cookie")!.split(";")[0];
  expect(page.headers.get("cache-control")).toBe("no-store");expect(page.headers.get("set-cookie")).toContain("HttpOnly");expect(page.headers.get("set-cookie")).toContain("Secure");
  const post=(requestOrigin=origin,hash=planHash,proof=csrf,requestCookie=cookie)=>fetch(base,{method:"POST",headers:{Origin:requestOrigin,Cookie:requestCookie,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrf:proof,plan_hash:hash,decision:"enroll"})});
  expect((await post("https://foreign.fixture.invalid")).status).toBe(403);
  expect((await post(origin,"c".repeat(64))).status).toBe(403);
  expect((await post(origin,planHash,csrf.slice(0,-1)+"x")).status).toBe(403);
  expect((await post(origin,planHash,csrf,"")).status).toBe(403);
  actor={...principal,operatorId:"different-human"};expect((await post()).status).toBe(403);expect(enroll).not.toHaveBeenCalled();
  actor=principal;expect((await post()).status).toBe(200);expect(enroll).toHaveBeenCalledExactlyOnceWith(principal,id,planHash);
 }finally{await new Promise<void>(r=>listener.close(()=>r()));}
});
