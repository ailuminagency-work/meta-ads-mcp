# Railway deployment plan — not executed

Existing service and /mcp URL remain the target. No new Railway service or provider is created. No staged configuration, environment variable, deployment or billing change is made during this build.

Before any separately authorized staging rollout: pin candidate SHA; pass lint/typecheck/full tests/build and secret scans; independently review auth/egress; provision isolated test registry/event storage and indexes/TTL; configure verified provider profiles through platform secret stores; complete mocked plus real consenting-test-asset acceptance; verify legacy Ads behavior in enabled mode. Start with platform writes off. Production requires a distinct approval and rollback manifest.

Secrets stay in Railway/provider stores: existing Meta app credentials, session/encryption material and Google credentials remain unchanged. Additional product app credentials are required only for verified configured profiles. Environment version settings include THREADS_API_VERSION (default v1.0) and INSTAGRAM_API_VERSION (must be explicitly verified/configured). No all-product OAuth scope bundle is permitted.
