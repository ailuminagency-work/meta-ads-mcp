import {it,expect} from "vitest";
import {dryRunProductionBootstrap,PRIVACY_RETENTION_INVARIANTS} from "../../src/platform/production-bootstrap.js";

it("staging dry-run covers persisted V1 records without expiring ambiguous claims or spend reservations",()=>{
 const result=dryRunProductionBootstrap({version:1,projectId:"lumin-staging",environment:"staging",releaseSha:"a".repeat(40),publicOrigin:"https://staging.example.com",serviceAccountEmail:"runtime@lumin-staging.iam.gserviceaccount.com",clientBillingOwnership:"CLIENT_OWNED",operatorAllowlist:["100"],featureFlags:{writes:false,signals:false,messaging:false,workers:false}});
 const plans=new Map(result.ttl.map(plan=>[plan.collectionGroup,plan]));
 expect(plans.get("appPromotionProposals")).toMatchObject({maximumDays:5/1440});
 expect(plans.get("platform_crm_sources")).toMatchObject({maximumDays:7});
 expect(plans.get("platform_crm_stage_journal")).toMatchObject({maximumDays:90});
 expect(plans.get("platform_crm_consent_revocations")).toMatchObject({maximumDays:90});
 expect(result.indexes).toContainEqual({collectionGroup:"platform_crm_sources",fields:["scopeHash ASC","leadHash ASC"]});
 expect(result.indexes).toContainEqual({collectionGroup:"platform_crm_stage_journal",fields:["scopeHash ASC","leadHash ASC"]});
 expect(plans.get("pausedAdBatchJobs")).toMatchObject({maximumDays:90,field:"expireTime"});
 expect(plans.get("manualEligibilityAttestations")).toMatchObject({maximumDays:1});
 expect(plans.get("hashtagQuotas")).toMatchObject({maximumDays:7});
 expect(plans.get("researchJobs")).toMatchObject({maximumDays:7});
 expect(plans.get("researchFinancialCheckpoints")).toMatchObject({onlyWhen:"SETTLED_never_UNRESOLVED"});
 expect(plans.get("researchBudgets")).toMatchObject({onlyWhen:"reservedCents_equals_zero"});
 expect(plans.has("platform_crm_no_resend")).toBe(false);
 expect(PRIVACY_RETENTION_INVARIANTS.join(" ")).toContain("HMAC pseudonymous");
 expect(plans.has("platform_whatsapp_setup_phone_locks")).toBe(false);
 expect(plans.has("platform_meta_privacy_subject_locks")).toBe(false);
 expect(plans.has("businessOwnerAttestations")).toBe(false);
 expect(PRIVACY_RETENTION_INVARIANTS.join(" ")).toContain("unresolved research financial checkpoints");
 expect(result.iam.requiredRoles).toEqual(["roles/datastore.user"]);
 expect(result.status).toBe("DRY_RUN_REVIEW_REQUIRED");
});
