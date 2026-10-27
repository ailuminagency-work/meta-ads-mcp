import express from "express";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {environmentRuntimeDiagnosticsRouter} from "../../src/platform/runtime-diagnostics-runtime.js";

const session=vi.hoisted(()=>vi.fn());
const resolvePrincipal=vi.hoisted(()=>vi.fn());
const inspect=vi.hoisted(()=>vi.fn());

vi.mock("../../src/auth/session.js",()=>({getSession:session}));
vi.mock("../../src/platform/runtime.js",()=>({getPlatformRepository:()=>({resolvePrincipal})}));
vi.mock("../../src/platform/runtime-diagnostics.js",()=>({inspectRuntimeCompatibility:inspect}));

describe("runtime diagnostics HTTP boundary",()=>{
  const app=express();
  app.use("/platform/runtime/diagnostics",environmentRuntimeDiagnosticsRouter());

  beforeEach(()=>{
    session.mockReset();
    resolvePrincipal.mockReset();
    inspect.mockReset();
  });
  afterEach(()=>vi.restoreAllMocks());

  it("returns 401, 403 for non-members, and a no-store admin response without writes",async()=>{
    const server=app.listen(0,"127.0.0.1");
    await new Promise<void>(resolve=>server.once("listening",resolve));
    const address=server.address();
    if(!address||typeof address==="string")throw new Error("server did not start");
    const url=`http://127.0.0.1:${address.port}/platform/runtime/diagnostics`;
    try {
      session.mockResolvedValueOnce(null);
      expect((await fetch(url)).status).toBe(401);

      session.mockResolvedValueOnce({fbUserId:"non-member"});
      resolvePrincipal.mockResolvedValueOnce(null);
      const denied=await fetch(url);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({status:"HOLD",reason:"PLATFORM_MEMBERSHIP_REQUIRED"});

      session.mockResolvedValueOnce({fbUserId:"admin"});
      resolvePrincipal.mockResolvedValueOnce({tenantId:"tenant",operatorId:"admin"});
      inspect.mockResolvedValueOnce({status:"PASS",firestore:{database_writes_performed:0}});
      const allowed=await fetch(url);
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("cache-control")).toBe("no-store");
      expect(await allowed.json()).toEqual({status:"PASS",firestore:{database_writes_performed:0}});
      expect(inspect).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });
});
