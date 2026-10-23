import {PlatformDenied} from "./models.js";
export type MarketingBudgetMode="AD_SET"|"CAMPAIGN";
export function marketingCboEnabled(env:Record<string,string|undefined>=process.env):boolean{const flag=env.LUMIN_MARKETING_CBO_ENABLED;if(flag!==undefined&&!["true","false"].includes(flag))throw new PlatformDenied("INVALID_MARKETING_CBO_FLAG");return env.LUMIN_PLATFORM_ENABLED==="true"&&flag==="true";}
export function requestedBudgetMode(value:unknown):MarketingBudgetMode{if(value===undefined)return "AD_SET";if(value!=="AD_SET"&&value!=="CAMPAIGN")throw new PlatformDenied("TYPED_MARKETING_BUDGET_MODE_REQUIRED");if(value==="CAMPAIGN"&&!marketingCboEnabled())throw new PlatformDenied("MARKETING_CBO_DISABLED_BY_DEPLOYMENT");return value;}
const amount=(value:unknown):string=>{if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1||value>1000000000)throw new PlatformDenied("LEGACY_WRITE_BUDGET_INVALID");return String(value);};
export function applyCampaignBudget(input:Record<string,unknown>,body:Record<string,unknown>):MarketingBudgetMode{
 const requested=requestedBudgetMode(input.budget_mode);
 if(input.daily_budget!==undefined){if(!marketingCboEnabled())throw new PlatformDenied("MARKETING_CBO_DISABLED_BY_DEPLOYMENT");if(input.budget_mode==="AD_SET"||input.bid_strategy!==undefined&&input.bid_strategy!=="LOWEST_COST_WITHOUT_CAP")throw new PlatformDenied("CAMPAIGN_BUDGET_MODE_CONTRADICTION");body.daily_budget=amount(input.daily_budget);body.bid_strategy="LOWEST_COST_WITHOUT_CAP";return "CAMPAIGN";}
 if(requested==="CAMPAIGN"||input.bid_strategy!==undefined)throw new PlatformDenied("CAMPAIGN_DAILY_BUDGET_REQUIRED");body.is_adset_budget_sharing_enabled=false;return "AD_SET";
}
export function applyAdsetBudget(input:Record<string,unknown>,body:Record<string,unknown>,lead:boolean):MarketingBudgetMode{
 const mode=requestedBudgetMode(input.budget_mode);
 if(mode==="CAMPAIGN"){if(["daily_budget","bid_amount","bid_strategy"].some(key=>input[key]!==undefined))throw new PlatformDenied("CBO_ADSET_OWN_BUDGET_OR_BID_FORBIDDEN");return mode;}
 if(lead){if(input.bid_amount===undefined||input.daily_budget===undefined||input.bid_strategy!==undefined&&input.bid_strategy!=="LOWEST_COST_WITH_BID_CAP")throw new PlatformDenied("LEAD_BID_AND_DAILY_BUDGET_REQUIRED");body.bid_amount=amount(input.bid_amount);body.bid_strategy="LOWEST_COST_WITH_BID_CAP";}else if(input.bid_amount!==undefined||input.bid_strategy!==undefined)throw new PlatformDenied("LEGACY_COMPLEX_AD_CREATION_HOLD");
 body.daily_budget=amount(input.daily_budget);return mode;
}
