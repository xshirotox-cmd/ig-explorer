/* Ig Biosensor Data Explorer — big-plot layout, sidebar selectors. */
const D = {}, PCACHE = {};
const COLOR = {IgG:"#5b9dff", IgM:"#46c98b", IgA:"#f0a85a"};
const ROLECOLOR = {control:"#8b97b3", sensor:"#5b9dff", other:"#5a6b8c"};
const PALETTE = ["#5b9dff","#46c98b","#f0a85a","#c98be0","#e06a6a","#54c6d6"];
const ROUTES = [["dose-response","Dose-Response"],["morphology","i-t Morphology"],
  ["reproducibility","Reproducibility"],["samples","Real Samples"],["overview","Browse"]];

const BASE_LAYOUT = {paper_bgcolor:"#171e2e", plot_bgcolor:"#171e2e", autosize:true,
  font:{color:"#cdd6ea", size:14}, margin:{t:34,r:24,b:60,l:74}, hovermode:"closest",
  xaxis:{gridcolor:"#2b3650",zerolinecolor:"#33405e",titlefont:{size:14},automargin:true},
  yaxis:{gridcolor:"#2b3650",zerolinecolor:"#33405e",titlefont:{size:14},automargin:true},
  legend:{bgcolor:"rgba(20,26,42,.6)",bordercolor:"#2b3650",borderwidth:1,font:{size:12}},
  title:{font:{size:17},x:.01,xanchor:"left"}};
const CFG = {responsive:true, displaylogo:false, modeBarButtonsToRemove:["lasso2d","select2d"],
  toImageButtonOptions:{scale:2}};
function layout(extra){ return Object.assign({}, BASE_LAYOUT, extra||{}); }

const $ = s => document.querySelector(s);
const el = (t,a={},...kids)=>{const e=document.createElement(t);
  for(const k in a){ if(k==="html")e.innerHTML=a[k]; else if(k.startsWith("on"))e[k]=a[k]; else e.setAttribute(k,a[k]); }
  kids.flat().forEach(c=>e.appendChild(typeof c==="string"?document.createTextNode(c):c)); return e;};
async function jget(p){const r=await fetch(p); if(!r.ok) throw new Error(p); return r.json();}
async function points(eid){ if(!PCACHE[eid]) PCACHE[eid]=await jget(`data/points/${eid}.json`).catch(()=>({})); return PCACHE[eid]; }
const uniq=a=>[...new Set(a)], mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const std=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};
const pill=(c,t)=>`<span class="pill ${c}">${t||c}</span>`;
const fnum=(x,d=2)=> x==null||isNaN(x)?"–":Number(x).toFixed(d);
const draw=(data,lay)=>Plotly.newPlot("plot",data,lay,CFG);

/* shell: sidebar + big plot + (optional) below area */
function shell(root){
  const side=el("div",{class:"sidebar"});
  const plot=el("div",{class:"plot-big",id:"plot"});
  const below=el("div",{class:"below"});
  root.append(el("div",{class:"layout"}, side, el("div",{class:"stage"}, plot, below)));
  return {side,below};
}
function grp(title,...kids){ return el("div",{class:"grp"}, el("div",{class:"grp-t"},title), ...kids); }
function picker(label,opts,onchange,sel){           // opts: [{value,label}]
  const s=el("select",{onchange});
  opts.forEach(o=>s.append(el("option",{value:o.value, ...(o.value===sel?{selected:"selected"}:{})},o.label)));
  return el("label",{}, label, s);
}

/* ---------- bootstrap ---------- */
async function boot(){
  try{
    [D.manifest,D.exps,D.traces,D.dr,D.repro,D.samples] = await Promise.all([
      jget("data/manifest.json"),jget("data/experiments.json"),jget("data/traces.json"),
      jget("data/doseresponse.json"),jget("data/reproducibility.json"),jget("data/samples.json")]);
  }catch(e){ $("#view").innerHTML=`<p class="loading">Could not load data (${e.message}).<br>
    Serve over http: <code>cd site && python3 -m http.server</code></p>`; return; }
  $("#nav").append(...ROUTES.map(([id,l])=>el("a",{href:`#${id}`},l)));
  $("#manifest").textContent=`${D.manifest.experiments} experiments · ${D.manifest.traces} traces · ${D.manifest.analytes.join(" / ")}`;
  if(!location.hash) location.hash="#dose-response";
  window.addEventListener("hashchange",render); render();
}
function render(){
  const [route,arg]=(location.hash.slice(1)||"dose-response").split("/");
  document.querySelectorAll("#nav a").forEach(a=>a.classList.toggle("active",a.hash===`#${route}`));
  const v=$("#view"); v.innerHTML="";
  (VIEWS[route]||VIEWS["dose-response"])(v, decodeURIComponent(arg||""));
}
const VIEWS={};

