import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHmac} from 'node:crypto';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));const {PrismaClient}=require('@prisma/client');
const env=Object.fromEntries(readFileSync('apps/api/.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1)];}));
const db=new PrismaClient({datasourceUrl:env.DATABASE_URL});const phone='1555'+String(Date.now()).slice(-7);const messageId='webhook-'+Date.now();let id;
const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{messages:[{id:messageId,from:phone,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'عاجل'}}]}}]}]});
async function deliver(signature){return fetch('http://localhost:4000/webhooks/whatsapp',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature},body});}
try{
 assert.equal((await deliver('sha256='+'00'.repeat(32))).status,403);
 const sig='sha256='+createHmac('sha256',env.WA_APP_SECRET).update(body).digest('hex');
 const responses=await Promise.all([deliver(sig),deliver(sig),deliver(sig)]);assert.ok(responses.every(r=>r.status===200));
 const message=await db.message.findUniqueOrThrow({where:{waMessageId:messageId}});id=message.conversationId;
 let c;for(let i=0;i<30;i++){c=await db.conversation.findUniqueOrThrow({where:{id},include:{messages:true,events:true}});if(c.status==='urgent')break;await new Promise(r=>setTimeout(r,500));}
 assert.equal(c.status,'urgent');assert.equal(c.messages.filter(m=>m.direction==='client').length,1);assert.equal(c.messages.filter(m=>m.direction==='agent').length,1);assert.ok(c.messages.find(m=>m.direction==='agent').agentConfigVersion>0);assert.ok(c.events.some(e=>e.type==='agent.handoff_urgent'));
 console.log('M3 smoke passed: raw signature, concurrent retries, atomic queue job, worker, validated mock agent, config provenance and status.');
}finally{if(id)await db.conversation.delete({where:{id}});await db.client.deleteMany({where:{phone:'+'+phone}});await db.$disconnect();}
