import {createHmac} from "node:crypto";
import {describe,it,expect} from "vitest";
import {verifyMetaSignedRequest} from "../../src/platform/meta-privacy.js";
const now=Date.now(),secret="synthetic-app-secret";
function signed(value:unknown,key=secret){const payload=Buffer.from(JSON.stringify(value)).toString("base64url");return createHmac("sha256",key).update(payload).digest("base64url")+"."+payload;}
const body={algorithm:"HMAC-SHA256",user_id:"123",issued_at:Math.floor(now/1000)};
describe("Meta privacy signed callback boundary",()=>{
 it("accepts only app-authenticated exact user identity and returns no token or raw payload",()=>{const proof=verifyMetaSignedRequest(signed({...body,oauth_token:"must-not-return"}),secret,now);expect(proof).toEqual({userId:"123",requestHash:expect.stringMatching(/^[a-f0-9]{64}$/)});expect(JSON.stringify(proof)).not.toContain("must-not-return");});
 it.each(["foreign-app","tampered-user","wrong-algorithm","expired","future","malformed","noncanonical","oversize"])("denies %s",mode=>{let raw=signed(body);if(mode==="foreign-app")raw=signed(body,"other-secret");if(mode==="tampered-user")raw=raw.split(".")[0]+"."+Buffer.from(JSON.stringify({...body,user_id:"999"})).toString("base64url");if(mode==="wrong-algorithm")raw=signed({...body,algorithm:"none"});if(mode==="expired")raw=signed({...body,issued_at:Math.floor(now/1000)-86401});if(mode==="future")raw=signed({...body,issued_at:Math.floor(now/1000)+61});if(mode==="malformed")raw="x.y.z";if(mode==="noncanonical")raw+="=";if(mode==="oversize")raw="a".repeat(20000);expect(()=>verifyMetaSignedRequest(raw,secret,now)).toThrow();});
});
