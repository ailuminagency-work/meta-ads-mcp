import {z} from "zod";
import {PlatformDenied} from "./models.js";
import {canonicalJson} from "./policy.js";
import {assertNoCredentialShapedString} from "./input-safety.js";
const text=(max:number)=>z.string().min(1).max(max).refine(s=>!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)&&!s.includes("${"));
const fieldName=z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).refine(s=>!/(password|passcode|secret|token|api_key)/i.test(s));
const footer=z.object({type:z.literal("Footer"),label:text(30),"on-click-action":z.object({name:z.literal("complete"),payload:z.record(fieldName,z.string().regex(/^\$\{form\.[a-z][a-z0-9_]{0,39}\}$/)).refine(v=>Object.keys(v).length<=16)}).strict()}).strict();
const display=z.discriminatedUnion("type",[z.object({type:z.literal("TextHeading"),text:text(80)}).strict(),z.object({type:z.literal("TextSubheading"),text:text(80)}).strict(),z.object({type:z.literal("TextBody"),text:text(4096)}).strict(),z.object({type:z.literal("TextCaption"),text:text(4096)}).strict()]);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s+"T00:00:00Z"))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s);
const fields=z.discriminatedUnion("type",[
 z.object({type:z.literal("TextInput"),name:fieldName,label:text(20),"input-type":z.enum(["text","number","email","phone"]),required:z.boolean(),"max-chars":z.string().regex(/^(?:[1-9]\d?|[12]\d\d|300)$/).optional(),"helper-text":text(80).optional()}).strict(),
 z.object({type:z.literal("TextArea"),name:fieldName,label:text(20),required:z.boolean(),"max-length":z.string().regex(/^(?:[1-9]\d?|[1-5]\d\d|600)$/).optional()}).strict(),
 z.object({type:z.literal("Dropdown"),name:fieldName,label:text(20),required:z.boolean(),"data-source":z.array(z.object({id:fieldName,title:text(30)}).strict()).min(1).max(50).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length)}).strict(),
 z.object({type:z.literal("CalendarPicker"),name:fieldName,label:text(40),mode:z.literal("single"),required:z.boolean(),"min-date":date,"max-date":date,"unavailable-dates":z.array(date).max(100).optional()}).strict(),
]);
const flowSchema=z.object({version:z.literal("7.3"),screens:z.array(z.object({id:z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),title:text(30),terminal:z.literal(true),success:z.literal(true),data:z.object({}).strict().optional(),sensitive:z.array(fieldName).max(16).optional(),layout:z.object({type:z.literal("SingleColumnLayout"),children:z.array(z.union([display,fields,footer])).min(2).max(20)}).strict()}).strict()).length(1)}).strict();
export const whatsappFlowCategories=z.array(z.enum(["SIGN_UP","SIGN_IN","APPOINTMENT_BOOKING","LEAD_GENERATION","CONTACT_US","CUSTOMER_SUPPORT","SURVEY","OTHER"])).min(1).max(8).refine(v=>new Set(v).size===v.length);
/** Current official API guide's recommended 7.3 static terminal-screen schema.
 * Dynamic endpoints, expression evaluation and response collection require a
 * separately reviewed adapter; none is silently inferred from generic JSON. */
