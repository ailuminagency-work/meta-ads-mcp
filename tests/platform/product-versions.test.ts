import {afterEach,describe,it,expect,vi} from "vitest";
import {productVersion} from "../../src/platform/clients.js";
afterEach(()=>vi.unstubAllEnvs());
describe("product endpoint version evidence",()=>{
 it("allows only the currently verified Threads version",()=>{vi.stubEnv("THREADS_API_VERSION","v1.0");expect(productVersion("META_THREADS")).toBe("v1.0");vi.stubEnv("THREADS_API_VERSION","v1.1");expect(()=>productVersion("META_THREADS")).toThrow("THREADS_PRODUCT_VERSION_UNVERIFIED");});
 it("requires explicit verified independent Instagram version",()=>{vi.stubEnv("INSTAGRAM_API_VERSION",undefined);expect(()=>productVersion("META_INSTAGRAM_LOGIN")).toThrow("VERIFICATION_REQUIRED");vi.stubEnv("INSTAGRAM_API_VERSION","v26.0");expect(productVersion("META_INSTAGRAM_LOGIN")).toBe("v26.0");vi.stubEnv("INSTAGRAM_API_VERSION","v27.0");expect(()=>productVersion("META_INSTAGRAM_LOGIN")).toThrow("INSTAGRAM_PRODUCT_VERSION_UNVERIFIED");});
});
