/**
 * Scene Framer  v7
 *
 * FIXES:
 *  1. shot_data is "required" in Python — JS hides it via computeSize=[0,-4]
 *     This is why crops were 1x1: hidden inputs don't reach process()
 *  2. Empty space: suppress ALL default widget rendering before our canvas
 *     by using onNodeCreated to reorder and collapse ComfyUI's own widgets
 *  3. Default node size: canvas starts at a sensible 560x320 placeholder
 *     before image loads, not 200px of black
 *  4. background_image widget row collapsed to 0 height
 */

import { app } from "../../scripts/app.js";

const MAX  = 8;
const HNDL = 7;
const COLS = ["#E8664A","#7C6FF7","#2EAF82","#E6A020",
              "#4A90D9","#C85A8A","#5BAD5B","#8A8A9A"];
const PRES = [
    {l:"1024×576", w:1024,h:576}, {l:"1216×832",  w:1216,h:832},
    {l:"1024×1024",w:1024,h:1024},{l:"832×1216",  w:832, h:1216},
    {l:"512×512",  w:512, h:512}, {l:"1920×1080", w:1920,h:1080},
];

function mkShot(i){
    return {name:`Shot_${i+1}`,active:false,x:0,y:0,w:0,h:0,out_w:1024,out_h:576};
}

app.registerExtension({
    name:"SceneFramer.v8",

    async beforeRegisterNodeDef(nodeType, nodeData){
        if(nodeData.name !== "SceneFramer") return;

        const orig = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function(){
            orig?.apply(this, arguments);

            const sf = {
                shots:[mkShot(0),mkShot(1),mkShot(2)],
                slot:0, img:null, imgW:1, imgH:1,
                sc:1, ox:0, oy:0, drag:null, rafId:null,
            };
            this._sf = sf;
            sf.node  = this;

            // ── Collapse ALL default ComfyUI widgets to zero height ───────────
            // background_image and shot_data both get hidden visually.
            // shot_data is still "required" so its value DOES reach process().
            setTimeout(()=>{
                for(const w of (this.widgets||[])){
                    if(w.name === "background_image" || w.name === "shot_data"){
                        w.computeSize = () => [0, -4];
                        w.type = "converted-widget";
                        w.hidden = true;
                        // Also zero out the element if it exists in the DOM
                        if(w.element){
                            w.element.style.cssText = "height:0;overflow:hidden;padding:0;margin:0;border:none;";
                        }
                    }
                }
                // Collapse the input slot label — this is what causes the top empty space
                // LiteGraph renders inputs above DOM widgets; setting slot height to 0
                // removes the gap. We keep the connection dot but hide the label.
                if(this.inputs?.[0]){
                    this.inputs[0].label = "";
                    this.inputs[0].slot_index = 0;
                }
                // Force LiteGraph to use minimum slot height for inputs
                this.slot_start_y = 0;
                this.setDirtyCanvas(true,true);
                // Recalculate node size to remove empty space
                const sz = this.computeSize();
                this.setSize([this.size[0], sz[1]]);
            }, 30);

            // ── Canvas widget ─────────────────────────────────────────────────
            const wrap = document.createElement("div");
            wrap.style.cssText = "position:relative;width:100%;background:#0c0c18;border-radius:6px 6px 0 0;overflow:hidden;line-height:0;";

            const cv = document.createElement("canvas");
            cv.style.cssText = "display:block;width:100%;cursor:crosshair;";
            // Set a default placeholder size immediately
            cv.width  = 560;
            cv.height = 220;
            cv.style.height = "220px";
            sf.cv  = cv;
            sf.ctx = cv.getContext("2d");

            const hint = document.createElement("div");
            hint.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#2a2a50;font:13px monospace;pointer-events:none;gap:8px;";
            hint.innerHTML = `
                <div>Connect background_image</div>
                <div style="font-size:10px;color:#1a1a38">then click Refresh Image</div>`;
            sf.hint = hint;
            // Draw placeholder grid
            drawPlaceholder(sf);

            wrap.appendChild(cv); wrap.appendChild(hint);
            cv.addEventListener("mousedown",  e => onMD(e,sf));
            cv.addEventListener("mousemove",  e => onMM(e,sf));
            cv.addEventListener("mouseup",    e => onMU(e,sf));
            cv.addEventListener("mouseleave", e => onMU(e,sf));

            // ResizeObserver: keeps canvas pixel dimensions correct when node
            // is resized by the user — prevents squish/stretch
            const ro = new ResizeObserver(entries => {
                for(const entry of entries){
                    const newW = entry.contentRect.width;
                    if(newW < 10) continue;
                    const dpr = window.devicePixelRatio||1;
                    if(sf.imgW > 1){
                        const newH = Math.min(Math.max(Math.round(newW*sf.imgH/sf.imgW),180),500);
                        sf.cv.width  = Math.round(newW*dpr);
                        sf.cv.height = Math.round(newH*dpr);
                        sf.cv.style.height = newH+"px";
                    } else {
                        sf.cv.width  = Math.round(newW*dpr);
                        sf.cv.height = Math.round(220*dpr);
                        sf.cv.style.height = "220px";
                    }
                    if(!sf.roRaf) sf.roRaf = requestAnimationFrame(()=>{ redraw(sf); sf.roRaf=null; });
                }
            });
            ro.observe(wrap);
            sf._ro = ro;

            this.addDOMWidget("sf_canvas","div",wrap,{
                computeSize:(w) => {
                    if(sf.imgW > 1){
                        const h = Math.min(Math.max(Math.round(w*sf.imgH/sf.imgW),180),500);
                        return [w, h];
                    }
                    return [w, 220];
                },
                serialize: false,
            });

            // ── Settings panel widget ─────────────────────────────────────────
            const panel = document.createElement("div");
            panel.style.cssText = [
                "font:11px monospace","color:#aaa",
                "background:#0d0d1a","border-radius:0 0 6px 6px",
                "padding:8px","box-sizing:border-box",
            ].join(";");
            sf.panel = panel;

            this.addDOMWidget("sf_panel","div",panel,{
                computeSize:(w)=>[w, 232],
                serialize: false,
            });

            buildPanel(sf);
            setTimeout(()=>tryLoad(this), 400);
        };

        nodeType.prototype.onRemoved = function(){
            if(this._sf?._ro) this._sf._ro.disconnect();
        };

        nodeType.prototype.onSerialize  = function(o){
            o._sf_shots = JSON.parse(JSON.stringify(this._sf.shots));
            o._sf_slot  = this._sf.slot;
        };
        nodeType.prototype.onConfigure = function(o){
            if(o._sf_shots){
                this._sf.shots = o._sf_shots;
                this._sf.slot  = o._sf_slot||0;
                sync(this); buildPanel(this._sf);
            }
            setTimeout(()=>tryLoad(this), 500);
        };
        nodeType.prototype.onConnectionsChange = function(){
            setTimeout(()=>tryLoad(this), 500);
        };
        nodeType.prototype.onExecuted = function(){
            setTimeout(()=>tryLoad(this), 200);
        };
    },
});


