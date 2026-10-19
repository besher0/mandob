'use strict';
const {app}=require('./app');
const {prisma}=require('./auth');
const port=Number(process.env.PORT)||3000;
const server=app.listen(port,()=>console.log('Mandob PostgreSQL API on port '+port));
for(const sig of ['SIGINT','SIGTERM']){
  process.on(sig,()=>{
    server.close(async()=>{await prisma.$disconnect();process.exit(0);});
  });
}
