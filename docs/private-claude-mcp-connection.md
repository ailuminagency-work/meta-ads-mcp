# Private Claude + cross-client MCP connection runbook

**Service:** Lumin Meta Ads MCP (internal agency service only)  
**Production MCP endpoint:** `https://meta-ads-mcp-production-9d28.up.railway.app/mcp`  
**Transport:** Streamable HTTP over HTTPS, OAuth-protected  
**Source of truth:** Existing Railway production service `meta-ads-mcp` in project `lumin-meta-ads-mcp`  
**Change policy:** Do not create another Railway service, duplicate Meta credentials, or publish the server in a public connector directory to onboard an AI client.

## Architecture and access boundary

ChatGPT, Claude, Claude Desktop, and other supported MCP clients can use **one** remote MCP resource. Each approved human operator authenticates independently. The host being network-reachable is **not** permission to use its tools: enforce authorization in the backend on every request, including tool calls.

- Require the existing Meta/Facebook login and strict individual `AUTH_ALLOWED_FB_USER_IDS` or narrower approved allowlists.
- Confirm the operator is registered and has the correct Lumin tenant/client membership and privileges. Do not assume that successful Facebook login or an MCP OAuth grant confers platform roles.
- Use an individually authorized Meta connection and the server-side token registry. Never share an agency Meta token, cookie, OAuth client secret, `OAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, or `META_APP_SECRET` with Claude, a colleague, or an AI client.
- Do not broaden `AUTH_ALLOWED_DOMAINS` or use a wildcard CORS origin to simplify onboarding. Browser CORS is not an authentication or authorization boundary.
- Preserve client-owned ad-account, client-funded billing, paused-by-default, approval, and refusal-first gates. Claude gets no special privileges compared with ChatGPT.
- Keep `AGENCY_WRITES_ENABLED` and `LUMIN_PLATFORM_WRITES_ENABLED` in their approved production states. Onboarding must be read-only.

## Claude (claude.ai, Claude Desktop / Cowork remote connectors)

1. The Lumin/Claude Team or Enterprise **owner** adds a custom **Web** connector in **Organization settings → Connectors**, using the exact MCP endpoint above. Individual Claude Pro/Max users add it under **Customize → Connectors → Add custom connector**. Available controls vary by account.
2. Name it **Lumin Meta MCP (Private)** and select sign-in (do **not** choose `No sign in`).
3. If available and compatible with our authorization server, prefer Claude's published OAuth identity. If client registration fails, select **Register automatically** (dynamic client registration, which the existing MCP server supports). Do not manufacture OAuth client IDs, redirect URLs or shared credentials.
4. The Lumin-approved colleague selects **Connect** in their Claude account, completes the Meta sign-in / server consent flow under their **own authorized identity**, and enables the connector for a conversation.
5. Verify the connector enumerates expected read tools and successfully makes **one low-risk read-only** call for an explicitly authorized account. Do not grant blanket approval for tool calls that write or spend.
6. On an authorization failure, check the OAuth discovery response, HTTP `WWW-Authenticate` challenge, redirect URI registration, individual Facebook allowlist, operator registry membership, and linked Meta token in that order. Do not disable authentication or inject a global token to fix an error.

Anthropic official instructions: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp

## ChatGPT and other clients

- In ChatGPT, create a custom MCP server plugin/app subject to account/workspace policy, specifying the same production HTTPS endpoint and OAuth. ChatGPT Pro custom MCP access may be read/fetch only; full write support currently depends on plan/workspace policy and the app's approved tools.
- For another third-party MCP-compatible client, prefer **remote Streamable HTTP + OAuth authorization-code/PKCE**. Confirm the client supports the metadata and token-refresh methods we expose, including dynamic registration as required.
- Never pass Meta Graph access tokens as a request header from an AI client. Never use agency-wide fixed bearer credentials as a shortcut to multi-user provisioning.

OpenAI official instructions: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt

## Production certification / rollout gate

This document is a setup guide **not a live Claude connection certificate**. Before declaring Claude production-ready, record evidence that all checks pass, with secrets redacted:

| Check | Pass criteria |
| --- | --- |
| Railway production | Deployment healthy; deployed commit and resource endpoint recorded |
| OAuth discovery | Protected-resource metadata for `/mcp` and authorization-server metadata return valid, origin-bound URLs |
| Unauthenticated access | `POST /mcp` returns **401 with OAuth challenge**; does not expose tools, leak information or silently fall back to an agency credential |
| Approved Claude user | Real OAuth redirect / PKCE, consent, authorization code exchange, `initialize` and `tools/list` succeed |
| Token refresh | Refresh succeeds without repeated arbitrary consent; revocation and expiry remain enforceable |
| Unauthorized Claude user | Unknown or unapproved Meta user is denied; cannot acquire an MCP access token or query any tenant/client |
| Tenant isolation | Operator has access only to accounts explicitly authorized for that role and underlying Meta grants |
| Read-only smoke | One allowed account/report read succeeds; no ad, budget, payment, billing, customer or campaign mutations |
| Claude privilege parity | Same protected tools/roles/financial gates apply as with ChatGPT |
| Logs | Sanitized identities, tool name, response class, correlation id; no secrets, Meta tokens, PII or raw credentials |

**Stop rollout** for an unverified authorization boundary, unexpected write tool, cross-client data exposure, missing challenge/metadata, failed PKCE/refresh/revocation, or a user token tied to the wrong operator. Fix on staging, independently review, then request explicit approval before deploying changes.

## Release note (2026-10-23)

Existing source code contains the HTTP MCP and OAuth server machinery; Railway reports a successful production deployment. **A successful Claude OAuth session and Claude read-only tool call have not yet been witnessed or certified.** A human who controls the Claude account must authorize the connector, and any new Lumin operator must be individually enrolled and permissioned. No access controls or production deployments should be relaxed to accelerate this final acceptance step.
