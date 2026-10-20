import { describe, expect, it } from "vitest";
import { mountGoogleAuthRoutes } from "../../src/transport/google-auth-routes.js";

describe("mountGoogleAuthRoutes", () => {
  it("mounts GET consent/callback and POST disconnect endpoints", () => {
    const gets: string[] = [];
    const posts: string[] = [];
    const app = {
      get: (path: string) => { gets.push(path); },
      post: (path: string) => { posts.push(path); },
    };
    mountGoogleAuthRoutes(app as never, { serverUrl: new URL("https://mcp.example.com") });
    expect(gets).toEqual(["/auth/google", "/auth/google/callback"]);
    expect(posts).toEqual(["/auth/google/disconnect"]);
  });
});
