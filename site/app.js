/* Ig Biosensor Data Explorer — faceted navigation, pastel high-contrast charts. */
const D = {}, PCACHE = {};
const ANALYTE = {IgG:"#ffe08a", IgM:"#9be7a6", IgA:"#ff9e9e"};      // pastel on navy
const CTRL = "#c2ccdf";
const PALETTE = ["#ffe08a","#9be7a6","#ff9e9e","#c9b6f7","#7fd8e0","#f7b6dd","#d9e88a","#f5c08a"];
const ROUTES = [["explore","Explore"],["dose-response","Dose-Response"],
  ["reproducibility","Reproducibility"],["samples","Real Samples"],["overview","Browse"]];

const BASE = {paper_bgcolor:"#0f1420", plot_bgcolor:"#0f1420", autosize:true,
  font:{color:"#e7ecf5", size:14}, margin:{t:36,r:22,b:58,l:74}, hovermode:"closest",
  xaxis:{gridcolor:"#28344e", zerolinecolor:"#3a4a6b", automargin:true, titlefont:{size:14}},
  yaxis:{gridcolor:"#28344e", zerolinecolor:"#3a4a6b", automargin:true, titlefont:{size:14}},
  legend:{bgcolor:"rgba(15,20,32,.7)",bordercolor:"#2b3650",borderwidth:1,font:{size:12}},
  title:{font:{size:16},x:.01,xanchor:"left"}};
const CFG = {responsive:true, displaylogo:false, modeBarButtonsToRemove:["lasso2d","select2d"], toImageButtonOptions:{scale:2}};
const lay = ex => Object.assign({}, BASE, ex||{});
const ax = (title, extra) => Object.assign({title}, BASE.xaxis, extra);
const ay = (title, extra) => Object.assign({title}, BASE.yaxis, extra);

const $ = s => document.querySelector(s);
const el = (t,a={},...k)=>{const e=document.createElement(t);
  for(const x in a){ if(x==="html")e.innerHTML=a[x]; else if(x.startsWith("on"))e[x]=a[x]; else e.setAttribute(x,a[x]); }
  k.flat().forEach(c=>e.appendChild(typeof c==="string"?document.createTextNode(c):c)); return e;};
async function jget(p){const r=await fetch(p); if(!r.ok) throw new Error(p); return r.json();}
async function points(eid){ if(!PCACHE[eid]) PCACHE[eid]=await jget(`data/points/${eid}.json`).catch(()=>({})); return PCACHE[eid]; }
const uniq=a=>[...new Set(a)], mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const std=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};
const pill=(c,t)=>`<span class="pill ${c}">${t||c}</span>`;
const fnum=(x,d=2)=> x==null||isNaN(x)?"–":Number(x).toFixed(d);
const acolor=a=>ANALYTE[a]||"#cccccc";
const drawTo=(id,data,l)=>Plotly.newPlot(id,data,l,CFG);

/* shell: sidebar + 1-2 big plots + below */
function shell(root,opts={}){
  const side=el("div",{class:"sidebar"});
  const stage=el("div",{class:"stage"});
  const plot=el("div",{class:"plot-big",id:"plot"}); stage.append(plot);
  if(opts.two){ stage.append(el("div",{class:"plot-big",id:"plot2",style:"margin-top:10px"})); }
  const below=el("div",{class:"below"}); stage.append(below);
  root.append(el("div",{class:"layout"}, side, stage));
  return {side,below};
}
const grp=(title,...k)=>el("div",{class:"grp"}, el("div",{class:"grp-t"},title), ...k);
function picker(label,opts,val,onchange){
  const s=el("select",{onchange});
  opts.forEach(o=>{const a={value:o.value}; if(o.value===val)a.selected="selected"; s.append(el("option",a,o.label));});
  return el("label",{}, label, s);
}
const interp=(xs,ys,x)=>{ if(x<=xs[0])return ys[0]; if(x>=xs[xs.length-1])return ys[ys.length-1];
  let j=0; while(j<xs.length-1&&xs[j+1]<x)j++; const t=(x-xs[j])/(xs[j+1]-xs[j]); return ys[j]+(ys[j+1]-ys[j])*t; };
