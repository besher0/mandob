import type { CSSProperties } from 'react';
const paths: Record<string, string> = {
  target:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  warning:'m12 3 10 18H2ZM12 9v5m0 3v1',
  home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  doctors:'M6 3v5a5 5 0 0 0 10 0V3M4 3h4m6 0h4M11 13v3a5 5 0 0 0 10 0v-3m-2-2a2 2 0 1 0 4 0 2 2 0 0 0-4 0',
  pharmacies:'M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7l7-7Zm-4 4 7 7',
  hospitals:'M5 21V5h14v16M9 21v-5h6v5M12 7v6m-3-3h6M3 21h18',
  areas:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM9 10a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  team:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 7m2 4a6 6 0 0 1 3 6',
  teams:'M3 6h7l2 3h9v12H3ZM3 6V3h8l2 3h8',
  reports:'M8 4H4v18h16V4h-4M8 2h8v5H8ZM8 11h8m-8 4h8m-8 4h5',
  analytics:'M4 3v18h18M8 16v-5m5 5V7m5 9V4',
  tours:'M3 7h12l4 5v7H3ZM3 12h16M7 19v2m9-2v2M6 15h1m8 0h1',
  products:'m3 7 9-4 9 4v12l-9 4-9-4ZM3 7l9 4 9-4M12 11v12M8 5l9 4',
  leaves:'M5 4h14v17H5ZM8 2v4m8-4v4M5 9h14m-11 5 3 3 5-5',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  account:'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM3 22v-2a9 9 0 0 1 18 0v2',
  bell:'M5 17h14l-2-3V8A5 5 0 0 0 7 8v6Zm5 3a2 2 0 0 0 4 0',
};
const aliases: Record<string,string> = {'🎯':'target','⚠️':'warning','👨‍⚕️':'doctors','🩺':'doctors','💊':'pharmacies','🏥':'hospitals','📍':'areas','👥':'team','🗂':'teams','📄':'reports','📊':'analytics','🚗':'tours','📦':'products','🏖':'leaves','⚙':'settings','▦':'home','dashboard':'home'};
export function ThemeIcon({name,size=24,className}:{name:string;size?:number;className?:string}) {
  const key=aliases[name]??name;
  // Preserve the existing navigation artwork while tinting it through currentColor.
  if(['home','analytics','reports','account'].includes(key)) return <span aria-hidden="true" className={`theme-icon ${className??''}`} style={{width:size,height:size,backgroundColor:'currentColor',mask:`url(/icons/${key}.svg) center / contain no-repeat`,WebkitMask:`url(/icons/${key}.svg) center / contain no-repeat`} as CSSProperties}/>;
  return <svg aria-hidden="true" focusable="false" className={`theme-icon ${className??''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[key]??paths.reports}/></svg>;
}
