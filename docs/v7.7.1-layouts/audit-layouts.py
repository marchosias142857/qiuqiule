"""Conservative geometry audit. Similarity is a review signal, not proof of play."""
import json, math, itertools
from pathlib import Path

ROOT=Path(__file__).resolve().parent
DATA=json.loads((ROOT/'snapshot.json').read_text())

def canonical(d,with_context=True):
    # No HP, level, goal, radius or colour values enter this fingerprint.
    # Relative centre geometry and rectangular aspect distinguish topology.
    parts=[('static',b) for b in d['statics']]+[('dynamic',b) for b in d['enemies']]
    if with_context:parts += [('player',d['player'])]+[('zone',b) for b in d['zones']]
    if not parts:return 'empty'
    variants=[]
    for swap,sx,sy in itertools.product([False,True],[-1,1],[-1,1]):
        points=[]
        for role,b in parts:
            x,y=b['x'],b['y'];w,h=b.get('width',0),b.get('height',0)
            if swap:x,y,w,h=y,x,h,w
            points.append([role,b.get('shape','circle'),x*sx,y*sy,w,h])
        minx=min(p[2] for p in points);miny=min(p[3] for p in points)
        scale=max(max(p[2] for p in points)-minx,max(p[3] for p in points)-miny,1)
        variants.append(tuple(sorted((role,shape,round((x-minx)/scale,6),round((y-miny)/scale,6),
            round(w/scale,6),round(h/scale,6)) for role,shape,x,y,w,h in points)))
    return min(variants)

def signed_gap(a,b):
    ar=a.get('shape','circle')=='rect';br=b.get('shape','circle')=='rect'
    if ar and br:
        gx=abs(a['x']-b['x'])-(a['width']+b['width'])/2
        gy=abs(a['y']-b['y'])-(a['height']+b['height'])/2
        return math.hypot(max(0,gx),max(0,gy)) if max(gx,gy)>0 else max(gx,gy)
    if ar or br:
        r,c=(a,b) if ar else (b,a)
        dx=max(abs(c['x']-r['x'])-r['width']/2,0);dy=max(abs(c['y']-r['y'])-r['height']/2,0)
        return math.hypot(dx,dy)-c['r']
    return math.hypot(a['x']-b['x'],a['y']-b['y'])-a['r']-b['r']

result={'snapshots':len(DATA),'exactDuplicatePairs':[],'targetOnlyDuplicatePairs':[],
        'bodyOverlaps':[],'joinedStaticPairs':[],'outOfBounds':[],
        'golfWithoutRoute':[],'holesTooSmall':[], 'smallestBodyGaps':{}}
for mode in ['wall','pool','merge','golf','peggle']:
    rows=[d for d in DATA if d['mode']==mode]
    for context,key in [(True,'exactDuplicatePairs'),(False,'targetOnlyDuplicatePairs')]:
        fingerprints=[canonical(d,context) for d in rows]
        for i,j in itertools.combinations(range(len(rows)),2):
            if fingerprints[i]==fingerprints[j]:result[key].append([mode,rows[i]['level'],rows[j]['level']])
    smallest=math.inf
    for d in rows:
        physical=[d['player']]+d['statics']+d['enemies'];bounds=d['bounds']
        for a,b in itertools.combinations(physical,2):
            gap=signed_gap(a,b)
            if a.get('shape')=='rect' and b.get('shape')=='rect' and gap<-.001:
                result['joinedStaticPairs'].append([d['level'],a['id'],b['id'],round(gap,3)])
            elif gap<-.001:result['bodyOverlaps'].append([d['level'],a['id'],b['id'],round(gap,3)])
            if gap>=0:smallest=min(smallest,gap/d['unit'])
        for body in physical:
            rx=body['width']/2 if body.get('shape')=='rect' else body['r']
            ry=body['height']/2 if body.get('shape')=='rect' else body['r']
            if body['x']-rx<bounds['left']-.001 or body['x']+rx>bounds['right']+.001 or body['y']-ry<bounds['top']-.001 or body['y']+ry>bounds['bottom']+.001:
                result['outOfBounds'].append([d['level'],body['id']])
        if mode=='golf' and not d['route']:result['golfWithoutRoute'].append(d['level'])
        if mode in ['golf','pool']:
            for z in d['zones']:
                if z['r']<d['player']['r']:result['holesTooSmall'].append([d['level'],z['id']])
    result['smallestBodyGaps'][mode]=round(smallest,4)
(ROOT/'audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
