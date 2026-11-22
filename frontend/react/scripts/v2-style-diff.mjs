// Lightweight, reproducible CSS-token evidence for paired v2 screenshots.
// This is NOT a pixel comparison: matching CSS samples cannot prove visual parity.
export const sampledSections=['body','shell','header','sidebar','heading',
  'card','primaryButton','input'];
export const sampledProperties=['fontFamily','fontSize','fontWeight','lineHeight',
  'color','backgroundColor','borderRadius','borderColor','padding','boxShadow'];
export const sampledControls=['buttons','textInputs','dialogs'];

export function compareStyleSnapshots(current={},reference={}){
  const differences=[],unpairedSections=[];
  let compared=0,mismatched=0;
  for(const section of sampledSections){
    const left=current?.[section]??null,right=reference?.[section]??null;
    if(!left||!right){
      if(Boolean(left)!==Boolean(right))
        unpairedSections.push({section,presentInMandob:Boolean(left),presentInV2:Boolean(right)});
      continue;
    }
    for(const property of sampledProperties){
      const actual=left[property],expected=right[property];
      if(actual===undefined||expected===undefined)continue;
      compared++;
      if(actual!==expected){
        mismatched++;
        differences.push({section,property,mandob:actual,v2:expected});
      }
    }
  }
  for(const property of sampledControls){
    const actual=current?.counts?.[property],expected=reference?.counts?.[property];
    if(!Number.isFinite(actual)||!Number.isFinite(expected))continue;
    compared++;
    if(actual!==expected){
      mismatched++;
      differences.push({section:'counts',property,mandob:actual,v2:expected});
    }
  }
  return {compared,mismatched,matched:compared-mismatched,
    matchPercent:compared?Math.round((compared-mismatched)/compared*100):null,
    unpairedSections,differences};
}

export function summarizeStyleDifferences(results=[]){
  const usable=results.filter(result=>!result.error&&result.cssDiff);
  const compared=usable.reduce((sum,row)=>sum+row.cssDiff.compared,0);
  const mismatched=usable.reduce((sum,row)=>sum+row.cssDiff.mismatched,0);
  const sorted=[...usable].sort((a,b)=>
    b.cssDiff.mismatched-a.cssDiff.mismatched||
    (a.device+a.role+a.targetPage).localeCompare(b.device+b.role+b.targetPage));
  return {
    pairedPages:usable.length,compared,mismatched,matched:compared-mismatched,
    matchPercent:compared?Math.round((compared-mismatched)/compared*100):null,
    pagesWithNoSampleDifferences:usable.filter(x=>x.cssDiff.mismatched===0&&
      !x.cssDiff.unpairedSections.length).length,
    pagesWithUnpairedSections:usable.filter(x=>x.cssDiff.unpairedSections.length>0).length,
    mostDifferent:sorted.slice(0,12).map(x=>({
      device:x.device,role:x.role,page:x.targetPage,
      compared:x.cssDiff.compared,mismatched:x.cssDiff.mismatched,
      missing:x.cssDiff.unpairedSections.map(item=>item.section)
    })),
    interpretation:'Computed CSS samples and control counts only; not pixel-level similarity or functional correctness.'
  };
}