function meanBand(ps){ const lo=Math.max(...ps.map(p=>p.t[0])), hi=Math.min(...ps.map(p=>p.t[p.t.length-1]));
  if(!(hi>lo))return null; const N=80,g=[...Array(N)].map((_,i)=>lo+(hi-lo)*i/(N-1));
  const m=[],H=[],L=[]; g.forEach(x=>{const v=ps.map(p=>interp(p.t,p.i_uA,x)),mm=mean(v),s=std(v);m.push(mm);H.push(mm+s);L.push(mm-s);});
  return {t:g,m,hi:H,lo:L}; }
const hexA=(h,a)=>{const n=parseInt(h.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;};

/* ---------- bootstrap ---------- */
async function boot(){
  try{ [D.manifest,D.exps,D.traces,D.dr,D.repro,D.samples]=await Promise.all([
    jget("data/manifest.json"),jget("data/experiments.json"),jget("data/traces.json"),
    jget("data/doseresponse.json"),jget("data/reproducibility.json"),jget("data/samples.json")]);
  }catch(e){ $("#view").innerHTML=`<p class="loading">Could not load data (${e.message}).<br>Serve over http: <code>cd site && python3 -m http.server</code></p>`; return; }
  $("#nav").append(...ROUTES.map(([id,l])=>el("a",{href:`#${id}`},l)));
  $("#manifest").textContent=`${D.manifest.experiments} experiments · ${D.manifest.traces} traces · ${D.manifest.analytes.join(" / ")}`;
  if(!location.hash) location.hash="#explore";
  window.addEventListener("hashchange",render); render();
}
function render(){
  const [route,arg]=(location.hash.slice(1)||"explore").split("/");
  document.querySelectorAll("#nav a").forEach(a=>a.classList.toggle("active",a.hash===`#${route}`));
  const v=$("#view"); v.innerHTML=""; (VIEWS[route]||VIEWS.explore)(v, decodeURIComponent(arg||""));
}
const VIEWS={};

/* ---------- EXPLORE (default): analyte -> standard/media -> conc/source ---------- */
const EXP={analyte:null,kind:null,conc:"all",source:"all",role:"all",focus:null,showMean:true};
VIEWS.explore=(root)=>renderExplore(root);
async function renderExplore(root){
  root.innerHTML=""; const {side,below}=shell(root);
  const analytes=uniq(D.traces.map(t=>t.analyte)).sort();
  if(!analytes.includes(EXP.analyte)) EXP.analyte = analytes.includes("IgG")?"IgG":analytes[0];
  let pool=D.traces.filter(t=>t.analyte===EXP.analyte);
  const kinds=uniq(pool.map(t=>t.kind)).sort();
  if(!kinds.includes(EXP.kind)) EXP.kind = kinds.includes("standard")?"standard":kinds[0];
  pool=pool.filter(t=>t.kind===EXP.kind);

  const reset=()=>{EXP.focus=null;};
  const ctrls=[ picker("Target (analyte)", analytes.map(a=>({value:a,label:a})), EXP.analyte,
      e=>{EXP.analyte=e.target.value; reset(); renderExplore(root);}),
    picker("Type", kinds.map(k=>({value:k,label:k==="standard"?"Standard (spiked)":"Media (real sample)"})), EXP.kind,
      e=>{EXP.kind=e.target.value; reset(); renderExplore(root);}) ];

  if(EXP.kind==="standard"){
    const cs=uniq(pool.map(t=>t.conc_label)).filter(Boolean);
    const concs=cs.filter(c=>c!=="standard").sort((a,b)=>concKey(pool,a)-concKey(pool,b));
    if(cs.includes("standard")) concs.push("standard");
    if(!["all",...concs].includes(EXP.conc)) EXP.conc="all";
    ctrls.push(picker("Concentration", [{value:"all",label:"All concentrations"},...concs.map(c=>({value:c,label:c==="standard"?"unspecified":c}))], EXP.conc,
      e=>{EXP.conc=e.target.value; reset(); renderExplore(root);}));
  }else{
    const srcs=uniq(pool.map(t=>t.source)).filter(Boolean).sort();
    if(!["all",...srcs].includes(EXP.source)) EXP.source="all";
    ctrls.push(picker("Sample source", [{value:"all",label:"All sources"},...srcs.map(s=>({value:s,label:s}))], EXP.source,
      e=>{EXP.source=e.target.value; reset(); renderExplore(root);}));
  }
  ctrls.push(picker("Role", [{value:"all",label:"All"},{value:"sensor",label:"Sensors"},{value:"control",label:"Controls"}], EXP.role,
    e=>{EXP.role=e.target.value; reset(); renderExplore(root);}));
  side.append(grp("Navigate", ...ctrls,
    el("label",{class:"row"}, el("input",{type:"checkbox",...(EXP.showMean?{checked:"checked"}:{}),onchange:e=>{EXP.showMean=e.target.checked; renderExplore(root);}}), "mean ± SD band")));

  // final filter
  let sel=pool.slice();
  if(EXP.kind==="standard" && EXP.conc!=="all") sel=sel.filter(t=>t.conc_label===EXP.conc);
  if(EXP.kind==="media" && EXP.source!=="all") sel=sel.filter(t=>t.source===EXP.source);
  if(EXP.role!=="all") sel=sel.filter(t=>t.role===EXP.role);

  // individual-file box
  const box=el("div",{class:"filelist"});
  sel.forEach(t=>{ const item=el("div",{class:"fileitem"+(EXP.focus===t.trace_id?" on":""),
      onclick:()=>{EXP.focus=EXP.focus===t.trace_id?null:t.trace_id; renderExplore(root);}},
      el("span",{},t.label), el("span",{class:"meta"},`${t.role} · ${t.date}`)); box.append(item); });
  side.append(grp(`Individual files (${sel.length})`,
    EXP.focus?el("div",{}, el("button",{class:"link",onclick:()=>{EXP.focus=null;renderExplore(root);}},"✕ clear focus")):el("span",{class:"muted",style:"font-size:12px"},"click a file to isolate it"),
    box));

  // load points + draw
  const eids=uniq(sel.map(t=>t.experiment_id));
  const P={}; await Promise.all(eids.map(async id=>{P[id]=await points(id);}));
  const colorBy = (EXP.kind==="standard"&&EXP.conc==="all") ? "conc" : (EXP.kind==="media"&&EXP.source==="all") ? "source" : "single";
  const keyOf = t => colorBy==="conc"?t.conc_label : colorBy==="source"?t.source : EXP.analyte;
  const keys = uniq(sel.map(keyOf));
  const colMap={}; keys.forEach((k,i)=>colMap[k]= colorBy==="single"?acolor(EXP.analyte):PALETTE[i%PALETTE.length]);
  const data=[], seen={}, groups={};
  sel.forEach(t=>{ const p=P[t.experiment_id]?.[t.trace_id]; if(!p)return;
    const k=keyOf(t), col=t.role==="control"?CTRL:colMap[k];
    const focusDim = EXP.focus && EXP.focus!==t.trace_id;
    data.push({x:p.t,y:p.i_uA,mode:"lines",line:{width:EXP.focus===t.trace_id?3.5:1.4,color:col},
      opacity:focusDim?.12:(EXP.focus?1:.65),name:k,legendgroup:k,showlegend:!seen[k]&&!EXP.focus,
      hovertext:t.label,hoverinfo:"text"});
    seen[k]=1; (groups[k]=groups[k]||[]).push(p);
  });
  if(EXP.showMean && !EXP.focus) for(const k in groups){ const b=meanBand(groups[k]); if(!b)continue; const col=colMap[k]||CTRL;
    data.push({x:b.t.concat(b.t.slice().reverse()),y:b.hi.concat(b.lo.slice().reverse()),fill:"toself",fillcolor:hexA(col,.13),line:{width:0},legendgroup:k,showlegend:false,hoverinfo:"skip"});
    data.push({x:b.t,y:b.m,mode:"lines",line:{width:3.4,color:col},legendgroup:k,showlegend:false,hoverinfo:"skip"}); }
  const subt = EXP.kind==="standard" ? (EXP.conc==="all"?"all concentrations":EXP.conc) : (EXP.source==="all"?"all sources":EXP.source);
  drawTo("plot", data.length?data:[], lay({title:{text:`${EXP.analyte} · ${EXP.kind} · ${subt}  —  i-t curves`},
    xaxis:ax("Time (s)"), yaxis:ay("Current (µA)"), showlegend:true}));

  // footer: source files
  const byExp=uniq(sel.map(t=>t.experiment_id));
  below.append(el("h3",{},`Data files (${sel.length} traces from ${byExp.length} experiment${byExp.length!==1?"s":""})`),
    el("div",{class:"srcfoot"}, byExp.map(id=>{const e=D.exps.find(x=>x.id===id); const n=sel.filter(t=>t.experiment_id===id).length;
      return el("span",{class:"srcchip"}, el("a",{href:`#detail/${encodeURIComponent(id)}`}, e?`${e.date} ${e.description}`:id), ` ·${n}`);})));
}
function concKey(pool,label){ const t=pool.find(x=>x.conc_label===label); return t&&t.conc_ngml!=null?t.conc_ngml:1e15; }

/* ---------- dose-response ---------- */
VIEWS["dose-response"]=(root)=>{
  const {side,below}=shell(root);
  if(!D.dr.length){ side.append(grp("Dose-response","none yet")); return; }
  let idx=0; const label=d=>`${d.analyte} · ${d.date} · ${d.experiment_id.split("_").slice(2).join(" ")}`;
  side.append(grp("Calibration set", picker("Choose", D.dr.map((d,i)=>({value:i,label:label(d)})), 0, e=>{idx=+e.target.value;paint();})));
  const stat=el("div"); side.append(grp("Best fit",stat));
  side.append(el("div",{class:"note"},"4PL fit when ≥4 pts & R²≥0.5, else semi-log linear. Each condition is one curve."));
  function paint(){ const d=D.dr[idx], data=[], rows=[];
    d.curves.forEach((c,ci)=>{ if(!c.points.length)return; const col=PALETTE[ci%PALETTE.length];
      const xs=c.points.map(p=>p.conc),ys=c.points.map(p=>p.mean),es=c.points.map(p=>p.sd||0);
      data.push({x:xs,y:ys,error_y:{type:"data",array:es,visible:true,color:col,thickness:1.4},mode:"markers",
        marker:{size:11,color:col,line:{width:1,color:"#0f1420"}},name:c.condition});
      if(c.fit){const fx=logspace(Math.min(...xs),Math.max(...xs),60);
        data.push({x:fx,y:fx.map(x=>evalFit(c.fit,x)),mode:"lines",line:{color:col,width:2.5,dash:"dot"},showlegend:false,hoverinfo:"skip"});}
      rows.push([c.condition,c.points.length,c.fit?c.fit.type:"–",c.fit&&c.fit.ec50!=null?fnum(c.fit.ec50,1):"–",c.fit&&c.fit.r2!=null?fnum(c.fit.r2,3):"–"]); });
    drawTo("plot",data,lay({title:{text:label(d)},xaxis:ax("Concentration (ng/mL)",{type:"log"}),yaxis:ay("Signal (µA)"),showlegend:true}));
    const best=d.curves.map(c=>c.fit).filter(Boolean).sort((a,b)=>(b.r2||0)-(a.r2||0))[0];
    stat.innerHTML=best?`<div class="big-stat">EC50 <b>${best.ec50!=null?fnum(best.ec50,1):"–"}</b> ng/mL</div><div class="big-stat">R² <b>${fnum(best.r2,3)}</b> <span class="tag">${best.type}</span></div>`:'<span class="muted">no fit</span>';
    below.innerHTML=""; const t=el("table",{},el("thead",{},el("tr",{},...["Condition","Pts","Fit","EC50","R²"].map(h=>el("th",{},h))))); const tb=el("tbody");
    rows.forEach(r=>tb.append(el("tr",{},...r.map(c=>el("td",{},String(c)))))); t.append(tb); below.append(t);
  } paint();
};
const logspace=(a,b,n)=>{const la=Math.log10(a),lb=Math.log10(b);return [...Array(n)].map((_,i)=>10**(la+(lb-la)*i/(n-1)));};
const evalFit=(f,x)=> f.type==="4pl"? f.d+(f.a-f.d)/(1+(x/f.c)**f.b) : f.slope*Math.log10(x)+f.intercept;

/* ---------- reproducibility (aggregations: all controls / sensors) ---------- */
VIEWS.reproducibility=(root)=>{
  const {side,below}=shell(root,{two:true});
  let role="control", an="all";
  side.append(grp("Aggregation",
    picker("Population",[{value:"control",label:"All controls"},{value:"sensor",label:"All sensors"}],role,e=>{role=e.target.value;paint();}),
    picker("Analyte",[{value:"all",label:"All analytes"},...D.manifest.analytes.map(a=>({value:a,label:a}))],an,e=>{an=e.target.value;paint();})));
  const stat=el("div"); side.append(grp("Pooled",stat));
  side.append(el("div",{class:"note"},"Top: every selected i-t trace overlaid with per-analyte mean ± SD. Bottom: steady-state current per analyte (bar = mean, dots = individual electrodes, jittered)."));
  async function paint(){
    const sub=D.traces.filter(t=>t.role===role&&(an==="all"||t.analyte===an));
    const eids=uniq(sub.map(t=>t.experiment_id)); const P={}; await Promise.all(eids.map(async id=>{P[id]=await points(id);}));
    // top: i-t overlay grouped by analyte
    const data=[],seen={},groups={};
    sub.forEach(t=>{const p=P[t.experiment_id]?.[t.trace_id]; if(!p)return; const col=acolor(t.analyte);
      data.push({x:p.t,y:p.i_uA,mode:"lines",line:{width:1,color:col},opacity:.4,legendgroup:t.analyte,showlegend:!seen[t.analyte],name:t.analyte,hovertext:t.label,hoverinfo:"text"});
      seen[t.analyte]=1;(groups[t.analyte]=groups[t.analyte]||[]).push(p);});
    for(const a in groups){const b=meanBand(groups[a]);if(!b)continue;data.push({x:b.t,y:b.m,mode:"lines",line:{width:3.6,color:acolor(a)},legendgroup:a,showlegend:false,hoverinfo:"skip"});}
    drawTo("plot",data,lay({title:{text:`${role==="control"?"All controls":"All sensors"} — i-t overlay (n=${sub.length})`},xaxis:ax("Time (s)"),yaxis:ay("Current (µA)"),showlegend:true}));
    // bottom: bar + jitter of steady-state by analyte
    const ans=uniq(sub.filter(t=>t.ss_uA!=null).map(t=>t.analyte)).sort();
    const bar={type:"bar",x:ans,y:ans.map(a=>{const v=sub.filter(t=>t.analyte===a&&t.ss_uA!=null).map(t=>t.ss_uA);return v.length?mean(v):0;}),
      marker:{color:ans.map(acolor),opacity:.45,line:{width:1,color:"#0f1420"}},
      error_y:{type:"data",visible:true,array:ans.map(a=>{const v=sub.filter(t=>t.analyte===a&&t.ss_uA!=null).map(t=>t.ss_uA);return v.length>1?std(v):0;})},
      name:"mean",hoverinfo:"y"};
    const jx=[],jy=[],jt=[]; ans.forEach((a,i)=>sub.filter(t=>t.analyte===a&&t.ss_uA!=null).forEach(t=>{jx.push(i+(Math.random()-.5)*0.35);jy.push(t.ss_uA);jt.push(`${t.label} (${t.date})`);}));
    const dots={type:"scatter",mode:"markers",x:jx,y:jy,text:jt,hoverinfo:"text+y",marker:{size:7,color:"#0f1420",line:{width:1.2,color:"#e7ecf5"},opacity:.9},name:"electrodes"};
    drawTo("plot2",[bar,dots],lay({title:{text:"Steady-state current per analyte (bar = mean, dots = electrodes)"},
      xaxis:Object.assign(ax(""),{tickmode:"array",tickvals:ans.map((_,i)=>i),ticktext:ans}),yaxis:ay("Steady-state (µA)"),showlegend:false}));
    const all=sub.filter(t=>t.ss_uA!=null).map(t=>t.ss_uA); const m=all.length?mean(all):0,s=all.length?std(all):0;
    stat.innerHTML=all.length>1?`<div class="big-stat">n=<b>${all.length}</b></div><div class="big-stat">mean <b>${fnum(m)}</b> µA</div><div class="big-stat">CV <b>${fnum(Math.abs(s/m)*100,1)}</b>%</div>`:'<span class="muted">n/a</span>';
    below.innerHTML="";
    const cv=D.repro.replicate_cv.filter(g=>g.role===role&&(an==="all"||g.analyte===an)).sort((a,b)=>a.date<b.date?-1:1);
    const t=el("table",{},el("thead",{},el("tr",{},...["Date","Analyte","n","Mean (µA)","CV %"].map(h=>el("th",{},h))))); const tb=el("tbody");
    cv.forEach(g=>tb.append(el("tr",{},el("td",{},g.date),el("td",{html:pill(g.analyte)}),el("td",{},String(g.n)),el("td",{},fnum(g.mean_uA)),el("td",{},g.cv_pct==null?"–":fnum(g.cv_pct,1)))));
    t.append(tb); below.append(el("h3",{},"Replicate CV by acquisition"),t);
  } paint();
};

/* ---------- real samples ---------- */
VIEWS.samples=(root)=>{
  const {side,below}=shell(root);
  if(!D.samples.length){ side.append(grp("Samples","no data")); return; }
  side.append(grp("Real samples","Sensor signal on biological samples by source (anonymized)."));
  const g=D.samples;
  const data=[{type:"bar",x:g.map(s=>`${s.sample_type}<br>${s.analyte}·${s.date}`),y:g.map(s=>s.mean_uA),
    error_y:{type:"data",array:g.map(s=>s.sd_uA||0),visible:true},
    marker:{color:g.map(s=>acolor(s.analyte)),opacity:.7,line:{width:1,color:"#0f1420"}},
    text:g.map(s=>`n=${s.n}`),textposition:"outside",hoverinfo:"y+text"}];
  drawTo("plot",data,lay({title:{text:"Real-sample response"},yaxis:ay("Steady-state (µA)"),xaxis:ax("")}));
  const t=el("table",{},el("thead",{},el("tr",{},...["Source","Analyte","Date","n","Mean (µA)","CV %"].map(h=>el("th",{},h))))); const tb=el("tbody");
  g.forEach(s=>tb.append(el("tr",{},el("td",{},s.sample_type),el("td",{html:pill(s.analyte)}),el("td",{},s.date),el("td",{},String(s.n)),el("td",{},fnum(s.mean_uA)),el("td",{},s.cv_pct==null?"–":fnum(s.cv_pct,1))))); t.append(tb); below.append(t);
};

/* ---------- browse + detail ---------- */
VIEWS.overview=(root)=>{
  const wrap=el("div",{class:"browser"}); root.append(wrap);
  wrap.append(el("h2",{},"Browse experiments"),
    el("div",{class:"cards"},[["experiments",D.exps.length],["traces",D.traces.length],["dose-response",D.dr.length],["sample groups",D.samples.length]]
      .map(([l,n])=>el("div",{class:"card"},el("div",{class:"n"},String(n)),el("div",{class:"l"},l)))));
  const sel=el("select",{onchange:tbl}); sel.append(el("option",{value:""},"All analytes"),...D.manifest.analytes.map(a=>el("option",{value:a},a)));
  wrap.append(el("div",{class:"grp",style:"max-width:240px;margin-bottom:12px"},el("div",{class:"grp-t"},"Filter"),el("label",{},"Analyte",sel)));
  const host=el("div"); wrap.append(host);
  function tbl(){ const a=sel.value; const rows=D.exps.filter(e=>!a||e.analyte===a).sort((x,y)=>x.date<y.date?1:-1);
    host.innerHTML=""; const t=el("table",{},el("thead",{},el("tr",{},...["Date","Analyte","Description","Sample","Traces","Conf.",""].map(h=>el("th",{},h))))); const tb=el("tbody");
    rows.forEach(e=>tb.append(el("tr",{},el("td",{},e.date||"–"),el("td",{html:pill(e.analyte)}),
      el("td",{},e.description,e.shared_folder_with?el("span",{class:"flag"}," shared"):""),
      el("td",{},e.sample_type==="standard"?el("span",{class:"muted"},"standard"):e.sample_type),
      el("td",{},String(e.n_traces)),el("td",{html:pill(e.confidence)}),
      el("td",{},(e.n_traces>0||e.methods)?el("a",{href:`#detail/${encodeURIComponent(e.id)}`},"open ›"):el("span",{class:"muted"},"—")))));
    t.append(tb); host.append(t); }
  tbl();
};
VIEWS.detail=async(root,id)=>{
  const e=D.exps.find(x=>x.id===id); const {side,below}=shell(root);
  if(!e){ side.append(grp("Not found",el("a",{class:"link",href:"#overview"},"‹ back"))); return; }
  side.append(grp("Experiment", el("div",{class:"big-stat",html:pill(e.analyte)+" "+e.date}),
    el("div",{class:"muted"},e.description), el("div",{style:"margin-top:8px",class:"muted"},`Sample: ${e.sample_type}`),
    el("div",{class:"muted"},`Source: ${e.raw_folder||"—"} (${e.confidence})`), el("div",{class:"muted"},`${e.n_traces} traces`),
    el("div",{style:"margin-top:10px"},el("a",{class:"link",href:"#overview"},"‹ back to browse"))));
  if(e.shared_folder_with) side.append(el("div",{class:"note"},"Traces under: "+e.shared_folder_with));
  if(e.n_traces>0){ const P=await points(e.id); const tr=D.traces.filter(t=>t.experiment_id===e.id&&P[t.trace_id]);
    drawTo("plot",tr.map(t=>({x:P[t.trace_id].t,y:P[t.trace_id].i_uA,mode:"lines",line:{width:1.5,color:t.role==="control"?CTRL:acolor(t.analyte)},name:t.label})),
      lay({title:{text:`${e.analyte} · ${e.date} — traces`},xaxis:ax("Time (s)"),yaxis:ay("Current (µA)"),showlegend:true}));
  } else drawTo("plot",[],lay({title:{text:"No electrochemical traces"}}));
  if(e.methods) below.append(el("h3",{},"Methods"),el("pre",{class:"methods"},e.methods));
};

boot();
