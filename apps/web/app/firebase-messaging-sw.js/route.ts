// Service worker contains public Firebase configuration only; no transcripts,
// API cookies or service-account credentials are embedded or cached here.
export const dynamic = "force-dynamic";
export function GET() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (!config.apiKey || !config.projectId || !config.appId)
    return new Response("// Firebase configuration missing", { status: 503 });
  const script = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id=event.notification.data && event.notification.data.conversationId;
  const target=new URL(id ? '/chats/'+encodeURIComponent(id) : '/chats',self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients => {
    const existing=clients.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing){await existing.navigate(target);return existing.focus();}
    return self.clients.openWindow(target);
  }));
});
function claim(id){return new Promise(resolve=>{
  const opened=indexedDB.open('osman-push-seen',1);
  opened.onupgradeneeded=()=>{const store=opened.result.createObjectStore('deliveries',{keyPath:'id'});store.createIndex('at','at');};
  opened.onerror=()=>resolve(false);
  opened.onsuccess=()=>{
    const db=opened.result;const transaction=db.transaction('deliveries','readwrite');
    const store=transaction.objectStore('deliveries');const add=store.add({id,at:Date.now()});let fresh=false;
    add.onsuccess=()=>{fresh=true;};add.onerror=event=>{event.preventDefault();event.stopPropagation();};
    const old=store.index('at').openCursor(IDBKeyRange.upperBound(Date.now()-86400000));
    old.onsuccess=()=>{const cursor=old.result;if(cursor){cursor.delete();cursor.continue();}};
    transaction.oncomplete=()=>{db.close();resolve(fresh);};transaction.onabort=()=>{db.close();resolve(false);};
  };
});}
importScripts('https://www.gstatic.com/firebasejs/13.4.0/firebase-app-compat.js','https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging-compat.js');
firebase.initializeApp(${JSON.stringify(config).replace(/</g, "\\u003c")});
firebase.messaging().onBackgroundMessage(async payload=>{
  const data=payload.data||{};
  if(!data.deliveryId||!['test','notification'].includes(data.kind)||Number(data.expiresAt)<Date.now())return;
  // Reject stale notifications after logout or a switch to another staff account.
  try {
    const response=await fetch(${JSON.stringify((process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000") + "/push/session")},{credentials:'include',cache:'no-store'});
    if(!response.ok || (await response.json()).staffId!==data.staffId)return;
  }catch{return;}
  if(!await claim(data.deliveryId))return;
  await self.registration.showNotification(data.title||'لوحة عثمان',{
    body:data.body||'توجد محادثة تحتاج متابعة.',
    tag:data.kind==='test'?'osman-test-'+data.deliveryId:data.conversationId,
    renotify:true,requireInteraction:data.urgent==='true',
    data:{conversationId:data.conversationId||'',deliveryId:data.deliveryId}
  });
});
`;
  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Service-Worker-Allowed": "/",
    },
  });
}
