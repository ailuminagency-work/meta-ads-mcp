/** Audited OAuth-scope dependencies from Meta Permissions Reference, updated 2026-10-15.
 * Feature names (for example Ads Management Standard Access) are eligibility gates, never scopes.
 * Unknown scope dependencies remain unknown; this function does not certify complete endpoint requirements.
 */
export const PERMISSION_DEPENDENCY_SOURCE = "https://developers.facebook.com/docs/permissions";
const DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  ads_management: ["pages_read_engagement", "pages_show_list"],
  business_management: ["pages_read_engagement", "pages_show_list"],
  catalog_management: ["business_management"],
  pages_manage_engagement: ["pages_read_user_content", "pages_show_list"],
  pages_manage_metadata: ["pages_show_list"],
  pages_manage_posts: ["pages_read_engagement", "pages_show_list"],
  pages_manage_ads: ["pages_show_list"],
  pages_messaging: ["pages_manage_metadata", "pages_show_list"],
  pages_read_engagement: ["pages_show_list"],
  pages_read_user_content: ["pages_show_list"],
  instagram_basic: ["pages_read_user_content", "pages_show_list"],
  instagram_manage_messages: ["instagram_basic", "pages_read_engagement", "pages_show_list"],
  instagram_content_publish: ["instagram_basic", "pages_read_engagement", "pages_show_list"],
  instagram_manage_comments: ["instagram_basic", "pages_read_engagement", "pages_show_list"],
  instagram_business_content_publish: ["instagram_business_basic"],
  instagram_business_manage_comments: ["instagram_business_basic"],
  instagram_business_manage_messages: ["instagram_business_basic"],
  whatsapp_business_messaging: ["whatsapp_business_management"],
  leads_retrieval: ["ads_management", "ads_read", "business_management", "pages_manage_ads", "pages_read_engagement", "pages_show_list"],
  threads_content_publish: ["threads_basic"],
  threads_delete: ["threads_basic"],
};

export function expandVerifiedPermissionDependencies(scopes: readonly string[]): string[] {
  const result = new Set(scopes);
  const add = (scope: string): void => {
    for (const dependency of DEPENDENCIES[scope] ?? []) {
      if (result.has(dependency)) continue;
      result.add(dependency);
      add(dependency);
    }
  };
  for (const scope of scopes) add(scope);
  return [...result];
}
