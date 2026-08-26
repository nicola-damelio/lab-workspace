import React, {useState, useEffect, useRef} from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import TestShellRenderer, { CollapsibleSection } from './TestShellRenderer';
import { NMR_FITTING_TAB_CONFIG } from './tabConfigs';
import { PALETTE, toHex, errBarPlugin } from '../data/constants';
import { NMRInstrumentalSetup } from './NMRInstrumentalSetup';
import {ChartControlBar, SharedChartStylePanel} from './SharedAnalysisTools';
import ST_DOSY_HTML from './stejskalTanner.html?raw';
const DIPOLAR_SIM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dipolar_CSA_S2 — rebuilt UI</title>
<style>
 :root{--bg:#ffffff;--panel:#f8fafc;--line:#cbd5e1;--ink:#0f172a;--muted:#475569;}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "Segoe UI",Roboto,Arial,sans-serif}
 header{background:linear-gradient(90deg,#1e3a8a,#0e7490);padding:14px 22px;color:#fff}
 header b{font-size:20px}
 header small{display:block;color:#c7e6f7;font-size:14px}
 .layout{display:flex;gap:14px;padding:14px;align-items:flex-start;flex-wrap:wrap}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
 aside.card{flex:0 0 352px;width:352px}
 main.card{flex:1 1 680px;min-width:620px}
 h2{font-size:15px;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted);margin:0 0 10px}
 h3{font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#0369a1;margin:18px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
 .ctl{display:flex;flex-direction:column;gap:4px;font-size:15px;margin:10px 0}
 .ctl .row{display:flex;justify-content:space-between;gap:6px;align-items:baseline}
 .ctl b{color:#0284c7;font-size:16px;font-variant-numeric:tabular-nums;text-align:right}
 .hint{color:#64748b;font-size:12.5px;font-weight:400}
 input[type=range]{width:100%;accent-color:#0284c7;height:22px}
 input[type=text]{background:#fff;color:var(--ink);border:1px solid #94a3b8;border-radius:6px;padding:5px 8px;font-size:14px;width:96px}
 select{background:#fff;color:var(--ink);border:1px solid #94a3b8;border-radius:6px;padding:6px 8px;font-size:14px;width:100%}
 label.inline{font-size:14px;display:flex;gap:6px;align-items:center}
 .modeselect{display:flex;flex-direction:column;gap:8px;margin-bottom:8px}
 .modeselect button{width:100%;text-align:left;font-size:15px}
 button{background:#f1f5f9;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px 14px;cursor:pointer;font-size:15px}
 button:hover{background:#e2e8f0}
 button.active{background:#0284c7;border-color:#0284c7;color:#fff}
 button.ghost{background:transparent}
 .hydout{font-size:14px;background:#eef2f7;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-top:10px}
 .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
 .badge{margin-left:auto;font-size:14px;background:#eef2f7;border:1px solid var(--line);border-radius:999px;padding:5px 14px;color:#0369a1;font-weight:700}
 canvas{width:100%;height:auto;background:#fff;border:1px solid var(--line);border-radius:10px}
 .checks{display:flex;gap:18px;margin:12px 2px;flex-wrap:wrap;font-size:16px}
 .checks label{display:flex;gap:7px;align-items:center;cursor:pointer}
 .checks input{width:18px;height:18px;accent-color:#0284c7}
 .dot{width:12px;height:12px;border-radius:50%;display:inline-block}
 .readout{display:flex;gap:9px;flex-wrap:wrap;margin-top:10px}
 .stat{background:#eef2f7;border:1px solid var(--line);border-radius:8px;padding:8px 11px;min-width:100px}
 .stat .k{font-size:13px;color:var(--muted)}
 .stat .v{font-size:18px;font-variant-numeric:tabular-nums}
 .eqbar{margin:0 14px 14px}
 .eqgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}
 .eq{background:#eef2f7;border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:15px}
 .eq .tag{color:var(--muted);font-size:12px;display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
 .eq .note{color:var(--muted);font-size:13px;margin-top:5px}
 sub,sup{font-size:.7em}
 .presets{display:flex;gap:6px;margin-top:6px}
</style>
</head>
<body>
<header>
 <b>Dipolar + CSA relaxation, model-free S&sup2; &mdash; X (&sup1;&sup3;C/&sup1;&sup5;N) and &sup1;H modes</b>
 <small>Rebuilt from dipolar_CSA_S2.xls &middot; rates on a log scale so the R&#8321; maximum is visible &middot; large fonts</small>
</header>

<div class="layout">
<aside class="card">
 <h2>Parameters</h2>
 <div class="modeselect">
   <button id="mX" class="active"><b>Observed: X nucleus</b> &mdash; relaxed by &sup1;H (shows R&#8321; maximum)</button>
   <button id="mH"><b>Observed: &sup1;H</b> &mdash; relaxed by &sup1;H (homonuclear)</button>
 </div>

 <h3>Spin system &amp; field</h3>
 <div class="ctl" id="rowNuc"><div class="row"><span>X nucleus &gamma;<sub>X</sub></span></div>
   <select id="selNuc">
     <option value="C13" selected>&sup1;&sup3;C (+6.728&times;10&#8311; rad/s/T)</option>
     <option value="N15">&sup1;&sup5;N (&minus;2.713&times;10&#8312; rad/s/T)</option>
     <option value="custom">custom &gamma;</option>
   </select>
   <div class="row" id="gWrap" style="display:none;margin-top:6px"><span>custom &gamma;<sub>X</sub></span><input type="text" id="sGx" value="6.73e7"></div>
 </div>
 <div class="ctl" id="rowRXH"><div class="row"><span>r(X&ndash;H) <span class="hint">0.9 &ndash; 2.5 &Aring;, sheet 1.10</span></span><b id="vRXH"></b></div>
   <input type="range" id="sRXH" min="0.9" max="2.5" step="0.005" value="1.10"></div>
 <div class="ctl" id="rowHH" style="display:none"><div class="row"><span>r(H&ndash;H) <span class="hint">1.0 &ndash; 4.0 &Aring;</span></span><b id="vRHH"></b></div>
   <input type="range" id="sRHH" min="1.0" max="4.0" step="0.01" value="1.75"></div>
 <div class="ctl" id="rowDWHH" style="display:none"><div class="row"><span>&Delta;&omega;(&sup1;H&ndash;&sup1;H) shift diff. <span class="hint">0 &ndash; 10 ppm</span></span><b id="vDWppm"></b></div>
   <input type="range" id="sDWppm" min="0" max="10" step="0.1" value="1.0"></div>
 <div class="ctl"><div class="row"><span>B&#8320; <span class="hint">0.5 &ndash; 28.2 T</span></span><b id="vB0"></b></div>
   <input type="range" id="sB0" min="0.5" max="28.2" step="0.1" value="14.1"></div>
 <div class="ctl"><div class="row"><span>CSA &Delta;&sigma; <span class="hint">&minus;300 &ndash; 300 ppm, sheet 0</span></span><b id="vCSA"></b></div>
   <input type="range" id="sCSA" min="-300" max="300" step="1" value="0"></div>

 <h3>Model-free dynamics</h3>
 <div class="ctl"><div class="row"><span>Order parameter S&sup2; <span class="hint">0.01 &ndash; 1, sheet 0.5</span></span><b id="vS2"></b></div>
   <input type="range" id="sS2" min="0.01" max="1" step="0.01" value="0.5"></div>
 <div class="ctl"><div class="row"><span>Internal time &tau;<sub>e</sub> <span class="hint">0 &ndash; 2000 ps</span></span><b id="vTauE"></b></div>
   <input type="range" id="sTauE" min="0" max="2000" step="5" value="50"></div>
 <div class="ctl"><div class="row"><span>Overall &tau;<sub>m</sub> <span class="hint">0.01 ns &ndash; 10 &micro;s, sheet 0.247 ns</span></span><b id="vTauM"></b></div>
   <input type="range" id="sTauM" min="-2" max="4" step="0.01" value="-0.607">
   <div class="presets">
     <button class="ghost" id="pT1">0.25 ns</button><button class="ghost" id="pT2">0.85 ns</button><button class="ghost" id="pT3">5 ns</button><button class="ghost" id="bReset">Reset</button>
   </div></div>

 <h3>Chemical exchange</h3>
 <div class="ctl"><div class="row"><span>Minor population p<sub>B</sub> <span class="hint">0 &ndash; 0.5</span></span><b id="vPB"></b></div>
   <input type="range" id="sPB" min="0" max="0.5" step="0.005" value="0.5"></div>
 <div class="ctl"><div class="row"><span>Exchange &Delta;&omega; <span class="hint">0 &ndash; 20 ppm</span></span><b id="vDW"></b></div>
   <input type="range" id="sDW" min="0" max="20" step="0.1" value="0"></div>
 <div class="ctl"><div class="row"><span>&tau;<sub>ex</sub> <span class="hint">0 &ndash; 100 &micro;s, sheet 1 &micro;s</span></span><b id="vTex"></b></div>
   <input type="range" id="sTex" min="0" max="100" step="0.5" value="1"></div>
 <div class="ctl"><div class="row"><span>Extra R<sub>ex</sub> <span class="hint">0 &ndash; 50 s&#8315;&sup1;</span></span><b id="vRex"></b></div>
   <input type="range" id="sRex" min="0" max="50" step="0.5" value="0"></div>

 <h3>Hydrodynamics (D &rarr; MW, &tau;<sub>D</sub>)</h3>
 <div class="ctl"><div class="row"><span>D<sub>meas</sub> <span class="hint">10&#8315;&sup1;&sup2; &ndash; 10&#8315;&#8312;&#8330;&#8330; m&sup2;/s</span></span><b id="vD"></b></div>
   <input type="range" id="hD" min="-12" max="-8.5" step="0.005" value="-9.886"></div>
 <div class="ctl"><div class="row"><span>T <span class="hint">270 &ndash; 320 K</span></span><b id="vT"></b></div>
   <input type="range" id="hT" min="270" max="320" step="0.2" value="278.8"></div>
 <div class="ctl"><div class="row"><span>&eta; <span class="hint">0.3 &ndash; 5 &times;10&#8315;&sup3; Pa&middot;s</span></span><b id="vEta"></b></div>
   <input type="range" id="hEta" min="0.3" max="5" step="0.01" value="1.53">
   <label class="inline"><input type="checkbox" id="hAuto"> auto &eta;(T)</label></div>
 <div class="ctl"><div class="row"><span>Hydration n <span class="hint">0 &ndash; 1, sheet 0.4</span></span><b id="vN"></b></div>
   <input type="range" id="hN" min="0" max="1" step="0.05" value="0.4"></div>
 <div class="ctl"><div class="row"><span>&#772;v protein <span class="hint">0.5 &ndash; 1 cm&sup3;/g</span></span><b id="vSv"></b></div>
   <input type="range" id="hSv" min="0.5" max="1" step="0.01" value="0.73"></div>
 <div class="ctl"><div class="row"><span>&#772;v<sub>w</sub> water <span class="hint">0.8 &ndash; 1.2 cm&sup3;/g</span></span><b id="vSvW"></b></div>
   <input type="range" id="hSvW" min="0.8" max="1.2" step="0.01" value="1.0"></div>
 <div class="ctl"><div class="row"><span>Friction factor F <span class="hint">1 &ndash; 2</span></span><b id="vF"></b></div>
   <input type="range" id="hF" min="1" max="2" step="0.01" value="1"></div>
 <div class="hydout" id="hydroOut"></div>
 <div style="margin-top:8px"><button class="ghost" id="hUse">use &tau;<sub>D</sub> as &tau;<sub>m</sub></button></div>
</aside>

<main class="card">
 <div class="toolbar">
   <button id="bRates" class="active">R&#8321;, R&#8322;, NOE vs &tau;<sub>c</sub></button>
   <button id="bT1">T&#8321; = 1/R&#8321;</button>
   <button id="bComp">dip vs CSA</button>
   <button id="bRatio">R&#8321;/R&#8322;</button>
   <button id="bS2s">S&sup2; sweep</button>
   <button id="bJ">J(&omega;)</button>
   <button id="bField">Field</button>
   <button id="bMW">MW vs D</button>
   <span class="badge" id="modeBadge">observed: X</span>
 </div>
 <canvas id="chart" width="1000" height="560"></canvas>
 <div class="checks">
   <label><span class="dot" style="background:#0284c7"></span><input type="checkbox" id="cR1" checked>R&#8321;</label>
   <label><span class="dot" style="background:#db2777"></span><input type="checkbox" id="cR2" checked>R&#8322;</label>
   <label><span class="dot" style="background:#16a34a"></span><input type="checkbox" id="cNOE" checked>NOE</label>
 </div>
 <div class="readout" id="readout"></div>
</main>
</div>

<section class="card eqbar">
 <h2>Equations</h2>
 <div class="eqgrid">
   <div class="eq"><span class="tag">Model-free spectral density</span>
     J(&omega;) = (2/5)&middot;[ S&sup2;&middot;&tau;<sub>m</sub>/(1+(&omega;&tau;<sub>m</sub>)&sup2;) + (1&minus;S&sup2;)&middot;&tau;/(1+(&omega;&tau;)&sup2;) ],
     &tau;<sup>&minus;1</sup> = &tau;<sub>m</sub><sup>&minus;1</sup> + &tau;<sub>e</sub><sup>&minus;1</sup></div>
   <div class="eq"><span class="tag">Couplings</span>
     d = (&mu;&#8320;/4&pi;)&middot;&gamma;<sub>o</sub>&gamma;<sub>p</sub>&#295;/r&sup3;, &nbsp; c = &omega;<sub>o</sub>&middot;&Delta;&sigma;/&radic;3
     <span class="note">o = observed, p = relaxing partner (&sup1;H)</span></div>
   <div class="eq"><span class="tag">Rates</span>
     R&#8321; = (d&sup2;/4)[J(&omega;<sub>p</sub>&minus;&omega;<sub>o</sub>) + 3J(&omega;<sub>o</sub>) + 6J(&omega;<sub>p</sub>+&omega;<sub>o</sub>)] + c&sup2;J(&omega;<sub>o</sub>)<br>
     R&#8322; = (d&sup2;/8)[4J(0) + J(&omega;<sub>p</sub>&minus;&omega;<sub>o</sub>) + 3J(&omega;<sub>o</sub>) + 6J(&omega;<sub>p</sub>) + 6J(&omega;<sub>p</sub>+&omega;<sub>o</sub>)] + (c&sup2;/6)[4J(0) + 3J(&omega;<sub>o</sub>)] + R<sub>ex</sub></div>
   <div class="eq"><span class="tag">NOE (ratio form)</span>
     NOE = 1 + (&gamma;<sub>p</sub>/&gamma;<sub>o</sub>)&middot;(d&sup2;/4)[6J(&omega;<sub>p</sub>+&omega;<sub>o</sub>) &minus; J(&omega;<sub>p</sub>&minus;&omega;<sub>o</sub>)]/R&#8321;</div>
   <div class="eq"><span class="tag">Shape of the R&#8321;(&tau;<sub>c</sub>) curve</span>
     Heteronuclear: R&#8321; peaks near <b>&tau;<sub>c</sub> &asymp; 1/&omega;<sub>X</sub></b> (&asymp;1 ns for &sup1;&sup3;C at 600 MHz; &asymp;2.6 ns for &sup1;&sup5;N), then falls &prop; 1/&tau;<sub>c</sub>.
     With S&sup2; &lt; 1, &tau;<sub>e</sub> leaves a plateau at long &tau;<sub>c</sub>; set S&sup2; = 1 to see R&#8321; &rarr; 0.
     <span class="note">Homonuclear &sup1;H&ndash;&sup1;H: the zero-quantum J(0) term makes R&#8321; keep rising with &tau;<sub>c</sub> (no maximum) &mdash; the classic BPP minimum applies to heteronuclear relaxation or exactly equivalent spins.</span></div>
   <div class="eq"><span class="tag">Exchange &amp; hydrodynamics</span>
     R<sub>ex</sub> = p<sub>A</sub>p<sub>B</sub>&Delta;&omega;&sup2;&tau;<sub>ex</sub>; &nbsp; r<sub>h</sub> = kT/(6&pi;&eta;D&middot;F); &nbsp; MW = (4&pi;/3)r<sub>h</sub>&sup3;N<sub>A</sub>/(&#772;v + n&#772;v<sub>w</sub>); &nbsp; &tau;<sub>D</sub> = 4&pi;&eta;r<sub>h</sub>&sup3;/(3kT)</div>
 </div>
</section>

<script>
"use strict";
const GAMMA_H=2.6752218744e8, HBAR=1.054571817e-34, MU04PI=1e-7, KB=1.380649e-23, NA=6.02214076e23;
let GAMMA_X=6.7283e7, obsMode='X', mode='rates';
const $=id=>document.getElementById(id);
const chk=id=>$(id).checked;

function Jof(w,tm,S2,te){
  const tau=te>0?tm*te/(tm+te):0;
  return 0.4*(S2*tm/(1+(w*tm)*(w*tm))+(te>0?(1-S2)*tau/(1+(w*tau)*(w*tau)):0));
}
function etaOfT(T){return 2.414e-5*Math.pow(10,247.8/(T-140));}
function state(){
  const T=+$('hT').value;
  return {B0:+$('sB0').value,dppm:+$('sCSA').value,
    rXH:+$('sRXH').value*1e-10,rHH:+$('sRHH').value*1e-10,dOmppm:+$('sDWppm').value,
    S2:+$('sS2').value,te:+$('sTauE').value*1e-12,tm:Math.pow(10,+$('sTauM').value)*1e-9,
    pB:+$('sPB').value,dw:+$('sDW').value,tex:+$('sTex').value*1e-6,Rex0:+$('sRex').value,
    D:Math.pow(10,+$('hD').value),T,eta:$('hAuto').checked?etaOfT(T):+$('hEta').value*1e-3,
    n:+$('hN').value,sv:+$('hSv').value*1e-6,svw:+$('hSvW').value*1e-6,F:+$('hF').value};
}
function getSpins(s){
  return obsMode==='X' ? {go:GAMMA_X,gp:GAMMA_H,r:s.rXH}
                       : {go:GAMMA_H,gp:GAMMA_H,r:s.rHH};
}
function totals(s,tm,S2){
  const sp=getSpins(s);
  const wo=Math.abs(sp.go)*s.B0, wp=Math.abs(sp.gp)*s.B0;
  const d=MU04PI*Math.abs(sp.go)*Math.abs(sp.gp)*HBAR/Math.pow(sp.r,3);
  const c=wo*s.dppm*1e-6/Math.sqrt(3);
  const d2=d*d,c2=c*c,J=w=>Jof(w,tm,S2,s.te);
  const wd=obsMode==='X'?Math.abs(wp-wo):s.dOmppm*1e-6*GAMMA_H*s.B0;
  const R1d=(d2/4)*(J(wd)+3*J(wo)+6*J(wp+wo));
  const R2d=(d2/8)*(4*J(0)+J(wd)+3*J(wo)+6*J(wp)+6*J(wp+wo));
  const R1c=c2*J(wo), R2c=(c2/6)*(4*J(0)+3*J(wo));
  const pA=1-s.pB, dwx=s.dw*1e-6*Math.abs(sp.go)*s.B0;
  const Rex=s.Rex0+pA*s.pB*dwx*dwx*s.tex;
  const R1=R1d+R1c, R2=R2d+R2c+Rex;
  const NOE=1+(sp.gp/sp.go)*((d2/4)*(6*J(wp+wo)-J(wd)))/Math.max(R1,1e-30);
  return {R1d,R2d,R1c,R2c,R1,R2,Rex,NOE};
}
function hydro(s,D){
  const rh=KB*s.T/(6*Math.PI*s.eta*D*s.F);
  return {rh,MW:(4/3)*Math.PI*Math.pow(rh,3)*NA/(s.sv+s.n*s.svw),tauD:4*Math.PI*s.eta*Math.pow(rh,3)/(3*KB*s.T)};
}

/* ---------- chart ---------- */
const cv=document.getElementById('chart'), ctx=cv.getContext('2d');
const SUP={'-':'\u207b','0':'\u2070','1':'\u00b9','2':'\u00b2','3':'\u00b3','4':'\u2074','5':'\u2075','6':'\u2076','7':'\u2077','8':'\u2078','9':'\u2079'};
const p10=e=>'10'+String(e).split('').map(c=>SUP[c]||c).join('');
function sci(v,d){d=d||2;if(!isFinite(v))return'\u2013';if(v===0)return'0';
  const e=Math.floor(Math.log10(Math.abs(v)));return (v/Math.pow(10,e)).toFixed(d)+'\u00d7'+p10(e);}
function trim(v){return Math.abs(v)>=1000?v.toFixed(0):String(+v.toPrecision(3));}
function logTicks(a,b){const t=[];for(let e=Math.ceil(Math.log10(a)-1e-9);e<=Math.floor(Math.log10(b)+1e-9);e++)t.push(Math.pow(10,e));return t;}
function linTicks(a,b,n){n=n||6;const s0=(b-a)/n,m=Math.pow(10,Math.floor(Math.log10(s0))),f=s0/m,
  st=(f<1.5?1:f<3?2:f<7?5:10)*m,t=[];for(let v=Math.ceil(a/st)*st;v<=b+st*1e-6;v+=st)t.push(v);return t;}
function rangeOf(arr,log){
  let mn=Infinity,mx=-Infinity;
  for(const v of arr){if(!isFinite(v)||(log&&v<=0))continue;if(v<mn)mn=v;if(v>mx)mx=v;}
  if(mn===Infinity){mn=log?1e-12:0;mx=log?1:1;}
  if(mn===mx){mn*=0.5;mx*=1.5;if(mn===mx){mn-=1;mx+=1;}}
  if(log){const f=Math.pow(10,0.08);return[mn/f,mx*f];}
  const p=(mx-mn)*0.08;return[mn-p,mx+p];
}
function drawPlot(o){
  const W=cv.width,H=cv.height,ML=96,MT=26,MB=66,MR=o.hasR?96:32,pw=W-ML-MR,ph=H-MT-MB;
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#ffffff';ctx.fillRect(ML,MT,pw,ph);
  const xa=Math.log10(o.xmin),xb=Math.log10(o.xmax);
  const X=v=>ML+(o.xlog?(Math.log10(v)-xa)/(xb-xa):(v-o.xmin)/(o.xmax-o.xmin))*pw;
  const Y={};
  for(const ax of['L','R']){if(ax==='R'&&!o.hasR)continue;const sc=o[ax];
    if(sc.log){const a=Math.log10(sc.min),b=Math.log10(sc.max);Y[ax]=v=>MT+ph-(Math.log10(v)-a)/(b-a)*ph;}
    else Y[ax]=v=>MT+ph-(v-sc.min)/(sc.max-sc.min)*ph;}
  ctx.font='14px "Segoe UI"';
  const xt=o.xlog?logTicks(o.xmin,o.xmax):linTicks(o.xmin,o.xmax,8);
  ctx.textAlign='center';ctx.textBaseline='top';
  for(const t of xt){const px=X(t);if(px<ML-1||px>ML+pw+1)continue;
    ctx.strokeStyle='#e2e8f0';ctx.beginPath();ctx.moveTo(px,MT);ctx.lineTo(px,MT+ph);ctx.stroke();
    ctx.fillStyle='#334155';ctx.fillText(o.xfmt?o.xfmt(t):trim(t),px,MT+ph+8);}
  const yl=o.L.log?logTicks(o.L.min,o.L.max):linTicks(o.L.min,o.L.max,6);
  ctx.textAlign='right';ctx.textBaseline='middle';
  for(const t of yl){const py=Y.L(t);if(py<MT-1||py>MT+ph+1)continue;
    ctx.strokeStyle='#e2e8f0';ctx.beginPath();ctx.moveTo(ML,py);ctx.lineTo(ML+pw,py);ctx.stroke();
    ctx.fillStyle='#334155';ctx.fillText(o.Lfmt?o.Lfmt(t):trim(t),ML-9,py);}
  if(o.hasR){const yr=o.R.log?logTicks(o.R.min,o.R.max):linTicks(o.R.min,o.R.max,6);
    ctx.textAlign='left';
    for(const t of yr){const py=Y.R(t);if(py<MT-1||py>MT+ph+1)continue;
      ctx.fillStyle='#334155';ctx.fillText(o.Rfmt?o.Rfmt(t):trim(t),ML+pw+9,py);}}
  ctx.fillStyle='#0f172a';ctx.font='17px "Segoe UI"';ctx.textAlign='center';ctx.textBaseline='alphabetic';
  ctx.fillText(o.xlabel,ML+pw/2,H-16);
  ctx.save();ctx.translate(26,MT+ph/2);ctx.rotate(-Math.PI/2);ctx.fillText(o.Llabel,0,0);ctx.restore();
  if(o.hasR){ctx.save();ctx.translate(W-20,MT+ph/2);ctx.rotate(Math.PI/2);ctx.fillText(o.Rlabel,0,0);ctx.restore();}
  ctx.save();ctx.beginPath();ctx.rect(ML,MT,pw,ph);ctx.clip();
  for(const s of o.series){
    const Yf=s.axis==='R'?Y.R:Y.L, Ls=s.axis==='R'?o.R:o.L;
    ctx.strokeStyle=s.color;ctx.lineWidth=s.w||2.4;ctx.setLineDash(s.dash||[]);
    ctx.beginPath();let st=false;
    for(let i=0;i<s.x.length;i++){const xv=s.x[i],yv=s.y[i];
      if(!isFinite(yv)||(Ls.log&&yv<=0)){st=false;continue;}
      const px=X(xv),py=Yf(yv);
      if(st)ctx.lineTo(px,py);else{ctx.moveTo(px,py);st=true;}}
    ctx.stroke();ctx.setLineDash([]);
  }
  if(o.marker){const px=X(o.marker.x);
    ctx.strokeStyle='rgba(15,23,42,.4)';ctx.setLineDash([6,5]);
    ctx.beginPath();ctx.moveTo(px,MT);ctx.lineTo(px,MT+ph);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#0f172a';ctx.font='14px "Segoe UI"';ctx.textAlign='left';ctx.textBaseline='top';
    ctx.fillText(o.marker.label,px+7,MT+7);}
  if(o.point){const px=X(o.point.x),py=Y[o.point.axis||'L'](o.point.y);
    ctx.fillStyle='#dc2626';ctx.beginPath();ctx.arc(px,py,6,0,2*Math.PI);ctx.fill();
    ctx.font='bold 14px "Segoe UI"';ctx.textAlign='left';ctx.textBaseline='bottom';
    ctx.fillText(o.point.label,px+10,py-8);}
  ctx.restore();
  ctx.strokeStyle='#64748b';ctx.strokeRect(ML,MT,pw,ph);
  ctx.font='15px "Segoe UI"';ctx.textAlign='left';ctx.textBaseline='middle';
  let ly=MT+22;
  for(const s of o.series){
    ctx.strokeStyle=s.color;ctx.lineWidth=2.6;ctx.setLineDash(s.dash||[]);
    ctx.beginPath();ctx.moveTo(ML+14,ly);ctx.lineTo(ML+42,ly);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#0f172a';ctx.fillText(s.label,ML+50,ly);ly+=22;}
}
function logspace(a,b,n){const o=[];for(let i=0;i<n;i++)o.push(Math.pow(10,a+(b-a)*i/(n-1)));return o;}

/* ---------- plot modes ---------- */
function plotRates(s){
  const xs=logspace(-11,-5,320),R1=[],R2=[],N=[];
  for(const t of xs){const r=totals(s,t,s.S2);R1.push(r.R1);R2.push(r.R2);N.push(r.NOE);}
  let im=0;for(let i=1;i<R1.length;i++)if(R1[i]>R1[im])im=i;
  const ser=[];
  if(chk('cR1'))ser.push({x:xs,y:R1,color:'#0284c7',label:'R\u2081 (s\u207b\u00b9)',axis:'L'});
  if(chk('cR2'))ser.push({x:xs,y:R2,color:'#db2777',label:'R\u2082 (s\u207b\u00b9)',axis:'L'});
  if(chk('cNOE'))ser.push({x:xs,y:N,color:'#16a34a',label:'NOE',axis:'R'});
  const Lv=[].concat(chk('cR1')?R1:[],chk('cR2')?R2:[]);
  const Lr=Lv.length?rangeOf(Lv,true):[0.01,10];
  const Rr=chk('cNOE')?rangeOf(N,false):[0,1];
  drawPlot({series:ser,xlog:true,xmin:1e-11,xmax:1e-5,xfmt:v=>p10(Math.round(Math.log10(v))),
    L:{min:Lr[0],max:Lr[1],log:true},Lfmt:v=>p10(Math.round(Math.log10(v))),Llabel:'rate (s\u207b\u00b9)',
    hasR:chk('cNOE'),R:{min:Rr[0],max:Rr[1]},Rlabel:'NOE',
    xlabel:'correlation time \u03c4_c (s) \u2014 log scale',
    marker:{x:s.tm,label:'\u03c4_m = '+sci(s.tm)+' s'},
    point:(chk('cR1')&&im>0&&im<R1.length-1)?{x:xs[im],y:R1[im],axis:'L',label:'R\u2081 max \u2248 '+sci(xs[im],1)+' s'}:null});
}
function plotT1(s){
  const xs=logspace(-11,-5,320),T1=[];
  for(const t of xs){T1.push(1/totals(s,t,s.S2).R1);}
  let im=0;for(let i=1;i<T1.length;i++)if(T1[i]<T1[im])im=i;
  const R=rangeOf(T1,true);
  drawPlot({series:[{x:xs,y:T1,color:'#7c3aed',label:'T\u2081 = 1/R\u2081 (s)',axis:'L'}],
    xlog:true,xmin:1e-11,xmax:1e-5,xfmt:v=>p10(Math.round(Math.log10(v))),
    L:{min:R[0],max:R[1],log:true},Lfmt:v=>p10(Math.round(Math.log10(v))),Llabel:'T\u2081 (s)',
    xlabel:'correlation time \u03c4_c (s)',
    marker:{x:s.tm,label:'\u03c4_m = '+sci(s.tm)+' s'},
    point:(im>0&&im<T1.length-1)?{x:xs[im],y:T1[im],axis:'L',label:'T\u2081 min \u2248 '+sci(xs[im],1)+' s'}:null});
}
function plotComp(s){
  const xs=logspace(-11,-5,320),A=[],B=[],C=[],D=[];
  for(const t of xs){const r=totals(s,t,s.S2);A.push(r.R1d);B.push(r.R2d);C.push(r.R1c);D.push(r.R2c);}
  const R=rangeOf(A.concat(B,C,D),true);
  drawPlot({series:[
    {x:xs,y:A,color:'#0284c7',label:'R\u2081 dipolar',axis:'L'},
    {x:xs,y:B,color:'#db2777',label:'R\u2082 dipolar',axis:'L'},
    {x:xs,y:C,color:'#d97706',label:'R\u2081 CSA (0 if \u0394\u03c3=0)',axis:'L',dash:[6,5]},
    {x:xs,y:D,color:'#ea580c',label:'R\u2082 CSA (0 if \u0394\u03c3=0)',axis:'L',dash:[6,5]}],
    xlog:true,xmin:1e-11,xmax:1e-5,xfmt:v=>p10(Math.round(Math.log10(v))),
    L:{min:R[0],max:R[1],log:true},Lfmt:v=>p10(Math.round(Math.log10(v))),Llabel:'rate (s\u207b\u00b9)',
    xlabel:'correlation time \u03c4_c (s)',marker:{x:s.tm,label:'\u03c4_m = '+sci(s.tm)+' s'}});
}
function plotRatio(s){
  const xs=logspace(-11,-5,320),T=[],D=[];
  for(const t of xs){const r=totals(s,t,s.S2);T.push(r.R1/r.R2);D.push(r.R1d/r.R2d);}
  const R=rangeOf(T.concat(D),false);
  drawPlot({series:[
    {x:xs,y:T,color:'#ca8a04',label:'R\u2081/R\u2082 total',axis:'L'},
    {x:xs,y:D,color:'#64748b',label:'R\u2081/R\u2082 dipolar (sheet column)',axis:'L',dash:[6,5]}],
    xlog:true,xmin:1e-11,xmax:1e-5,xfmt:v=>p10(Math.round(Math.log10(v))),
    L:{min:R[0],max:R[1]},Llabel:'R\u2081 / R\u2082',xlabel:'correlation time \u03c4_c (s)',
    marker:{x:s.tm,label:'\u03c4_m = '+sci(s.tm)+' s'}});
}
function plotS2s(s){
  const xs=[],R1=[],R2=[],N=[];
  for(let i=0;i<240;i++){const S=0.01+1.09*i/239;xs.push(S);
    const r=totals(s,s.tm,S);R1.push(r.R1);R2.push(r.R2);N.push(r.NOE);}
  const ser=[];
  if(chk('cR1'))ser.push({x:xs,y:R1,color:'#0284c7',label:'R\u2081(S\u00b2)',axis:'L'});
  if(chk('cR2'))ser.push({x:xs,y:R2,color:'#db2777',label:'R\u2082(S\u00b2)',axis:'L'});
  if(chk('cNOE'))ser.push({x:xs,y:N,color:'#16a34a',label:'NOE(S\u00b2)',axis:'R'});
  const Lv=[].concat(chk('cR1')?R1:[],chk('cR2')?R2:[]);
  const Lr=Lv.length?rangeOf(Lv,false):[0,1];
  const Rr=chk('cNOE')?rangeOf(N,false):[0,1];
  drawPlot({series:ser,xlog:false,xmin:0,xmax:1.1,
    L:{min:Lr[0],max:Lr[1]},Llabel:'rate (s\u207b\u00b9)',
    hasR:chk('cNOE'),R:{min:Rr[0],max:Rr[1]},Rlabel:'NOE',
    xlabel:'order parameter S\u00b2 (sheet grid 0.01\u20131.1)',
    marker:{x:s.S2,label:'S\u00b2 = '+s.S2.toFixed(2)}});
}
function plotJ(s){
  const nus=logspace(2,11,300),J1=[],J2=[];
  for(const nu of nus){const w=2*Math.PI*nu;J1.push(Jof(w,s.tm,s.S2,s.te));J2.push(Jof(w,s.tm,1,0));}
  const R=rangeOf(J1.concat(J2),true);
  drawPlot({series:[
    {x:nus,y:J1,color:'#9333ea',label:'J(\u03c9), S\u00b2='+s.S2.toFixed(2),axis:'L'},
    {x:nus,y:J2,color:'#64748b',label:'rigid (S\u00b2=1)',axis:'L',dash:[6,5]}],
    xlog:true,xmin:1e2,xmax:1e11,xfmt:v=>p10(Math.round(Math.log10(v))),
    L:{min:R[0],max:R[1],log:true},Lfmt:v=>p10(Math.round(Math.log10(v))),Llabel:'J(\u03c9) (s)',
    xlabel:'frequency \u03bd = \u03c9/2\u03c0 (Hz)'});
}
function plotField(s){
  const xs=[],R1=[],R2=[],N=[];
  for(let i=0;i<240;i++){const B=0.5+(28.2-0.5)*i/239;xs.push(B);
    const r=totals({...s,B0:B},s.tm,s.S2);R1.push(r.R1);R2.push(r.R2);N.push(r.NOE);}
  const ser=[];
  if(chk('cR1'))ser.push({x:xs,y:R1,color:'#0284c7',label:'R\u2081',axis:'L'});
  if(chk('cR2'))ser.push({x:xs,y:R2,color:'#db2777',label:'R\u2082',axis:'L'});
  if(chk('cNOE'))ser.push({x:xs,y:N,color:'#16a34a',label:'NOE',axis:'R'});
  const Lv=[].concat(chk('cR1')?R1:[],chk('cR2')?R2:[]);
  const Lr=Lv.length?rangeOf(Lv,false):[0,1];
  const Rr=chk('cNOE')?rangeOf(N,false):[0,1];
  drawPlot({series:ser,xlog:false,xmin:0.5,xmax:28.2,
    L:{min:Lr[0],max:Lr[1]},Llabel:'rate (s\u207b\u00b9)',
    hasR:chk('cNOE'),R:{min:Rr[0],max:Rr[1]},Rlabel:'NOE',
    xlabel:'B\u2080 (T) \u2014 \u03bd(\u00b9H) = 42.58\u00b7B\u2080 MHz',
    marker:{x:s.B0,label:'B\u2080 = '+s.B0.toFixed(1)+' T'}});
}
function plotMW(s){
  const xs=logspace(-12,-8,220),ys=[];
  for(const D of xs)ys.push(hydro(s,D).MW);
  const R=rangeOf(ys,true);
  drawPlot({series:[{x:xs,y:ys,color:'#0891b2',label:'apparent MW (Stokes\u2013Einstein)',axis:'L'}],
    xlog:true,xmin:1e-12,xmax:1e-8,xfmt:v=>p10(Math.round(Math.log10(v))),
    L:{min:R[0],max:R[1],log:true},Lfmt:v=>p10(Math.round(Math.log10(v))),Llabel:'MW (g/mol)',
    xlabel:'D (m\u00b2/s) \u2014 sheet scan D\u2192MW',
    marker:{x:s.D,label:'D_meas = '+sci(s.D)+' m\u00b2/s'}});
}

/* ---------- readout & labels ---------- */
function readout(s){
  const cur=totals(s,s.tm,s.S2), rig=totals(s,s.tm,1), sp=getSpins(s);
  const stats=[
    ['\u03bd(obs)',(Math.abs(sp.go)*s.B0/(2*Math.PI*1e6)).toFixed(1)+' MHz'],
    ['\u03bd(partner)',(Math.abs(sp.gp)*s.B0/(2*Math.PI*1e6)).toFixed(1)+' MHz'],
    ['R\u2081 dip\u00b7S\u00b2',cur.R1d.toFixed(2)],['R\u2082 dip\u00b7S\u00b2',cur.R2d.toFixed(2)],
    ['R\u2081 dip (S\u00b2=1)',rig.R1d.toFixed(2)],['R\u2082 dip (S\u00b2=1)',rig.R2d.toFixed(2)],
    ['R\u2081 CSA',cur.R1c.toFixed(2)],['R\u2082 CSA',cur.R2c.toFixed(2)],
    ['R\u2081 tot',cur.R1.toFixed(2)],['R\u2082 tot',cur.R2.toFixed(2)],
    ['R ex',cur.Rex.toFixed(2)],['R\u2081/R\u2082',(cur.R1/cur.R2).toFixed(3)],
    ['NOE',cur.NOE.toFixed(3)]];
  $('readout').innerHTML=stats.map(kv=>'<div class="stat"><div class="k">'+kv[0]+
    '</div><div class="v">'+kv[1]+'</div></div>').join('');
}
function labels(){
  const s=state(), tmNs=Math.pow(10,+$('sTauM').value);
  $('vB0').textContent=s.B0.toFixed(1)+' T ('+(GAMMA_H*s.B0/(2*Math.PI*1e6)).toFixed(0)+' MHz \u00b9H)';
  $('vCSA').textContent=s.dppm+' ppm';
  $('vRXH').textContent=(+$('sRXH').value).toFixed(3)+' \u212b';
  $('vRHH').textContent=(+$('sRHH').value).toFixed(2)+' \u212b';
  $('vDWppm').textContent=(+$('sDWppm').value).toFixed(1)+' ppm';
  $('vS2').textContent=s.S2.toFixed(2);
  $('vTauE').textContent=$('sTauE').value+' ps';
  $('vTauM').textContent=tmNs>=1?tmNs.toFixed(2)+' ns':(tmNs*1000).toFixed(0)+' ps';
  $('vPB').textContent=s.pB.toFixed(3);
  $('vDW').textContent=s.dw.toFixed(1)+' ppm';
  $('vTex').textContent=(+$('sTex').value).toFixed(1)+' \u00b5s';
  $('vRex').textContent=s.Rex0.toFixed(1)+' s\u207b\u00b9';
  $('vD').textContent=sci(s.D)+' m\u00b2/s';
  $('vT').textContent=s.T.toFixed(1)+' K ('+(s.T-273.15).toFixed(1)+' \u00b0C)';
  $('vEta').textContent=$('hAuto').checked?sci(s.eta,3)+' Pa\u00b7s (auto)':(+$('hEta').value).toFixed(2)+'\u00d710\u207b\u00b3 Pa\u00b7s';
  $('vN').textContent=s.n.toFixed(2);
  $('vSv').textContent=(+$('hSv').value).toFixed(2)+' cm\u00b3/g';
  $('vSvW').textContent=(+$('hSvW').value).toFixed(2)+' cm\u00b3/g';
  $('vF').textContent=s.F.toFixed(2);
  const h=hydro(s,s.D);
  $('hydroOut').innerHTML='r<sub>h</sub> = '+(h.rh*1e10).toFixed(2)+' \u212b &nbsp;\u00b7&nbsp; MW = '+
    h.MW.toFixed(1)+' g/mol (sheet 2416.9) &nbsp;\u00b7&nbsp; \u03c4<sub>D</sub> = '+sci(h.tauD)+' s';
}
function render(){
  const s=state();
  ({rates:plotRates,T1:plotT1,comp:plotComp,ratio:plotRatio,s2s:plotS2s,J:plotJ,field:plotField,MW:plotMW})[mode](s);
  readout(s);
}
function sync(){labels();render();}

/* ---------- wiring ---------- */
function setObs(m){obsMode=m;
  $('mX').classList.toggle('active',m==='X');$('mH').classList.toggle('active',m==='H');
  const isX=m==='X';
  $('rowNuc').style.display=isX?'':'none';
  $('rowRXH').style.display=isX?'':'none';
  $('rowHH').style.display=isX?'none':'';
  $('rowDWHH').style.display=isX?'none':'';
  $('modeBadge').textContent=isX?('observed: X ('+(GAMMA_X<0?'\u00b9\u2075N':'\u00b9\u00b3C')+' + \u00b9H)'):'observed: \u00b9H (\u00b9H\u2013\u00b9H)';
  sync();}
function setMode(m,btn){mode=m;
  document.querySelectorAll('.toolbar button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');render();}
$('mX').onclick=()=>setObs('X');
$('mH').onclick=()=>setObs('H');
$('bRates').onclick=e=>setMode('rates',e.currentTarget);
$('bT1').onclick=e=>setMode('T1',e.currentTarget);
$('bComp').onclick=e=>setMode('comp',e.currentTarget);
$('bRatio').onclick=e=>setMode('ratio',e.currentTarget);
$('bS2s').onclick=e=>setMode('s2s',e.currentTarget);
$('bJ').onclick=e=>setMode('J',e.currentTarget);
$('bField').onclick=e=>setMode('field',e.currentTarget);
$('bMW').onclick=e=>setMode('MW',e.currentTarget);
const NUC={C13:{g:6.7283e7,r:1.10},N15:{g:-2.7126e7,r:1.02}};
$('selNuc').onchange=e=>{const v=e.target.value;
  if(v==='custom'){$('gWrap').style.display='flex';GAMMA_X=parseFloat($('sGx').value)||6.73e7;}
  else{$('gWrap').style.display='none';GAMMA_X=NUC[v].g;$('sRXH').value=NUC[v].r;}
  setObs('X');};
$('sGx').addEventListener('input',()=>{GAMMA_X=parseFloat($('sGx').value)||GAMMA_X;sync();});
$('pT1').onclick=()=>{$('sTauM').value=Math.log10(0.25);sync();};
$('pT2').onclick=()=>{$('sTauM').value=Math.log10(0.85);sync();};
$('pT3').onclick=()=>{$('sTauM').value=Math.log10(5);sync();};
$('bReset').onclick=()=>{
  $('selNuc').value='C13';$('gWrap').style.display='none';GAMMA_X=6.7283e7;
  $('sRXH').value=1.10;$('sRHH').value=1.75;$('sDWppm').value=1.0;
  $('sB0').value=14.1;$('sCSA').value=0;$('sS2').value=0.5;$('sTauE').value=50;$('sTauM').value=-0.607;
  $('sPB').value=0.5;$('sDW').value=0;$('sTex').value=1;$('sRex').value=0;
  $('hD').value=-9.886;$('hT').value=278.8;$('hEta').value=1.53;$('hAuto').checked=false;
  $('hN').value=0.4;$('hSv').value=0.73;$('hSvW').value=1.0;$('hF').value=1;
  $('cR1').checked=$('cR2').checked=$('cNOE').checked=true;
  setObs('X');};
$('hUse').onclick=()=>{const s=state();$('sTauM').value=Math.log10(hydro(s,s.D).tauD*1e9);sync();};
document.querySelectorAll('input[type=range],input[type=checkbox]')
  .forEach(el=>el.addEventListener('input',sync));
setObs('X');
</script>
</body>
</html>`;
/* ============================================================================
NMR FITTINGS / RELAXATION RENDERER — UPDATED VERSION
Changes:
- Removed target molecule from experiment setup
- Added dataset name, experiment number, and link fields
- Decay/Diffusion curves and Parameter vs Atom are full-width (not side by side)
- Histogram option and error bars added to charts
- Observed atom, Experiment Type, Delay unit and fit button moved under data table
  in "Data Analysis" subsection linked to each table
- Fitted data table is expandable and exportable to XLS
- Simulation section added with diffusion coefficient simulator and nuclear
  relaxation simulator
- NMRInstrumentalSetup integrated
- Integrated SharedGraphConfig for modular chart settings
============================================================================ */

const FS_CLASSES = 'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';

/* ---------------------------------------------------------------------------
PHYSICS CONSTANTS & MODEL-FREE
--------------------------------------------------------------------------- */
const HBAR = 1.054571817e-34;
const MU0_4PI = 1e-7;
const RGAS = 8.314462618;
const GAMMA_H = 2.6752218744e8;
const GAMMA = { '15N': -2.7126e7, '13C': 6.7283e7, '1H': 2.6752218744e8, '31P': 1.083e8 };
const DEFAULT_DIST = { '15N': 1.02, '13C': 1.09, '1H': 1.09 };
const DEFAULT_CSA = { '15N': -160, '13C': -20, '1H': 0 };
const BOLTZMANN = 1.380649e-23;



function spectralDensity(w, tau_c, S2, useInternal, tau_e) {
    let val = (S2 * tau_c) / (1 + (w * tau_c) ** 2);
    if (useInternal && tau_e > 0) {
        const te = 1 / (1 / tau_c + 1 / tau_e);
        val += ((1 - S2) * te) / (1 + (w * te) ** 2);
    }
    return (2 / 5) * val;
}

function modelFreeRates({ nucleus = '15N', fieldMHz = 600, tau_c_ns = 5, S2 = 0.85, useInternal = false, tau_e_ps = 50, r_A = 1.02, csa_ppm = -160 }) {
    const gx = GAMMA[nucleus] ?? GAMMA['15N'];
    const gxAbs = Math.abs(gx);
    const B0 = (2 * Math.PI * fieldMHz * 1e6) / GAMMA_H;
    const wH = GAMMA_H * B0;
    const wX = gxAbs * B0;
    const tau_c = tau_c_ns * 1e-9;
    const tau_e = tau_e_ps * 1e-12;
    const r_m = r_A * 1e-10;
    const J = (w) => spectralDensity(w, tau_c, S2, useInternal, tau_e);
    const D = MU0_4PI * GAMMA_H * gxAbs * HBAR / (r_m ** 3);
    const D2 = D * D;
    const C = (wX * csa_ppm * 1e-6) / Math.sqrt(3);
    const C2 = C * C;
    const wDiff = Math.abs(wH - wX);
    const wSum = wH + wX;
    const R1dip = (D2 / 4) * (J(wDiff) + 3 * J(wX) + 6 * J(wSum));
    const R2dip = (D2 / 8) * (4 * J(0) + J(wDiff) + 3 * J(wX) + 18 * J(wH) + 6 * J(wSum));
    const sigmaX = (D2 / 4) * (6 * J(wSum) - J(wDiff));
    const R1csa = C2 * J(wX);
    const R2csa = (C2 / 6) * (4 * J(0) + 3 * J(wX));
    const R1 = R1dip + R1csa;
    const R2 = R2dip + R2csa;
    return { R1dip, R2dip, R1csa, R2csa, R1, R2, NOE: R1 > 0 ? 1 + (GAMMA_H / gx) * (sigmaX / R1) : 1, T1: R1 > 0 ? 1 / R1 : Infinity, T2: R2 > 0 ? 1 / R2 : Infinity, ratio: R2 > 0 ? R1 / R2 : 0 };
}

function tauFromMW(MW_Da, eta_PaS, T_K, vbar_cm3g = 0.73, hydration = 0.3) {
    return (eta_PaS * (MW_Da * 1e-3 * (vbar_cm3g * 1e-3 + hydration * 1e-3))) / (RGAS * T_K);
}


// Stokes-Einstein diffusion coefficient
function stokesEinsteinD(T_K, eta_PaS, r_m) {
    return (BOLTZMANN * T_K) / (6 * Math.PI * eta_PaS * r_m);
}

// Approximate radius from MW (assuming sphere with vbar and hydration)
function radiusFromMW(MW_Da, vbar_cm3g = 0.73, hydration = 0.3) {
    const V_m3 = (MW_Da * 1e-3 / 6.022e23) * (vbar_cm3g * 1e-6 + hydration * 1e-6);
    return Math.pow((3 * V_m3) / (4 * Math.PI), 1 / 3);
}

/* ---------------------------------------------------------------------------
LEVENBERG-MARQUARDT SOLVERS
--------------------------------------------------------------------------- */
function solveLinear(A, b) {
    const n = A.length;
    const M = A.map((r, i) => [...r, b[i]]);
    for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
        if (Math.abs(M[piv][col]) < 1e-14) return null;
        [M[col], M[piv]] = [M[piv], M[col]];
        const d = M[col][col];
        for (let j = col; j <= n; j++) M[col][j] /= d;
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = M[r][col];
            if (Math.abs(f) < 1e-14) continue;
            for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
        }
    }
    return M.map((r) => r[n]);
}

function fitMonoExp(xs, ys) {
    const pts = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => isFinite(p.x) && isFinite(p.y));
    const n = pts.length;
    if (n < 3) return null;
    const pos = pts.filter((p) => p.y > 0);
    let R0 = 1, A0 = Math.max(...pts.map((p) => Math.abs(p.y)));
    if (pos.length >= 2) {
        const lx = pos.map((p) => p.x), ly = pos.map((p) => Math.log(p.y));
        const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
        const my = ly.reduce((a, b) => a + b, 0) / ly.length;
        let num = 0, den = 0;
        for (let i = 0; i < lx.length; i++) { num += (lx[i] - mx) * (ly[i] - my); den += (lx[i] - mx) ** 2; }
        R0 = Math.max(1e-6, -(den > 0 ? num / den : -1));
        A0 = Math.max(1e-9, Math.exp(my + R0 * mx));
    }
    let p = [Math.log(A0), Math.log(R0)];
    const model = (x, pp) => Math.exp(pp[0] - Math.exp(pp[1]) * x);
    const rss = (pp) => pts.reduce((s, q) => s + Math.pow(q.y - model(q.x, pp), 2), 0);
    let cur = rss(p), lambda = 1e-3;
    for (let it = 0; it < 200; it++) {
        const JtJ = [[0, 0], [0, 0]], Jtr = [0, 0];
        for (let i = 0; i < n; i++) {
            const x = pts[i].x, f0 = model(x, p), g = [];
            for (let j = 0; j < 2; j++) {
                const h = Math.max(1e-8, Math.abs(p[j]) * 1e-6), pp = p.slice(); pp[j] += h;
                g.push((model(x, pp) - f0) / h);
            }
            const r = pts[i].y - f0;
            for (let a = 0; a < 2; a++) { Jtr[a] += g[a] * r; for (let b = 0; b < 2; b++) JtJ[a][b] += g[a] * g[b]; }
        }
        const dp = solveLinear([[JtJ[0][0] * (1 + lambda), JtJ[0][1]], [JtJ[1][0], JtJ[1][1] * (1 + lambda)]], Jtr);
        if (!dp) { lambda *= 10; if (lambda > 1e12) break; continue; }
        const pn = [p[0] + dp[0], p[1] + dp[1]], nr = rss(pn);
        if (nr < cur) { p = pn; cur = nr; lambda = Math.max(lambda * 0.5, 1e-12); } else { lambda *= 10; if (lambda > 1e12) break; }
    }
    const A = Math.exp(p[0]), R = Math.exp(p[1]), meanY = pts.reduce((s, q) => s + q.y, 0) / n;
    let ssTot = 0, ssRes = 0;
    pts.forEach((q) => { ssTot += (q.y - meanY) ** 2; ssRes += (q.y - model(q.x, p)) ** 2; });
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
    let seR = null;
    const H = [[0, 0], [0, 0]];
    for (let i = 0; i < n; i++) {
        const x = pts[i].x, f0 = model(x, p), g = [];
        for (let j = 0; j < 2; j++) {
            const h = Math.max(1e-8, Math.abs(p[j]) * 1e-6), pp = p.slice(); pp[j] += h;
            g.push((model(x, pp) - f0) / h);
        }
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) H[a][b] += g[a] * g[b];
    }
    const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
    if (Math.abs(det) > 1e-30) {
        const varLnR = (H[0][0] / det) * (ssRes / Math.max(1, n - 2));
        if (varLnR > 0) seR = R * Math.sqrt(varLnR);
    }
    return { A, R, T: 1 / R, r2, n, seR, modelType: 'mono-exp' };
}

function fitInversionRecovery(xs, ys) {
    const pts = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => isFinite(p.x) && isFinite(p.y));
    const n = pts.length;
    if (n < 4) return null;
    const maxY = Math.max(...pts.map(p => p.y)), minY = Math.min(...pts.map(p => p.y));
    let R0 = 1;
    const zeroCross = pts.find(p => p.y >= 0);
    if (zeroCross && zeroCross.x > 0) R0 = Math.log(2) / zeroCross.x;
    let p = [maxY, maxY - minY, Math.log(Math.max(1e-6, R0))];
    const model = (x, pp) => pp[0] - pp[1] * Math.exp(-Math.exp(pp[2]) * x);
    const rss = (pp) => pts.reduce((s, q) => s + Math.pow(q.y - model(q.x, pp), 2), 0);
    let cur = rss(p), lambda = 1e-3;
    for (let it = 0; it < 200; it++) {
        const JtJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Jtr = [0, 0, 0];
        for (let i = 0; i < n; i++) {
            const x = pts[i].x, f0 = model(x, p), R_val = Math.exp(p[2]), exp_term = Math.exp(-R_val * x);
            const g = [1, -exp_term, p[1] * x * R_val * exp_term];
            const r = pts[i].y - f0;
            for (let a = 0; a < 3; a++) { Jtr[a] += g[a] * r; for (let b = 0; b < 3; b++) JtJ[a][b] += g[a] * g[b]; }
        }
        const dp = solveLinear([[JtJ[0][0] * (1 + lambda), JtJ[0][1], JtJ[0][2]], [JtJ[1][0], JtJ[1][1] * (1 + lambda), JtJ[1][2]], [JtJ[2][0], JtJ[2][1], JtJ[2][2] * (1 + lambda)]], Jtr);
        if (!dp) { lambda *= 10; if (lambda > 1e12) break; continue; }
        const pn = [p[0] + dp[0], p[1] + dp[1], p[2] + dp[2]], nr = rss(pn);
        if (nr < cur) { p = pn; cur = nr; lambda = Math.max(lambda * 0.5, 1e-12); } else { lambda *= 10; if (lambda > 1e12) break; }
    }
    const A = p[0], B = p[1], R = Math.exp(p[2]), meanY = pts.reduce((s, q) => s + q.y, 0) / n;
    let ssTot = 0, ssRes = 0;
    pts.forEach((q) => { ssTot += (q.y - meanY) ** 2; ssRes += (q.y - model(q.x, p)) ** 2; });
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
    let seR = null;
    const H = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i = 0; i < n; i++) {
        const x = pts[i].x, f0 = model(x, p), g = [];
        for (let j = 0; j < 3; j++) {
            const h = Math.max(1e-8, Math.abs(p[j]) * 1e-6), pp = p.slice(); pp[j] += h;
            g.push((model(x, pp) - f0) / h);
        }
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a][b] += g[a] * g[b];
    }
    const det = H[0][0]*(H[1][1]*H[2][2] - H[1][2]*H[2][1]) - H[0][1]*(H[1][0]*H[2][2] - H[1][2]*H[2][0]) + H[0][2]*(H[1][0]*H[2][1] - H[1][1]*H[2][0]);
    if (Math.abs(det) > 1e-30) {
        const inv22 = (H[0][0]*H[1][1] - H[0][1]*H[1][0]) / det;
        const varLnR = inv22 * (ssRes / Math.max(1, n - 3));
        if (varLnR > 0) seR = R * Math.sqrt(varLnR);
    }
    return { A, B, R, T: 1 / R, r2, n, seR, modelType: 'inversion-recovery' };
}

/* ---------------------------------------------------------------------------
ERROR INPUT UI
--------------------------------------------------------------------------- */
export const ErrInput = ({ label, value, isOverridden, onSave, onReset }) => {
    const [tempVal, setTempVal] = useState(value !== undefined ? value : '');
    useEffect(() => { setTempVal(value !== undefined ? value : ''); }, [value]);
    return (
        <div className={`flex flex-col gap-1 p-1.5 rounded border ${isOverridden ? 'border-orange-400 bg-white' : 'border-slate-200 bg-white'}`}>
            <span className="text-[9px] font-bold text-slate-500 truncate w-14" title={label}>{label}</span>
            <div className="flex gap-1 items-center">
                <input type="number" step="0.01" value={tempVal} onChange={(e) => setTempVal(e.target.value)} onBlur={() => onSave(parseFloat(tempVal) || 0)} className="w-12 text-xs border border-slate-300 rounded p-0.5 outline-none focus:border-orange-500 text-center" />
                {isOverridden && ( <button onClick={onReset} className="text-red-500 hover:text-red-700 font-bold" title="Reset to calculated error">×</button>)}
            </div>
        </div>
    );
};

/* ---------------------------------------------------------------------------
CHARTS — FULL WIDTH (not side by side)
--------------------------------------------------------------------------- */
function DecayChart({ table, colFits, chartCfg, isFs, onToggleFs, chartType = 'line' }) {
    const ref = useRef(null); const chartRef = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        const ds = [];
        const isHist = chartType === 'hist';

        for (let c = 0; c < table.nCols; c++) {
            const color = toHex(PALETTE[c % PALETTE.length]);
            const pts = [];
            for (let r = 0; r < table.nRows; r++) {
                const x = table.delays[r], y = parseFloat(table.grid[r]?.[c]);
                if (isFinite(x) && isFinite(y)) pts.push({ x, y });
            }
            if (pts.length === 0) continue;

            if (isHist) {
                // Histogram: show fitted parameter values as bars
                const fit = colFits[c]?.fit;
                if (fit) {
                    ds.push({ label: table.colResidues[c] || `Col ${c + 1}`, data: [{ x: c, y: fit.R_s }], type: 'bar', backgroundColor: color + '99', borderColor: color, borderWidth: 1 });
                }
            } else {
                ds.push({ label: table.colResidues[c] || `Col ${c + 1}`, data: pts, showLine: false, pointRadius: chartCfg.ptSize, pointStyle: chartCfg.ptStyle, backgroundColor: color, borderColor: color, type: 'scatter' });
                const fit = colFits[c]?.fit;
                if (fit && pts.length >= 2) {
                    const xmin = Math.min(...pts.map((p) => p.x)), xmax = Math.max(...pts.map((p) => p.x)), curve = [];
                    for (let i = 0; i <= 60; i++) {
                        const x = xmin + ((xmax - xmin) * i) / 60;
                        let yVal = fit.modelType === 'inversion-recovery' ? fit.A - fit.B * Math.exp(-fit.R * x) : fit.A * Math.exp(-fit.R * x);
                        curve.push({ x, y: yVal });
                    }
                    let borderDash = [];
                    if (chartCfg.lineStyle === 'dashed') borderDash = [5, 5];
                    if (chartCfg.lineStyle === 'dotted') borderDash = [2, 3];
                    ds.push({ label: `${table.colResidues[c] || `Col ${c + 1}`} fit`, data: curve, showLine: true, pointRadius: 0, borderColor: color, backgroundColor: 'transparent', borderWidth: chartCfg.lineThickness, borderDash, type: 'line', tension: 0.25 });
                }
            }
        }
        if (chartRef.current) chartRef.current.destroy();
        const xLabel = isHist ? 'Residue' : (table.relaxType === 'DOSY' ? `b-value / G² (${table.delayUnit})` : `Delay (${table.delayUnit})`);
        chartRef.current = new Chart(ref.current, {
            type: isHist ? 'bar' : 'scatter',
            data: isHist ? { labels: ds.map(d => d.label), datasets: [{ label: `Rate (${table.relaxType === 'T1' ? 'R1' : table.relaxType === 'DOSY' ? 'D' : 'R2'})`, data: ds.map(d => d.data[0].y), backgroundColor: ds.map(d => d.backgroundColor), borderColor: ds.map(d => d.borderColor), borderWidth: 1 }] } : { datasets: ds },
            plugins: errBarPlugin ? [errBarPlugin] : [],
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { type: isHist ? 'category' : 'linear', position: chartCfg.xPos, min: !isHist && chartCfg.xMin !== '' ? parseFloat(chartCfg.xMin) : undefined, max: !isHist && chartCfg.xMax !== '' ? parseFloat(chartCfg.xMax) : undefined, title: { display: true, text: xLabel, font: { size: chartCfg.fontSize + 2 } }, ticks: { font: { size: chartCfg.fontSize } } },
                    y: { position: chartCfg.yPos, min: chartCfg.yMin !== '' ? parseFloat(chartCfg.yMin) : undefined, max: chartCfg.yMax !== '' ? parseFloat(chartCfg.yMax) : undefined, title: { display: true, text: isHist ? `Rate (${table.relaxType === 'T1' ? 'R1' : table.relaxType === 'DOSY' ? 'D' : 'R2'})` : 'Intensity / Volume', font: { size: chartCfg.fontSize + 2 } }, ticks: { font: { size: chartCfg.fontSize } } },
                },
                plugins: { legend: { display: !isHist, labels: { font: { size: chartCfg.fontSize } } } }
            }
        });
        return () => { if (chartRef.current) chartRef.current.destroy(); };
    }, [table, colFits, chartCfg, chartType]);
    return (
        <div className={`flex flex-col ${isFs ? FS_CLASSES + ' p-6' : 'relative h-[350px]'}`}>
            <div className="flex justify-between items-start mb-2 z-10">
                <h4 className="text-xs font-bold text-slate-600 uppercase">Decay / Diffusion curves</h4>
                <button onClick={onToggleFs} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors no-print">{isFs ? '↙️' : '↗️'}</button>
            </div>
            <div className="flex-1 relative min-h-0"> <canvas ref={ref} /> </div>
        </div>
    );
}

function ParameterChart({ table, colFits, chartCfg, isFs, onToggleFs, chartType = 'bar' }) {
    const ref = useRef(null); const chartRef = useRef(null);
    useEffect(() => {
        if (!ref.current || !colFits.some(cf => cf.fit)) return;
        const labels = []; const data = []; const colors = []; const ebars = [];
        colFits.forEach((cf, i) => {
            if (!cf.fit) return;
            labels.push(cf.residue || `Col ${i+1}`);
            data.push(cf.fit.R_s);
            colors.push(toHex(PALETTE[i % PALETTE.length]));
            const err = cf.effectiveError || cf.fit.seR_s || 0;
            ebars.push({ plus: err, minus: err });
        });
        if (chartRef.current) chartRef.current.destroy();
        const yLabel = table.relaxType === 'DOSY' ? 'Diffusion Rate (D)' : `Rate (${table.relaxType === 'T1' ? 'R1' : 'R2'}) s⁻¹`;
        chartRef.current = new Chart(ref.current, {
            type: chartType === 'hist' ? 'bar' : 'bar',
            data: { labels, datasets: [{ label: yLabel, data, backgroundColor: colors, borderColor: colors, borderWidth: 1, errorBars: ebars }] },
            plugins: errBarPlugin ? [errBarPlugin] : [],
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    y: { position: chartCfg.yPos, min: chartCfg.yMin !== '' ? parseFloat(chartCfg.yMin) : undefined, max: chartCfg.yMax !== '' ? parseFloat(chartCfg.yMax) : undefined, title: { display: true, text: yLabel, font: { size: chartCfg.fontSize + 2 } }, ticks: { font: { size: chartCfg.fontSize } } },
                    x: { position: chartCfg.xPos, title: { display: true, text: 'Residue / Atom', font: { size: chartCfg.fontSize + 2 } }, ticks: { font: { size: chartCfg.fontSize } } }
                },
                plugins: { legend: { display: false } }
            }
        });
        return () => { if (chartRef.current) chartRef.current.destroy(); };
    }, [table, colFits, chartCfg, chartType]);
    return (
        <div className={`flex flex-col ${isFs ? FS_CLASSES + ' p-6' : 'relative h-[350px]'}`}>
            <div className="flex justify-between items-start mb-2 z-10">
                <h4 className="text-xs font-bold text-slate-600 uppercase">Parameter vs Atom</h4>
                <button onClick={onToggleFs} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors no-print">{isFs ? '↙️' : '↗️'}</button>
            </div>
            <div className="flex-1 relative min-h-0"> <canvas ref={ref} /> </div>
        </div>
    );
}

function IndividualDecayChart({ table, colIndex, colFit, chartCfg, isFs, onToggleFs }) {
    const ref = useRef(null); const chartRef = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        const color = toHex(PALETTE[colIndex % PALETTE.length]);
        const pts = [];
        for (let r = 0; r < table.nRows; r++) {
            const x = table.delays[r], y = parseFloat(table.grid[r]?.[colIndex]);
            if (isFinite(x) && isFinite(y)) pts.push({ x, y });
        }
        if (pts.length === 0) return;
        const ds = [];
        ds.push({ label: 'Data', data: pts, showLine: false, pointRadius: chartCfg.ptSize, pointStyle: chartCfg.ptStyle, backgroundColor: color, borderColor: color, type: 'scatter' });
        const fit = colFit?.fit;
        if (fit && pts.length >= 2) {
            const xmin = Math.min(...pts.map((p) => p.x)), xmax = Math.max(...pts.map((p) => p.x)), curve = [];
            for (let i = 0; i <= 60; i++) {
                const x = xmin + ((xmax - xmin) * i) / 60;
                let yVal = fit.modelType === 'inversion-recovery' ? fit.A - fit.B * Math.exp(-fit.R * x) : fit.A * Math.exp(-fit.R * x);
                curve.push({ x, y: yVal });
            }
            let borderDash = [];
            if (chartCfg.lineStyle === 'dashed') borderDash = [5, 5];
            if (chartCfg.lineStyle === 'dotted') borderDash = [2, 3];
            ds.push({ label: `Fit`, data: curve, showLine: true, pointRadius: 0, borderColor: color, backgroundColor: 'transparent', borderWidth: chartCfg.lineThickness, borderDash, type: 'line', tension: 0.25 });
        }
        if (chartRef.current) chartRef.current.destroy();
        chartRef.current = new Chart(ref.current, {
            type: 'scatter', data: { datasets: ds },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { type: 'linear', position: chartCfg.xPos, min: chartCfg.xMin !== '' ? parseFloat(chartCfg.xMin) : undefined, max: chartCfg.xMax !== '' ? parseFloat(chartCfg.xMax) : undefined, title: { display: isFs, text: chartCfg.xAxisLabel || (table.relaxType === 'DOSY' ? `b-value / G² (${table.delayUnit})` : `Delay (${table.delayUnit})`), font: { size: chartCfg.fontSize + 2 } }, ticks: { display: isFs, font: { size: chartCfg.fontSize } } },
                    y: { position: chartCfg.yPos, min: chartCfg.yMin !== '' ? parseFloat(chartCfg.yMin) : undefined, max: chartCfg.yMax !== '' ? parseFloat(chartCfg.yMax) : undefined, title: { display: isFs, text: 'Intensity / Volume', font: { size: chartCfg.fontSize + 2 } }, ticks: { display: isFs, font: { size: chartCfg.fontSize } } },
                },
                plugins: { legend: { display: false }, tooltip: { enabled: true } },
                interaction: { mode: 'nearest', intersect: true },
            }
        });
        return () => { if (chartRef.current) chartRef.current.destroy(); };
    }, [table, colIndex, colFit, chartCfg, isFs]);
    const residueName = table.colResidues[colIndex] || `Col ${colIndex + 1}`;
    return (
        <div className={`flex flex-col bg-white ${isFs ? FS_CLASSES + ' p-6' : 'relative aspect-square p-2 cursor-pointer hover:shadow-lg transition-shadow border border-slate-200 rounded-lg group'}`} onClick={!isFs ? onToggleFs : undefined}>
            <div className="flex justify-between items-start mb-1 z-10">
                <h4 className="text-xs font-bold text-slate-600 uppercase">{residueName}</h4>
                {!isFs && <button className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1 transition-all text-[10px]">↗️</button>}
                {isFs && <button onClick={(e) => { e.stopPropagation(); onToggleFs(); }} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors no-print">↙️</button>}
            </div>
            <div className={`flex-1 relative min-h-0 ${!isFs ? 'pointer-events-none' : ''}`}> <canvas ref={ref} /> </div>
        </div>
    );
}

const makeTable = (overrides = {}) => ({
    id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    atom: 'HN', relaxType: 'T2', delayUnit: 'ms', nRows: 6, nCols: 4,
    delays: [0, 50, 100, 200, 400, 800], colResidues: ['', '', '', ''],
    grid: Array.from({ length: 6 }, () => new Array(4).fill('')), ...overrides,
});

/* ---------------------------------------------------------------------------
SIMULATION SECTION
--------------------------------------------------------------------------- */
function SimulationSection({ sim, setSim, activeTest }) {
    const [simType, setSimType] = useState('diffusion');
    const solventName = activeTest?.solvent || '';
    const temperature = parseFloat(activeTest?.temperature) || 298;

    // Default viscosity for common solvents (Pa·s at ~25°C)
    const SOLVENT_VISCOSITY = {
        'H2O': 0.89e-3, 'D2O': 1.107e-3, 'DMSO': 1.996e-3, 'DMSO-d6': 1.996e-3,
        'methanol': 0.544e-3, 'ethanol': 1.074e-3, 'chloroform': 0.538e-3,
        'acetone': 0.306e-3, 'benzene': 0.604e-3, 'toluene': 0.560e-3,
    };

    const viscosity = sim.viscosity || SOLVENT_VISCOSITY[solventName] || 0.89e-3;
    const T_K = temperature > 100 ? temperature : temperature + 273.15; // assume °C if < 100

    // Diffusion coefficient simulation
    const MW = sim.MW || 12000;
    const shape = sim.shape || 'sphere'; // sphere, rod, disc
    const shapeFactor = shape === 'sphere' ? 1 : shape === 'rod' ? 1.3 : 1.15; // approximate correction
    const r_m = radiusFromMW(MW, sim.vbar || 0.73, sim.hydration || 0.3) * shapeFactor;
    const D_calc = stokesEinsteinD(T_K, viscosity, r_m);
    const tau_c_calc = tauFromMW(MW, viscosity, T_K, sim.vbar || 0.73, sim.hydration || 0.3);

    // Nuclear relaxation simulation
    const nucleus = sim.nucleus || '15N';
    const fieldMHz = sim.fieldMHz || 600;
    const rates = modelFreeRates({
        nucleus, fieldMHz,
        tau_c_ns: (tau_c_calc * 1e9) || (sim.tau_c_ns || 5),
        S2: sim.S2 || 0.85,
        useInternal: sim.useInternal || false,
        tau_e_ps: sim.tau_e_ps || 50,
        r_A: sim.r_A || DEFAULT_DIST[nucleus] || 1.02,
        csa_ppm: sim.csa_ppm ?? DEFAULT_CSA[nucleus] ?? -160,
    });

    return (
        <div className="flex flex-col gap-4">
            <div className="flex gap-2 flex-wrap mb-2">
                <button type="button" onClick={() => setSimType('diffusion')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${simType === 'diffusion' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>💧 Diffusion Coefficient</button>
                <button type="button" onClick={() => setSimType('relaxation')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${simType === 'relaxation' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>🔄 Nuclear Relaxation</button>
                <button type="button" onClick={() => setSimType('dipolar')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${simType === 'dipolar' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>🧲 Dipolar + CSA (Advanced)</button>
                <button type="button" onClick={() => setSimType('dosy')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${simType === 'dosy' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>📈 Stejskal-Tanner (DOSY)</button>
            </div>

            {simType === 'diffusion' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex flex-col gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Molecular Weight (Da)</label>
                            <input type="number" value={sim.MW || 12000} onChange={(e) => setSim({ MW: parseFloat(e.target.value) || 12000 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Temperature (K)</label>
                            <input type="number" value={T_K.toFixed(1)} onChange={(e) => setSim({ temperature: parseFloat(e.target.value) || 298 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Viscosity (Pa·s)</label>
                            <input type="number" step="0.001e-3" value={viscosity} onChange={(e) => setSim({ viscosity: parseFloat(e.target.value) || 0.89e-3 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Shape</label>
                            <select value={sim.shape || 'sphere'} onChange={(e) => setSim({ shape: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500">
                                <option value="sphere">Sphere</option>
                                <option value="rod">Rod (elongated)</option>
                                <option value="disc">Disc (flat)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Partial specific volume (cm³/g)</label>
                            <input type="number" step="0.01" value={sim.vbar || 0.73} onChange={(e) => setSim({ vbar: parseFloat(e.target.value) || 0.73 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Hydration (g/g)</label>
                            <input type="number" step="0.05" value={sim.hydration || 0.3} onChange={(e) => setSim({ hydration: parseFloat(e.target.value) || 0.3 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                    </div>
                    <div className="md:col-span-2 flex flex-col gap-3">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <h4 className="text-xs font-black text-blue-800 uppercase mb-3">Stokes-Einstein Diffusion Coefficient</h4>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div><span className="font-bold text-slate-600">Hydrodynamic radius:</span> <span className="font-mono text-blue-700">{(r_m * 1e9).toFixed(2)} nm</span></div>
                                <div><span className="font-bold text-slate-600">Diffusion coefficient D:</span> <span className="font-mono text-blue-700">{D_calc.toExponential(3)} m²/s</span></div>
                                <div><span className="font-bold text-slate-600">D (×10⁻¹¹ m²/s):</span> <span className="font-mono text-blue-700">{(D_calc * 1e11).toFixed(2)}</span></div>
                                <div><span className="font-bold text-slate-600">Rotational τc:</span> <span className="font-mono text-blue-700">{(tau_c_calc * 1e9).toFixed(2)} ns</span></div>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-3 italic">D = k_B·T / (6π·η·r_h) — Stokes-Einstein equation. Shape correction factor: {shapeFactor.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            )}

            {simType === 'relaxation' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex flex-col gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Nucleus</label>
                            <select value={sim.nucleus || '15N'} onChange={(e) => setSim({ nucleus: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500">
                                <option value="15N">¹⁵N</option>
                                <option value="13C">¹³C</option>
                                <option value="1H">¹H</option>
                                <option value="31P">³¹P</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Field (MHz)</label>
                            <input type="number" value={sim.fieldMHz || 600} onChange={(e) => setSim({ fieldMHz: parseFloat(e.target.value) || 600 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">τc (ns)</label>
                            <input type="number" step="0.1" value={sim.tau_c_ns || (tau_c_calc * 1e9).toFixed(1)} onChange={(e) => setSim({ tau_c_ns: parseFloat(e.target.value) || 5 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">S² (order parameter)</label>
                            <input type="number" step="0.01" min="0" max="1" value={sim.S2 || 0.85} onChange={(e) => setSim({ S2: parseFloat(e.target.value) || 0.85 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Bond length r (Å)</label>
                            <input type="number" step="0.01" value={sim.r_A || DEFAULT_DIST[sim.nucleus || '15N'] || 1.02} onChange={(e) => setSim({ r_A: parseFloat(e.target.value) || 1.02 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">CSA (ppm)</label>
                            <input type="number" step="1" value={sim.csa_ppm ?? DEFAULT_CSA[sim.nucleus || '15N'] ?? -160} onChange={(e) => setSim({ csa_ppm: parseFloat(e.target.value) || -160 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                            <input type="checkbox" checked={sim.useInternal || false} onChange={(e) => setSim({ useInternal: e.target.checked })} className="w-4 h-4 accent-blue-600" /> Use internal motion (τe)
                        </label>
                        {sim.useInternal && (
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">τe (ps)</label>
                                <input type="number" step="1" value={sim.tau_e_ps || 50} onChange={(e) => setSim({ tau_e_ps: parseFloat(e.target.value) || 50 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                            </div>
                        )}
                    </div>
                    <div className="md:col-span-2 flex flex-col gap-3">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                            <h4 className="text-xs font-black text-emerald-800 uppercase mb-3">Model-Free Relaxation Rates</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                                <div><span className="font-bold text-slate-600">R1 (s⁻¹):</span> <span className="font-mono text-emerald-700">{rates.R1.toFixed(3)}</span></div>
                                <div><span className="font-bold text-slate-600">R2 (s⁻¹):</span> <span className="font-mono text-emerald-700">{rates.R2.toFixed(3)}</span></div>
                                <div><span className="font-bold text-slate-600">NOE:</span> <span className="font-mono text-emerald-700">{rates.NOE.toFixed(3)}</span></div>
                                <div><span className="font-bold text-slate-600">T1 (s):</span> <span className="font-mono text-emerald-700">{rates.T1 === Infinity ? '∞' : rates.T1.toFixed(3)}</span></div>
                                <div><span className="font-bold text-slate-600">T2 (s):</span> <span className="font-mono text-emerald-700">{rates.T2 === Infinity ? '∞' : rates.T2.toFixed(3)}</span></div>
                                <div><span className="font-bold text-slate-600">R1/R2:</span> <span className="font-mono text-emerald-700">{rates.ratio.toFixed(3)}</span></div>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-3 italic">Model-free formalism: R1, R2, and heteronuclear NOE from dipolar + CSA relaxation mechanisms.</p>
                        </div>
                    </div>
                </div>
            )}

            {simType === 'dipolar' && (
                <div className="w-full border border-slate-300 rounded-lg overflow-hidden mt-2 bg-slate-50" style={{ height: '900px' }}>
                    <iframe srcDoc={DIPOLAR_SIM_HTML} className="w-full h-full border-0" title="Dipolar CSA Simulator" />
                </div>
            )}

            {simType === 'dosy' && (
                <>
                    <div className="w-full bg-blue-50 border-2 border-dashed border-blue-300 rounded-xl px-4 py-3 text-center">
                        <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Stejskal-Tanner Equation</span>
                        <div className="text-lg font-semibold text-slate-800 mt-1 whitespace-nowrap overflow-x-auto">
                            I<sub>G</sub> = I<sub>G=0</sub>·exp[ −(γ·δ·G)<sup>2</sup>·D·(Δ − δ/3) ] + C
                        </div>
                    </div>
                    <div className="w-full border border-slate-300 rounded-lg overflow-hidden mt-2 bg-slate-50" style={{ height: '960px' }}>
                        <iframe srcDoc={ST_DOSY_HTML} className="w-full h-full border-0" title="Stejskal-Tanner DOSY Fitter" />
                    </div>
                </>
            )}
        </div>
    );
}

/* ========================================================================== */
/* STABLE SECTION WRAPPERS (module-level)
   ---------------------------------------------------------------------------
   These must stay at module scope. When they were defined inline inside
   NMRFittingsTestRenderer, every render created brand-new component functions,
   so React unmounted/remounted the whole subtree on each keystroke — which
   collapsed every CollapsibleSection and dropped input focus.

   The render helpers (renderTableData / renderTableAnalysis) are closures over
   the parent's state, so they are bridged through the mutable `nmrSections`
   registry below (updated every render; the component *types* stay stable).
========================================================================== */
const nmrSections = {
    renderData: null,     // (t, tIndex) => ReactNode
    renderAnalysis: null, // (t, tIndex) => ReactNode
    addTable: null,       // () => void
    sim: {},
    setSim: null,         // (patch) => void
    solvents: [],
};

const NMRSetupSection = ({ ctx }) => {
    const activeTest = ctx.activeTest || {};
    const update = (u) => { if (ctx.updateActiveTest) ctx.updateActiveTest(u); };
    return (
        <CollapsibleSection title="Experiment Setup" icon="🧭" defaultOpen={false}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">NMR Dataset Name</label>
                    <input type="text" value={activeTest.nmrDatasetName || ''} onChange={(e) => update({ nmrDatasetName: e.target.value })} placeholder="e.g. 15N_T2_relax_series" className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Experiment Number</label>
                    <input type="text" value={activeTest.nmrExpNumber || ''} onChange={(e) => update({ nmrExpNumber: e.target.value })} placeholder="e.g. 42" className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Link (URL)</label>
                    <input type="text" value={activeTest.nmrLink || ''} onChange={(e) => update({ nmrLink: e.target.value })} placeholder="https://..." className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                </div>
            </div>
        </CollapsibleSection>
    );
};

const NMRFittingSection = ({ ctx }) => {
    const tables = Array.isArray(ctx.activeTest?.nmrTables) ? ctx.activeTest.nmrTables : [];
    return (
        <div className="flex flex-col gap-6">
            {tables.map((t, i) => (nmrSections.renderAnalysis ? nmrSections.renderAnalysis(t, i) : null))}
        </div>
    );
};

const NMRDataSection = ({ ctx }) => {
    const tables = Array.isArray(ctx.activeTest?.nmrTables) ? ctx.activeTest.nmrTables : [];
    return (
        <div className="flex flex-col gap-6">
            {tables.map((t, i) => (nmrSections.renderData ? nmrSections.renderData(t, i) : null))}
            {nmrSections.addTable && (
                <button onClick={nmrSections.addTable} className="self-start text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-md shadow-sm">+ Add relaxation table</button>
            )}
        </div>
    );
};

const NMRSimulationsSection = ({ ctx }) => (
    <SimulationSection sim={nmrSections.sim} setSim={nmrSections.setSim} solvents={nmrSections.solvents} activeTest={ctx.activeTest} />
);

/* ========================================================================== */
export const NMRFittingsTestRenderer = ({ activeTest = {}, updateActiveTest, TestHeader, compoundMeta = {}, allCmpds = [], ...rest }) => {
    const update = (u) => { if (updateActiveTest) updateActiveTest(u); };
    const tables = Array.isArray(activeTest.nmrTables) ? activeTest.nmrTables : [];
    const [fits, setFits] = useState(activeTest.savedFits || {});
    const [fsPanel, setFsPanel] = useState(null);
    const [showChartCfg, setShowChartCfg] = useState(false);
    const [chartType, setChartType] = useState('line'); // 'line' or 'hist'
    const manualErrors = activeTest.manualErrors || {};
    const chartCfg = { yMin: '', yMax: '', xMin: '', xMax: '', ptStyle: 'circle', ptSize: 5, fontSize: 12, xPos: 'bottom', yPos: 'left', xAxisLabel: '', lineStyle: 'solid', lineThickness: 2, ...(activeTest.chartCfg || {}) };

    useEffect(() => { if (!Array.isArray(activeTest.nmrTables) || activeTest.nmrTables.length === 0) update({ nmrTables: [makeTable()] }); }, []);

    const sim = { nucleus: '15N', fieldMHz: 600, tau_c_ns: 5, S2: 0.85, useInternal: false, tau_e_ps: 50, r_A: 1.02, csa_ppm: -160, temperature: 298, viscosity: 0.89e-3, vbar: 0.73, hydration: 0.3, MW: 12000, shape: 'sphere', ...(activeTest.sim || {}) };
    const setSim = (patch) => update({ sim: { ...sim, ...patch } });

    const updateTable = (id, patch) => update({ nmrTables: tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    const setCell = (t, r, c, v) => { const g = t.grid.map((row) => row.slice()); while (g.length < t.nRows) g.push(new Array(t.nCols).fill('')); while (g[r].length < t.nCols) g[r].push(''); g[r][c] = v; updateTable(t.id, { grid: g }); };
    const setDelay = (t, r, v) => { const d = t.delays.slice(); d[r] = v; updateTable(t.id, { delays: d }); };
    const setColResidue = (t, c, v) => { const cr = t.colResidues.slice(); cr[c] = v; updateTable(t.id, { colResidues: cr }); };
    const addRow = (t) => { const last = t.delays.length ? Number(t.delays[t.delays.length - 1]) || 0 : 0; updateTable(t.id, { nRows: t.nRows + 1, delays: [...t.delays, last], grid: [...t.grid.map((r) => r.slice()), new Array(t.nCols).fill('')] }); };
    const removeRow = (t, r) => { if (t.nRows <= 1) return; updateTable(t.id, { nRows: t.nRows - 1, delays: t.delays.filter((_, i) => i !== r), grid: t.grid.filter((_, i) => i !== r) }); };
    const addCol = (t) => { updateTable(t.id, { nCols: t.nCols + 1, colResidues: [...t.colResidues, ''], grid: t.grid.map((r) => [...r, '']) }); };
    const removeCol = (t, c) => { if (t.nCols <= 1) return; updateTable(t.id, { nCols: t.nCols - 1, colResidues: t.colResidues.filter((_, i) => i !== c), grid: t.grid.map((r) => r.filter((_, i) => i !== c)) }); };
    const addTable = () => update({ nmrTables: [...tables, makeTable()] });
    const duplicateTable = (t) => update({ nmrTables: [...tables, { ...t, id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), grid: t.grid.map((r) => r.slice()), delays: t.delays.slice(), colResidues: t.colResidues.slice() }] });
    const removeTable = (id) => {
        if (tables.length <= 1) { alert('Keep at least one table.'); return; }
        update({ nmrTables: tables.filter((t) => t.id !== id) });
        setFits((prev) => { const next = { ...prev }; delete next[id]; return next; });
    };

    const storeManualErr = (tId, res, val) => { const inner = { ...(manualErrors[tId] || {}) }; inner[res] = val; update({ manualErrors: { ...manualErrors, [tId]: inner } }); };
    const clearManualErr = (tId, res) => { const inner = { ...(manualErrors[tId] || {}) }; delete inner[res]; const next = { ...manualErrors }; if (Object.keys(inner).length === 0) delete next[tId]; else next[tId] = inner; update({ manualErrors: next }); };

    const runFitForTable = (t) => {
        const unit = t.delayUnit === 'ms' ? 1e-3 : 1; const cols = [];
        for (let c = 0; c < t.nCols; c++) {
            const xs = [], ys = [];
            for (let r = 0; r < t.nRows; r++) {
                const x = Number(t.delays[r]), y = parseFloat(t.grid[r]?.[c]);
                if (isFinite(x) && isFinite(y)) { xs.push(x); ys.push(y); }
            }
            let fit = null, fitS = null;
            if (t.relaxType === 'T1') fit = fitInversionRecovery(xs, ys); else fit = fitMonoExp(xs, ys);
            if (fit) {
                const R_s = fit.R / unit;
                fitS = { ...fit, R_s, T_s: R_s > 0 ? 1 / R_s : Infinity, seR_s: fit.seR != null ? fit.seR / unit : null };
            }
            cols.push({ residue: t.colResidues[c] || `Col ${c + 1}`, fit: fitS });
        }

        const nextFits = { ...fits, [t.id]: cols };
        setFits(nextFits);
        update({ savedFits: nextFits });
    };

const exportFittedTable = (t, colFits) => {
        try {
            const wb = XLSX.utils.book_new();
            const aoa = [['Residue', `Rate (${t.relaxType === 'T1' ? 'R1' : t.relaxType === 'DOSY' ? 'D' : 'R2'}) s⁻¹`, t.relaxType !== 'DOSY' ? `${t.relaxType} (s)` : null, 'R²', 'N', 'Error'].filter(Boolean)];
            colFits.forEach(cf => {
                if (!cf.fit) return;
                const row = [cf.residue, cf.fit.R_s];
                if (t.relaxType !== 'DOSY') row.push(cf.fit.T_s === Infinity ? '∞' : cf.fit.T_s);
                row.push(cf.fit.r2, cf.fit.n, cf.effectiveError || cf.fit.seR_s || 0);
                aoa.push(row.filter(Boolean));
            });
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            XLSX.utils.book_append_sheet(wb, ws, 'Fitted Parameters');
            XLSX.writeFile(wb, `NMR_Fitting_${t.relaxType}_${Date.now()}.xlsx`);
        } catch (e) { console.error(e); alert('Export failed: ' + e.message); }
    };

    const renderTableData = (t, tIndex) => {
        return (
            <CollapsibleSection key={t.id} title={`Table ${tIndex + 1} Data — ${t.atom || '…'} (${t.relaxType})`} icon="📈" defaultOpen={false}>
                <div className="flex flex-col gap-4">
                    {/* Dataset info row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Dataset Name</label>
                            <input type="text" value={t.datasetName || ''} onChange={(e) => updateTable(t.id, { datasetName: e.target.value })} placeholder="e.g. 15N_T2_relax" className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Experiment Number</label>
                            <input type="text" value={t.expNumber || ''} onChange={(e) => updateTable(t.id, { expNumber: e.target.value })} placeholder="e.g. 42" className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Link (URL)</label>
                            <input type="text" value={t.link || ''} onChange={(e) => updateTable(t.id, { link: e.target.value })} placeholder="https://..." className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                    </div>

                    {/* Data table */}
                    <div className="overflow-auto border border-slate-300 rounded-lg bg-white shadow-inner">
                        <table className="border-collapse text-xs w-full">
                            <thead>
                                <tr>
                                    <th className="bg-slate-200 border border-slate-300 p-1 sticky top-0 left-0 z-20 text-slate-600">{t.relaxType === 'DOSY' ? 'b-value / G²' : 'Delay'} ({t.delayUnit})</th>
                                    {Array.from({ length: t.nCols }, (_, c) => (
                                        <th key={c} className="bg-slate-100 border border-slate-300 p-1 min-w-[110px] sticky top-0 z-10 group relative">
                                            <div className="flex flex-col gap-1 w-full relative">
                                                <input value={t.colResidues[c] || ''} onChange={(e) => setColResidue(t, c, e.target.value)} placeholder="residue" className="w-full text-center border border-slate-300 rounded p-1 text-[11px] font-bold text-blue-800" />
                                                <button onClick={() => removeCol(t, c)} className="absolute -top-1 -right-1 bg-red-100 text-red-500 hover:bg-red-500 hover:text-white rounded-full w-5 h-5 flex items-center justify-center font-bold opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" title="Delete Column">✕</button>
                                            </div>
                                        </th>
                                    ))}
                                    <th className="bg-slate-50 border border-slate-200 p-1 sticky top-0 z-10"><button onClick={() => addCol(t)} className="text-blue-600 hover:text-blue-800 font-bold text-[11px] bg-blue-50 px-2 py-1 rounded w-full h-full transition-colors">+ Add Col</button></th>
                                </tr>
                            </thead>
                            <tbody>
                                {Array.from({ length: t.nRows }, (_, r) => (
                                    <tr key={r}>
                                        <td className="bg-slate-100 border border-slate-300 p-0.5 sticky left-0 z-10">
                                            <div className="flex items-center justify-between px-1">
                                                <input type="number" step="any" value={t.delays[r]} onChange={(e) => setDelay(t, r, e.target.value === '' ? '' : Number(e.target.value))} className="w-16 text-center border border-slate-300 rounded p-1 text-[11px] font-mono" />
                                                <button onClick={() => removeRow(t, r)} className="text-red-400 hover:text-red-600 text-[11px] font-bold ml-1 px-1" title="Delete Row">✕</button>
                                            </div>
                                        </td>
                                        {Array.from({ length: t.nCols }, (_, c) => (
                                            <td key={c} className="border border-slate-200 p-0"><input value={t.grid[r]?.[c] ?? ''} onChange={(e) => setCell(t, r, c, e.target.value)} className="w-full h-8 text-center outline-none focus:bg-blue-50 focus:ring-1 focus:ring-blue-400 font-mono text-[11px]" /></td>
                                        ))}
                                        <td className="border border-slate-100 p-0.5 text-center text-slate-300 bg-slate-50">·</td>
                                    </tr>
                                ))}
                                <tr><td colSpan={t.nCols + 2} className="bg-slate-50 border border-slate-200 p-2"><button onClick={() => addRow(t)} className="text-blue-600 hover:text-blue-800 font-bold text-[11px] w-full text-left pl-2">+ Add Delay Row</button></td></tr>
                            </tbody>
                        </table>
                    </div>

                    <div className="flex justify-end pt-2 border-t border-slate-100">
                       <button onClick={() => removeTable(t.id)} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-4 py-2 rounded-md shadow-sm flex items-center gap-2 transition-colors">🗑️ Delete Entire Table</button>
                    </div>
                </div>
            </CollapsibleSection>
        );
    };

const renderTableAnalysis = (t, tIndex) => {
        const colFits = (fits[t.id] || []).map(cf => ({ ...cf, effectiveError: manualErrors[t.id]?.[cf.residue] ?? (cf.fit?.seR_s || 0) }));
        return (
            <CollapsibleSection key={t.id} title={`Table ${tIndex + 1} Analysis — ${t.atom || '…'} (${t.relaxType})`} icon="📐" defaultOpen={false}>
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Observed atom</label>
                            <input type="text" value={t.atom || 'HN'} onChange={(e) => updateTable(t.id, { atom: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" placeholder="HN" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Experiment Type</label>
                            <select value={t.relaxType} onChange={(e) => updateTable(t.id, { relaxType: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500">
                                <option value="T1">T1 (Inversion Recovery)</option>
                                <option value="T2">T2 / T1rho (Exponential)</option>
                                <option value="DOSY">DOSY (Diffusion)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t.relaxType === 'DOSY' ? 'X Unit' : 'Delay unit'}</label>
                            <select value={t.delayUnit} onChange={(e) => updateTable(t.id, { delayUnit: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500">
                                <option value="ms">ms</option> <option value="s">s</option>{t.relaxType === 'DOSY' && <option value="s/mm2">s/mm²</option>}
                            </select>
                        </div>
                        <div className="flex items-end gap-2">
                            <button onClick={() => runFitForTable(t)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 w-full rounded-md shadow-sm transition-colors">▶️ Compute Fit</button>
                        </div>
                        <div className="flex items-end gap-2">
                            <button onClick={() => duplicateTable(t)} className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold px-3 py-2 w-full rounded-md transition-colors">♻️ Duplicate</button>
                        </div>
                    </div>
                    
                    {/* Chart type & Config controls */}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-1">
                        <div className="flex items-center gap-3">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Chart Type:</label>
                            <select value={chartType} onChange={(e) => setChartType(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white outline-none focus:border-blue-500">
                                <option value="line">Line / Scatter</option>
                                <option value="hist">Histogram</option>
                            </select>
                        </div>
                        <ChartControlBar
                            showCfg={showChartCfg === t.id}
                            onToggleCfg={() => setShowChartCfg(showChartCfg === t.id ? false : t.id)}
                            className="flex gap-2"
                        />
                    </div>

                    {showChartCfg === t.id && (
                        <div className="mb-2">
                            <SharedChartStylePanel
                                cfg={{ ...activeTest.chartCfg }}
                                setCfg={(patch) => update({ chartCfg: { ...(activeTest.chartCfg || {}), ...patch } })}
                                series={[]}
                                showHeightSlider={false}
                            />
                        </div>
                    )}

                    {/* Fitted results table — expandable and exportable */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-bold text-slate-600 uppercase">Fitted {t.relaxType} per residue</h4>
                            <button onClick={() => exportFittedTable(t, colFits)} className="text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded shadow-sm">📊 Export XLS</button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="text-xs border border-slate-200 rounded w-full">
                                <thead>
                                    <tr className="bg-slate-100 text-slate-600">
                                        <th className="p-1.5 border border-slate-200">Residue</th>
                                        <th className="p-1.5 border border-slate-200">{t.relaxType === 'DOSY' ? 'D (Diff. Rate)' : `R (${t.relaxType === 'T1' ? 'R1' : 'R2'}) s⁻¹`}</th>
                                        {t.relaxType !== 'DOSY' && <th className="p-1.5 border border-slate-200">{t.relaxType} (s)</th>}
                                        <th className="p-1.5 border border-slate-200">R²</th><th className="p-1.5 border border-slate-200">N</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {colFits.length === 0 ? (<tr><td colSpan={5} className="p-3 text-center text-slate-400">Click "Compute Fit" to calculate parameters.</td></tr>) : (
                                        colFits.map((cf, i) => (
                                            <tr key={i} className="text-center">
                                                <td className="p-1.5 border border-slate-200 font-bold text-blue-800">{cf.residue}</td>
                                                <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? (t.relaxType === 'DOSY' ? cf.fit.R_s.toExponential(3) : cf.fit.R_s.toFixed(3)) + (cf.effectiveError ? ` ± ${cf.effectiveError.toExponential(2)}` : '') : '—'}</td>
                                                {t.relaxType !== 'DOSY' && (<td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? (cf.fit.T_s === Infinity ? '∞' : cf.fit.T_s.toFixed(3)) : '—'}</td>)}
                                                <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? cf.fit.r2.toFixed(3) : '—'}</td>
                                                <td className="p-1.5 border border-slate-200">{cf.fit ? cf.fit.n : 0}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Error Management Panel per Table */}
                    {colFits.some(cf => cf.fit) && (
                        <div className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg shadow-sm">
                            <h4 className="text-xs font-black text-orange-800 uppercase mb-3 border-b border-orange-100 pb-2">Manual SD Overrides (Parameter Err)</h4>
                            <div className="flex flex-wrap gap-3">
                                {colFits.filter(cf => cf.fit).map(cf => {
                                    const isOverridden = typeof manualErrors[t.id]?.[cf.residue] === 'number';
                                    return (
                                        <ErrInput
                                            key={cf.residue}
                                            label={cf.residue}
                                            value={isOverridden ? manualErrors[t.id][cf.residue] : cf.fit.seR_s}
                                            sdRaw={cf.fit.seR_s}
                                            isOverridden={isOverridden}
                                            onSave={(v) => storeManualErr(t.id, cf.residue, v)}
                                            onReset={() => clearManualErr(t.id, cf.residue)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Charts — FULL WIDTH, one per line */}
                    <div className="flex flex-col gap-4 relative">
                        {fsPanel === `decay_${t.id}` && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)}></div>}
                        <div className={`border border-slate-200 rounded-lg bg-white ${fsPanel === `decay_${t.id}` ? 'z-[999999]' : 'p-3'}`}>
                            <DecayChart table={t} colFits={colFits} chartCfg={chartCfg} isFs={fsPanel === `decay_${t.id}`} onToggleFs={() => setFsPanel(fsPanel === `decay_${t.id}` ? null : `decay_${t.id}`)} chartType={chartType} />
                        </div>

                        {fsPanel === `param_${t.id}` && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)}></div>}
                        <div className={`border border-slate-200 rounded-lg bg-white ${fsPanel === `param_${t.id}` ? 'z-[999999]' : 'p-3'}`}>
                            <ParameterChart table={t} colFits={colFits} chartCfg={chartCfg} isFs={fsPanel === `param_${t.id}`} onToggleFs={() => setFsPanel(fsPanel === `param_${t.id}` ? null : `param_${t.id}`)} chartType={chartType} />
                        </div>
                    </div>

                    {/* Individual Fittings Panel */}
                    {colFits.length > 0 && (
                        <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg shadow-sm">
                            <h4 className="text-xs font-black text-slate-700 uppercase mb-3 border-b border-slate-200 pb-2">Individual Fittings</h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                                {colFits.map((cf, c) => (
                                    <React.Fragment key={c}>
                                        {fsPanel === `indiv_${t.id}_${c}` && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)}></div>}
                                        <IndividualDecayChart
                                            table={t}
                                            colIndex={c}
                                            colFit={cf}
                                            chartCfg={chartCfg}
                                            isFs={fsPanel === `indiv_${t.id}_${c}`}
                                            onToggleFs={() => setFsPanel(fsPanel === `indiv_${t.id}_${c}` ? null : `indiv_${t.id}_${c}`)}
                                        />
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </CollapsibleSection>
        );
    };

    // Bridge the render-time closures into the stable module-level section
    // components (see nmrSections registry above). Because the components
    // themselves keep a constant identity, typing in any table cell or the
    // Experiment Setup fields no longer remounts the sections.
    nmrSections.renderData = (t, i) => renderTableData(t, i);
    nmrSections.renderAnalysis = (t, i) => renderTableAnalysis(t, i);
    nmrSections.addTable = addTable;
    nmrSections.sim = sim;
    nmrSections.setSim = setSim;
    nmrSections.solvents = rest.solvents || [];

    return (
        <TestShellRenderer
            config={NMR_FITTING_TAB_CONFIG}
            custom={{
                Setup: NMRSetupSection,
                Data: NMRDataSection,
                Fitting: NMRFittingSection,
                InstrumentalSetup: NMRInstrumentalSetup,
                Simulations: NMRSimulationsSection,
            }}
            activeTest={activeTest}
            updateActiveTest={updateActiveTest}
            TestHeader={TestHeader}
            compoundMeta={compoundMeta}
            allCmpds={allCmpds}
            {...rest}
        />
    );
};

export default NMRFittingsTestRenderer;
