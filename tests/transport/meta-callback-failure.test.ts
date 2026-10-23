import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {MetaOAuthRequestError} from "../../src/auth/meta-oauth-request.js";
import {signOAuthState,resetOAuthStateSecretForTests} from "../../src/auth/oauth-state.js";
import {mountAuthRoutes} from "../../src/transport/auth-routes.js";

const mocks=vi.hoisted(()=>({exchange:vi.fn(),profile:vi.fn(),save:vi.fn(),upsert:vi.fn(),session:vi.fn(),log:vi.fn()}));
vi.mock('../../src/auth/meta-oauth.js',async original=>({...await original<typeof import('../../src/auth/meta-oauth.js')>(),exchangeCodeForToken:mocks.exchange,exchangeForLongLivedToken:vi.fn(async()=>({accessToken:'fixture-token',expiresAt:9999999999})),fetchProfile:mocks.profile,fetchPrimaryBusiness:vi.fn(async()=>null)}));
vi.mock('../../src/auth/email-allowlist.js',()=>({isAllowed:()=>true}));
vi.mock('../../src/platform/meta-privacy-access.js',()=>({isMetaPrincipalPrivacyLocked:async()=>false}));
vi.mock('../../src/auth/session.js',()=>({setSession:mocks.session,getSession:async()=>null,clearSession:async()=>{}}));
vi.mock('../../src/store/meta-token-repo.js',()=>({saveToken:mocks.save,upsertUser:mocks.upsert,getDefaultTokenName:async()=>null,listTokens:async()=>[],deleteToken:vi.fn(),setDefaultToken:vi.fn()}));
vi.mock('../../src/utils/logger.js',()=>({logger:{error:mocks.log,warn:vi.fn(),info:vi.fn(),debug:vi.fn()}}));

function callback(){
  let handler: (req:never,res:never)=>Promise<void>;
  mountAuthRoutes({get:(path:string,fn:typeof handler)=>{if(path==='/auth/meta/callback')handler=fn;},post:()=>{},use:()=>{}} as never,{serverUrl:'https://example.com',getClient:async()=>undefined});
  return handler!;
}
async function invoke(cookie='browser-a', signedNonce='browser-a'){
  const state=await signOAuthState({returnTo:'/auth/connections',nonce:signedNonce});
  const res={clearCookie:vi.fn(),setHeader:vi.fn(),status:vi.fn(),type:vi.fn(),send:vi.fn(),redirect:vi.fn()};
  res.status.mockReturnValue(res);res.type.mockReturnValue(res);
  await callback()({query:{code:'fixture-code',state,fbUserId:'attacker-selected-user'},cookies:{meta_oauth_state:cookie}} as never,res as never);
  return res;
}
beforeEach(()=>{
  vi.stubEnv('NODE_ENV','test');vi.stubEnv('SESSION_COOKIE_SECRET','local-fixture-cookie-secret-at-least-32');vi.stubEnv('META_APP_ID','123');vi.stubEnv('META_APP_SECRET','fixture-only');
  resetOAuthStateSecretForTests();vi.clearAllMocks();
  mocks.exchange.mockResolvedValue({accessToken:'short-fixture',expiresIn:3600});
  mocks.profile.mockResolvedValue({id:'12345',name:'Operator',email:null,pictureUrl:null});
});
afterEach(()=>{vi.unstubAllEnvs();resetOAuthStateSecretForTests();});
describe('Meta callback failure and identity boundaries',()=>{
  it('rejects another browser state before exchange or persistence',async()=>{
    const res=await invoke('browser-b','browser-a');
    expect(res.status).toHaveBeenCalledWith(400);expect(mocks.exchange).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
  });
  it('gives configuration recovery and a correlatable reference without persistence',async()=>{
    mocks.exchange.mockRejectedValueOnce(new MetaOAuthRequestError('code-exchange','configuration',1));
    const res=await invoke();
    const html=res.send.mock.calls[0][0] as string;
    expect(html).toContain('reconnecting will not fix this');expect(html).toContain('Support reference:');expect(html).not.toContain('fixture-code');
    const diagnostic=mocks.log.mock.calls[0][0];expect(html).toContain(diagnostic.reference);expect(diagnostic.kind).toBe('configuration');
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.upsert).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control','no-store');
  });
  it('never logs or reflects arbitrary thrown provider text',async()=>{
    mocks.exchange.mockRejectedValueOnce(new Error('sensitive-provider-body'));
    const res=await invoke();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('sensitive-provider-body');expect(res.send.mock.calls[0][0]).not.toContain('sensitive-provider-body');
  });
  it('persists and authenticates only the validated Meta identity',async()=>{
    await invoke();
    expect(mocks.upsert.mock.calls[0][0]).toBe('12345');expect(mocks.save.mock.calls[0][0].fbUserId).toBe('12345');expect(mocks.session.mock.calls[0][1].fbUserId).toBe('12345');
    expect(JSON.stringify(mocks.save.mock.calls)).not.toContain('attacker-selected-user');
  });
});
