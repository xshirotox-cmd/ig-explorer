// Headless smoke test for app.js using jsc: stub DOM/Plotly/fetch, run each view
// against the real data/*.json. Run from site/:  jsc ../build/harness.js
function FakeNode(tag){this.tag=tag;this.children=[];this.attrs={};this._html="";}
FakeNode.prototype.append=function(){for(var i=0;i<arguments.length;i++){var a=arguments[i];
  if(Array.isArray(a))this.append.apply(this,a); else this.children.push(a);} };
FakeNode.prototype.appendChild=function(c){this.children.push(c);return c;};
FakeNode.prototype.setAttribute=function(k,v){this.attrs[k]=v;};
Object.defineProperty(FakeNode.prototype,"innerHTML",{set:function(v){this._html=v;this.children=[];},get:function(){return this._html;}});
Object.defineProperty(FakeNode.prototype,"textContent",{set:function(v){this._t=v;},get:function(){return this._t||"";}});
Object.defineProperty(FakeNode.prototype,"value",{
  get:function(){ if(this._v!==undefined)return this._v;
    for(var i=0;i<this.children.length;i++){var c=this.children[i]; if(c&&c.tag==="option")return c.attrs.value;} return ""; },
  set:function(v){this._v=v;}});
Object.defineProperty(FakeNode.prototype,"checked",{get:function(){return !!this.attrs.checked;},set:function(v){this.attrs.checked=v;}});
FakeNode.prototype.classList={toggle:function(){},add:function(){},remove:function(){},contains:function(){return false;}};

var store={};
globalThis.document={createElement:function(t){return new FakeNode(t);},
  createTextNode:function(t){return {text:t};},
  querySelector:function(s){return store[s]||(store[s]=new FakeNode("div"));},
  querySelectorAll:function(s){return [];}};
var L={};
globalThis.window={addEventListener:function(t,f){L[t]=f;},scrollTo:function(){}};
globalThis.location={hash:""};
globalThis.Plotly={newPlot:function(){},react:function(){},purge:function(){}};
globalThis.fetch=function(url){return new Promise(function(res){
  try{var txt=read(url);res({ok:true,json:function(){return Promise.resolve(JSON.parse(txt));}});}
  catch(e){res({ok:false,status:404,json:function(){return Promise.reject(e);}});}});};
globalThis.addEventListener=function(t,f){L[t]=f;};

var ERRORS=[];
load("app.js");          // runs boot()
for(var k=0;k<50;k++) drainMicrotasks();

function go(hash,label){
  location.hash=hash;
  try{ if(L.hashchange) L.hashchange(); }catch(e){ ERRORS.push(label+": "+e); }
  for(var k=0;k<60;k++) drainMicrotasks();
}
var routes=["overview","morphology","dose-response","reproducibility","samples"];
routes.forEach(function(r){go("#"+r,r);});
// detail pages for a few experiments
var exps=JSON.parse(read("data/experiments.json"));
exps.slice(0,4).forEach(function(e){ go("#detail/"+encodeURIComponent(e.id),"detail:"+e.id); });
// also a dose-response exp + a sample exp
go("#detail/"+encodeURIComponent("2025-07-14_IgG_low-calibration"),"detail:lowcal");
go("#detail/"+encodeURIComponent("2025-08-06_IgG_PBMC-samples"),"detail:pbmc");

for(var k=0;k<60;k++) drainMicrotasks();
if(ERRORS.length){ print("RUNTIME ERRORS ("+ERRORS.length+"):"); ERRORS.forEach(function(e){print("  "+e);}); }
else print("ALL VIEWS RAN CLEAN ("+(routes.length+6)+" view renders)");
