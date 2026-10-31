import {chromium} from 'playwright';
import QRCode from 'qrcode';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateFixtures} from './fixtures.mjs';

const out=resolve('trailer-output'),root=resolve('.trailer-render');
await mkdir(out,{recursive:true});await mkdir(root,{recursive:true});await cp('dist',root+'/game',{recursive:true});
const original=await readFile('dist/game.js','utf8'),adapter=await readFile('trailer/director.js','utf8');
await writeFile(root+'/game/game.js',original.replace('type:Phaser.AUTO','type:Phaser.CANVAS')+'\n'+adapter);
await cp('trailer/frame.html',root+'/index.html');
await writeFile(root+'/qr.svg',await QRCode.toString('https://marchosias142857.github.io/qiuqiule/',{type:'svg',errorCorrectionLevel:'M',margin:4,color:{dark:'#252720',light:'#fbfbf6'}}));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+'/'))throw Error('path');res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(8899,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:540,height:960},deviceScaleFactor:2,serviceWorkers:'block'});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto('http://127.0.0.1:8899');await page.waitForFunction(()=>document.querySelector('iframe').contentWindow.trailer?.ready());
await page.evaluate(async()=>{await document.fonts.ready;await document.querySelector('iframe').contentDocument.fonts.ready;document.querySelector('iframe').contentWindow.trailer.init();});
const fixture=generateFixtures();
await writeFile(out+'/fixture.json',JSON.stringify({seed:fixture.seed,startFrame:fixture.startFrame,upgradeFrame:fixture.upgradeFrame,score:fixture.score}));
const ff=spawn('ffmpeg',['-y','-loglevel','warning','-f','image2pipe','-framerate','30','-vcodec','mjpeg','-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',out+'/silent.mp4'],{stdio:['pipe','inherit','inherit']});
const samples=new Set([0,2,3.8,5.3,7,9,12,13.5,15,16.5,18,20.5,22,23.8,25.3,27,30].map(t=>Math.round(t*30)));
const history=[];
for(let i=0;i<960;i++){
  const t=i/30;
  const state=await page.evaluate(({i,t,fixture})=>{
    const d=document.querySelector('iframe').contentWindow.trailer;
    if(i>=90&&i<129)d.homeDrag(Math.min(1,(i-90)/25));
    if(i===129)d.homeRelease();
    if(i===210)d.restore(fixture.battle);
    if(i===459)d.select();
    if(i===570)d.settings();
    if(i===591)d.openSettings();
    if(i===630)d.theme('night');
    if(i===690)d.theme('pool');
    if(i===744){d.theme('classic');d.close();}
    const state=d.step(i*1000/30,1000/30);window.compose(t,state);return state;
  },{i,t,fixture:i===210?fixture:null});
  if(i%15===0)history.push({t,...state});
  const buffer=await page.screenshot({type:'jpeg',quality:96});
  if(!ff.stdin.write(buffer))await once(ff.stdin,'drain');
  if(samples.has(i))await writeFile(out+`/frame-${String(i).padStart(4,'0')}.jpg`,buffer);
  if(i%90===0)console.log(`Rendered ${i}/960`,JSON.stringify(state));
}
ff.stdin.end();const [code]=await once(ff,'close');if(code!==0)throw Error('ffmpeg failed '+code);
await writeFile(out+'/sounds.json',JSON.stringify(await page.evaluate(()=>document.querySelector('iframe').contentWindow.trailer.sounds())));
await writeFile(out+'/history.json',JSON.stringify(history,null,2));
await writeFile(out+'/errors.json',JSON.stringify(errors));
await browser.close();server.close();
if(errors.length)throw Error(errors.join('\n'));
if(!history.some(s=>s.phase==='choose')||!history.some(s=>s.energy>1))throw Error('Upgrade segment did not complete');
console.log('Rendered real gameplay, choice, energy upgrade and three palettes.');
