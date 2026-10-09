'use strict';
// Browser-native independent gzip frames. WHATWG requires one complete gzip member
// with CRC/ISIZE verification and no trailing input. Output is read under a hard
// application budget; no shared compression context or previous packet is needed.
// https://compression.spec.whatwg.org/#gzip
// https://www.w3.org/TR/webcrypto/#SubtleCrypto-method-digest
const C=require('./state-codec.cjs'),S=require('./state-session.cjs');
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const LIMITS=Object.freeze({stateBytes:60*1024,packetBytes:128*1024,messageBytes:60*1024,compressedBytes:64*1024});
const fail=code=>{throw Object.assign(Error(code),{code});};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
function base64(bytes){let text='';for(let n=0;n<bytes.length;n+=8192)text+=String.fromCharCode(...bytes.subarray(n,n+8192));return btoa(text);}
function unbase64(text){
  if(typeof text!=='string'||text.length>LIMITS.messageBytes||!text.length||text.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))fail('invalid_envelope');
  const raw=atob(text);if(btoa(raw)!==text)fail('invalid_envelope');return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function bounded(stream,limit){
  const reader=stream.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail('decompression_limit');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(size);let at=0;for(const bytes of chunks){result.set(bytes,at);at+=bytes.length;}return result;
}
async function compress(packet){
  const raw=enc.encode(JSON.stringify(packet));if(raw.length>LIMITS.packetBytes)fail('packet_limit');
  const bytes=await bounded(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),LIMITS.compressedBytes);
  return {data:base64(bytes),encodedBytes:raw.length};
}
function create({now=Date.now,hash:hashState=hash,compress:compressPacket=compress,...options}={}){
  const sender=S.createSender({...options,now}),receiver=S.createReceiver(options);
  let revision=0,closed=false;const proofs={sent:[],applied:[]};
  const proof=(side,packet,envelope)=>{const rows=proofs[side];rows.push({serial:packet.serial,generation:packet.generation,kind:packet.kind,base:packet.base,digest:envelope.digest,rawBytes:envelope.rawBytes});if(rows.length>64)rows.shift();};
  const counts={encoded:0,decoded:0,invalid:0,missing:0,stale:0,rawBytes:0,sentBytes:0};
  function reset(){revision++;sender.reset();receiver.reset();}
  return {
    async encode(payload){
      if(closed)return null;const version=revision,raw=enc.encode(C.canonical(payload)),digest=await hashState(raw);
      if(closed||version!==revision)return null;
      const candidates=sender.prepare(payload,digest),generation=candidates.full.generation;
      const full=await compressPacket(candidates.full),delta=candidates.delta&&await compressPacket(candidates.delta);
      if(closed||version!==revision||generation!==sender.diagnostics().generation)return null;
      const useDelta=delta&&delta.data.length<full.data.length,packet=useDelta?candidates.delta:candidates.full,body=useDelta?delta:full;
      const envelope={v:2,codec:'gzip-delta',serial:payload.serial,rawBytes:raw.length,encodedBytes:body.encodedBytes,digest,data:body.data};
      const bytes=enc.encode(JSON.stringify({type:'brawl.view',payload:envelope,lane:'latest',key:'view'})).length;
      if(bytes>LIMITS.messageBytes)fail('state_wire_limit');
      counts.encoded++;return {envelope,packet,revision:version,rawBytes:raw.length,bytes};
    },
    sent(prepared){if(!prepared||closed||prepared.revision!==revision||prepared.packet.generation!==sender.diagnostics().generation)return false;sender.sent(prepared.packet);counts.rawBytes+=prepared.rawBytes;counts.sentBytes+=prepared.bytes;proof('sent',prepared.packet,prepared.envelope);return true;},
    current:prepared=>!!prepared&&!closed&&prepared.revision===revision&&prepared.packet.generation===sender.diagnostics().generation,
    acknowledge:ack=>!closed&&sender.acknowledge(ack),
    feedback:()=>receiver.feedback(),
    async decode(envelope,apply){
      if(closed)return {ignored:'closed'};const version=revision;
      try{
        const e=envelope;
        if(!e||Object.keys(e).length!==7||Object.keys(e).some(k=>!['v','codec','serial','rawBytes','encodedBytes','digest','data'].includes(k))||e.v!==2||e.codec!=='gzip-delta'||!positive(e.serial)||!positive(e.rawBytes)||e.rawBytes>LIMITS.stateBytes||!positive(e.encodedBytes)||e.encodedBytes>LIMITS.packetBytes||typeof e.digest!=='string'||!/^[a-f0-9]{64}$/.test(e.digest))fail('invalid_envelope');
        const compressed=unbase64(e.data),bytes=await bounded(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),e.encodedBytes);
        if(closed||version!==revision)return {ignored:'reset'};
        if(bytes.length!==e.encodedBytes)fail('encoded_length_mismatch');
        const packet=JSON.parse(dec.decode(bytes));if(packet.serial!==e.serial)fail('serial_mismatch');
        const result=await receiver.receive(packet,e.digest,async(state,digest)=>{
          const raw=enc.encode(C.canonical(state));return raw.length===e.rawBytes&&await hashState(raw)===digest;
        },apply);
        if(result.ignored)counts.stale++;else{counts.decoded++;proof('applied',packet,e);}
        return result;
      }catch(error){
        if(closed||version!==revision)return {ignored:'reset'};
        if(error.code==='baseline_missing'){counts.missing++;return {ignored:'baseline_missing'};}
        receiver.forget();counts.invalid++;throw error;
      }
    },
    reset,
    resync(){revision++;sender.reset();receiver.forget();},
    close(){closed=true;reset();},
    diagnostics:()=>({...counts,closed,revision,sender:sender.diagnostics(),receiver:receiver.diagnostics(),proofs:{sent:proofs.sent.map(v=>({...v})),applied:proofs.applied.map(v=>({...v}))}}),
  };
}
module.exports={create,LIMITS};
