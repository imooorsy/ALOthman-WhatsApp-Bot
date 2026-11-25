'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useState} from 'react';
import type {OfficeConfig,Staff} from '@osman/shared';
import {api} from './api';
export function Shell({children}:{children:React.ReactNode}){
 const [collapsed,setCollapsed]=useState(false);const [user,setUser]=useState<Staff>();const [paused,setPaused]=useState(false);const pathname=usePathname();
 useEffect(()=>{setCollapsed(window.innerWidth<=760);api<Staff>('/auth/me').then(setUser).catch(()=>{});api<OfficeConfig>('/settings').then(s=>setPaused(s.rules.paused)).catch(()=>{});const handler=(e:Event)=>setPaused((e as CustomEvent<boolean>).detail);window.addEventListener('osman:paused',handler);return()=>window.removeEventListener('osman:paused',handler);},[]);
 useEffect(()=>{document.body.classList.toggle('sbc',collapsed);return()=>document.body.classList.remove('sbc');},[collapsed]);
 return <div className="app"><aside className="sb" aria-label="القائمة الرئيسية"><div className="sh"><div className="mono">ع</div><div className="bt"><b>لوحة عثمان</b><small>آل عثمان محامون ومستشارون</small></div><button className="ib" aria-label={collapsed?'توسيع القائمة':'طي القائمة'} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}>☰</button></div><nav>{[['/chats','المحادثات','◫'],['/settings','الإعدادات','⚙']].map(([href,label,icon])=><Link className={'nv '+(pathname.startsWith(href)?'on':'')} href={href} key={href} title={label} aria-current={pathname.startsWith(href)?'page':undefined}><i aria-hidden="true">{icon}</i><span>{label}</span></Link>)}</nav><div className="df"><div className={'st '+(paused?'off':'')}><i className="dot"/><span>{paused?'البوت متوقف':'البوت يعمل'}</span></div><p>{user?.name}</p><button className="btn logout" onClick={()=>api('/auth/logout',{method:'POST'}).then(()=>window.location.assign('/login'))} title="تسجيل الخروج">خروج</button></div></aside><button className="sc" aria-label="إغلاق القائمة" onClick={()=>setCollapsed(true)}/><main>{children}</main></div>;
}
export function Toast({message}:{message:string}){return <div className={'ts '+(message?'on':'')} role="status" aria-live="polite">{message}</div>;}
export function Switch({label,value,onChange,disabled=false}:{label:string;value:boolean;onChange:(v:boolean)=>void;disabled?:boolean}){return <button type="button" className="sw" role="switch" aria-label={label} aria-checked={value} disabled={disabled} onClick={()=>onChange(!value)}/>;}
