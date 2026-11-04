import {AIM_HOLD_SECONDS,AIM_CALIBRATED_HOLD_SECONDS,AIM_RECOVERY_SECONDS} from './aim.js';

export const AIM_METRICS_VERSION=1;
export const AIM_SAMPLE_LIMIT=60;
export const AIM_CALIBRATION_SAMPLES=20;
export const AIM_MEDIAN_THRESHOLD=.9;

function savedObject(raw){
  if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{return {};}}
  return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
}

function validSeconds(value){
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=AIM_HOLD_SECONDS+AIM_RECOVERY_SECONDS+1e-9;
}

// Only bounded timing samples are stored. No dates, identity or network calls.
export function normalizeAimMetrics(raw){
  const saved=savedObject(raw);
  const samples=(Array.isArray(saved.samples)?saved.samples.slice(-AIM_SAMPLE_LIMIT):[])
    .filter(validSeconds).map(value=>Math.round(value*1e6)/1e6);
  const count=typeof saved.completedCount==='number'&&Number.isFinite(saved.completedCount)
    ?Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.floor(saved.completedCount))):0;
  return {version:AIM_METRICS_VERSION,completedCount:Math.max(count,samples.length),samples};
}

export function recordAimDuration(raw,seconds){
  const state=normalizeAimMetrics(raw);
  if(!validSeconds(seconds))return state;
  return normalizeAimMetrics({...state,completedCount:Math.min(Number.MAX_SAFE_INTEGER,state.completedCount+1),samples:[...state.samples,seconds]});
}

export function aimMetricsReport(raw){
  const state=normalizeAimMetrics(raw),ordered=[...state.samples].sort((a,b)=>a-b),count=ordered.length;
  const medianSeconds=count?(ordered[Math.floor((count-1)/2)]+ordered[Math.floor(count/2)])/2:null;
  const calibrated=count>=AIM_CALIBRATION_SAMPLES&&medianSeconds>AIM_MEDIAN_THRESHOLD;
  return {...state,sampleCount:count,medianSeconds,minimumSamples:AIM_CALIBRATION_SAMPLES,sampleLimit:AIM_SAMPLE_LIMIT,
    medianThreshold:AIM_MEDIAN_THRESHOLD,nextHoldSeconds:calibrated?AIM_CALIBRATED_HOLD_SECONDS:AIM_HOLD_SECONDS,recoverySeconds:AIM_RECOVERY_SECONDS};
}

export const aimHoldDuration=raw=>aimMetricsReport(raw).nextHoldSeconds;
