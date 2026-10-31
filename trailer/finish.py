"""Mix original in-game music and frame-timed game effects into the trailer."""
import json
from pathlib import Path
import subprocess
import wave
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'trailer-output'
SR=48000
DURATION=32
mix=np.zeros(SR*DURATION,dtype=np.float64)
events=json.loads((OUT/'sounds.json').read_text())
# The home launcher adapter calls HomeWorld directly; use its shipped release tone.
events.append({'time':4.3,'args':[410,.15,'sine',.045,.4]})
for e in events:
    if not 0<=e['time']<26:
        continue
    params=[300,.09,'sine',.06,.5]
    params[:len(e['args'])]=e['args']
    freq,duration,kind,volume,slide=params
    n=round(duration*SR)
    t=np.arange(n)/SR
    k=np.log(max(20,freq*slide)/freq)/duration
    phase=2*np.pi*freq*(np.expm1(k*t)/k if abs(k)>1e-12 else t)
    if kind=='triangle':
        osc=(8/np.pi**2)*sum((-1)**((h-1)//2)*np.sin(h*phase)/h**2 for h in range(1,20,2))
    else:
        osc=np.sin(phase)
    envelope=np.where(t<.003,volume*t/.003,volume*np.exp(np.log(.0001/volume)*(t-.003)/(duration-.003)))
    signal=osc*envelope*1.5
    start=round(e['time']*SR)
    length=min(n,len(mix)-start)
    mix[start:start+length]+=signal[:length]
with wave.open(str(OUT/'effects.wav'),'wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR)
    f.writeframes(np.repeat(np.clip(mix,-1,1)[:,None],2,axis=1).__mul__(32767).astype('<i2').tobytes())
target=OUT/'qiuqiule-intro-v2.2.6-1080x1920.mp4'
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','warning',
    '-i',str(OUT/'silent.mp4'),'-i',str(ROOT/'dist/audio/light-bounce.mp3'),'-i',str(OUT/'effects.wav'),
    '-filter_complex','[1:a]atrim=0:32,asetpts=PTS-STARTPTS,volume=1.1,afade=t=in:d=0.35,afade=t=out:st=30.3:d=1.7[b];[b][2:a]amix=inputs=2:normalize=0,alimiter=limit=0.89:level=false[a]',
    '-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t','32','-movflags','+faststart',
    '-metadata','title=球球了 · 游戏介绍','-metadata','comment=Real gameplay from v2.2.6; original game music and sound effects.',str(target)],check=True)
print(target)
