import {PlatformDenied} from "./models.js";
export const OFFLINE_SIGNAL_SOURCE="https://developers.facebook.com/documentation/ads-commerce/conversions-api/offline-events";
export function assertOfflinePixelConsolidation(value:unknown,pixelId:string):void{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new PlatformDenied("OFFLINE_CONSOLIDATED_DATASET_REQUIRED");const row=value as Record<string,unknown>;
 if(row.id!==pixelId||row.is_consolidated_container!==true||"error"in row)throw new PlatformDenied("OFFLINE_CONSOLIDATED_DATASET_REQUIRED");
}
