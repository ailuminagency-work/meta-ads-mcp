import {PlatformDenied} from "./models.js";
import {assertNoCredentialShapedString} from "./input-safety.js";
/** Reviewed deterministic UTM subset. No provider macros, asset references or credential-shaped values. */
export function validateLegacyUrlTags(value:unknown):string {
 if(typeof value!=="string"||value.length>2048||/[\x00-\x20\x7f#?]/.test(value))throw new PlatformDenied("TYPED_UTM_QUERY_REQUIRED");
 if(value==="")return "";
 const params=new URLSearchParams(value),pairs=[...params.entries()];
 if(!pairs.length||pairs.length>6||new Set(pairs.map(([k])=>k)).size!==pairs.length)throw new PlatformDenied("TYPED_UTM_QUERY_REQUIRED");
 const allowed=new Set(["utm_source","utm_medium","utm_campaign","utm_content","utm_term","utm_id"]);
 for(const [key,text]of pairs){if(!allowed.has(key)||!text||text.length>256||!/^[-a-zA-Z0-9._~ ]+$/.test(text))throw new PlatformDenied("TYPED_UTM_QUERY_REQUIRED");assertNoCredentialShapedString(text);}
 return new URLSearchParams(pairs.sort(([a],[b])=>a.localeCompare(b))).toString();
}
