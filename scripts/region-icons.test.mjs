import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../dist/region-icons.js',import.meta.url),'utf8');
// A bare context: no window, document or DOM, as when the server renderer evaluates the file.
function load(){const context=vm.createContext({});vm.runInContext(source,context);return context.MobialoRegionIcon;}
const icon=load();
const labels=['Europe','Asia','Africa','America','North America','South America','Middle East','Oceania','Caribbean','Balkans','Global','Multi-country'];
const open='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
const inner=svg=>svg.slice(open.length,-'</svg>'.length);

// Absolute end and control points of a path (the commands the icons use), to keep every shape inside the 24px box.
function points(d){
  const out=[],tokens=d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)/g);let i=0,x=0,y=0,sx=0,sy=0,cmd='';
  const n=()=>Number(tokens[i++]);
  while(i<tokens.length){
    if(/[a-zA-Z]/.test(tokens[i]))cmd=tokens[i++];
    const rel=cmd===cmd.toLowerCase(),c=cmd.toUpperCase();
    if(c==='Z'){x=sx;y=sy;continue;}
    if(c==='M'||c==='L'){const nx=n()+(rel?x:0),ny=n()+(rel?y:0);x=nx;y=ny;if(c==='M'){sx=x;sy=y;cmd=rel?'l':'L';}}
    else if(c==='H')x=n()+(rel?x:0);
    else if(c==='V')y=n()+(rel?y:0);
    else if(c==='C'){for(let k=0;k<2;k++)out.push([n()+(rel?x:0),n()+(rel?y:0)]);const nx=n()+(rel?x:0),ny=n()+(rel?y:0);x=nx;y=ny;}
    else if(c==='S'){out.push([n()+(rel?x:0),n()+(rel?y:0)]);const nx=n()+(rel?x:0),ny=n()+(rel?y:0);x=nx;y=ny;}
    else if(c==='A'){n();n();n();n();n();const nx=n()+(rel?x:0),ny=n()+(rel?y:0);x=nx;y=ny;}
    else throw new Error('unexpected command '+cmd);
    out.push([x,y]);
  }
  return out;
}

test('region icons: loads as a classic script without any DOM and stays small',()=>{
  assert.equal(typeof icon,'function');
  assert.ok(Buffer.byteLength(source)<6*1024,'region-icons.js is '+Buffer.byteLength(source)+' bytes');
  assert.doesNotMatch(source,/\b(?:document|window|navigator|localStorage)\b/);
  assert.deepEqual([...icon.labels].sort(),['africa','america','asia','balkans','caribbean','europe','global','middle east','multi country','north america','oceania','south america']);
});

test('region icons: every region returns a valid, distinct inline SVG drawn inside the 24px box',()=>{
  const seen=new Map();
  for(const label of labels){
    const svg=icon(label);
    assert.ok(svg.startsWith(open)&&svg.endsWith('</svg>'),label);
    const body=inner(svg);
    // Only path and circle elements with geometry attributes.
    assert.match(body,/^(?:<path d="[MmLlHhVvCcSsAaZz0-9.\s-]+"\/>|<circle cx="[\d.]+" cy="[\d.]+" r="[\d.]+"\/>)+$/,label);
    for(const [,d] of body.matchAll(/ d="([^"]+)"/g))for(const [x,y] of points(d)){assert.ok(x>=0.5&&x<=23.5&&y>=0.5&&y<=23.5,`${label}: point ${x},${y} outside the box`);}
    for(const [,cx,cy,r] of body.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g))assert.ok(cx-r>=0.5&&+cx+ +r<=23.5&&cy-r>=0.5&&+cy+ +r<=23.5,label+' circle');
    assert.ok(!seen.has(body),`${label} looks like ${seen.get(body)}`);seen.set(body,label);
  }
  assert.ok(!seen.has(inner(icon('Somewhere else'))),'the fallback globe differs from every region icon');
});

test('region icons: labels match case-insensitively, as slugs, as Americas and in Albanian and Italian',()=>{
  const same=(a,b)=>assert.equal(icon(a),icon(b),`${a} = ${b}`);
  for(const [a,b] of [['EUROPE','Europe'],[' europe ','Europe'],['Americas','America'],['AMERICAS','America'],['north-america','North America'],['north_america','North America'],['middle-east','Middle East'],['Multi-country','multi country'],['multicountry','Multi-country'],['World','Global'],['Worldwide','Global'],['global','Global'],['Evropë','Europe'],['Europa','Europe'],['Lindja e Mesme','Middle East'],['Medio Oriente','Middle East'],['America del Nord','North America'],['Amerika e Jugut','South America'],['Più paesi','Multi-country'],['Disa shtete','Multi-country'],['Balcani','Balkans'],['Caraibi','Caribbean']])same(a,b);
  assert.notEqual(icon('North America'),icon('America'));assert.notEqual(icon('South America'),icon('America'));
});

test('region icons: unknown or hostile labels fall back to a generic globe and never echo the input',()=>{
  const globe=icon('Atlantis');
  for(const label of ['', null, undefined, 42, {}, 'Antarctica', '<script>alert(1)</script>', '" onload="alert(1)', 'globe', 'constructor', '__proto__', 'toString'])assert.equal(icon(label),globe,String(label));
  assert.match(globe,/<circle cx="12" cy="12" r="9"\/>/);
  for(const svg of [...labels.map(icon),globe]){
    assert.doesNotMatch(svg,/<script|\son\w+=|javascript:|href=|style=|<foreignObject|<use\b/i);
    assert.equal((svg.match(/<svg\b/g)||[]).length,1);
  }
});

test('region icons: a second evaluation (another vm context) gives the same markup',()=>{
  const again=load();
  for(const label of labels)assert.equal(again(label),icon(label));
});
