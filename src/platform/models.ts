import type { EncryptedPayload } from "../auth/crypto.js";

export type Provider = "META_MARKETING" | "META_FACEBOOK_PAGES" | "META_INSTAGRAM_FACEBOOK_LOGIN" | "META_INSTAGRAM_LOGIN" | "META_MESSENGER" | "META_WHATSAPP" | "META_THREADS" | "META_BUSINESS";
export type OperationClass = "READ" | "WRITE_NON_FINANCIAL" | "WRITE_CONTENT" | "WRITE_MESSAGING" | "WRITE_AD_CONFIGURATION" | "WRITE_BUDGET" | "ACTIVATE_SPEND" | "DELETE" | "BUSINESS_ADMIN" | "IDENTITY_OR_ACCESS" | "BILLING";
export type AssetType = "BUSINESS" | "AD_ACCOUNT" | "PAGE" | "INSTAGRAM_ACCOUNT" | "DATASET" | "PIXEL" | "CATALOG" | "WABA" | "WHATSAPP_ACCOUNT" | "MESSAGING_ACCOUNT" | "WHATSAPP_PHONE" | "THREADS_ACCOUNT" | "APP" | "CAMPAIGN" | "AD_SET" | "AD" | "CREATIVE" | "POST" | "COMMENT" | "MEDIA" | "LEAD_FORM" | "LEAD" | "CONVERSATION" | "MESSAGE" | "FLOW" | "TEMPLATE" | "REPORT" | "AUDIENCE" | "PRODUCT_SET" | "FEED";
export interface Tenant { id: string; status: "ACTIVE" | "DISABLED"; policyRevision: number; registryRevision: number; migrationState: "READY" | "PENDING" }
export interface Member { operatorId: string; tenantId: string; roles: string[]; allowedClientIds: string[]; revision: number; disabledAt: number | null }
export interface Client { id: string; tenantId: string; status: "ACTIVE" | "DISABLED"; revision: number; verifiedBusinessIds: string[] }
export interface AssetRef { type: AssetType; id: string }
export interface MetaAsset extends AssetRef { createdFromOperationId?:string; ownerBusinessId?:string; billingOwnershipVerified?:boolean; ownershipEvidenceSource?:string; key: string; tenantId: string; clientId: string; provider: Provider; appId: string; parents: AssetRef[]; verifiedAt: number; revokedAt: number | null; revision: number }
export interface AssetGrant { id: string; tenantId: string; clientId: string; assetKey: string; connectionId: string; capabilities: string[]; actions: OperationClass[]; tasks: string[]; verifiedAt: number; expiresAt: number; revokedAt: number | null; revision: number }
export interface Connection { id: string; tenantId: string; operatorId: string; provider: Provider; authStrategy: string; credentialId: string; appId: string; tokenType: "user" | "page" | "system_user" | "business_integration_system_user" | "instagram" | "threads"; scopes: string[]; assetKeys: string[]; expiresAt: number | null; revokedAt: number | null; verifiedAt: number; revision: number; eligibility?: Array<{requirement: string; source: string; checkedAt: number; expiresAt: number; verified: boolean}> }
export interface Credential { id: string; tenantId: string; operatorId: string; provider: Provider; appId: string; envelopeVersion: 1; keyVersion: string; payload: EncryptedPayload }
export interface PlatformPrincipal { operatorId: string; tenantId: string }
export interface OperationContext { principal: PlatformPrincipal; clientId: string; tool: string; provider: Provider; requestId: string }
export interface OperationPlan { parameters: Record<string, unknown>; assets: AssetRef[]; classes: OperationClass[]; capability: string; requiredScopes: string[]; tokenTypes: Connection["tokenType"][]; requiredTasks?: string[]; createOrCopy?: boolean }
export interface AuthorizationSnapshot { tenant: Tenant; member: Member; client: Client; assets: MetaAsset[]; grants: AssetGrant[]; connection: Connection }
export interface Approval { id: string; tenantId: string; clientId: string; actorId: string; approverId: string; approverRevision: number; planHash: string; revisionHash: string; expiresAt: number; consumedAt: number | null; operationId: string | null }
export interface Operation { id: string; tenantId: string; clientId: string; actorId: string; tool: string; planHash: string; state: "PREPARED" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "PARTIAL"; approvalId: string | null; createdAt: number; updatedAt: number }
export interface SafeChange { field: string; value: string | number | boolean }
export interface AuditRecord { createdAssetKey?:string; id: string; tenantId: string; clientId: string; actorId: string; tool: string; operationId: string; event: "PREPARED" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "PARTIAL"; timestamp: number; assetKeys: string[]; planHash: string; approvalId: string | null; providerRequestId?: string; requestedChange?: SafeChange[]; beforeEvidence?: "UNKNOWN"; afterSummary?: SafeChange[] }
export class PlatformDenied extends Error { constructor(public readonly reason: string) { super(reason); this.name = "PlatformDenied"; } }

export interface ApprovalRequest {id:string;tenantId:string;clientId:string;actorId:string;tool:string;provider:Provider;planHash:string;revisionHash:string;expiresAt:number;approvedAt:number|null;approvalId:string|null;encryptedPlan:EncryptedPayload}
export interface ControlAudit {id:string;tenantId:string;clientId:string;actorId:string;event:"APPROVAL_REQUESTED"|"APPROVAL_ISSUED"|"CONNECTION_ENROLLED";timestamp:number;subjectId:string;planHash:string}
