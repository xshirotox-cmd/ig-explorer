/* Ig Biosensor Data Explorer — client-side, pre-computed JSON. */
const D = {};                 // loaded datasets
const PCACHE = {};            // per-experiment point cache
const COLOR = {IgG:"#5b9dff", IgM:"#46c98b", IgA:"#f0a85a"};
const ROLECOLOR = {control:"#8b97b3", sensor:"#5b9dff", other:"#5a6b8c"};
const ROUTES = [["overview","Overview"],["morphology","i-t Morphology"],
  ["dose-response","Dose-Response"],["reproducibility","Reproducibility"],["samples","Real Samples"]];

const PLOT_LAYOUT = {paper_bgcolor:"#171e2e", plot_bgcolor:"#171e2e",
  font:{color:"#cdd6ea"}, margin:{t:30,r:20,b:50,l:60},
  xaxis:{gridcolor:"#2b3650",zerolinecolor:"#2b3650"},
  yaxis:{gridcolor:"#2b3650",zerolinecolor:"#2b3650"}, legend:{bgcolor:"rgba(0,0,0,0)"}};
const PLOT_CFG = {responsive:true, displaylogo:false,
  modeBarButtonsToRemove:["lasso2d","select2d","autoScale2d"]};

const $ = sel => document.querySelector(sel);
const el = (t,a={},...kids) => {const e=document.createElement(t);
  for(const k in a){ if(k==="html")e.innerHTML=a[k]; else if(k.startsWith("on"))e[k]=a[k]; else e.setAttribute(k,a[k]); }
  kids.flat().forEach(c=>e.appendChild(typeof c==="string"?document.createTextNode(c):c)); return e;};
async function jget(p){const r=await fetch(p); if(!r.ok) throw new Error(p); return r.json();}
async function points(eid){ if(!PCACHE[eid]) PCACHE[eid]=await jget(`data/points/${eid}.json`).catch(()=>({})); return PCACHE[eid]; }
const uniq = a => [...new Set(a)];
const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
const std  = a => {if(a.length<2)return 0; const m=mean(a); return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};
const pill = (c,t)=>`<span class="pill ${c}">${t||c}</span>`;
const fnum = (x,d=2)=> x==null||isNaN(x) ? "–" : Number(x).toFixed(d);

/* ---------- bootstrap ---------- */
async function boot(){
  try{
    [D.manifest,D.exps,D.traces,D.dr,D.repro,D.samples] = await Promise.all([
      jget("data/manifest.json"), jget("data/experiments.json"), jget("data/traces.json"),
      jget("data/doseresponse.json"), jget("data/reproducibility.json"), jget("data/samples.json")]);
  }catch(e){ $("#view").innerHTML=`<p class="loading">Could not load data (${e.message}).<br>
    Serve the folder over http: <code>cd site && python3 -m http.server</code></p>`; return; }
  $("#nav").append(...ROUTES.map(([id,lbl])=>el("a",{href:`#${id}`},lbl)));
  $("#manifest").textContent =
    `${D.manifest.experiments} experiments · ${D.manifest.traces} traces · ${D.manifest.analytes.join(" / ")}`;
  window.addEventListener("hashchange",render); render();
}
function render(){
  const [route,arg] = (location.hash.slice(1)||"overview").split("/");
  document.querySelectorAll("#nav a").forEach(a=>a.classList.toggle("active",a.hash===`#${route}`));
  const v=$("#view"); v.innerHTML="";
  (VIEWS[route]||VIEWS.overview)(v, decodeURIComponent(arg||""));
  window.scrollTo(0,0);
}
const VIEWS={};

