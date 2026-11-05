'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('active v2 startup and build cannot fall back to legacy SQLite entrypoints',()=>{
  const root=path.resolve(__dirname,'..');
  const config=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(config.scripts.start,'node src/server.js');
  assert.match(config.scripts.dev,/src\/server\.js/);
  assert.match(config.scripts.test,/test-v2/);
  assert.ok(!config.scripts.start.includes('database.js'));
  const entry=fs.readFileSync(path.join(root,'src/server.js'),'utf8');
  assert.match(entry,/require\(['"]\.\/app['"]\)/);
  const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
  assert.match(app,/require\(['"]\.\/routes['"]\)/);
  const files=fs.readdirSync(path.join(root,'src')).filter(f=>f.endsWith('.js'));
  for(const file of files){
    const source=fs.readFileSync(path.join(root,'src',file),'utf8');
    assert.doesNotMatch(source,/require\(['"]\.\.\/(?:database|server)\.js['"]\)/,
      'Active v2 source imported a legacy entrypoint: '+file);
    assert.doesNotMatch(source,/medrep(?:\.db|\.sqlite)/i,
      'Active v2 source depends on the removed SQLite fixture: '+file);
  }
  const react=JSON.parse(fs.readFileSync(
    path.join(root,'../frontend/react/package.json'),'utf8'));
  assert.match(react.scripts.build,/vite build/);
  assert.ok(!react.scripts.build.includes('frontend/rep'));
});
