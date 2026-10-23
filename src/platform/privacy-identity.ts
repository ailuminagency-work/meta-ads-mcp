import type {Connection} from "./models.js";
import {PlatformDenied} from "./models.js";
/** Provider app-user identity differs from the platform's authenticated operator
 * for separate Threads and Instagram apps. Older Page connections use the
 * same-app original operator until their purpose-bound delegation is inspected. */
export function connectionPrivacyAppUserId(connection:Connection):string{
 if(connection.metaAppUserId!==undefined){if(!/^\d{1,100}$/.test(connection.metaAppUserId))throw new PlatformDenied("PRIVACY_APP_USER_IDENTITY_INVALID");return connection.metaAppUserId;}
 if(connection.tokenType==="business_integration_system_user"){if(!connection.subjectId||!/^\d{1,100}$/.test(connection.subjectId))throw new PlatformDenied("BISU_APP_USER_REAUTHORIZATION_REQUIRED");return connection.subjectId;}
 if(connection.tokenType==="instagram")throw new PlatformDenied("INSTAGRAM_APP_USER_REAUTHORIZATION_REQUIRED");
 return ["user","threads"].includes(connection.tokenType)&&connection.subjectId?connection.subjectId:connection.operatorId;
}
