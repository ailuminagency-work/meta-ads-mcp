import {PlatformDenied,type AssetRef} from "./models.js";
export const ANOMALY_TOOL="ads_insights_anomaly_signal";
export function anomalyWindows(input:Record<string,unknown>,root:AssetRef,now=Date.now()){
 const days=input.window_days??7,threshold=input.threshold_pct??30,level=({AD_ACCOUNT:"account",CAMPAIGN:"campaign",AD_SET:"adset",AD:"ad"} as Record<string,string>)[root.type];
 if(!Number.isInteger(days)||Number(days)<1||Number(days)>30||typeof threshold!=="number"||!Number.isFinite(threshold)||threshold<1||threshold>500||!level||input.level!==undefined&&String(input.level).replace("ad_set","adset")!==level)throw new PlatformDenied("ANOMALY_EXACT_OBJECT_WINDOW_REQUIRED");
 const end=new Date(now);end.setUTCHours(0,0,0,0);end.setUTCDate(end.getUTCDate()-1);const date=(offset:number)=>new Date(end.getTime()-offset*86400000).toISOString().slice(0,10);
 return {days:Number(days),threshold,level,recent:{since:date(Number(days)-1),until:date(0)},previous:{since:date(Number(days)*2-1),until:date(Number(days))}};
}
export function normalizeAnomaly(input:Record<string,unknown>,root:AssetRef,results:unknown[],now=Date.now()){
 const windows=anomalyWindows(input,root,now),metrics=["spend","impressions","clicks","ctr","cpc","cpm"];
 const base={windows,date_basis:"UTC date boundaries supplied to Meta; Meta interprets dates in the advertiser account calendar",measurement:"DESCRIPTIVE_COMPARISON_ONLY",causation:"NOT_ESTABLISHED"};
 const rows=results.map((value,index)=>{const page=value as {data?:unknown[];lumin_page?:{complete?:boolean}};if(!page||!Array.isArray(page.data)||page.lumin_page?.complete!==true||page.data.length>1)throw new PlatformDenied("ANOMALY_COMPLETE_SINGLE_AGGREGATE_REQUIRED");if(!page.data.length)return null;const row=page.data[0] as Record<string,unknown>,idField=({AD_ACCOUNT:"account_id",CAMPAIGN:"campaign_id",AD_SET:"adset_id",AD:"ad_id"} as Record<string,string>)[root.type],range=index===0?windows.recent:windows.previous;if(!row||String(row[idField]).replace(/^act_/,"")!==root.id.replace(/^act_/,"")||row.date_start!==range.since||row.date_stop!==range.until)throw new PlatformDenied("ANOMALY_AGGREGATE_IDENTITY_REQUIRED");return row;});
 if(results.length!==2)throw new PlatformDenied("ANOMALY_TWO_WINDOWS_REQUIRED");
 if(rows.some(row=>row===null))return {...base,status:"INSUFFICIENT_DATA",comparisons:[],missing_values:"UNKNOWN_NOT_ZERO"};
 const comparisons=metrics.map(metric=>{const values=rows.map(row=>{const value=row![metric];if(value===undefined||value===null)return null;if(typeof value!=="string"&&typeof value!=="number"||!/^\d+(?:\.\d+)?$/.test(String(value))||!Number.isFinite(Number(value)))throw new PlatformDenied("ANOMALY_METRIC_INVALID");return Number(value);}),[current,previous]=values;if(current===null||previous===null)return {metric,status:"MISSING_VALUE",current,previous,delta_pct:null,threshold_exceeded:null};if(previous===0)return {metric,status:"ZERO_BASELINE",current,previous,delta_pct:null,absolute_change:current,threshold_exceeded:null};const delta=(current-previous)/previous*100;if(!Number.isFinite(delta))throw new PlatformDenied("ANOMALY_METRIC_INVALID");return {metric,status:"COMPARED",current,previous,delta_pct:delta,threshold_exceeded:Math.abs(delta)>=windows.threshold};});
 return {...base,status:"COMPARED",comparisons,missing_values:"UNKNOWN_NOT_ZERO"};
}
