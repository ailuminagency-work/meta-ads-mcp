import { describe, expect, it } from "vitest";
import { resolveDeploymentMode } from "../../src/transport/deployment-config.js";

describe("an unset DEPLOYMENT_MODE needs an unset, development or test NODE_ENV (G3R-03)", () => {
  it.each(["production", "prodution", "Production", "PRODUCTION", " production", "production ", "prod", "live", "staging", "", " "])(
    "refuses to start for NODE_ENV=%j instead of falling through to unrestricted upstream",
    (nodeEnv) => {
      expect(() => resolveDeploymentMode({ NODE_ENV: nodeEnv })).toThrow(/DEPLOYMENT_MODE must be set explicitly/);
    },
  );

  it("names the variable and the allowed exceptions without echoing the value", () => {
    let message = "";
    try {
      resolveDeploymentMode({ NODE_ENV: "prodution-synthetic" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("NODE_ENV");
    expect(message).toContain("development");
    expect(message).not.toContain("synthetic");
  });

  it.each([undefined, "development", "test"])("keeps the developer path for NODE_ENV=%j", (nodeEnv) => {
    expect(resolveDeploymentMode(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv })).toBe("upstream");
  });

  it.each(["production", "prodution", "Production", " production", "staging", ""])(
    "accepts an explicit mode whatever NODE_ENV is spelled (agency mode checks the exact spelling itself): %j",
    (nodeEnv) => {
      expect(resolveDeploymentMode({ NODE_ENV: nodeEnv, DEPLOYMENT_MODE: "upstream" })).toBe("upstream");
      expect(resolveDeploymentMode({ NODE_ENV: nodeEnv, DEPLOYMENT_MODE: "awaiting_credentials" })).toBe("awaiting_credentials");
      expect(resolveDeploymentMode({ NODE_ENV: nodeEnv, DEPLOYMENT_MODE: "agency" })).toBe("agency");
    },
  );

  it("still refuses an empty or unknown DEPLOYMENT_MODE", () => {
    expect(() => resolveDeploymentMode({ NODE_ENV: "development", DEPLOYMENT_MODE: "" })).toThrow(/Invalid DEPLOYMENT_MODE/);
    expect(() => resolveDeploymentMode({ NODE_ENV: "development", DEPLOYMENT_MODE: "Agency" })).toThrow(/Invalid DEPLOYMENT_MODE/);
  });
});