// ── Placeholder draw ──────────────────────────────────────────────────────────
function drawPlaceholder(sf){
    const cv=sf.cv, ctx=sf.ctx;
    ctx.fillStyle="#0c0c18"; ctx.fillRect(0,0,cv.width,cv.height);
    ctx.strokeStyle="#1a1a2e"; ctx.lineWidth=1;
    const step=40;
    for(let x=0;x<cv.width;x+=step){
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,cv.height); ctx.stroke();
    }
    for(let y=0;y<cv.height;y+=step){
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(cv.width,y); ctx.stroke();
    }
}


// ── Image loading ─────────────────────────────────────────────────────────────
function tryLoad(node, retries=0){
    const sf  = node._sf;
    const inp = node.inputs?.find(i=>i.name==="background_image");
    if(!inp?.link) return;
    const link = app.graph.links[inp.link];
    if(!link) return;
    const src = app.graph.getNodeById(link.origin_id);
    if(!src) return;

    if(src.imgs?.length){ setImg(sf, src.imgs[0], node); return; }

    if(src.type==="LoadImage"){
        const iw = src.widgets?.find(w=>w.name==="image");
        if(iw?.value){
            const img=new Image();
            img.crossOrigin="anonymous";
            img.onload=()=>setImg(sf,img,node);
            img.src=`/view?filename=${encodeURIComponent(iw.value)}&type=input&subfolder=`;
            return;
        }
    }
    if(retries<15) setTimeout(()=>tryLoad(node,retries+1), 600);
}

