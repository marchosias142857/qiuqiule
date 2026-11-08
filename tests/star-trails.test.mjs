import test from 'node:test';
import assert from 'node:assert/strict';
import {STAR_TRAIL_DEFINITIONS,normalizeStarTrailState,unlockStarTrails,acknowledgeStarTrailUnlock,
  selectStarTrail,starTrailShapes,resolveStarTrailShape,starTrailPreview} from '../dist/star-trails.js';

test('nine star trails unlock at the requested successive five-stage milestones',()=>{
  assert.deepEqual(STAR_TRAIL_DEFINITIONS.map(item=>item.label),['三角星','四方星','菱星','雪星','三连星','日','月','日月星','群星']);
  assert.deepEqual(STAR_TRAIL_DEFINITIONS.map(item=>item.id),['triangle','square','diamond','snowflake','triple','sun','moon','galaxy','star']);
  assert.deepEqual(STAR_TRAIL_DEFINITIONS.map(item=>item.stage),[5,10,15,20,25,30,35,40,45]);
  for(let stage=0;stage<=50;stage++){
    const count=Math.min(9,Math.floor(stage/5)),state=normalizeStarTrailState(null,{highestStage:stage});
    assert.equal(state.unlocked,count);assert.equal(state.selected,null);
    assert.deepEqual(state.pendingUnlocks,STAR_TRAIL_DEFINITIONS.slice(0,count).map(item=>item.id));
  }
});

test('the renamed final rewards follow the new milestones for saved selections and pending queues',()=>{
  const atForty=normalizeStarTrailState({unlocked:8,selected:'star',pendingUnlocks:['star','moon','galaxy']},{highestStage:40});
  assert.equal(atForty.selected,null,'the 45-stage star cannot remain equipped before its new milestone');
  assert.deepEqual(atForty.pendingUnlocks,['moon','galaxy']);
  assert.equal(selectStarTrail(atForty,'galaxy').selected,'galaxy');
  assert.equal(selectStarTrail(atForty,'star').selected,null);
  const last=unlockStarTrails(atForty,45);
  assert.deepEqual(last.newlyUnlocked,['star']);
  assert.deepEqual(last.state.pendingUnlocks,['moon','galaxy','star']);
  const all=normalizeStarTrailState({unlocked:9,selected:'galaxy',pendingUnlocks:['star','galaxy']});
  assert.equal(all.selected,'galaxy','renaming never switches an earned mixed cosmetic to star-only');
  assert.deepEqual(all.pendingUnlocks,['galaxy','star']);
});

test('saved stage records restore earned star trails and celebration queues survive reload',()=>{
  const initial=normalizeStarTrailState(null,{highestStage:16});
  const selected=selectStarTrail(initial,'diamond');
  assert.deepEqual(selected.pendingUnlocks,['triangle','square','diamond']);
  const acknowledged=acknowledgeStarTrailUnlock(selected,'triangle');
  const loaded=normalizeStarTrailState(JSON.stringify(acknowledged),{highestStage:16});
  assert.deepEqual(loaded,acknowledged);assert.equal(loaded.selected,'diamond');
  const earned=unlockStarTrails(loaded,25);
  assert.deepEqual(earned.newlyUnlocked,['snowflake','triple']);
  assert.deepEqual(earned.state.pendingUnlocks,['square','diamond','snowflake','triple']);
  assert.deepEqual(unlockStarTrails(earned.state,25).newlyUnlocked,[]);
  assert.equal(unlockStarTrails(earned.state,1).state.unlocked,5,'later short runs never revoke ownership');
  assert.deepEqual(initial.pendingUnlocks,['triangle','square','diamond'],'operations never mutate saved inputs');
});

test('locked and unknown choices cannot be equipped, selected cosmetics toggle off',()=>{
  const state=normalizeStarTrailState(null,{highestStage:5});
  assert.equal(selectStarTrail(state,'square').selected,null);
  assert.equal(selectStarTrail(state,'unknown').selected,null);
  const wearing=selectStarTrail(state,'triangle');assert.equal(wearing.selected,'triangle');
  assert.equal(selectStarTrail(wearing,'triangle').selected,null);
  assert.equal(selectStarTrail(wearing,null).selected,null);
  assert.deepEqual(wearing.pendingUnlocks,state.pendingUnlocks,'equipping is not reward acknowledgement');
});

test('malformed records cannot create invalid selection or reward entries',()=>{
  for(const value of [null,[],false,'{broken',42])assert.deepEqual(normalizeStarTrailState(value),normalizeStarTrailState(null));
  const state=normalizeStarTrailState({unlocked:100,selected:'unknown',pendingUnlocks:['galaxy','bad','galaxy','triangle']});
  assert.equal(state.unlocked,9);assert.equal(state.selected,null);assert.deepEqual(state.pendingUnlocks,['triangle','galaxy']);
  assert.equal(normalizeStarTrailState({unlocked:-100,selected:'triangle'}).unlocked,0);
  assert.equal(normalizeStarTrailState({unlocked:NaN,selected:'triangle'}).selected,null);
  for(const highestStage of [Infinity,{},true,'invalid'])assert.equal(normalizeStarTrailState(null,{highestStage}).unlocked,0);
});

test('mixed trails use equal thirds and resolve to a fixed primitive from supplied randomness',()=>{
  assert.deepEqual(starTrailShapes('triple'),['triangle','square','diamond']);
  assert.deepEqual(starTrailShapes('galaxy'),['sun','moon','star']);
  for(const id of ['triple','galaxy']){
    const expected=starTrailShapes(id),counts=new Map(expected.map(shape=>[shape,0]));
    for(let i=0;i<300;i++){
      const shape=resolveStarTrailShape(id,(i+.5)/300);counts.set(shape,counts.get(shape)+1);
    }
    assert.deepEqual([...counts.values()],[100,100,100]);
    assert.equal(resolveStarTrailShape(id,0),expected[0]);assert.equal(resolveStarTrailShape(id,1),expected[2]);
  }
  assert.equal(resolveStarTrailShape(null,.5),null);assert.equal(resolveStarTrailShape('unknown',.5),null);
  for(const item of STAR_TRAIL_DEFINITIONS.filter(item=>item.shapes.length===1))
    for(const sample of [0,.1,.5,.999])assert.equal(resolveStarTrailShape(item.id,sample),item.shapes[0]);
});

test('gallery previews reveal each mixed primitive and sanitize colors',()=>{
  for(const item of STAR_TRAIL_DEFINITIONS){
    const svg=starTrailPreview(item.id,'#123456');assert.match(svg,/viewBox="0 0 100 100"/);
    assert.equal((svg.match(/<path /g)||[]).length,3);
    for(const shape of item.shapes)assert.ok(svg.includes(`data-shape="${shape}"`));
    assert.match(svg,/fill="#123456"/);assert.doesNotMatch(svg,/gradient|filter|image|animate/);
  }
  assert.doesNotMatch(starTrailPreview('star','"><script>bad</script>'),/script|bad/);
  assert.doesNotMatch(starTrailPreview(null),/<path/);
});
