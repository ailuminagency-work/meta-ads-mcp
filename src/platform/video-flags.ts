import {PlatformDenied} from "./models.js";
export function pageVideoEnabled(env:Record<string,string|undefined>=process.env):boolean{const flag=env.LUMIN_PAGE_VIDEO_ENABLED;if(flag!==undefined&&!["true","false"].includes(flag))throw new PlatformDenied("INVALID_PAGE_VIDEO_FLAG");return env.LUMIN_PLATFORM_ENABLED==="true"&&flag==="true";}