function setImg(sf, el, node){
    sf.img=el;
    sf.imgW=el.naturalWidth||el.width||512;
    sf.imgH=el.naturalHeight||el.height||288;

    // Set initial canvas dimensions based on current display width
    const dpr   = window.devicePixelRatio||1;
    const dispW = sf.cv.parentElement?.clientWidth||560;
    const dispH = Math.min(Math.max(Math.round(dispW*sf.imgH/sf.imgW),180),500);
    sf.cv.width  = Math.round(dispW*dpr);
    sf.cv.height = Math.round(dispH*dpr);
    sf.cv.style.height = dispH+"px";

    // Expand default crops to full image on first load
    sf.shots.forEach(s=>{ if(s.w===0){s.w=sf.imgW; s.h=sf.imgH;} });
    sf.hint.style.display="none";
    sync(node);
    redraw(sf);
    // Trigger ComfyUI to recompute node size (removes empty space below image)
    node.setDirtyCanvas(true,true);
    setTimeout(()=>{
        const sz = node.computeSize();
        node.setSize([node.size[0], sz[1]]);
        node.setDirtyCanvas(true,true);
    }, 50);
}


// ── Canvas draw ───────────────────────────────────────────────────────────────
function redraw(sf){
    const cv=sf.cv; if(!cv||!sf.img) return;
    const ctx=sf.ctx, dpr=window.devicePixelRatio||1;
    const W=cv.width/dpr, H=cv.height/dpr;

    ctx.save();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#0c0c18"; ctx.fillRect(0,0,W,H);

    const sc=Math.min(W/sf.imgW,H/sf.imgH);
    const dw=sf.imgW*sc,dh=sf.imgH*sc;
    const ox=(W-dw)/2, oy=(H-dh)/2;
    sf.sc=sc; sf.ox=ox; sf.oy=oy;

    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality="high";
    ctx.drawImage(sf.img,ox,oy,dw,dh);

    // Dim other active shots
    sf.shots.forEach((s,i)=>{
        if(i===sf.slot||!s.active) return;
        const r=tc(sf,s);
        ctx.strokeStyle=COLS[i]+"66"; ctx.lineWidth=1.5;
        ctx.strokeRect(r.x,r.y,r.w,r.h);
        ctx.fillStyle=COLS[i]+"15"; ctx.fillRect(r.x,r.y,r.w,r.h);
        ctx.fillStyle=COLS[i]+"aa"; ctx.font="9px monospace";
        ctx.textAlign="left"; ctx.textBaseline="top";
        ctx.fillText(s.name,r.x+4,r.y+4);
    });

    // Active shot crop
    const shot=sf.shots[sf.slot], r=tc(sf,shot), col=COLS[sf.slot];
    ctx.fillStyle="rgba(0,0,0,0.55)";
    ctx.fillRect(0,0,W,r.y); ctx.fillRect(0,r.y+r.h,W,H-r.y-r.h);
    ctx.fillRect(0,r.y,r.x,r.h); ctx.fillRect(r.x+r.w,r.y,W-r.x-r.w,r.h);

    ctx.strokeStyle=col; ctx.lineWidth=2.5; ctx.strokeRect(r.x,r.y,r.w,r.h);
    ctx.fillStyle=col;
    Object.values(hh(r)).forEach(([hx,hy])=>{
        ctx.beginPath(); ctx.arc(hx,hy,HNDL,0,Math.PI*2); ctx.fill();
    });
    if(r.y>22){
        ctx.fillStyle=col+"dd"; ctx.fillRect(r.x,r.y-20,r.w,20);
        ctx.fillStyle="#fff"; ctx.font="bold 10px monospace";
        ctx.textAlign="left"; ctx.textBaseline="middle";
        ctx.fillText(`${shot.name}  ·  ${Math.round(shot.w)}×${Math.round(shot.h)}  →  ${shot.out_w}×${shot.out_h}`,r.x+5,r.y-10);
    }
    ctx.restore();
}


