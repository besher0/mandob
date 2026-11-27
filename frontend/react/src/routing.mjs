export const ROLE_PREFIXES={
  SUPER_ADMIN:'super-admin',
  COMPANY_ADMIN:'company',
  SALES_MANAGER:'sales-manager',
  TEAM_MANAGER:'manager',
  REP:'rep'
};

export function routePath(role,key,query={}){
  const prefix=ROLE_PREFIXES[role]||ROLE_PREFIXES.REP;
  const params=new URLSearchParams();
  Object.entries(query).forEach(([name,value])=>{
    if(value!==undefined&&value!==null&&value!=='')params.set(name,value);
  });
  const suffix=params.toString();
  return `/${prefix}/${key}${suffix?`?${suffix}`:''}`;
}

export function homePath(role){
  return routePath(role,role==='SUPER_ADMIN'?'companies':role==='SALES_MANAGER'?'sales':'dashboard');
}
