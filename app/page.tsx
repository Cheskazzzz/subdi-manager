"use client";
import { useEffect, useMemo, useState } from "react";
import { StoreProvider } from "@/lib/store";
import { Role } from "@/lib/types";
import { Login } from "@/components/login";
import { PageKey, Shell } from "@/components/shell";
import { AdminDashboard, ResidentDashboard } from "@/components/dashboard";
import { HomeownersPage } from "@/components/homeowners";
import { MyVehicles, VehiclesPage } from "@/components/vehicles";
import { GateLogsPage, VerifyPage } from "@/components/security";
import { AnnouncementsPage, EventsPage } from "@/components/community";
import { FacialRecognitionPage } from "@/components/facial-recognition";
import { ProfilePage } from "@/components/profile";
import { StaffPage } from "@/components/staff";
import { ChangePassword } from "@/components/change-password";
import { createClient } from "@/lib/supabase/client";
import { UnreadProvider } from "@/lib/unread";

const IDLE_LIMIT_MS=20*60*1000;const ACTIVITY_KEY="iv-last-activity";const EXPIRED_NOTICE="You were signed out after 20 minutes of inactivity. Please sign in again.";
// Last activity is shared across tabs, so working in one tab keeps the others signed in.
const readActivity=()=>{try{return Number(localStorage.getItem(ACTIVITY_KEY))||0}catch{return 0}};
const writeActivity=(time:number)=>{try{localStorage.setItem(ACTIVITY_KEY,String(time))}catch{}};

export default function Home(){return <StoreProvider><App/></StoreProvider>}
function App(){
  const supabase=useMemo(()=>createClient(),[]);const [role,setRole]=useState<Role|null>(null);const [checking,setChecking]=useState(true);const [page,setPage]=useState<PageKey>("dashboard");const [notice,setNotice]=useState("");const [recovering,setRecovering]=useState(false);
  useEffect(()=>{void(async()=>{
    // A password reset email link lands here with the recovery session (or an error) in the URL hash.
    const hash=new URLSearchParams(window.location.hash.slice(1));
    if(hash.get("type")==="recovery"||hash.get("error_description")){window.history.replaceState(null,"",window.location.pathname+window.location.search);
      const accessToken=hash.get("access_token"),refreshToken=hash.get("refresh_token");
      if(accessToken&&refreshToken&&!(await supabase.auth.setSession({access_token:accessToken,refresh_token:refreshToken})).error){setRecovering(true)}else{setNotice("This password reset link is invalid or has expired. Request a new one from Forgot password.")}
      setChecking(false);return}
    const {data}=await supabase.auth.getUser();if(data.user){const lastActive=readActivity();if(lastActive&&Date.now()-lastActive>=IDLE_LIMIT_MS){await supabase.auth.signOut();setNotice(EXPIRED_NOTICE);setChecking(false);return}const {data:profile}=await supabase.from("profiles").select("role").eq("id",data.user.id).single();if(profile?.role==="homeowner"){const {data:homeowner}=await supabase.from("homeowners").select("status").eq("user_id",data.user.id).single();if(homeowner?.status!=="active"){await supabase.auth.signOut();setChecking(false);return}}if(profile?.role)setRole(profile.role as Role)}setChecking(false)})();},[supabase]);
  // Return to the login screen whenever the session ends or expires, so staff never act without a valid sign-in.
  useEffect(()=>{const {data:listener}=supabase.auth.onAuthStateChange((_event,session)=>{if(!session)setRole(null)});return()=>listener.subscription.unsubscribe()},[supabase]);
  // Sign out any role after 20 minutes without mouse, keyboard, scroll or touch activity.
  useEffect(()=>{if(!role)return;let last=Date.now();writeActivity(last);
    const touch=()=>{const now=Date.now();if(now-last>5000){last=now;writeActivity(now)}};
    const check=()=>{if(Date.now()-Math.max(last,readActivity())>=IDLE_LIMIT_MS){setNotice(EXPIRED_NOTICE);setRole(null);void supabase.auth.signOut()}};
    const events=["mousemove","mousedown","keydown","scroll","touchstart","wheel"];events.forEach(e=>window.addEventListener(e,touch,{passive:true}));
    const onVisible=()=>{if(document.visibilityState==="visible")check()};document.addEventListener("visibilitychange",onVisible);const timer=window.setInterval(check,30000);
    return()=>{events.forEach(e=>window.removeEventListener(e,touch));document.removeEventListener("visibilitychange",onVisible);window.clearInterval(timer)}},[role,supabase]);
  const [account,setAccount]=useState<{id:string;name:string;superAdmin:boolean;mustChangePassword:boolean}|null>(null);
  // Load the signed-in account's name and staff flags (super admin, default password still in use).
  useEffect(()=>{if(!role){setAccount(null);return}void(async()=>{const {data}=await supabase.auth.getUser();if(!data.user)return;const {data:profile}=await supabase.from("profiles").select("first_name,last_name,email").eq("id",data.user.id).single();const {data:flags}=await supabase.from("profiles").select("is_super_admin,must_change_password").eq("id",data.user.id).single();setAccount({id:data.user.id,name:`${profile?.first_name??""} ${profile?.last_name??""}`.trim()||profile?.email||"",superAdmin:!!flags?.is_super_admin,mustChangePassword:role!=="homeowner"&&!!flags?.must_change_password})})();},[role,supabase]);
  const login=(nextRole:Role)=>{setNotice("");setRole(nextRole);setPage(nextRole==="security"?"verify":"dashboard")};
  const logout=async()=>{await supabase.auth.signOut();setRole(null)};
  if(checking)return <main className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading Isabel Village…</main>;
  if(recovering)return <ChangePassword title="Choose a new password" description="Enter a new password for your account. You will sign in with it from now on." onDone={()=>{void(async()=>{await supabase.auth.signOut();setRecovering(false);setNotice("Your password was changed. Sign in with your new password.")})()}} onLogout={()=>{void(async()=>{await supabase.auth.signOut();setRecovering(false)})()}}/>;
  if(!role)return <Login onLogin={login} notice={notice}/>;
  if(!account)return <main className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading Isabel Village…</main>;
  if(account.mustChangePassword)return <ChangePassword onDone={()=>setAccount({...account,mustChangePassword:false})} onLogout={()=>{void logout()}}/>;
  return <UnreadProvider userId={account.id} enabled={role==="homeowner"}><Shell role={role} name={account.name} superAdmin={account.superAdmin} page={page} setPage={setPage} logout={()=>{void logout()}}><Page role={role} page={page} superAdmin={account.superAdmin}/></Shell></UnreadProvider>
}
function Page({role,page,superAdmin}:{role:Role;page:PageKey;superAdmin:boolean}){switch(page){case"dashboard":return role==="homeowner"?<ResidentDashboard/>:<AdminDashboard/>;case"homeowners":return <HomeownersPage/>;case"vehicles":return <VehiclesPage/>;case"verify":return <VerifyPage/>;case"logs":return <GateLogsPage/>;case"announcements":return <AnnouncementsPage role={role}/>;case"events":return <EventsPage role={role}/>;case"facial":return <FacialRecognitionPage/>;case"profile":return <ProfilePage/>;case"my-vehicles":return <MyVehicles/>;case"staff":return superAdmin?<StaffPage/>:null;default:return null}}