// ── Panel ─────────────────────────────────────────────────────────────────────
function buildPanel(sf){
    const p=sf.panel; if(!p) return;
    p.innerHTML="";
    const node=sf.node, col=COLS[sf.slot], shot=sf.shots[sf.slot];

    // Tabs + add/remove
    const tr=el("div","display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px;align-items:center;");
    sf.shots.forEach((s,i)=>{
        const c=COLS[i],sel=i===sf.slot;
        const t=el("div",
            `padding:2px 8px;border-radius:4px;cursor:pointer;font-size:10px;white-space:nowrap;`+
            `background:${sel?c+"44":"#1a1a2e"};border:1px solid ${sel?c:"#252540"};`+
            `color:${sel?"#fff":"#555"};`+(s.active?`outline:2px solid ${c}44;outline-offset:1px;`:""));
        t.textContent=s.name;
        t.onclick=()=>{ sf.slot=i; buildPanel(sf); redraw(sf); };
        tr.appendChild(t);
    });
    if(sf.shots.length<MAX){
        const ab=el("div","padding:2px 8px;border-radius:4px;cursor:pointer;font-size:10px;white-space:nowrap;background:#1a2e1a;border:1px solid #2EAF82;color:#2EAF82;");
        ab.textContent="+";
        ab.onclick=()=>{
            sf.shots.push(mkShot(sf.shots.length));
            sf.slot=sf.shots.length-1;
            const ns=sf.shots[sf.slot]; ns.w=sf.imgW||512; ns.h=sf.imgH||288;
            sync(node); buildPanel(sf); redraw(sf);
        };
        tr.appendChild(ab);
    }
    if(sf.shots.length>1){
        const rb=el("div","padding:2px 8px;border-radius:4px;cursor:pointer;font-size:10px;white-space:nowrap;background:#2e1a1a;border:1px solid #E8664A;color:#E8664A;");
        rb.textContent="−";
        rb.onclick=()=>{
            sf.shots.splice(sf.slot,1);
            sf.slot=Math.max(0,sf.slot-1);
            sync(node); buildPanel(sf); redraw(sf);
        };
        tr.appendChild(rb);
    }
    p.appendChild(tr);

    // Active toggle
    const ar=el("div","display:flex;align-items:center;gap:8px;margin-bottom:5px;");
    const tog=document.createElement("input");
    tog.type="checkbox"; tog.checked=shot.active;
    tog.style.cssText=`width:15px;height:15px;cursor:pointer;accent-color:${col};flex-shrink:0;`;
    const slbl=el("span","font-size:11px;");
    const updSlbl=()=>{
        slbl.textContent=tog.checked?`Active — shot_${sf.slot+1} outputs image`:`Inactive — shot_${sf.slot+1} outputs blank`;
        slbl.style.color=tog.checked?col:"#555";
    };
    updSlbl();
    tog.onchange=()=>{ sf.shots[sf.slot].active=tog.checked; updSlbl(); sync(node); redraw(sf); refreshDots(sf); };
    ar.appendChild(tog); ar.appendChild(slbl); p.appendChild(ar);

    // Shot name
    const nr=el("div","display:flex;align-items:center;gap:8px;margin-bottom:5px;");
    const nl=el("span","color:#555;min-width:72px;flex-shrink:0;"); nl.textContent="Shot name:";
    const ni=document.createElement("input");
    ni.type="text"; ni.value=shot.name;
    ni.style.cssText=`flex:1;min-width:0;background:#0a0a14;border:1px solid ${col}44;border-radius:3px;color:#ccc;padding:3px 6px;font:11px monospace;`;
    ni.onchange=()=>{ sf.shots[sf.slot].name=ni.value.trim().replace(/[^a-zA-Z0-9_\- ]/g,"_")||`Shot_${sf.slot+1}`; sync(node); redraw(sf); buildPanel(sf); };
    nr.appendChild(nl); nr.appendChild(ni); p.appendChild(nr);

    // Resolution presets
    const rl=el("div","color:#555;margin-bottom:3px;"); rl.textContent="Output resolution:";
    p.appendChild(rl);
    const rr=el("div","display:flex;flex-wrap:wrap;gap:3px;margin-bottom:5px;");
    PRES.forEach(pr=>{
        const sel=shot.out_w===pr.w&&shot.out_h===pr.h;
        const b=el("div",`padding:2px 7px;border-radius:3px;cursor:pointer;font-size:10px;white-space:nowrap;background:${sel?col:"#12121e"};border:1px solid ${sel?col:"#252540"};color:${sel?"#fff":"#444"};`);
        b.textContent=pr.l;
        b.onclick=()=>{ sf.shots[sf.slot].out_w=pr.w; sf.shots[sf.slot].out_h=pr.h; sync(node); buildPanel(sf); };
        rr.appendChild(b);
    });
    p.appendChild(rr);

    // Custom W×H
    const cr2=el("div","display:flex;align-items:center;gap:6px;margin-bottom:5px;");
    const cl=el("span","color:#555;min-width:72px;flex-shrink:0;"); cl.textContent="Custom:";
    const wi=nIn(shot.out_w,v=>{ sf.shots[sf.slot].out_w=v; sync(node); });
    const xl=el("span","color:#444;"); xl.textContent="×";
    const hi=nIn(shot.out_h,v=>{ sf.shots[sf.slot].out_h=v; sync(node); });
    cr2.appendChild(cl); cr2.appendChild(wi); cr2.appendChild(xl); cr2.appendChild(hi); p.appendChild(cr2);

    // Crop info
    const inf=el("div","color:#383858;font-size:10px;margin-bottom:5px;");
    inf.setAttribute("data-info","1");
    const ar2=shot.h>0?(shot.w/shot.h).toFixed(2):"—";
    inf.textContent=`Crop  X:${Math.round(shot.x)}  Y:${Math.round(shot.y)}  W:${Math.round(shot.w)}  H:${Math.round(shot.h)}  |  Aspect: ${ar2}:1`;
    p.appendChild(inf);

    // Buttons
    const br=el("div","display:flex;gap:6px;flex-wrap:wrap;margin-bottom:5px;");
    br.appendChild(abtn("Reset crop","#252540","#888",()=>{
        const s=sf.shots[sf.slot]; s.x=0;s.y=0;s.w=sf.imgW||512;s.h=sf.imgH||288;
        sync(node); redraw(sf); updInfo(sf);
    }));
    br.appendChild(abtn("Refresh image","#0e1a2e","#4A90D9",()=>{
        sf.img=null; sf.hint.style.display="flex"; drawPlaceholder(sf); tryLoad(node,0);
    }));
    p.appendChild(br);

    // Output dots
    const dr=el("div","display:flex;align-items:center;gap:4px;flex-wrap:wrap;");
    dr.setAttribute("data-dotrow","1");
    const dll=el("span","color:#383858;font-size:9px;min-width:52px;flex-shrink:0;"); dll.textContent="Outputs:";
    dr.appendChild(dll);
    sf.shots.forEach((s,i)=>{
        const c=COLS[i%COLS.length];
        const dot=el("div",
            `width:16px;height:16px;border-radius:50%;cursor:pointer;flex-shrink:0;`+
            `background:${s.active?c:"#1a1a2e"};border:1px solid ${s.active?c:"#252540"};`+
            `display:flex;align-items:center;justify-content:center;font-size:8px;color:${s.active?"#fff":"#333"};`);
        dot.setAttribute("data-dot",i);
        dot.textContent=i+1;
        dot.title=`shot_${i+1}: ${s.name} (${s.active?"active":"inactive"})`;
        dot.onclick=()=>{ sf.slot=i; buildPanel(sf); redraw(sf); };
        dr.appendChild(dot);
    });
    p.appendChild(dr);
}

