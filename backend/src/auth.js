'use strict';
require('dotenv').config();
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const COOKIE = 'mandob_session';
const TTL_MS = 8 * 60 * 60 * 1000;
const attempts = new Map();

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256)
    throw new HttpError(400, 'كلمة المرور يجب أن تكون 12 محرفاً على الأقل');
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return 'scrypt$16384$8$1$' + salt.toString('hex') + '$' + digest.toString('hex');
}

function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const p = encoded.split('$');
  if (p.length !== 6 || p[0] !== 'scrypt' || p[1] !== '16384' || p[2] !== '8' || p[3] !== '1' ||
      !/^[0-9a-f]{32}$/.test(p[4]) || !/^[0-9a-f]{128}$/.test(p[5])) return false;
  const expected = Buffer.from(p[5], 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(p[4], 'hex'), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(expected, actual);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function requireRole(user, roles) {
  if (!user || !roles.includes(user.role)) throw new HttpError(403,'ليس لديك صلاحية لتنفيذ العملية');
}

function companyId(user) {
  if (!user?.companyId) throw new HttpError(403,'لا يوجد حساب شركة مرتبط بالمستخدم');
  return user.companyId;
}

function scope(user) {
  const companyIdValue = companyId(user);
  if (user.role === 'REP') return { companyId: companyIdValue, repId: user.id };
  if (user.role === 'TEAM_MANAGER') return { companyId: companyIdValue, rep: { teamId: user.teamId || '__UNASSIGNED__' } };
  return { companyId: companyIdValue };
}

function asDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400,'تاريخ غير صحيح');
  const d = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0,10) !== value) throw new HttpError(400,'تاريخ غير صحيح');
  return d;
}
function requireString(value,label,max=200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new HttpError(400,'قيمة غير صحيحة: '+label);
  return value.trim();
}
function safeInt(value,label,min=0,max=100000) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400,'عدد غير صحيح: '+label);
  return n;
}
function validateLocation(loc, now=new Date()) {
  if (!loc || typeof loc !== 'object') throw new HttpError(400,'الموقع مطلوب لإنهاء الجولة');
  const latitude = Number(loc.latitude), longitude = Number(loc.longitude), accuracy = Number(loc.accuracy);
  if (![latitude,longitude,accuracy].every(Number.isFinite) || Math.abs(latitude)>90 || Math.abs(longitude)>180 || accuracy<=0 || accuracy>150)
    throw new HttpError(400,'إحداثيات الموقع أو دقته غير مقبولة');
  const capturedAt = new Date(loc.capturedAt);
  const diff = now.getTime()-capturedAt.getTime();
  if (!Number.isFinite(diff) || diff < -60000 || diff > 10*60*1000) throw new HttpError(400,'يجب التقاط موقع حديث');
  return {latitude,longitude,accuracy,capturedAt};
}
function setCookie(res,token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',COOKIE+'='+token+'; HttpOnly; SameSite=Strict; Path=/api; Max-Age='+TTL_MS/1000+secure);
}
function clearCookie(res) {
  res.setHeader('Set-Cookie',COOKIE+'=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0'+(process.env.NODE_ENV==='production'?'; Secure':''));
}
function readToken(req) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)'+COOKIE+'=([a-f0-9]{64})(?:;|$)'));
  return m ? m[1] : null;
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function publicUser(user) {
  const {id,name,username,role,companyId,teamId,dailyTarget,annualLeaveBalance}=user;
  return {id,name,username,role,companyId,teamId,dailyTarget,annualLeaveBalance};
}
async function authenticate(req,res,next) {
  try {
    const token = readToken(req);
    const session = token ? await prisma.authSession.findUnique({where:{tokenHash:hashToken(token)},include:{user:true}}) : null;
    if (!session || session.expiresAt <= new Date() || !session.user.active) throw new HttpError(401,'يجب تسجيل الدخول');
    req.user = session.user;
    req.sessionHash = session.tokenHash;
    next();
  } catch (err) { next(err); }
}
async function login(req,res) {
  const username=requireString(req.body?.username,'username',150);
  const password=req.body?.password;
  if(typeof password!=='string'||password.length>256)throw new HttpError(400,'بيانات تسجيل الدخول غير صحيحة');
  const key=String(req.ip)+':'+username.toLowerCase(), now=Date.now(), old=attempts.get(key);
  if(attempts.size>2500)attempts.clear();
  if(old?.until>now && old.failures>=5)throw new HttpError(429,'محاولات كثيرة؛ حاول لاحقاً');
  const user=await prisma.user.findUnique({where:{username}});
  if(!user?.active || !verifyPassword(password,user.passwordHash)){
    attempts.set(key,{failures:old?.until>now?old.failures+1:1,until:now+15*60*1000});
    throw new HttpError(401,'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  attempts.delete(key);
  const token=crypto.randomBytes(32).toString('hex');
  await prisma.authSession.create({data:{tokenHash:hashToken(token),userId:user.id,expiresAt:new Date(now+TTL_MS)}});
  setCookie(res,token);
  res.json({user:publicUser(user)});
}
async function logout(req,res) {
  await prisma.authSession.deleteMany({where:{tokenHash:req.sessionHash}});
  clearCookie(res);
  res.json({success:true});
}

module.exports={prisma,login,logout,authenticate,hashPassword,verifyPassword,
  HttpError,requireRole,companyId,scope,asDate,requireString,safeInt,validateLocation,publicUser};