/* ---------- overview ---------- */
VIEWS.overview = (root)=>{
  const ex=D.exps;
  const cards=[["experiments",ex.length],["traces",D.traces.length],
    ["dose-response sets",D.dr.length],["sample groups",D.samples.length]];
  root.append(el("h2",{},"Overview"),
    el("div",{class:"cards"}, cards.map(([l,n])=>el("div",{class:"card"},
      el("div",{class:"n"},String(n)), el("div",{class:"l"},l)))));
  // filter
  const sel=el("select",{onchange:draw}, el("option",{value:""},"All analytes"),
    ...D.manifest.analytes.map(a=>el("option",{value:a},a)));
  root.append(el("div",{class:"controls"}, el("label",{},"Analyte",sel)));
  const host=el("div"); root.append(host);
  function draw(){
    const a=sel.value; const rows=ex.filter(e=>!a||e.analyte===a)
      .sort((x,y)=>x.date<y.date?1:-1);
    host.innerHTML="";
    const t=el("table",{}, el("thead",{},el("tr",{},
      ...["Date","Analyte","Description","Sample","Traces","Conf.",""].map(h=>el("th",{},h)))));
    const tb=el("tbody");
    rows.forEach(e=>{
      const link = e.n_traces>0 || e.methods ? el("a",{href:`#detail/${encodeURIComponent(e.id)}`},"open ›") : el("span",{class:"muted"},"—");
      tb.append(el("tr",{},
        el("td",{},e.date||"–"),
        el("td",{html:pill(e.analyte)}),
        el("td",{}, e.description, e.shared_folder_with?el("span",{class:"flag",title:"raw traces under "+e.shared_folder_with},"  shared folder"):""),
        el("td",{},e.sample_type==="standard"?el("span",{class:"muted"},"standard"):e.sample_type),
        el("td",{},String(e.n_traces)),
        el("td",{html:pill(e.confidence)}),
        el("td",{},link)));
    });
    t.append(tb); host.append(t);
  }
  draw();
};

