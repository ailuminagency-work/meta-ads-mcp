import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import { validateMetaId } from "../utils/format.js";
import {
  INSTAGRAM_ACCOUNT_FIELDS,
  INSTAGRAM_MEDIA_DEFAULT_FIELDS,
} from "../meta/types/instagram.js";
import type {
  InstagramAccount,
  InstagramMedia,
  MetaApiResponse,
} from "../meta/types/index.js";
import { READ } from "./_register.js";
import { fenceBlock, fencedJsonBlock, untrustedText } from "../media/content-blocks.js";

export function registerInstagramTools(server: McpServer): void {
  // ─── Get Instagram Business Account ────────────────────────
  server.registerTool(
    "ads_get_instagram_account",
    {
      description:
        "Get the Instagram Business account linked to a Facebook Page. Returns the Instagram account ID needed for creating ad creatives with Instagram placement.",
      inputSchema: {
        page_id: z.string().describe("Facebook Page ID to look up its linked Instagram Business account"),
      },
      annotations: { ...READ },
    },
    async ({ page_id }) => {
      const id = validateMetaId(page_id, "page");
      const nestedFields = INSTAGRAM_ACCOUNT_FIELDS.join(",");
      const result = await metaApiClient.get<{
        instagram_business_account?: InstagramAccount;
        id: string;
      }>(`/${id}`, {
        fields: `instagram_business_account{${nestedFields}}`,
      });

      const ig = result.instagram_business_account;

      if (!ig) {
        return {
          content: [
            {
              type: "text",
              text: `No Instagram Business account linked to Page ${id}. Ensure the Page has an Instagram Business or Creator account connected in Page Settings.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Instagram Business Account found. Use its ID, listed below, as the instagram_actor_id parameter when creating creatives. The MCP maps it to instagram_user_id internally (Meta deprecated instagram_actor_id in Marketing API v22.0).\n${fenceBlock([
              `ID: ${untrustedText(ig.id, 40)}`,
              `Username: ${untrustedText(ig.username, 100) || "N/A"}`,
              `Name: ${untrustedText(ig.name) || "N/A"}`,
              `Followers: ${untrustedText(ig.followers_count, 20) || "N/A"}`,
              `Media count: ${untrustedText(ig.media_count, 20) || "N/A"}`,
            ])}`,
          },
          { type: "text", text: fencedJsonBlock(ig) },
        ],
      };
    },
  );

  // ─── Get Instagram Media ───────────────────────────────────
  server.registerTool(
    "ads_get_instagram_media",
    {
      description:
        "List recent media posts from an Instagram Business account. Returns media IDs that can be used with source_instagram_media_id in create_ad_creative to promote existing posts.",
      inputSchema: {
        instagram_account_id: z.string().describe("Instagram Business account ID (from ads_get_instagram_account)"),
        limit: z.number().min(1).max(100).default(25).describe("Number of posts to return"),
      },
      annotations: { ...READ },
    },
    async ({ instagram_account_id, limit }) => {
      const id = validateMetaId(instagram_account_id, "instagram_account");
      const fieldsParam = [...INSTAGRAM_MEDIA_DEFAULT_FIELDS].join(",");

      const response = await metaApiClient.get<MetaApiResponse<InstagramMedia>>(
        `/${id}/media`,
        { fields: fieldsParam, limit },
      );

      const media = response.data ?? [];

      const text =
        media.length === 0
          ? "No media found for this Instagram account."
          : fenceBlock(
              media.map(
                (m) =>
                  `• ${untrustedText(m.id, 40)} — ${untrustedText(m.media_type, 40) || "UNKNOWN"}${m.boost_eligibility_info ? ` — Boost: ${m.boost_eligibility_info.eligible_to_boost ? "✅ Eligible" : `❌ ${untrustedText(m.boost_eligibility_info.reason, 100) || "Not eligible"}`}` : ""} — ${untrustedText(m.caption, 80) || "No caption"} — ${untrustedText(m.timestamp, 40)}`,
              ),
            );

      return {
        content: [
          { type: "text", text: `Found ${media.length} media post(s):\n\n${text}` },
          { type: "text", text: fencedJsonBlock(media) },
        ],
      };
    },
  );
}
