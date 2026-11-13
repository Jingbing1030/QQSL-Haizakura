// Capture RAW handshake headers + RAW READY frame bytes for the evidence record.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import crypto from "node:crypto";
const dist = readFileSync("/home/ubuntu/satori-transport-verify/dist/index.mjs", "utf8");
const at = dist.indexOf("//#region src/index.ts");
const head = dist.slice(0, dist.lastIndexOf("\n", at) + 1);
writeFileSync("/home/ubuntu/satori-transport-verify/raw-cap.mjs", head + "\n" + `
async function rawCapGo(){
  const adapter = new SatoriServerAdapter("raw", { name:"raw", host:"127.0.0.1", port:5620, path:"/v1/events", accessToken:"raw-token", messageFormat:"array", reportSelfMessage:true },
    { uin:"3254926145", selfId:3254926145, api:{ isAcceptingActions:true, handle: async(a)=> a==="get_login_info" ? {status:"ok",data:{user_id:3254926145,nickname:"碧海"}} : {status:"ok",data:{}} }, buildLifecycleEvent:()=>({}), buildHeartbeatEvent:()=>({}) });
  await adapter.open();
  const crypto = createRequire(import.meta.url)("node:crypto");
  const key = crypto.randomBytes(16).toString("base64");
  await new Promise((res)=>{
    const s = net.connect(5620,"127.0.0.1",()=>{
      s.write("GET /v1/events HTTP/1.1\\r\\nHost: 127.0.0.1:5620\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: "+key+"\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n");
    });
    let buf=Buffer.alloc(0), hs=false;
    s.on("data",(c)=>{
      buf=Buffer.concat([buf,c]);
      if(!hs){
        const i=buf.indexOf("\\r\\n\\r\\n"); if(i===-1) return;
        console.log("=== RAW HANDSHAKE RESPONSE ===");
        console.log(buf.slice(0,i).toString("latin1"));
        buf=buf.slice(i+4); hs=true;
        const p=Buffer.from(JSON.stringify({op:3,body:{token:"raw-token"}}));
        const m=crypto.randomBytes(4); const mm=Buffer.alloc(p.length);
        for(let k=0;k<p.length;k++) mm[k]=p[k]^m[k%4];
        s.write(Buffer.concat([Buffer.from([0x81,0x80|p.length]), m, mm]));
        return;
      }
      if(buf.length>=2){
        const fop=buf[0]&0x0f; let len=buf[1]&0x7f, off=2;
        if(len===126){len=buf.readUInt16BE(2);off=4;} else if(len===127){len=Number(buf.readBigUInt64BE(2));off=10;}
        if(buf.length>=off+len){
          console.log("=== RAW SERVER FRAME ===");
          console.log("RFC6455 frame opcode:", fop, "(1=TEXT)");
          console.log("payload bytes:", len);
          console.log("payload JSON:");
          console.log(JSON.stringify(JSON.parse(buf.slice(off,off+len).toString("utf8")), null, 2));
          s.destroy(); res();
        }
      }
    });
    s.on("error",()=>res());
    setTimeout(()=>{s.destroy();res();},8000);
  });
  await adapter.close();
}
rawCapGo().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});
`);
console.log("raw-cap built");
