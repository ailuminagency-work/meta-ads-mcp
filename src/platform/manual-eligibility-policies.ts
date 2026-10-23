import {IMAGE_INSPECTION_CONTRACT,CREATIVE_IMAGE_INSPECTION_CONTRACT} from "./image-inspection-contract.js";
import {APP_EVENT_TYPES_CONTRACT} from "./app-event-types-contract.js";
import {VIDEO_INSPECTION_CONTRACT,CREATIVE_VIDEO_INSPECTION_CONTRACT} from "./video-inspection-contract.js";
import {CATALOG_CAMPAIGN_CONTRACT} from "./catalog-campaign-contract.js";
import {INVOICE_METADATA_CONTRACT} from "./business-invoice-contract.js";
import {CRM_SIGNAL_CONTRACT} from "./crm-contract.js";
import {CATALOG_OPERATIONAL_CONTRACTS} from "./catalog-operational-contracts.js";
import {WHATSAPP_QR_CONTRACTS} from "./whatsapp-qr-contracts.js";
import {MARKETING_CONTROL_CONTRACTS} from './marketing-control-contracts.js';
import {MARKETING_AUDIENCE_CONTRACTS} from "./marketing-audience-contracts.js";
import {reviewedFamilyEligibility} from "./family-eligibility.js";
import type {ProductContract} from './products/contracts.js';
import type {ManualRequirementPolicy} from './manual-eligibility.js';
import {WHATSAPP_FLOW_CONTRACTS} from './whatsapp-flow-contracts.js';
import {WHATSAPP_TEMPLATE_CONTRACTS} from './whatsapp-template-contracts.js';
import {WHATSAPP_PHONE_CONTRACTS} from './whatsapp-phone-contracts.js';
import {WHATSAPP_SUBSCRIPTION_CONTRACTS} from './whatsapp-subscription-contracts.js';
import {WHATSAPP_ANALYTICS_CONTRACTS} from './whatsapp-analytics-contracts.js';
import {WHATSAPP_SEND_CONTRACTS} from './whatsapp-send-contracts.js';
/** Exact reviewed definitions, never a prose keyword classifier. Runtime/provider predicates remain enforced by each dedicated transport. */
export function reviewedEligibilityMetadata(contract:ProductContract):Pick<ProductContract,'eligibilityRequirements'|'eligibilityPolicies'>|Record<string,never>{const groups:Array<[readonly ProductContract[],number[]]>=[[[IMAGE_INSPECTION_CONTRACT,CREATIVE_IMAGE_INSPECTION_CONTRACT],[0]],[[APP_EVENT_TYPES_CONTRACT],[0]],[[VIDEO_INSPECTION_CONTRACT,CREATIVE_VIDEO_INSPECTION_CONTRACT],[0]],[[CATALOG_CAMPAIGN_CONTRACT],[0]],[[INVOICE_METADATA_CONTRACT],[0]],[[CRM_SIGNAL_CONTRACT],[0]],[CATALOG_OPERATIONAL_CONTRACTS,[0]],[WHATSAPP_QR_CONTRACTS,[0,1]],[WHATSAPP_PHONE_CONTRACTS,[0,1]],[WHATSAPP_TEMPLATE_CONTRACTS,[0,1]],[WHATSAPP_SEND_CONTRACTS,[0,1]],[WHATSAPP_ANALYTICS_CONTRACTS,[0,1,4]],[WHATSAPP_SUBSCRIPTION_CONTRACTS,[0,1,2]],[WHATSAPP_FLOW_CONTRACTS,[0,1,3]]];for(const [contracts,indices]of groups){const canonical=contracts.find(c=>c.tool===contract.tool&&c.provider===contract.provider);if(!canonical)continue;const eligibilityRequirements=indices.map(i=>canonical.manualRequirements[i]);if(eligibilityRequirements.some(r=>!r))throw new Error('REVIEWED_ELIGIBILITY_REQUIREMENT_MISSING');const eligibilityPolicies:Record<string,ManualRequirementPolicy>=Object.fromEntries(eligibilityRequirements.map((requirement,i)=>[requirement,{kind:'HUMAN_ATTESTATION',maxAgeMs:i===0?86400000:3600000}]));return {eligibilityRequirements,eligibilityPolicies};}const audience=[...MARKETING_AUDIENCE_CONTRACTS,...MARKETING_CONTROL_CONTRACTS].find(c=>c.tool===contract.tool&&c.provider===contract.provider);if(audience)return {eligibilityRequirements:structuredClone(audience.eligibilityRequirements),eligibilityPolicies:structuredClone(audience.eligibilityPolicies)};return reviewedFamilyEligibility(contract);}
