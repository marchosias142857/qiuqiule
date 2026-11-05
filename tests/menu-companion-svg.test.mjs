import test from 'node:test';
import assert from 'node:assert/strict';
import {companionSvg,paintCompanionSvg} from '../dist/companions.js';

function svgFixture(t){
  const stats={created:0,removed:0,writes:0};
  function element(tag){
    const attrs=new Map();
    return {tag,attrs,children:[],
      getAttribute(name){return attrs.get(name)??null;},
      setAttribute(name,value){stats.writes++;attrs.set(name,String(value));},
      append(node){this.children.push(node);},
      removeChild(node){stats.removed++;const index=this.children.indexOf(node);assert.notEqual(index,-1);this.children.splice(index,1);},
    };
  }
  const original=globalThis.document;
  globalThis.document={createElementNS(namespace,tag){
    assert.equal(namespace,'http://www.w3.org/2000/svg');stats.created++;return element(tag);
  }};
  t.after(()=>{if(original)globalThis.document=original;else delete globalThis.document;});
  return {host:element('div'),stats};
}
// Ignore only the unstyled groups that keep each satellite's tail separate.
// The body group and its single composite opacity stay in the comparison.
function visibleMarkup(node){
  const children=node.children.map(visibleMarkup).join('');
  if(node.tag==='path')return '<path'+[...node.attrs].map(([k,v])=>' '+k+'="'+v+'"').join('')+'/>';
  const opacity=node.getAttribute('opacity');
  return opacity===null?children:'<g opacity="'+opacity+'">'+children+'</g>';
}
const pose={x:40,y:40,r:20};
const moon={id:'moon-3',weight:1};

test('the moving menu retains the SVG body, every path, and its original group opacity',t=>{
  const {host,stats}=svgFixture(t),layers=[moon],options={color:'#739d66'};
  paintCompanionSvg(host,layers,pose,0,options);
  const [root]=host.children,first=root.children[0],body=first.children[1];
  const paths=root.children.flatMap(s=>s.children.flatMap(group=>group.children));
  assert.equal(paths.length,99);
  const initial=stats.created;
  for(let frame=1;frame<=60;frame++)paintCompanionSvg(host,layers,pose,frame/60,options);
  assert.equal(stats.created,initial);assert.equal(stats.removed,0);
  assert.strictEqual(host.children[0],root);
  assert.strictEqual(root.children[0],first);assert.strictEqual(first.children[1],body);
  const retained=root.children.flatMap(s=>s.children.flatMap(group=>group.children));
  paths.forEach((path,i)=>assert.strictEqual(retained[i],path));
  assert.equal(visibleMarkup(root),companionSvg(moon.id,pose,1,options));
  const writes=stats.writes;
  paintCompanionSvg(host,layers,pose,1,options);
  assert.equal(stats.writes,writes,'redrawing an identical pose leaves the live DOM untouched');
});

test('rapid switches preserve tail/body draw order and every paint value throughout a crossfade and unequip',t=>{
  const {host}=svgFixture(t);
  const frames=[
    [moon],
    [{id:'moon-3',weight:.6},{id:'star-2',weight:.4}],
    [{id:'moon-3',weight:.23},{id:'star-2',weight:.28},{id:'sun-1',weight:.49}],
    [{id:'sun-1',weight:1}],
    [{id:'sun-1',weight:.07}],
    [],
    [{id:'star-3',weight:.26}],
  ];
  frames.forEach((layers,i)=>{
    const time=i*.05,r=17+i,center={x:2*r,y:2*r,r};
    const contour=Array.from({length:7},(_,j)=>{
      const a=j*Math.PI*2/7;
      return {x:center.x+r*1.3*Math.cos(a),y:center.y+r*.76*Math.sin(a)};
    });
    const options={color:i%2?'#7d9c50':'#548aba',contour};
    paintCompanionSvg(host,layers,center,time,options);
    if(!layers.length){assert.equal(host.children.length,0);return;}
    const [root]=host.children;
    assert.equal(root.getAttribute('viewBox'),`0 0 ${4*r} ${4*r}`);
    assert.equal(root.getAttribute('aria-hidden'),'true');
    const expected=layers.map(layer=>companionSvg(layer.id,center,time,{...options,alpha:layer.weight})).join('');
    assert.equal(visibleMarkup(root),expected);
  });
});