/* ---------- dose-response (default landing) ---------- */
VIEWS["dose-response"]=(root)=>{
  const {side,below}=shell(root);
  if(!D.dr.length){ side.append(grp("Dose-response","none harmonized yet")); return; }
  let idx=0;
  const label=d=>`${d.analyte} · ${d.date} · ${d.experiment_id.split("_").slice(2).join(" ")}`;
  side.append(grp("Calibration set",
    picker("Choose a curve set", D.dr.map((d,i)=>({value:i,label:label(d)})), e=>{idx=+e.target.value;paint();}, 0)));
  const stat=el("div"); side.append(grp("Fit", stat));
  side.append(el("div",{class:"note"},"4PL fit when ≥4 points & R²≥0.5, else semi-log linear. Each condition (substrate / flow vs static) is its own curve."));
  function paint(){
    const d=D.dr[idx], data=[]; let rows=[];
    d.curves.forEach((c,ci)=>{ if(!c.points.length) return;
      const col=PALETTE[ci%PALETTE.length];
      const xs=c.points.map(p=>p.conc), ys=c.points.map(p=>p.mean), es=c.points.map(p=>p.sd||0);
      data.push({x:xs,y:ys,error_y:{type:"data",array:es,visible:true,color:col,thickness:1.5},
        mode:"markers",marker:{size:11,color:col,line:{width:1,color:"#0f1420"}},name:c.condition});
      if(c.fit){ const fx=logspace(Math.min(...xs),Math.max(...xs),60);
        data.push({x:fx,y:fx.map(x=>evalFit(c.fit,x)),mode:"lines",line:{color:col,width:2.5,dash:"dot"},
          name:`${c.condition} fit`,hoverinfo:"skip",showlegend:false}); }
      rows.push([c.condition,c.points.length,c.fit?c.fit.type:"–",
        c.fit&&c.fit.ec50!=null?fnum(c.fit.ec50,1):"–", c.fit&&c.fit.r2!=null?fnum(c.fit.r2,3):"–"]);
    });
    draw(data, layout({title:{text:label(d)+"  —  dose-response"},
      xaxis:Object.assign({title:"Concentration (ng/mL)",type:"log"},BASE_LAYOUT.xaxis),
      yaxis:Object.assign({title:"Signal (µA)"},BASE_LAYOUT.yaxis)}));
    const best=d.curves.map(c=>c.fit).filter(Boolean).sort((a,b)=>(b.r2||0)-(a.r2||0))[0];
    stat.innerHTML = best ? `<div class="big-stat">EC50 <b>${best.ec50!=null?fnum(best.ec50,1):"–"}</b> ng/mL</div>
      <div class="big-stat">R² <b>${fnum(best.r2,3)}</b> <span class="tag">(${best.type}, best curve)</span></div>` : `<span class="muted">no fit</span>`;
    below.innerHTML=""; const t=el("table",{},el("thead",{},el("tr",{},...["Condition","Points","Fit","EC50 (ng/mL)","R²"].map(h=>el("th",{},h)))));
    const tb=el("tbody"); rows.forEach(r=>tb.append(el("tr",{},...r.map(c=>el("td",{},String(c)))))); t.append(tb); below.append(t);
  }
  paint();
};
const logspace=(a,b,n)=>{const la=Math.log10(a),lb=Math.log10(b);return [...Array(n)].map((_,i)=>10**(la+(lb-la)*i/(n-1)));};
const evalFit=(f,x)=> f.type==="4pl"? f.d+(f.a-f.d)/(1+(x/f.c)**f.b) : f.slope*Math.log10(x)+f.intercept;

