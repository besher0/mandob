import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareStyleSnapshots,summarizeStyleDifferences} from '../scripts/v2-style-diff.mjs';

test('CSS audit compares real paired values without claiming pixel similarity',()=>{
  const current={
    body:{fontFamily:'Cairo',backgroundColor:'rgb(246, 248, 247)',fontSize:'14px'},
    header:{padding:'13px 16px',fontSize:'19px'},
    counts:{buttons:5,textInputs:2,dialogs:0}
  };
  const reference={
    body:{fontFamily:'Cairo',backgroundColor:'rgb(246, 248, 247)',fontSize:'14px'},
    header:{padding:'20px 34px',fontSize:'19px'},
    counts:{buttons:4,textInputs:2,dialogs:0}
  };
  const diff=compareStyleSnapshots(current,reference);
  assert.equal(diff.compared,8);
  assert.equal(diff.mismatched,2);
  assert.deepEqual(diff.differences.map(x=>x.section+':'+x.property),
    ['header:padding','counts:buttons']);
  assert.equal(diff.matchPercent,75);
});

test('unpaired panels are reported explicitly, not counted as matching tokens',()=>{
  const diff=compareStyleSnapshots({card:{borderRadius:'16px'}},{});
  assert.equal(diff.compared,0);
  assert.equal(diff.matchPercent,null);
  assert.deepEqual(diff.unpairedSections.map(x=>x.section),['card']);
});

test('overview tracks worst routes while excluding failed capture pairs',()=>{
  const results=[
    {device:'desktop',role:'REP',targetPage:'doctors',
      cssDiff:compareStyleSnapshots({body:{color:'red'}},{body:{color:'blue'}})},
    {device:'mobile',role:'REP',targetPage:'areas',
      cssDiff:compareStyleSnapshots({body:{color:'red'}},{body:{color:'red'}})},
    {device:'mobile',role:'REP',targetPage:'reports',error:'not rendered'}
  ];
  const overview=summarizeStyleDifferences(results);
  assert.equal(overview.pairedPages,2);
  assert.equal(overview.compared,2);
  assert.equal(overview.mismatched,1);
  assert.equal(overview.pagesWithNoSampleDifferences,1);
  assert.equal(overview.mostDifferent[0].page,'doctors');
  assert.match(overview.interpretation,/not pixel-level similarity/);
});

test('side-by-side audit writes the numeric CSS findings into the artifact',()=>{
  const script=readFileSync(new URL('../scripts/v2-side-by-side.mjs',import.meta.url),'utf8');
  assert.match(script,/compareStyleSnapshots\(mandobStyles,v2Styles\)/);
  assert.match(script,/css-differences-summary\.json/);
  assert.match(script,/summary\.mismatched/);
});