function refreshDots(sf){
    const dr=sf.panel?.querySelector("[data-dotrow]");
    if(!dr) return;
    sf.shots.forEach((s,i)=>{
        const dot=dr.querySelector(`[data-dot="${i}"]`);
        if(!dot) return;
        const c=COLS[i%COLS.length];
        dot.style.background=s.active?c:"#1a1a2e";
        dot.style.border=`1px solid ${s.active?c:"#252540"}`;
        dot.style.color=s.active?"#fff":"#333";
    });
}

function updInfo(sf){
    const e=sf.panel?.querySelector("[data-info]"); if(!e) return;
    const s=sf.shots[sf.slot],ar=s.h>0?(s.w/s.h).toFixed(2):"—";
    e.textContent=`Crop  X:${Math.round(s.x)}  Y:${Math.round(s.y)}  W:${Math.round(s.w)}  H:${Math.round(s.h)}  |  Aspect: ${ar}:1`;
}


// ── Mouse ──────────────────────────────────────────────────────────────────────
function cp(e,cv){
    const R=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
    return [(e.clientX-R.left)*cv.width/R.width/dpr,(e.clientY-R.top)*cv.height/R.height/dpr];
}
function onMD(e,sf){
    const node=sf.node,[mx,my]=cp(e,sf.cv);
    if(!sf.img) return;
    const s=sf.shots[sf.slot],r=tc(sf,s);
    for(const [nm,[hx,hy]] of Object.entries(hh(r))){
        if(Math.hypot(mx-hx,my-hy)<=HNDL+5){
            sf.drag={type:"resize",h:nm,sx:mx,sy:my,o:{...s}};
            sf.cv.style.cursor="nwse-resize"; return;
        }
    }
    if(iR(mx,my,r)){
        sf.drag={type:"move",sx:mx,sy:my,o:{...s}};
        sf.cv.style.cursor="grabbing"; return;
    }
    const ip=ti(sf,mx,my);
    s.x=ip.x-s.w/2; s.y=ip.y-s.h/2;
    cl2(sf,s); sync(node); redraw(sf); updInfo(sf);
}
function onMM(e,sf){
    if(!sf.drag) return;
    const [mx,my]=cp(e,sf.cv);
    const dx=(mx-sf.drag.sx)/sf.sc,dy=(my-sf.drag.sy)/sf.sc;
    const o=sf.drag.o,s=sf.shots[sf.slot];
    if(sf.drag.type==="move"){s.x=o.x+dx;s.y=o.y+dy;}
    else{
        const h=sf.drag.h;
        if(h.includes("e")) s.w=Math.max(60,o.w+dx);
        if(h.includes("s")) s.h=Math.max(60,o.h+dy);
        if(h.includes("w")){s.x=o.x+dx;s.w=Math.max(60,o.w-dx);}
        if(h.includes("n")){s.y=o.y+dy;s.h=Math.max(60,o.h-dy);}
    }
    cl2(sf,s);
    if(!sf.rafId) sf.rafId=requestAnimationFrame(()=>{redraw(sf);updInfo(sf);sf.rafId=null;});
}
function onMU(e,sf){
    if(!sf.drag) return;
    sf.drag=null; sf.cv.style.cursor="crosshair";
    cancelAnimationFrame(sf.rafId); sf.rafId=null;
    sync(sf.node); redraw(sf); updInfo(sf);
}


