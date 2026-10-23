import type {Provider} from "./models.js";
import {PlatformDenied} from "./models.js";
import {resolveMetaApiVersion,assertMetaApiVersion} from "../meta/api-version.js";
function reviewedVersion(provider: Provider): string {
  if (provider === "META_THREADS") {
    const version=assertMetaApiVersion(process.env.THREADS_API_VERSION ?? "v1.0");if(version!=="v1.0")throw new PlatformDenied("THREADS_PRODUCT_VERSION_UNVERIFIED");return version;
  }
  if (provider === "META_INSTAGRAM_LOGIN") {
    if (!process.env.INSTAGRAM_API_VERSION) throw new PlatformDenied("INSTAGRAM_API_VERSION_VERIFICATION_REQUIRED");
    const version=assertMetaApiVersion(process.env.INSTAGRAM_API_VERSION);if(version!=="v26.0")throw new PlatformDenied("INSTAGRAM_PRODUCT_VERSION_UNVERIFIED");return version;
  }
  const version=resolveMetaApiVersion();if(version!=="v26.0")throw new PlatformDenied("GRAPH_PRODUCT_VERSION_UNVERIFIED");return version;
}

export function productVersion(provider:Provider):string{try{return reviewedVersion(provider);}catch(error){if(error instanceof PlatformDenied)throw error;throw new PlatformDenied("PRODUCT_VERSION_CONFIGURATION_INVALID");}}
