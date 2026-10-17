/** Meta Graph API Rate Limiting: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ */
export interface ProductUsageObservation {maximumUsage:number;regainMs:number;malformed:boolean}
export function readProductUsage(headers:Headers):ProductUsageObservation {
 let maximumUsage=0,regainMs=0,malformed=false;
 const number=(value:unknown,max:number):number=>{if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>max){malformed=true;return 0;}return value;};
 const parse=(key:string):unknown=>{const raw=headers.get(key);if(raw===null)return undefined;if(raw.length>32768){malformed=true;return undefined;}try{return JSON.parse(raw);}catch{malformed=true;return undefined;}};
 const metrics=(raw:unknown):void=>{if(!raw||typeof raw!=="object"||Array.isArray(raw)){malformed=true;return;}const row=raw as Record<string,unknown>;if(!["call_count","total_cputime","total_time"].some(key=>row[key]!==undefined))malformed=true;for(const key of ["call_count","total_cputime","total_time"])if(row[key]!==undefined)maximumUsage=Math.max(maximumUsage,number(row[key],1000000));if(row.estimated_time_to_regain_access!==undefined)regainMs=Math.max(regainMs,number(row.estimated_time_to_regain_access,1440)*60000);};
 const app=parse("x-app-usage");if(app!==undefined)metrics(app);
 const account=parse("x-ad-account-usage");if(account!==undefined){if(!account||typeof account!=="object"||Array.isArray(account))malformed=true;else{const row=account as Record<string,unknown>;if(row.acc_id_util_pct===undefined)malformed=true;if(row.acc_id_util_pct!==undefined)maximumUsage=Math.max(maximumUsage,number(row.acc_id_util_pct,1000000));if(row.reset_time_duration!==undefined&&maximumUsage>=100)regainMs=Math.max(regainMs,number(row.reset_time_duration,86400)*1000);}}
 const buc=parse("x-business-use-case-usage");if(buc!==undefined){if(!buc||typeof buc!=="object"||Array.isArray(buc)||Object.keys(buc).length>32)malformed=true;else{let count=0;for(const rows of Object.values(buc)){if(!Array.isArray(rows)||rows.length>32){malformed=true;continue;}for(const row of rows){if(++count>32){malformed=true;break;}metrics(row);}}}}
 return {maximumUsage,regainMs,malformed};
}
export function productUsageDelay(usage:ProductUsageObservation):number {return Math.max(usage.malformed?60000:0,usage.regainMs,usage.maximumUsage>=100?60000:usage.maximumUsage>=95?5000:usage.maximumUsage>=75?1000:0);}