export function validateStaticWhatsAppFlowJson(raw:unknown):string{
 if(typeof raw!=="string"||Buffer.byteLength(raw,"utf8")>65536)throw new PlatformDenied("BOUNDED_STATIC_FLOW_JSON_REQUIRED");
 assertNoCredentialShapedString(raw);let value:unknown;try{value=JSON.parse(raw);}catch{throw new PlatformDenied("BOUNDED_STATIC_FLOW_JSON_REQUIRED");}
 const parsed=flowSchema.safeParse(value);if(!parsed.success)throw new PlatformDenied("BOUNDED_STATIC_FLOW_JSON_REQUIRED");
 const children=parsed.data.screens[0].layout.children;if(children.at(-1)?.type!=="Footer"||children.filter(c=>c.type==="Footer").length!==1)throw new PlatformDenied("EXACT_TERMINAL_FLOW_FOOTER_REQUIRED");
 const named=children.filter(c=>"name"in c),names=named.map(c=>c.name);if(new Set(names).size!==names.length||names.length>16)throw new PlatformDenied("FLOW_FIELD_IDENTITY_REQUIRED");
 const complete=children.at(-1);if(!complete||complete.type!=="Footer")throw new PlatformDenied("EXACT_TERMINAL_FLOW_FOOTER_REQUIRED");
 const payload=complete["on-click-action"].payload;if(Object.keys(payload).length!==names.length||names.some(name=>payload[name]!==`\${form.${name}}`))throw new PlatformDenied("EXACT_LOCAL_FLOW_COMPLETION_BINDING_REQUIRED");
 const sensitive=parsed.data.screens[0].sensitive??[];if(sensitive.some(name=>!names.includes(name))||new Set(sensitive).size!==sensitive.length)throw new PlatformDenied("FLOW_SENSITIVE_FIELD_BINDING_REQUIRED");
 for(const field of named)if(field.type==="CalendarPicker"&&(field["min-date"]>field["max-date"]||field["unavailable-dates"]?.some(d=>d<field["min-date"]||d>field["max-date"])))throw new PlatformDenied("FLOW_DATE_BOUNDARY_REQUIRED");
 return canonicalJson(parsed.data);
}
export function validateWhatsAppFlowParameters(tool:string,input:Record<string,unknown>):void{
 const name=text(200),empty=z.object({}).strict();let schema:z.ZodType;
 if(tool==="whatsapp_platform_create_flow")schema=z.object({name,categories:whatsappFlowCategories,flow_json:z.string().optional()}).strict();
 else if(tool==="whatsapp_platform_update_flow")schema=z.object({name:name.optional(),categories:whatsappFlowCategories.optional()}).strict().refine(v=>v.name!==undefined||v.categories!==undefined);
 else if((tool==="whatsapp_platform_upload_flow_json"||tool==="whatsapp_platform_publish_flow"))schema=z.object({flow_json:z.string()}).strict();else schema=empty;
 if(!schema.safeParse(input).success)throw new PlatformDenied("STRICT_WHATSAPP_FLOW_INPUT_REQUIRED");
 for(const value of Object.values(input))if(typeof value==="string")assertNoCredentialShapedString(value);
 if(input.flow_json!==undefined&&validateStaticWhatsAppFlowJson(input.flow_json)!==input.flow_json)throw new PlatformDenied("CANONICAL_FLOW_JSON_REQUIRED");
}
/** A real static appointment-request form. Choices and time zone come from the
 * client; this collects preferences and never claims to reserve availability. */
export function buildWhatsAppBookingRequestFlow(input:unknown):string{
 const choice=z.object({id:fieldName,title:text(30)}).strict(),schema=z.object({title:text(30),timeZone:z.string().min(1).max(100).refine(s=>{try{new Intl.DateTimeFormat("en",{timeZone:s});return true;}catch{return false;}}),appointmentTypes:z.array(choice).min(1).max(30),timeSlots:z.array(choice).min(1).max(50),minDate:date,maxDate:date,unavailableDates:z.array(date).max(100).optional()}).strict(),p=schema.parse(input);
 const form=[{type:"TextHeading",text:p.title},{type:"TextBody",text:`Request an appointment. The business will confirm availability. Times are shown in ${p.timeZone}.`},{type:"Dropdown",name:"appointment_type",label:"Appointment type",required:true,"data-source":p.appointmentTypes},{type:"CalendarPicker",name:"appointment_date",label:"Preferred date",required:true,mode:"single","min-date":p.minDate,"max-date":p.maxDate,...(p.unavailableDates?{"unavailable-dates":p.unavailableDates}:{})},{type:"Dropdown",name:"appointment_time",label:"Preferred time",required:true,"data-source":p.timeSlots},{type:"TextInput",name:"customer_name",label:"Your name","input-type":"text",required:true,"max-chars":"100"},{type:"TextInput",name:"contact_phone",label:"Contact phone","input-type":"phone",required:true,"max-chars":"30"},{type:"TextArea",name:"notes",label:"Notes",required:false,"max-length":"600"},{type:"Footer",label:"Request appointment","on-click-action":{name:"complete",payload:Object.fromEntries(["appointment_type","appointment_date","appointment_time","customer_name","contact_phone","notes"].map(name=>[name,`\${form.${name}}`]))}}];
 return validateStaticWhatsAppFlowJson(canonicalJson({version:"7.3",screens:[{id:"APPOINTMENT_REQUEST",title:p.title,terminal:true,success:true,data:{},sensitive:["customer_name","contact_phone","notes"],layout:{type:"SingleColumnLayout",children:form}}]}));
}
