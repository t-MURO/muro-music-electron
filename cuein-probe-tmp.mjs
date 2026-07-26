import { app, BrowserWindow, protocol } from "electron";
import { build } from "esbuild";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createLocalFileResponse } from "./electron/fileProtocol.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([{ scheme: "muro-file", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
const shuffle = (a, seed) => { const o=[...a]; let s=seed; for(let i=o.length-1;i>0;i--){s=(s*1103515245+12345)&0x7fffffff;const j=s%(i+1);[o[i],o[j]]=[o[j],o[i]];} return o; };
app.whenReady().then(async () => {
  const dbPath = path.join(path.dirname(app.getPath("userData")), "muro-music-electron", "muro.db");
  const db = new Database(dbPath, { readonly: true });
  const tracks = db.prepare(`SELECT source_path, bpm, duration_seconds FROM tracks WHERE import_status!='staged' AND COALESCE(is_missing,0)=0 AND duration_seconds>60`).all();
  db.close();
  const sample = shuffle(tracks, 20260726).slice(0, 40).filter(t => fs.existsSync(t.source_path));
  const bundle = path.join(os.tmpdir(), `cuein-${process.pid}.js`);
  await build({ stdin: { contents: `
    import { analyzeBeatGrid } from ${JSON.stringify(path.join(root,"src/lib/beatgrid/dsp.ts"))};
    window.__a = async (p, h) => { const r = await fetch("muro-file://local/"+encodeURIComponent(p)); const e = await r.arrayBuffer();
      const c = new OfflineAudioContext(1,1,11025); const d = await c.decodeAudioData(e);
      const m = new Float32Array(d.length); const n = d.numberOfChannels;
      for(let x=0;x<n;x++){const ch=d.getChannelData(x); for(let i=0;i<m.length;i++) m[i]+=ch[i];}
      if(n>1) for(let i=0;i<m.length;i++) m[i]/=n;
      return analyzeBeatGrid(m, d.sampleRate, { bpmHint: h||null }); };`, resolveDir: root, loader: "ts" },
    bundle: true, format: "iife", platform: "browser", target: "chrome120", outfile: bundle });
  protocol.handle("muro-file", (req) => { try { const u = new URL(req.url); return createLocalFileResponse(req, decodeURIComponent(u.pathname.slice(1))); } catch { return new Response("bad",{status:400}); } });
  const html = path.join(os.tmpdir(), `cuein-${process.pid}.html`);
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><script src="file://${bundle.replace(/\/g,"/")}"></script>`);
  const w = new BrowserWindow({ show:false, webPreferences:{ offscreen:true, backgroundThrottling:false } });
  await w.loadFile(html);
  const offsets = [];
  for (const t of sample) {
    try {
      const g = await w.webContents.executeJavaScript(`__a(${JSON.stringify(t.source_path)}, ${Number(t.bpm)||0})`);
      const barSec = 4*(60/g.bpm);
      offsets.push({ bars: (g.firstPhraseSec - g.firstDownbeatSec)/barSec, secs: g.firstPhraseSec - g.firstDownbeatSec, phraseBars: g.phraseBars, conf: g.phraseConfidence });
    } catch {}
  }
  fs.rmSync(bundle,{force:true}); fs.rmSync(html,{force:true});
  const used = offsets.filter(o => o.conf >= 0.15);
  const secs = used.map(o=>o.secs).sort((a,b)=>a-b);
  const p = (f) => secs.length? secs[Math.min(secs.length-1, Math.floor(secs.length*f))] : 0;
  console.log(`\n=== where cueInSec starts the INCOMING track (n=${used.length} with usable phrase) ===`);
  console.log(`seconds into the track: p10=${p(0.1).toFixed(1)}s  p50=${p(0.5).toFixed(1)}s  p90=${p(0.9).toFixed(1)}s  max=${p(1).toFixed(1)}s`);
  const buckets = [0,2,5,10,20,40];
  for (const b of buckets) {
    const c = used.filter(o => o.secs >= b && (b===40 || o.secs < buckets[buckets.indexOf(b)+1])).length;
    console.log(`  ${String(b).padStart(2)}s+ : ${String(c).padStart(3)} ${"#".repeat(Math.round(c/Math.max(1,used.length)*40))}`);
  }
  console.log(`\ntracks cued more than 5s in: ${used.filter(o=>o.secs>5).length}/${used.length}`);
  app.exit(0);
});
