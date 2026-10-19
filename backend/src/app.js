'use strict';
const express=require('express');
const {prisma,login,logout,authenticate,publicUser}=require('./auth');
const {registerRoutes}=require('./routes');
const app=express();
app.disable('x-powered-by');
app.set('trust proxy',process.env.TRUST_PROXY==='1' ? 1 : false);
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");
  const origin=req.get('origin'), expected=process.env.WEB_ORIGIN;
  if(origin && expected && origin===expected) {
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Allow-Credentials','true');
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,PUT,DELETE,OPTIONS');
  }
  if(req.method==='OPTIONS')return res.sendStatus(origin && expected && origin!==expected ? 403:204);
  if(origin && (!expected || origin!==expected))return res.status(403).json({error:'Origin not allowed'});
  next();
});
app.use(express.json({limit:'128kb'}));
const wrap=handler=>(req,res,next)=>Promise.resolve().then(()=>handler(req,res)).catch(next);
app.get('/healthz',wrap(async(_req,res)=>{
  await prisma.$queryRaw`SELECT 1`;
  res.json({status:'ok'});
}));
app.post('/api/login',wrap(login));
app.use('/api',authenticate);
app.get('/api/me',(req,res)=>res.json({user:publicUser(req.user)}));
app.post('/api/logout',wrap(logout));
registerRoutes(app,wrap);
app.use((err,_req,res,_next)=>{
  if(err.code==='P2002')return res.status(409).json({error:'هذا السجل موجود مسبقاً'});
  if(err.code==='P2025')return res.status(404).json({error:'السجل غير موجود'});
  const status=Number.isInteger(err.status)?err.status:500;
  if(status>=500)console.error('Unhandled API error:',err);
  res.status(status).json({error:status<500?err.message:'حدث خطأ داخلي'});
});
module.exports={app};
