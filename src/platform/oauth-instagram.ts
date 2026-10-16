import { unverifiedOAuthAdapter, type VerifiedProviderAdapter } from "./oauth.js";

/** Instagram Login is a separate professional-account credential, never a Page
 * or Ads credential. Meta documents api.instagram.com code exchange and
 * graph.instagram.com long-lived exchange, but the reviewed documentation does
 * not establish independent actual-app/grants inspection for this adapter.
 * Keep initiation and exchange disabled until that inspection contract is proven.
 * https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
 * https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started
 */
export function createInstagramOAuthAdapter(): VerifiedProviderAdapter {
  return unverifiedOAuthAdapter("META_INSTAGRAM_LOGIN");
}