/* ---------- i-t morphology ---------- */
VIEWS.morphology=(root)=>{
  const {side,below}=shell(root);
  const withTraces=D.exps.filter(e=>e.n_traces>0);
  let eid=withTraces[0]?.id, role="", showMean=true;
  side.append(grp("Experiment",
    picker("Choose experiment", withTraces.map(e=>({value:e.id,label:`${e.analyte} · ${e.date} · ${e.description}`})), e=>{eid=e.target.value;paint();}, eid)));
  side.append(grp("Display",
    picker("Role", [{value:"",label:"All roles"},{value:"sensor",label:"Sensors"},{value:"control",label:"Controls"}], e=>{role=e.target.value;paint();}, ""),
    el("label",{class:"row"}, el("input",{type:"checkbox",checked:"checked",onchange:e=>{showMean=e.target.checked;paint();}}), "mean ± SD band")));
  const info=el("div",{class:"muted"}); side.append(grp("Info",info));
  side.append(el("div",{class:"note"},"Faint lines = individual electrode traces; bold line = group mean with ±SD band (resampled to a common time grid)."));
  async function paint(){
    const e=D.exps.find(x=>x.id===eid); const P=await points(eid);
    const tr=D.traces.filter(t=>t.experiment_id===eid && (!role||t.role===role) && P[t.trace_id]);
    const data=[], groups={};
    tr.forEach(t=>{const p=P[t.trace_id], c=role?ROLECOLOR[t.role]:COLOR[t.analyte]||"#888";
      data.push({x:p.t,y:p.i_uA,mode:"lines",line:{width:1,color:c},opacity:.3,name:t.label,hoverinfo:"name",showlegend:false});
      (groups[t.role]=groups[t.role]||[]).push(p);});
    if(showMean) for(const g in groups){ const b=meanBand(groups[g]); if(!b)continue; const col=ROLECOLOR[g]||"#fff";
      data.push({x:b.t.concat(b.t.slice().reverse()),y:b.hi.concat(b.lo.slice().reverse()),fill:"toself",
        fillcolor:hexA(col,.16),line:{width:0},hoverinfo:"skip",showlegend:false});
      data.push({x:b.t,y:b.m,mode:"lines",line:{width:3.5,color:col},name:`${g} mean (n=${groups[g].length})`}); }
    draw(data, layout({title:{text:`${e.analyte} · ${e.date} · ${e.description}  —  i-t traces`},
      xaxis:Object.assign({title:"Time (s)"},BASE_LAYOUT.xaxis),
      yaxis:Object.assign({title:"Current (µA)"},BASE_LAYOUT.yaxis), showlegend:true}));
    info.textContent=`${tr.length} traces${role?` (${role})`:""}.`;
  }
  paint();
};
function meanBand(ps){ const lo=Math.max(...ps.map(p=>p.t[0])), hi=Math.min(...ps.map(p=>p.t[p.t.length-1]));
  if(!(hi>lo))return null; const N=80, grid=[...Array(N)].map((_,i)=>lo+(hi-lo)*i/(N-1));
  const m=[],H=[],L=[]; grid.forEach(x=>{const v=ps.map(p=>interp(p.t,p.i_uA,x)),mm=mean(v),s=std(v);m.push(mm);H.push(mm+s);L.push(mm-s);});
  return {t:grid,m,hi:H,lo:L}; }
function interp(xs,ys,x){ if(x<=xs[0])return ys[0]; if(x>=xs[xs.length-1])return ys[ys.length-1];
  let j=0; while(j<xs.length-1&&xs[j+1]<x)j++; const t=(x-xs[j])/(xs[j+1]-xs[j]); return ys[j]+(ys[j+1]-ys[j])*t; }
