import express from 'express';
import cookieParser from 'cookie-parser';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {PlatformPrincipal} from './models.js';
import type {PlatformRepository} from './repository.js';
import {clientManagementHash,manageClient} from './client-management.js';

const originCookie='__Host-lumin-client-management';
const styles='body{font:16px/1.5 system-ui,sans-serif;color:#172535;background:#f4f7fb;max-width:860px;margin:40px auto;padding:0 20px}h1{margin-bottom:6px}p{color:#43566c}a{color:#174d88}.panel{background:white;border:1px solid #d4dfeb;border-radius:14px;padding:20px;margin:20px 0}form{display:grid;gap:12px}label{display:grid;gap:6px;font-weight:600}input,select,button{font:inherit;padding:11px;border:1px solid #9eacbd;border-radius:7px}button{border:0;color:white;background:#1c548c;font-weight:650;cursor:pointer}label.check{display:flex;gap:9px;align-items:center;font-weight:400}ul{padding-left:22px}li{margin-bottom:6px}.subtle{color:#64758a;font-size:14px}.status{color:#185c39}';
const styleHash=createHash('sha256').update(styles).digest('base64');
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const equal=(a:string,b:string)=>/^[A-Za-z0-9._-]{1,3000}$/.test(a)&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const reviewSchema=z.object({
  principal:z.object({tenantId:z.string(),operatorId:z.string()}).strict(),
  memberHash:z.string().regex(/^[a-f0-9]{64}$/),
  expires:z.number().int().positive(),
  nonce:z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export function createClientManagementRouter(deps:{
  origin:string;csrfSecret:string;repo:PlatformRepository;
  resolveSession(req:express.Request):Promise<PlatformPrincipal|null>;
}){
  if(new URL(deps.origin).origin!==deps.origin||new URL(deps.origin).protocol!=='https:'||deps.csrfSecret.length<32)
    throw new Error('CLIENT_MANAGEMENT_ORIGIN_REQUIRED');
  const router=express.Router();
  const sign=(payload:string)=>createHmac('sha256',deps.csrfSecret).update(payload).digest('hex');
  router.use(cookieParser());
  router.use((_req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'sha256-"+styleHash+"'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    next();
  });
  const access=async(req:express.Request)=>{
    const principal=await deps.resolveSession(req);
    if(!principal)throw new Error('no session');
    const [trusted,tenant,member]=await Promise.all([
      deps.repo.resolvePrincipal(principal.operatorId),
      deps.repo.get('tenants',principal.tenantId,principal.tenantId),
      deps.repo.get('members',principal.tenantId,principal.operatorId)
    ]);
    if(!trusted||clientManagementHash(trusted)!==clientManagementHash(principal)
      ||!tenant||tenant.status!=='ACTIVE'||tenant.migrationState!=='READY'
      ||!member||member.tenantId!==principal.tenantId||member.operatorId!==principal.operatorId
      ||member.disabledAt!==null||!member.roles.includes('admin'))
      throw new Error('not admin');
    return {principal,member};
  };
  router.get('/',async(req,res)=>{
    try{
      const {principal,member}=await access(req);
      const clients=(await deps.repo.list('clients',principal.tenantId))
        .filter(c=>c.tenantId===principal.tenantId&&c.status==='ACTIVE')
        .sort((a,b)=>a.id.localeCompare(b.id)).slice(0,100);
      const payload=Buffer.from(JSON.stringify({principal,memberHash:clientManagementHash(member),
        expires:Date.now()+300000,nonce:randomBytes(32).toString('hex')})).toString('base64url');
      const csrf=payload+'.'+sign(payload);
      res.cookie(originCookie,csrf,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:300000});
      const available=clients.filter(c=>!member.allowedClientIds.includes(c.id));
      const options=available.map(c=>'<option value="'+escapeHtml(c.id)+'">'+escapeHtml(c.id)+'</option>').join('');
      const clientRows=clients.map(c=>'<li>'+escapeHtml(c.id)+(member.allowedClientIds.includes(c.id)?' — assigned to you':' — unassigned to you')+'</li>').join('');
      const proof='<input type="hidden" name="csrf" value="'+escapeHtml(csrf)+'">';
      const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        '<title>Manage agency clients · Lumin</title><style>'+styles+'</style><h1>Manage agency clients</h1>'+
        '<p>Only your authorized agency tenant is shown. These actions do not grant Meta access or change client ownership or billing.</p>'+
        '<p><a href="/platform/connections/">Back to Meta connections</a></p>'+
        '<section class="panel"><h2>Current clients</h2><ul>'+(clientRows||'<li>No active client profiles yet.</li>')+'</ul></section>'+
        '<section class="panel"><h2>Assign existing client to my operator</h2>'+
        (available.length?'<form method="post">'+proof+'<input type="hidden" name="action" value="assign">'+
        '<label>Existing client <select name="clientId" required>'+options+'</select></label>'+
        '<label class="check"><input name="confirmed" type="checkbox" value="yes" required>I am authorized to manage this client for Lumin.</label>'+
        '<button type="submit">Assign existing client</button></form>':'<p class="subtle">No unassigned active clients are available in this tenant.</p>')+
        '</section><section class="panel"><h2>Create a client profile</h2><p class="subtle">No Meta ad account ID is needed now. Discover the actual account during secure Meta consent.</p>'+
        '<form method="post">'+proof+'<input type="hidden" name="action" value="create">'+
        '<label>Internal client identifier <input name="clientId" pattern="[A-Za-z0-9_-]{1,128}" placeholder="amazing-decks-seattle" required></label>'+
        '<label class="check"><input name="confirmed" type="checkbox" value="yes" required>This is an approved client of our agency. Creating its profile does not prove Meta access.</label>'+
        '<button type="submit">Create client profile</button></form></section></html>';
      res.type('html').send(html);
    }catch{res.status(403).type('text').send('Client management requires an authorized tenant administrator.');}
  });
  router.post('/',express.urlencoded({extended:false,limit:'8kb'}),async(req,res)=>{
    try{
      const {principal,member}=await access(req);
      const body=z.object({csrf:z.string().max(3000),action:z.enum(['create','assign']),
        clientId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),confirmed:z.literal('yes')}).strict().parse(req.body);
      const stored=req.cookies?.[originCookie];
      if(req.get('origin')!==deps.origin||typeof stored!=='string'||!equal(stored,body.csrf))throw new Error('origin or cookie');
      const [payload,signature,...extra]=body.csrf.split('.');
      if(!payload||!signature||extra.length||!equal(signature,sign(payload)))throw new Error('signature');
      const review=reviewSchema.parse(JSON.parse(Buffer.from(payload,'base64url').toString('utf8')));
      if(review.expires<=Date.now()||review.expires>Date.now()+300000
        ||clientManagementHash(review.principal)!==clientManagementHash(principal)
        ||review.memberHash!==clientManagementHash(member))throw new Error('stale review');
      await manageClient(deps.repo,principal,body.action,body.clientId,review.memberHash);
      res.clearCookie(originCookie,{httpOnly:true,secure:true,sameSite:'lax',path:'/'});
      res.type('html').send('<!doctype html><html lang="en"><title>Client ready for connection</title>'+
        '<h1>Client assignment recorded</h1><p>'+escapeHtml(body.clientId)+
        ' is now assigned to this operator. No Meta access, credentials, grants, ownership or spending permission was created.</p>'+
        '<p><a href="/platform/connections/">Continue to Meta connection</a></p></html>');
    }catch{res.status(403).type('text').send('Client not changed. The client, session, membership, or protected review is invalid or stale.');}
  });
  return router;
}
