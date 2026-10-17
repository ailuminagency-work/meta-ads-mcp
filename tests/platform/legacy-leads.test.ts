import {describe,it,expect} from "vitest";
import {mapLegacyLeadAction,LEGACY_LEAD_CAPABILITIES} from "../../src/platform/legacy-leads.js";
describe("strict legacy lead compatibility mapping",()=>{
 it("maps registered Page form metadata without caller fields",()=>{expect(mapLegacyLeadAction("ads_get_lead_forms",{client_id:"client",page_id:"101",connection_id:"connection",limit:10})).toEqual({tool:"leads_list_forms",assetId:"101",input:{},limit:10});expect(LEGACY_LEAD_CAPABILITIES.ads_get_lead_forms).toBe("leads.list.forms");});
 it("requires selected ad and preserves local date bounds",()=>{const until=Math.floor(Date.now()/1000),since=until-3600;expect(mapLegacyLeadAction("ads_get_leads",{client_id:"client",form_id:"101",ad_id:"202",created_since:since,created_until:until})).toEqual({tool:"leads_retrieve",assetId:"101",input:{ad_id:"202",created_since:since,created_until:until},limit:25});});
 it.each([{fields:"id,field_data"},{filtering:[]},{access_token:"forbidden"},{limit:101},{created_since:1}])("rejects unchecked legacy options %j",extra=>{expect(()=>mapLegacyLeadAction("ads_get_leads",{client_id:"client",form_id:"101",ad_id:"202",...extra})).toThrow();});
 it("rejects missing ad/client and unsupported action",()=>{expect(()=>mapLegacyLeadAction("ads_get_leads",{client_id:"client",form_id:"101"})).toThrow();expect(()=>mapLegacyLeadAction("ads_get_lead_forms",{page_id:"101"})).toThrow();expect(()=>mapLegacyLeadAction("ads_delete_lead",{client_id:"client"})).toThrow();});
});