function hexA(h,a){const n=parseInt(h.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;}

/* ---------- reproducibility ---------- */
VIEWS.reproducibility=(root)=>{
  const {side,below}=shell(root);
  let an="", role="control";
  side.append(grp("Filter",
    picker("Analyte",[{value:"",label:"All"},...D.manifest.analytes.map(a=>({value:a,label:a}))],e=>{an=e.target.value;paint();},""),
    picker("Role",[{value:"control",label:"Controls"},{value:"sensor",label:"Sensors"}],e=>{role=e.target.value;paint();},"control")));
  const stat=el("div"); side.append(grp("Pooled",stat));
  side.append(el("div",{class:"note"},"Steady-state current (median of each trace's last 20%) per electrode across dates, with mean ± 2SD bands. Controls are the cleanest reproducibility metric."));
  function paint(){
    const set=role==="control"?D.repro.controls:D.repro.sensors;
    const pts=set.filter(t=>(!an||t.analyte===an)&&t.ss_uA!=null);
    const ys=pts.map(t=>t.ss_uA), m=ys.length?mean(ys):0, s=ys.length?std(ys):0;
    const data=[{x:pts.map(t=>t.date),y:ys,mode:"markers",text:pts.map(t=>`${t.analyte} ${t.label}`),
      marker:{size:9,color:pts.map(t=>COLOR[t.analyte]||"#888"),line:{width:.5,color:"#0f1420"}},name:role}];
    const dates=uniq(pts.map(t=>t.date)).sort();
    if(dates.length) [[m,"mean","#cdd6ea","solid"],[m+2*s,"+2SD","#8b97b3","dot"],[m-2*s,"−2SD","#8b97b3","dot"]]
      .forEach(([y,nm,c,d])=>data.push({x:dates,y:dates.map(()=>y),mode:"lines",line:{color:c,width:1,dash:d},name:nm,hoverinfo:"skip"}));
    draw(data, layout({title:{text:`${role} steady-state current${an?` · ${an}`:""}`},
      xaxis:Object.assign({title:"Date"},BASE_LAYOUT.xaxis),
      yaxis:Object.assign({title:"Steady-state current (µA)"},BASE_LAYOUT.yaxis),showlegend:true}));
    stat.innerHTML = ys.length>1 ? `<div class="big-stat">n=<b>${ys.length}</b></div>
      <div class="big-stat">mean <b>${fnum(m)}</b> µA</div><div class="big-stat">CV <b>${fnum(Math.abs(s/m)*100,1)}</b>%</div>` : `<span class="muted">not enough data</span>`;
    const cv=D.repro.replicate_cv.filter(g=>(!an||g.analyte===an)&&g.role===role).sort((a,b)=>a.date<b.date?-1:1);
    below.innerHTML=""; const t=el("table",{},el("thead",{},el("tr",{},...["Date","Analyte","n","Mean (µA)","SD","CV %"].map(h=>el("th",{},h))))); const tb=el("tbody");
    cv.forEach(g=>tb.append(el("tr",{},el("td",{},g.date),el("td",{html:pill(g.analyte)}),el("td",{},String(g.n)),
      el("td",{},fnum(g.mean_uA)),el("td",{},fnum(g.sd_uA)),el("td",{},g.cv_pct==null?"–":fnum(g.cv_pct,1)))));
    t.append(tb); below.append(el("h3",{},"Replicate CV by acquisition"),t,
      role==="sensor"?el("div",{class:"note"},"Sensor groups pool concentrations, so CV reflects dose spread, not pure replicate error."):"");
  }
  paint();
};

/* ---------- real samples ---------- */
VIEWS.samples=(root)=>{
  const {side,below}=shell(root);
  if(!D.samples.length){ side.append(grp("Samples","no data")); return; }
  side.append(grp("Real samples","Measured sensor signal on biological samples, grouped by source (anonymized to type)."));
  const g=D.samples;
  const data=[{type:"bar",x:g.map(s=>`${s.sample_type}<br>${s.analyte} · ${s.date}`),y:g.map(s=>s.mean_uA),
    error_y:{type:"data",array:g.map(s=>s.sd_uA||0),visible:true},
    marker:{color:g.map(s=>s.sample_type==="PBMC"?"#5b9dff":"#46c98b")},
    text:g.map(s=>`n=${s.n}`),textposition:"outside",hoverinfo:"y+text"}];
  draw(data, layout({title:{text:"Real-sample response"},
    yaxis:Object.assign({title:"Steady-state current (µA)"},BASE_LAYOUT.yaxis)}));
  const t=el("table",{},el("thead",{},el("tr",{},...["Sample type","Analyte","Date","n","Mean (µA)","SD","CV %"].map(h=>el("th",{},h)))));
  const tb=el("tbody"); g.forEach(s=>tb.append(el("tr",{},el("td",{},s.sample_type),el("td",{html:pill(s.analyte)}),
    el("td",{},s.date),el("td",{},String(s.n)),el("td",{},fnum(s.mean_uA)),el("td",{},fnum(s.sd_uA)),el("td",{},s.cv_pct==null?"–":fnum(s.cv_pct,1)))));
  t.append(tb); below.append(t);
};

/* ---------- browse (overview) + detail ---------- */
VIEWS.overview=(root)=>{
  const wrap=el("div",{class:"browser"}); root.append(wrap);
  wrap.append(el("h2",{},"Browse experiments"),
    el("div",{class:"cards"},[["experiments",D.exps.length],["traces",D.traces.length],["dose-response",D.dr.length],["sample groups",D.samples.length]]
      .map(([l,n])=>el("div",{class:"card"},el("div",{class:"n"},String(n)),el("div",{class:"l"},l)))));
  const sel=el("select",{onchange:tbl}); sel.append(el("option",{value:""},"All analytes"),...D.manifest.analytes.map(a=>el("option",{value:a},a)));
  wrap.append(el("div",{class:"grp",style:"max-width:260px;margin-bottom:12px"},el("div",{class:"grp-t"},"Filter"),el("label",{},"Analyte",sel)));
  const host=el("div"); wrap.append(host);
  function tbl(){ const a=sel.value; const rows=D.exps.filter(e=>!a||e.analyte===a).sort((x,y)=>x.date<y.date?1:-1);
    host.innerHTML=""; const t=el("table",{},el("thead",{},el("tr",{},...["Date","Analyte","Description","Sample","Traces","Conf.",""].map(h=>el("th",{},h))))); const tb=el("tbody");
    rows.forEach(e=>tb.append(el("tr",{},el("td",{},e.date||"–"),el("td",{html:pill(e.analyte)}),
      el("td",{},e.description, e.shared_folder_with?el("span",{class:"flag",title:"traces under "+e.shared_folder_with}," shared"):""),
      el("td",{},e.sample_type==="standard"?el("span",{class:"muted"},"standard"):e.sample_type),
      el("td",{},String(e.n_traces)),el("td",{html:pill(e.confidence)}),
      el("td",{}, (e.n_traces>0||e.methods)?el("a",{href:`#detail/${encodeURIComponent(e.id)}`},"open ›"):el("span",{class:"muted"},"—")))));
    t.append(tb); host.append(t); }
  tbl();
};
VIEWS.detail=async(root,id)=>{
  const e=D.exps.find(x=>x.id===id);
  const {side,below}=shell(root);
  if(!e){ side.append(grp("Not found", el("a",{class:"link",href:"#overview"},"‹ back to browse"))); return; }
  side.append(grp("Experiment",
    el("div",{class:"big-stat",html:pill(e.analyte)+" "+e.date}),
    el("div",{class:"muted"},e.description),
    el("div",{style:"margin-top:8px",class:"muted"},`Sample: ${e.sample_type}`),
    el("div",{class:"muted"},`Source: ${e.raw_folder||"—"} (${e.confidence})`),
    el("div",{class:"muted"},`${e.n_traces} traces`),
    el("div",{style:"margin-top:10px"}, el("a",{class:"link",href:"#overview"},"‹ back to browse"))));
  if(D.dr.find(d=>d.experiment_id===e.id)) side.append(el("div",{class:"note"},el("a",{class:"link",href:"#dose-response"},"→ has a dose-response set")));
  if(e.shared_folder_with) side.append(el("div",{class:"note"},"Raw traces stored under: "+e.shared_folder_with));
  if(e.n_traces>0){ const P=await points(e.id); const tr=D.traces.filter(t=>t.experiment_id===e.id&&P[t.trace_id]);
    draw(tr.map(t=>({x:P[t.trace_id].t,y:P[t.trace_id].i_uA,mode:"lines",line:{width:1.4,color:t.role==="control"?"#8b97b3":COLOR[t.analyte]||"#888"},name:t.label})),
      layout({title:{text:`${e.analyte} · ${e.date} — traces`},xaxis:Object.assign({title:"Time (s)"},BASE_LAYOUT.xaxis),yaxis:Object.assign({title:"Current (µA)"},BASE_LAYOUT.yaxis),showlegend:true}));
  } else { draw([], layout({title:{text:"No electrochemical traces for this experiment"}})); }
  if(e.methods) below.append(el("h3",{},"Methods"), el("pre",{class:"methods"},e.methods));
};

boot();