// ── Sync shot_data to the required STRING widget ──────────────────────────────
function sync(node){
    const w=node.widgets?.find(w=>w.name==="shot_data");
    if(!w){ console.warn("[SceneFramer] shot_data widget not found!"); return; }
    w.value=JSON.stringify(node._sf.shots.map(s=>({
        name:s.name,active:s.active,
        x:Math.round(s.x),y:Math.round(s.y),
        w:Math.round(s.w),h:Math.round(s.h),
        out_w:s.out_w,out_h:s.out_h,
    })));
}


// ── Helpers ───────────────────────────────────────────────────────────────────
function tc(sf,s){return{x:sf.ox+s.x*sf.sc,y:sf.oy+s.y*sf.sc,w:s.w*sf.sc,h:s.h*sf.sc};}
function ti(sf,cx,cy){return{x:(cx-sf.ox)/sf.sc,y:(cy-sf.oy)/sf.sc};}
function hh(r){return{nw:[r.x,r.y],ne:[r.x+r.w,r.y],sw:[r.x,r.y+r.h],se:[r.x+r.w,r.y+r.h],n:[r.x+r.w/2,r.y],s:[r.x+r.w/2,r.y+r.h],e:[r.x+r.w,r.y+r.h/2],w:[r.x,r.y+r.h/2]};}
function iR(mx,my,r){return mx>=r.x&&mx<=r.x+r.w&&my>=r.y&&my<=r.y+r.h;}
function cl2(sf,s){const mw=sf.imgW||9999,mh=sf.imgH||9999;s.w=Math.max(60,Math.min(s.w,mw));s.h=Math.max(60,Math.min(s.h,mh));s.x=Math.max(0,Math.min(s.x,mw-s.w));s.y=Math.max(0,Math.min(s.y,mh-s.h));}
function el(tag,style){const e=document.createElement(tag);if(style)e.style.cssText=style;return e;}
function nIn(val,cb){const i=document.createElement("input");i.type="number";i.value=val;i.min=64;i.max=4096;i.style.cssText="width:60px;background:#0a0a14;border:1px solid #252540;border-radius:3px;color:#ccc;padding:2px 4px;font:11px monospace;";i.onchange=()=>{const v=parseInt(i.value);if(!isNaN(v)&&v>=64)cb(v);};return i;}
function abtn(lbl,bg,col,fn){const b=document.createElement("button");b.textContent=lbl;b.style.cssText=`padding:3px 10px;background:${bg};border:1px solid ${col};border-radius:3px;color:${col};cursor:pointer;font:10px monospace;`;b.onclick=fn;return b;}
