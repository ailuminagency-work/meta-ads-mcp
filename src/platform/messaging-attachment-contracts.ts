import {z} from "zod";
import {PlatformDenied} from "./models.js";
import type {ProductContract} from "./products/contracts.js";
import {validatePublicVideoUrl} from "./page-video.js";
export const MESSENGER_ATTACHMENT_TOOLS:readonly string[]=["messenger_send_video","messenger_send_audio","messenger_send_file"];
export const MESSENGER_ATTACHMENT_CONTRACTS:ProductContract[]=MESSENGER_ATTACHMENT_TOOLS.map(tool=>({id:tool.replaceAll("_","."),tool,provider:"META_MESSENGER",product:"messenger",title:"Send one separately approved client attachment in an open response window",method:"POST",path:"/{asset_id}/messages",assetType:"PAGE",operationClasses:["WRITE_MESSAGING"],requiredScopes:["pages_messaging"],tokenTypes:["page"],requiredTasks:["MESSAGE"],requiredTaskAssetType:"PAGE",allowedInputKeys:["recipient","source_media_id","attachment_url"],serverOnlyInputKeys:["source_media_id","attachment_url"],assetInputKeys:{source_media_id:"MEDIA"},responseFields:["recipient_id","message_id"],requiresMessagingWindow:true,verified:true,documentation:["https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api"],manualRequirements:["Current client-owned Page access, literal MESSAGE task, pages_messaging permission and external-user access review must be independently verified.","Trusted signed inbound and recipient relationship must establish an open 24-hour response window. No outreach tags or window exceptions.","Actual bounded attachment bytes, immutable source digest and purpose-specific client rights require signed trusted ingestion and separate human source enrollment. A separate human send approval is mandatory. No arbitrary caller URLs or automatic retry; a receipt is not delivery proof."]}));
export function validateMessengerAttachmentInput(tool:string,input:Record<string,unknown>):void{
 const prefix=tool==="messenger_send_video"?"mp4":tool==="messenger_send_audio"?"audio":tool==="messenger_send_file"?"pdf":null;
 if(!prefix||!z.object({recipient:z.object({id:z.string().regex(/^[0-9]{1,32}$/)}).strict(),source_media_id:z.string().regex(new RegExp(`^${prefix}_[a-f0-9]{64}$`)),attachment_url:z.string().max(2048)}).strict().safeParse(input).success)throw new PlatformDenied("MESSENGER_ATTACHMENT_SCHEMA_REQUIRED");
 validatePublicVideoUrl(input.attachment_url);
}
export function messengerAttachmentBody(tool:string,input:Record<string,unknown>):Record<string,unknown>{
 validateMessengerAttachmentInput(tool,input);const type=tool.slice("messenger_send_".length);
 return {recipient:input.recipient,messaging_type:"RESPONSE",message:{attachment:{type,payload:{url:input.attachment_url}}}};
}
