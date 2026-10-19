'use strict';
const {prisma,hashPassword,requireString}=require('../src/auth');
async function main(){
  const username=requireString(process.env.BOOTSTRAP_USERNAME,'BOOTSTRAP_USERNAME',150);
  const name=requireString(process.env.BOOTSTRAP_NAME,'BOOTSTRAP_NAME');
  const passwordHash=hashPassword(process.env.BOOTSTRAP_PASSWORD);
  const exists=await prisma.user.findUnique({where:{username}});
  if(exists)throw Error('Username already exists; no accounts changed.');
  await prisma.user.create({data:{username,name,passwordHash,role:'SUPER_ADMIN'}});
  console.log('Super admin created. Remove BOOTSTRAP_* variables from your environment.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
