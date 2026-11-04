"""Render exact constructor geometry. Run snapshot.mjs first; no game edits."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Rectangle
from matplotlib.font_manager import FontProperties

ROOT=Path(__file__).resolve().parent
DATA=json.loads((ROOT/'snapshot.json').read_text())
FONT=FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
BG='#101923'; PANEL='#172433'; INK='#e6edf3'; MUTED='#9eafbf'
COLORS=['#61c6ec','#4ed0a4','#f1c465','#ea9272','#ca9ce7']

def shape(ax,b,face,edge,lw=1.2,zorder=3):
    if b.get('shape')=='rect':
        p=Rectangle((b['x']-b['width']/2,b['y']-b['height']/2),b['width'],b['height'],
                    facecolor=face,edgecolor=edge,linewidth=lw,zorder=zorder)
    else:
        p=Circle((b['x'],b['y']),b['r'],facecolor=face,edgecolor=edge,linewidth=lw,zorder=zorder)
    ax.add_patch(p)

for mode in ['wall','pool','merge','golf','peggle']:
    levels=[d for d in DATA if d['mode']==mode]
    fig,axes=plt.subplots(4,5,figsize=(18,28),facecolor=BG)
    fig.subplots_adjust(left=.025,right=.975,top=.945,bottom=.027,wspace=.12,hspace=.16)
    fig.text(.035,.978,f"{levels[0]['name']} · 20 套实际初始布局",fontproperties=FONT,fontsize=23,color=INK)
    legend='白球＝玩家  彩球数字＝合成等级  描边＝不可破障碍  紫菱＝来球口' if mode=='merge' else '白球＝玩家  橙色＝目标  描边＝不可破障碍  绿色＝球洞 / 接桶'
    fig.text(.035,.960,'390 × 844 · 相同比例 · '+legend,
             fontproperties=FONT,fontsize=12,color=MUTED)
    for ax,d in zip(axes.flat,levels):
        ax.set_facecolor(PANEL);ax.set_xlim(0,390);ax.set_ylim(844,0);ax.set_aspect('equal');ax.set_xticks([]);ax.set_yticks([])
        for sp in ax.spines.values():sp.set_visible(False)
        b=d['bounds']
        ax.add_patch(Rectangle((b['left'],b['top']),b['right']-b['left'],b['bottom']-b['top'],
                              facecolor='#12202d',edgecolor='#708496',linewidth=1.1,zorder=0))
        for z in d['zones']:shape(ax,z,'#214b45','#6de0b0',1.3,1)
        for p in d['ports']:
            ax.plot(p['x'],p['y'],marker='D',ms=3.4,color='#ca9ce7',zorder=4)
        for s in d['statics']:
            if s.get('kind')=='obstacle':shape(ax,s,PANEL,'#9dafbd',1.3)
            elif s.get('kind')=='peg':shape(ax,s,'#eaa35b' if s.get('target') else '#529dc4','#f2c08d' if s.get('target') else '#80bbd8',.7)
            else:shape(ax,s,'#df9250','#f0b47c',.7)
            if s.get('moving'):
                ax.plot(s['x'],s['y'],marker='.',ms=2.5,color=INK,zorder=5)
        for e in d['enemies']:
            lv=e.get('mergeLevel',1);color=COLORS[min(4,lv-1)] if mode=='merge' else '#eaa35b'
            shape(ax,e,color,color,.8)
            if mode=='merge':ax.text(e['x'],e['y'],str(lv),ha='center',va='center',fontsize=5.2,color='#101923',zorder=5)
        shape(ax,d['player'],'#edf5f5','#ffffff',.8,6)
        ax.text(15,49,f"第 {d['level']:02d} 关 · {d['layoutName']}",fontproperties=FONT,fontsize=12,color=INK)
        metrics=f"球 {d['player']['r']/d['unit']:.2f}u  ·  静态体 {len(d['statics'])}  ·  目标球 {len(d['enemies'])}"
        ax.text(15,81,metrics,fontproperties=FONT,fontsize=7.8,color=MUTED)
    fig.savefig(ROOT/f'{mode}.png',dpi=150,facecolor=BG)
    fig.savefig(ROOT/f'{mode}.svg',facecolor=BG)
    plt.close(fig)
    print(f'{mode}: {len(levels)} layouts')