/* ---------- i-t morphology ---------- */
VIEWS.morphology = async (root)=>{
  root.append(el("h2",{},"i-t Curve Morphology"));
  const withTraces = D.exps.filter(e=>e.n_traces>0);
  const expSel=el("select",{onchange:draw}, ...withTraces.map(e=>el("option",{value:e.id},`${e.date}  ${e.analyte}  ${e.description}`)));
  const roleSel=el("select",{onchange:draw}, el("option",{value:""},"All roles"),
    el("option",{value:"sensor"},"Sensors"), el("option",{value:"control"},"Controls"));
  const meanChk=el("input",{type:"checkbox",checked:"checked",onchange:draw});
  root.append(el("div",{class:"controls"},
    el("label",{},"Experiment",expSel),
    el("label",{},"Role",roleSel),
    el("label",{class:"chk"}, el("label",{},meanChk,"show mean ± SD band"))));
  root.append(el("div",{class:"note"},"Each faint line is one electrode trace; the bold line is the group mean with a ±SD band (traces resampled to a common time grid). Group by Role to compare sensor vs control morphology."));
  const plot=el("div",{class:"plot",id:"morph"}); root.append(plot);
  const info=el("div",{class:"muted"}); root.append(info);
  async function draw(){
    const eid=expSel.value, role=roleSel.value;
    const P=await points(eid);
    const tr=D.traces.filter(t=>t.experiment_id===eid && (!role||t.role===role) && P[t.trace_id]);
    if(!tr.length){ Plotly.purge("morph"); info.textContent="No traces for this selection."; return; }
    const traces=[]; const groups={};
    tr.forEach(t=>{
      const p=P[t.trace_id]; const c=role?ROLECOLOR[t.role]:COLOR[t.analyte]||"#888";
      traces.push({x:p.t,y:p.i_uA,mode:"lines",line:{width:1,color:c},opacity:.28,
        name:t.label,hoverinfo:"name",showlegend:false});
      (groups[t.role]=groups[t.role]||[]).push(p);
    });
    if(meanChk.checked){
      for(const g in groups){
        const band=meanBand(groups[g]); if(!band) continue;
        const col=ROLECOLOR[g]||"#fff";
        traces.push({x:band.t.concat(band.t.slice().reverse()),
          y:band.hi.concat(band.lo.slice().reverse()),fill:"toself",
          fillcolor:hexA(col,.15),line:{width:0},name:g+" ±SD",hoverinfo:"skip",showlegend:false});
        traces.push({x:band.t,y:band.m,mode:"lines",line:{width:3,color:col},name:`${g} mean (n=${groups[g].length})`});
      }
    }
    Plotly.react("morph",traces,Object.assign({},PLOT_LAYOUT,{
      xaxis:Object.assign({title:"Time (s)"},PLOT_LAYOUT.xaxis),
      yaxis:Object.assign({title:"Current (µA)"},PLOT_LAYOUT.yaxis),
      showlegend:true}),PLOT_CFG);
    info.textContent=`${tr.length} traces shown.`;
  }
  draw();
};
function meanBand(ps){
  const lo=Math.max(...ps.map(p=>p.t[0])), hi=Math.min(...ps.map(p=>p.t[p.t.length-1]));
  if(!(hi>lo)) return null;
  const N=80, grid=[...Array(N)].map((_,i)=>lo+(hi-lo)*i/(N-1));
  const M=[],HI=[],LO=[];
  grid.forEach(x=>{ const vals=ps.map(p=>interp(p.t,p.i_uA,x)); const m=mean(vals),s=std(vals);
    M.push(m);HI.push(m+s);LO.push(m-s); });
  return {t:grid,m:M,hi:HI,lo:LO};
}
function interp(xs,ys,x){
  if(x<=xs[0])return ys[0]; if(x>=xs[xs.length-1])return ys[ys.length-1];
  let j=0; while(j<xs.length-1 && xs[j+1]<x) j++;
  const t=(x-xs[j])/(xs[j+1]-xs[j]); return ys[j]+(ys[j+1]-ys[j])*t;
}
function hexA(h,a){const n=parseInt(h.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;}

/* ---------- dose-response ---------- */
VIEWS["dose-response"] = (root)=>{
  root.append(el("h2",{},"Dose-Response"));
  if(!D.dr.length){root.append(el("p",{class:"muted"},"No harmonized dose-response sets yet."));return;}
  const sel=el("select",{onchange:draw}, ...D.dr.map((d,i)=>el("option",{value:i},`${d.date}  ${d.analyte}  ${d.experiment_id.split("_").slice(2).join(" ")}`)));
  root.append(el("div",{class:"controls"}, el("label",{},"Calibration set",sel)));
  const plot=el("div",{class:"plot",id:"dr"}); root.append(plot);
  const tbl=el("div"); root.append(tbl);
  function draw(){
    const d=D.dr[+sel.value]; const traces=[]; const rows=[];
    const palette=["#5b9dff","#46c98b","#f0a85a","#c98be0","#e06a6a"];
    d.curves.forEach((c,ci)=>{
      if(!c.points.length) return;
      const col=palette[ci%palette.length];
      const xs=c.points.map(p=>p.conc), ys=c.points.map(p=>p.mean),
            es=c.points.map(p=>p.sd||0);
      traces.push({x:xs,y:ys,error_y:{type:"data",array:es,visible:true,color:col},
        mode:"markers",marker:{size:9,color:col},name:c.condition});
      if(c.fit){ const fx=logspace(Math.min(...xs),Math.max(...xs),60);
        const fy=fx.map(x=>evalFit(c.fit,x));
        traces.push({x:fx,y:fy,mode:"lines",line:{color:col,width:2,dash:"dot"},
          name:`${c.condition} fit`,hoverinfo:"skip",showlegend:false}); }
      rows.push([c.condition, c.points.length, c.fit?c.fit.type:"–",
        c.fit&&c.fit.ec50!=null?fnum(c.fit.ec50,1):"–",
        c.fit&&c.fit.r2!=null?fnum(c.fit.r2,3):"–"]);
    });
    Plotly.react("dr",traces,Object.assign({},PLOT_LAYOUT,{
      xaxis:Object.assign({title:"Concentration (ng/mL)",type:"log"},PLOT_LAYOUT.xaxis),
      yaxis:Object.assign({title:"Signal (µA)"},PLOT_LAYOUT.yaxis),showlegend:true}),PLOT_CFG);
    tbl.innerHTML="";
    const t=el("table",{},el("thead",{},el("tr",{},...["Condition","Points","Fit","EC50 (ng/mL)","R²"].map(h=>el("th",{},h)))));
    const tb=el("tbody"); rows.forEach(r=>tb.append(el("tr",{},...r.map(c=>el("td",{},String(c)))))); t.append(tb);
    tbl.append(el("h3",{},"Fit summary"),t,
      el("div",{class:"note"},"4PL fit when ≥4 points and R²≥0.5; otherwise a semi-log linear fit. A flat fit (low R²) means the data showed no real concentration dependence."));
  }
  draw();
};
const logspace=(a,b,n)=>{const la=Math.log10(a),lb=Math.log10(b);
  return [...Array(n)].map((_,i)=>10**(la+(lb-la)*i/(n-1)));};
function evalFit(f,x){ return f.type==="4pl" ? f.d+(f.a-f.d)/(1+(x/f.c)**f.b)
  : f.slope*Math.log10(x)+f.intercept; }

/* ---------- reproducibility ---------- */
VIEWS.reproducibility = (root)=>{
  root.append(el("h2",{},"Reproducibility"));
  root.append(el("div",{class:"note"},"Steady-state current (median of each trace's final 20%). Control-chart view tracks control electrodes across dates; the CV table summarizes replicate spread within each acquisition."));
  // analyte filter
  const sel=el("select",{onchange:draw}, el("option",{value:""},"All analytes"),
    ...D.manifest.analytes.map(a=>el("option",{value:a},a)));
  const roleSel=el("select",{onchange:draw}, el("option",{value:"control"},"Controls"),
    el("option",{value:"sensor"},"Sensors"));
  root.append(el("div",{class:"controls"}, el("label",{},"Analyte",sel), el("label",{},"Role",roleSel)));
  const plot=el("div",{class:"plot",id:"rep"}); root.append(plot);
  const tbl=el("div"); root.append(tbl);
  function draw(){
    const a=sel.value, role=roleSel.value;
    const set = role==="control"?D.repro.controls:D.repro.sensors;
    const pts=set.filter(t=>(!a||t.analyte===a)&&t.ss_uA!=null);
    const vals=pts.map(t=>t.ss_uA), m=vals.length?mean(vals):0, s=vals.length?std(vals):0;
    const traces=[{x:pts.map(t=>t.date),y:vals,mode:"markers",
      marker:{size:8,color:pts.map(t=>COLOR[t.analyte]||"#888")},
      text:pts.map(t=>t.label),name:role}];
    // mean ± 2SD bands
    const dates=uniq(pts.map(t=>t.date)).sort();
    if(dates.length){[ [m,"mean","#cdd6ea","solid"],[m+2*s,"+2SD","#8b97b3","dot"],[m-2*s,"-2SD","#8b97b3","dot"] ]
      .forEach(([y,nm,c,d])=>traces.push({x:dates,y:dates.map(()=>y),mode:"lines",
        line:{color:c,width:1,dash:d},name:nm,hoverinfo:"skip"}));}
    Plotly.react("rep",traces,Object.assign({},PLOT_LAYOUT,{
      xaxis:Object.assign({title:"Date"},PLOT_LAYOUT.xaxis),
      yaxis:Object.assign({title:"Steady-state current (µA)"},PLOT_LAYOUT.yaxis),showlegend:true}),PLOT_CFG);
    // CV table
    const cv=D.repro.replicate_cv.filter(g=>(!a||g.analyte===a)&&g.role===role).sort((x,y)=>x.date<y.date?-1:1);
    tbl.innerHTML="";
    const overall = vals.length>1 ? `Pooled ${role}: n=${vals.length}, mean=${fnum(m)} µA, SD=${fnum(s)} µA, CV=${fnum(Math.abs(s/m)*100,1)}%` : "";
    const t=el("table",{},el("thead",{},el("tr",{},...["Date","Analyte","n","Mean (µA)","SD (µA)","CV %"].map(h=>el("th",{},h)))));
    const tb=el("tbody");
    cv.forEach(g=>tb.append(el("tr",{},el("td",{},g.date),el("td",{html:pill(g.analyte)}),
      el("td",{},String(g.n)),el("td",{},fnum(g.mean_uA)),el("td",{},fnum(g.sd_uA)),
      el("td",{},g.cv_pct==null?"–":fnum(g.cv_pct,1)))));
    t.append(tb);
    tbl.append(el("h3",{},`Replicate CV by acquisition  `), el("div",{class:"stat",html:overall}), t,
      role==="sensor"?el("div",{class:"note"},"Note: sensor groups pool all concentrations in an acquisition, so CV reflects dose spread, not pure replicate error. Controls are the cleaner reproducibility metric."):"");
  }
  draw();
};

/* ---------- real samples ---------- */
VIEWS.samples = (root)=>{
  root.append(el("h2",{},"Real Samples"));
  if(!D.samples.length){root.append(el("p",{class:"muted"},"No real-sample data."));return;}
  root.append(el("div",{class:"note"},"Measured sensor signal (steady-state current) on real biological samples, grouped by sample source. Sources anonymized to type (PBMC, Bone Marrow)."));
  const plot=el("div",{class:"plot",id:"smp"}); root.append(plot);
  const groups=D.samples;
  const x=groups.map(g=>`${g.sample_type}\n${g.analyte} · ${g.date}`);
  const trace=[{type:"bar",x:x,y:groups.map(g=>g.mean_uA),
    error_y:{type:"data",array:groups.map(g=>g.sd_uA||0),visible:true},
    marker:{color:groups.map(g=>g.sample_type==="PBMC"?"#5b9dff":"#46c98b")},
    text:groups.map(g=>`n=${g.n}`),textposition:"outside",hoverinfo:"y+text"}];
  Plotly.newPlot("smp",trace,Object.assign({},PLOT_LAYOUT,{
    yaxis:Object.assign({title:"Steady-state current (µA)"},PLOT_LAYOUT.yaxis),
    xaxis:Object.assign({},PLOT_LAYOUT.xaxis)}),PLOT_CFG);
  const t=el("table",{},el("thead",{},el("tr",{},...["Sample type","Analyte","Date","n","Mean (µA)","SD","CV %"].map(h=>el("th",{},h)))));
  const tb=el("tbody");
  groups.forEach(g=>tb.append(el("tr",{},el("td",{},g.sample_type),el("td",{html:pill(g.analyte)}),
    el("td",{},g.date),el("td",{},String(g.n)),el("td",{},fnum(g.mean_uA)),
    el("td",{},fnum(g.sd_uA)),el("td",{},g.cv_pct==null?"–":fnum(g.cv_pct,1)))));
  t.append(tb); root.append(t);
};

/* ---------- experiment detail ---------- */
VIEWS.detail = async (root,id)=>{
  const e=D.exps.find(x=>x.id===id);
  if(!e){root.append(el("p",{class:"muted"},"Unknown experiment. ",el("a",{href:"#overview"},"Back")));return;}
  root.append(el("a",{href:"#overview",class:"muted"},"‹ all experiments"),
    el("h2",{}, `${e.date} · `, el("span",{html:pill(e.analyte)}), ` ${e.description}`),
    el("p",{class:"muted"},
      `Sample: ${e.sample_type} · raw source: ${e.raw_folder||"—"} · mapping ${e.confidence} · ${e.n_traces} traces`));
  if(e.shared_folder_with) root.append(el("div",{class:"flag"},"Raw traces are stored under the shared-acquisition experiment: "+e.shared_folder_with));
  const dr=D.dr.find(d=>d.experiment_id===e.id);
  if(dr) root.append(el("p",{},el("a",{href:"#dose-response"},"→ has a dose-response set")));
  if(e.n_traces>0){
    root.append(el("h3",{},"Traces"));
    const plot=el("div",{class:"plot",id:"det"}); root.append(plot);
    const P=await points(e.id);
    const tr=D.traces.filter(t=>t.experiment_id===e.id && P[t.trace_id]);
    const data=tr.map(t=>({x:P[t.trace_id].t,y:P[t.trace_id].i_uA,mode:"lines",
      line:{width:1.3,color:t.role==="control"?"#8b97b3":COLOR[t.analyte]||"#888"},name:t.label}));
    Plotly.newPlot("det",data,Object.assign({},PLOT_LAYOUT,{
      xaxis:Object.assign({title:"Time (s)"},PLOT_LAYOUT.xaxis),
      yaxis:Object.assign({title:"Current (µA)"},PLOT_LAYOUT.yaxis),showlegend:true}),PLOT_CFG);
  }
  if(e.methods){ root.append(el("h3",{},"Methods"), el("pre",{class:"methods"},e.methods)); }
};

boot();
