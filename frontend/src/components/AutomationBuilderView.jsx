import React, { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from "react";
import { api } from "../api.js";
import AutomationExecutions from "./AutomationExecutions.jsx";
import { maskPhone } from "../constants.js";

// Automation Builder — single-file React JSX (DM Sans + DM Mono, inline styles).

const fmt = (n) => "₹" + Number(n).toLocaleString("en-IN");

/* ── Color tokens ─────────────────────────────────────────────────── */
const C = {
  pageBg:"var(--c-pageBg)", cardBg:"var(--c-cardBg)", cardBorder:"var(--c-border)", cardBorderOpen:"var(--c-text)",
  innerBg:"var(--c-surfaceAlt)", innerBorder:"var(--c-border)", sectionBg:"var(--c-surfaceAlt)",
  rowDiv:"var(--c-border)", divider:"var(--c-border)", inputBorder:"var(--c-borderDark)",
  text1:"var(--c-text)", text2:"var(--c-text)", text3:"var(--c-textSecondary)", text4:"var(--c-textSecondary)", text5:"var(--c-textMuted)",
  muted:"var(--c-textMuted)", ghost:"var(--c-textMuted)", ph:"var(--c-textMuted)",
  brand:"#0F6E56", brandBright:"#1D9E75", brandDark:"#085041", brandBg:"#E1F5EE", brandTint:"#F0FAF6",
  purple:"#534AB7", purpleBg:"#EEEDFE", purpleDark:"#3C3489",
  red:"#A32D2D", redBg:"#FCEBEB", redDark:"#791F1F",
  orange:"#E65100", orangeBg:"#FFF3E0", orangeBorder:"#FFE0B2", orangeText:"#A04400",
  amber:"#854F0B", amberBg:"#FAEEDA",
  blue:"#1565C0", blueBg:"#E3F2FD", blueBorder:"#BBDEFB",
  navy:"#1B2A4E", navyBg:"#E5EAF2",
  teal:"#00796B", tealBg:"#DDF1EE",
  pink:"#9C2153", pinkBg:"#FBE5EE",
  sb:"#161513", sbItem:"#9E9A92", sbActive:"#26241F", sbBorder:"#26241F",
};

/* ── Inline SVG icon factory ──────────────────────────────────────── */
const I = (paths, s=16) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
);
const IC = {
  dash:(s)=>I(<><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></>,s),
  flow:(s)=>I(<><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M9 6h6M7.5 8.5L11 16M16.5 8.5L13 16"/></>,s),
  tpl:(s)=>I(<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>,s),
  contacts:(s)=>I(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,s),
  inbox:(s)=>I(<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>,s),
  bcast:(s)=>I(<><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></>,s),
  plug:(s)=>I(<><path d="M9 2v6M15 2v6M5 10h14v4a7 7 0 0 1-14 0v-4zM12 21v-3"/></>,s),
  chart:(s)=>I(<><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></>,s),
  cog:(s)=>I(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,s),
  search:(s=14)=>I(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,s),
  bell:(s)=>I(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,s),
  help:(s)=>I(<><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/></>,s),
  plus:(s=14)=>I(<><path d="M12 5v14M5 12h14"/></>,s),
  check:(s=14)=>I(<polyline points="20 6 9 17 4 12"/>,s),
  cD:(s=12)=>I(<polyline points="6 9 12 15 18 9"/>,s),
  cR:(s=12)=>I(<polyline points="9 18 15 12 9 6"/>,s),
  edit:(s)=>I(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,s),
  play:(s=14)=>I(<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>,s),
  copy:(s)=>I(<><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,s),
  trash:(s)=>I(<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></>,s),
  eye:(s)=>I(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,s),
  zap:(s)=>I(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" stroke="none"/>,s),
  msg:(s)=>I(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>,s),
  img:(s)=>I(<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21"/></>,s),
  vid:(s)=>I(<><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></>,s),
  doc:(s)=>I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,s),
  pin:(s)=>I(<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,s),
  list:(s)=>I(<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></>,s),
  qr:(s)=>I(<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h7v7M14 18h2M18 14v2"/></>,s),
  branch:(s)=>I(<><circle cx="6" cy="3" r="2"/><circle cx="18" cy="3" r="2"/><circle cx="12" cy="21" r="2"/><path d="M6 5v6a6 6 0 0 0 6 6M18 5v6a6 6 0 0 1-6 6"/></>,s),
  clock:(s)=>I(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,s),
  api:(s)=>I(<><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></>,s),
  tag:(s)=>I(<><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></>,s),
  agent:(s)=>I(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,s),
  ai:(s)=>I(<><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></>,s),
  warn:(s=12)=>I(<><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,s),
  err:(s=12)=>I(<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,s),
  ok:(s=14)=>I(<polyline points="20 6 9 17 4 12"/>,s),
  x:(s=14)=>I(<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,s),
  drag:(s)=>I(<><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></>,s),
  zIn:(s)=>I(<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></>,s),
  zOut:(s)=>I(<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></>,s),
  fit:(s)=>I(<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>,s),
  undo:(s)=>I(<><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></>,s),
  redo:(s)=>I(<><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></>,s),
  arr:(s)=>I(<><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></>,s),
  send:(s)=>I(<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,s),
  back:(s=16)=>I(<><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,s),
  up:(s)=>I(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,s),
  dl:(s)=>I(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,s),
  link:(s)=>I(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,s),
  filt:(s)=>I(<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>,s),
  user:(s)=>I(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,s),
  phone:(s)=>I(<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>,s),
  bag:(s)=>I(<><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></>,s),
  mail:(s)=>I(<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,s),
  refresh:(s)=>I(<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,s),
  cal:(s)=>I(<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,s),
  power:(s=13)=>I(<><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></>,s),
};

/* ── Primitive components ─────────────────────────────────────────── */
const Badge = ({ label, bg, color, border, dot, style }) => (
  <span style={{ fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:99, background:bg, color, fontFamily:"'DM Sans'", whiteSpace:"nowrap", letterSpacing:".03em", border:border?`1px solid ${border}`:"none", display:"inline-flex", alignItems:"center", gap:5, ...style }}>
    {dot && <span style={{ width:5, height:5, borderRadius:"50%", background:color }}/>}
    {label}
  </span>
);

const StatusPill = ({ status }) => {
  const m = {
    Live:{bg:C.brandBg,color:C.brandDark,dot:true}, Draft:{bg:"#EFEEE9",color:C.text4,dot:true},
    Paused:{bg:C.orangeBg,color:C.orangeText,dot:true}, Error:{bg:C.redBg,color:C.redDark,dot:true},
    Approved:{bg:C.brandBg,color:C.brandDark,dot:true}, "Pending Review":{bg:C.amberBg,color:C.amber,dot:true},
    Rejected:{bg:C.redBg,color:C.redDark,dot:true},
    Connected:{bg:C.brandBg,color:C.brandDark,dot:true}, "Not connected":{bg:"#EFEEE9",color:C.text4,dot:true},
    draft:{bg:"#EFEEE9",color:C.text4,dot:true}, active:{bg:C.brandBg,color:C.brandDark,dot:true},
    inactive:{bg:"#EEEDE8",color:C.text4,dot:true},
    paused:{bg:C.orangeBg,color:C.orangeText,dot:true}, error:{bg:C.redBg,color:C.redDark,dot:true},
  }[status] || {bg:"#EFEEE9",color:C.text4,dot:true};
  return <Badge label={status} bg={m.bg} color={m.color} dot={m.dot}/>;
};

const Btn = ({ kind="ghost", icon, children, onClick, style, size="md", title, ...rest }) => {
  const pad = size==="sm" ? "6px 12px" : size==="lg" ? "11px 20px" : "9px 16px";
  const fs = size==="sm" ? 11 : 12;
  const v = {
    primary:{ background:C.brand, color:"#fff", border:`1px solid ${C.brand}` },
    dark:   { background:C.text1, color:"#fff", border:`1px solid ${C.text1}` },
    ghost:  { background:"#fff", color:C.text3, border:`1.5px solid ${C.inputBorder}` },
    soft:   { background:C.brandBg, color:C.brandDark, border:"1px solid transparent" },
    danger: { background:"#fff", color:C.redDark, border:`1.5px solid ${C.redBg}` },
  }[kind];
  return <button onClick={onClick} title={title} style={{ fontFamily:"'DM Sans'", fontSize:fs, fontWeight:600, borderRadius:10, padding:pad, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:7, whiteSpace:"nowrap", transition:"all .14s", lineHeight:1, ...v, ...style }} {...rest}>{icon}{children}</button>;
};

const IconBtn = ({ children, onClick, title, danger, style }) => (
  <button onClick={onClick} title={title} style={{ width:30, height:30, border:"none", background:"transparent", borderRadius:7, cursor:"pointer", color:danger?C.redDark:C.text4, display:"flex", alignItems:"center", justifyContent:"center", ...style }}>{children}</button>
);

const Sec = ({ children, style }) => <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:".1em", color:C.muted, fontWeight:700, ...style }}>{children}</div>;

const Toggle = ({ value, onChange, size="md" }) => {
  const w = size==="sm" ? 32:38, h = size==="sm" ? 18:20, k = h-4;
  return <div onClick={() => onChange && onChange(!value)} style={{ width:w, height:h, borderRadius:99, background:value?C.brandBright:"#D5D5D0", position:"relative", cursor:"pointer", transition:"background .2s", flexShrink:0 }}>
    <div style={{ width:k, height:k, borderRadius:"50%", background:"#fff", position:"absolute", top:2, left:value?w-k-2:2, transition:"left .18s", boxShadow:"0 1px 3px rgba(0,0,0,.2)" }}/>
  </div>;
};

const Input = ({ style, ...p }) => <input {...p} style={{ width:"100%", padding:"8px 11px", border:`1.5px solid ${C.inputBorder}`, borderRadius:8, fontSize:12, fontFamily:"'DM Sans'", outline:"none", background:"#fff", color:C.text1, ...style }}/>;
const Textarea = ({ style, ...p }) => <textarea {...p} style={{ width:"100%", padding:"9px 11px", border:`1.5px solid ${C.inputBorder}`, borderRadius:8, fontSize:12, fontFamily:"'DM Sans'", outline:"none", background:"#fff", color:C.text1, lineHeight:1.5, resize:"vertical", ...style }}/>;

// Textarea with a Word-like B/I/U toolbar. Wraps selection in WhatsApp
// markers (`*`, `_`, `~`); with no selection, inserts the markers and parks
// the cursor between them so the next typed characters land inside the wrap.
// NOTE: WhatsApp's `~` renders as strikethrough — there is no native underline
// syntax in WhatsApp markdown; this is the closest available marker.
const FormatTextarea = ({ value, onChange, style, ...p }) => {
  const taRef = React.useRef(null);
  const apply = (marker) => {
    const ta = taRef.current;
    if (!ta) return;
    const v = value || "";
    const s = ta.selectionStart ?? v.length;
    const e = ta.selectionEnd ?? v.length;
    const nv = v.slice(0, s) + marker + v.slice(s, e) + marker + v.slice(e);
    const ns = s + marker.length;
    const ne = e + marker.length;
    onChange({ target: { value: nv } });
    requestAnimationFrame(() => {
      ta.focus();
      try { ta.setSelectionRange(ns, ne); } catch {}
    });
  };
  const TBtn = ({ marker, label, sx, title }) => (
    <button type="button" title={title}
      onMouseDown={(ev)=>ev.preventDefault()}
      onClick={()=>apply(marker)}
      style={{ width:26, height:24, border:`1px solid ${C.inputBorder}`, borderRadius:6, background:"#fff", color:C.text1, fontFamily:"'DM Sans'", fontSize:12, cursor:"pointer", display:"inline-flex", alignItems:"center", justifyContent:"center", ...sx }}>
      {label}
    </button>
  );
  const insertVar = (k) => {
    const ta = taRef.current;
    const v = value || "";
    const s = ta && typeof ta.selectionStart === "number" ? ta.selectionStart : v.length;
    const e = ta && typeof ta.selectionEnd === "number" ? ta.selectionEnd : v.length;
    const token = `{{${k}}}`;
    const nv = v.slice(0, s) + token + v.slice(e);
    onChange({ target: { value: nv } });
    if (ta) {
      const np = s + token.length;
      requestAnimationFrame(() => { try { ta.focus(); ta.setSelectionRange(np, np); } catch {} });
    }
  };
  return (
    <div>
      <div style={{ display:"flex", gap:4, marginBottom:6, alignItems:"center" }}>
        <TBtn marker="*" label="B" title="Bold — wraps selection in *text*" sx={{ fontWeight:700 }}/>
        <TBtn marker="_" label="I" title="Italic — wraps selection in _text_" sx={{ fontStyle:"italic" }}/>
        <TBtn marker="~" label="U" title="Underline — uses ~text~ (WhatsApp renders this as strikethrough; no native underline)" sx={{ textDecoration:"underline" }}/>
        <span style={{ marginLeft:"auto" }}>
          <VarPickerButton onInsert={insertVar}/>
        </span>
      </div>
      <textarea ref={taRef} value={value || ""} onChange={onChange}
        style={{ width:"100%", padding:"9px 11px", border:`1.5px solid ${C.inputBorder}`, borderRadius:8, fontSize:12, fontFamily:"'DM Sans'", outline:"none", background:"#fff", color:C.text1, lineHeight:1.5, resize:"vertical", ...style }}
        {...p}/>
    </div>
  );
};
const Select = ({ style, children, ...p }) => <select {...p} style={{ width:"100%", padding:"7px 9px", border:`1.5px solid ${C.inputBorder}`, borderRadius:8, fontSize:12, fontFamily:"'DM Sans'", outline:"none", background:"#fff", color:C.text1, ...style }}>{children}</select>;

// ─── Variable picker (Insert {{key}} into any text input) ──────────────────
// React Context lets the settings panel pass nodes+edges+currentNodeId once
// and every nested VarInput/VarTextarea/FormatTextarea reads from it.
const VarContext = React.createContext({ nodes: [], edges: [], currentNodeId: null, contactFields: [] });

// Built-in variables that the engine's resolveVariables always knows about.
const BUILTIN_VARS = [
  { key: "name",           description: "Full contact name" },
  { key: "first_name",     description: "First word of the name" },
  { key: "phone",          description: "Contact phone number" },
  { key: "contact_number", description: "Contact phone number (alias)" },
];

// Normalize a ForgeCRM field name into a {{variable}} token key.
// MUST stay identical to fieldVarKey() in backend automationEngine.js so the
// token this picker inserts is the token the engine resolves at runtime.
// "Date of Birth" -> "date_of_birth", "city" -> "city".
function fieldVarKey(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Small "{x}" button that opens a dropdown of available variables and
// calls onInsert(varKey) when one is picked.
const VarPickerButton = ({ onInsert, style }) => {
  const { contactFields } = React.useContext(VarContext);
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  // Custom contact fields from ForgeCRM (Admin Settings → Fields), as variable
  // tokens. Deduped against the built-ins and each other by normalized key.
  const customVars = [];
  const seen = new Set(BUILTIN_VARS.map(v => v.key));
  (contactFields || []).forEach(f => {
    const key = fieldVarKey(f.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    customVars.push({ key, label: f.name });
  });
  const pick = (k) => { onInsert(k); setOpen(false); };
  const Row = (v) => (
    <button key={v.key} type="button" onClick={()=>pick(v.key)}
      style={{ display:"block", width:"100%", textAlign:"left", padding:"7px 11px", border:"none", background:"transparent", cursor:"pointer", fontSize:11 }}
      onMouseEnter={(e)=>e.currentTarget.style.background=C.sectionBg}
      onMouseLeave={(e)=>e.currentTarget.style.background="transparent"}>
      <span style={{ fontFamily:"'DM Mono'", color:C.brandDark, fontWeight:700 }}>{`{{${v.key}}}`}</span>
      {(v.description || v.label) && <span style={{ marginLeft:8, color:C.text5 }}>{v.description || v.label}</span>}
    </button>
  );
  return (
    <span ref={wrapRef} style={{ position:"relative", display:"inline-flex", ...style }}>
      <button
        type="button"
        title="Insert a variable"
        onMouseDown={(e)=>e.preventDefault()}
        onClick={()=>setOpen(o=>!o)}
        style={{ height:24, padding:"0 8px", border:`1px solid ${C.inputBorder}`, borderRadius:6, background:"#fff", color:C.text1, fontFamily:"'DM Mono'", fontSize:11, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:3, fontWeight:700 }}>
        {"{x}"}
      </button>
      {open && (
        <div style={{ position:"absolute", top:28, right:0, zIndex:50, minWidth:240, maxHeight:320, overflowY:"auto", background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:8, boxShadow:C.shadowLg || "0 8px 24px rgba(0,0,0,.12)", fontFamily:"'DM Sans'" }}>
          <div style={{ padding:"7px 11px", fontSize:9, fontWeight:700, color:C.text5, textTransform:"uppercase", letterSpacing:".06em", borderBottom:`1px solid ${C.cardBorder}` }}>Built-in</div>
          {BUILTIN_VARS.map(Row)}
          {customVars.length > 0 && (
            <>
              <div style={{ padding:"7px 11px", fontSize:9, fontWeight:700, color:C.text5, textTransform:"uppercase", letterSpacing:".06em", borderTop:`1px solid ${C.cardBorder}`, background:C.sectionBg }}>Custom fields</div>
              {customVars.map(Row)}
            </>
          )}
          {customVars.length === 0 && (
            <div style={{ padding:"8px 11px", fontSize:10, color:C.text5, fontStyle:"italic", borderTop:`1px solid ${C.cardBorder}` }}>
              No custom fields yet — add them in Admin Settings → Fields.
            </div>
          )}
        </div>
      )}
    </span>
  );
};

// Insert {{key}} at the cursor of `inputRef`'s current input/textarea, then
// call onChange with the synthesized event. Used by VarInput and VarTextarea.
function _insertVarAtCursor(inputRef, value, onChange, key) {
  const el = inputRef.current;
  const v = String(value || "");
  const token = `{{${key}}}`;
  const s = el && typeof el.selectionStart === "number" ? el.selectionStart : v.length;
  const e = el && typeof el.selectionEnd === "number" ? el.selectionEnd : v.length;
  const nv = v.slice(0, s) + token + v.slice(e);
  onChange({ target: { value: nv } });
  if (el) {
    const np = s + token.length;
    requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(np, np); } catch {} });
  }
}

// Single-line input with a built-in variable picker button on the right.
const VarInput = ({ value, onChange, style, pickerStyle, ...p }) => {
  const ref = React.useRef(null);
  return (
    <div style={{ display:"flex", alignItems:"stretch", gap:6 }}>
      <input ref={ref} value={value ?? ""} onChange={onChange}
        style={{ flex:1, padding:"8px 11px", border:`1.5px solid ${C.inputBorder}`, borderRadius:8, fontSize:12, fontFamily:"'DM Sans'", outline:"none", background:"#fff", color:C.text1, ...style }}
        {...p}/>
      <VarPickerButton onInsert={(k)=>_insertVarAtCursor(ref, value, onChange, k)} style={pickerStyle}/>
    </div>
  );
};

// Multi-line textarea with the variable picker button parked top-right.
const VarTextarea = ({ value, onChange, style, ...p }) => {
  const ref = React.useRef(null);
  return (
    <div style={{ position:"relative" }}>
      <div style={{ position:"absolute", top:6, right:6, zIndex:2 }}>
        <VarPickerButton onInsert={(k)=>_insertVarAtCursor(ref, value, onChange, k)}/>
      </div>
      <textarea ref={ref} value={value ?? ""} onChange={onChange}
        style={{ width:"100%", padding:"9px 38px 9px 11px", border:`1.5px solid ${C.inputBorder}`, borderRadius:8, fontSize:12, fontFamily:"'DM Sans'", outline:"none", background:"#fff", color:C.text1, lineHeight:1.5, resize:"vertical", ...style }}
        {...p}/>
    </div>
  );
};

const Field = ({ label, hint, children, style }) => (
  <div style={{ marginBottom:13, ...style }}>
    {label && <div style={{ fontSize:11, fontWeight:600, color:C.text3, marginBottom:5, fontFamily:"'DM Sans'" }}>{label}</div>}
    {children}
    {hint && <div style={{ fontSize:10, color:C.text5, marginTop:4, fontWeight:500 }}>{hint}</div>}
  </div>
);

const Pill = ({ active, children, onClick, color=C.brand, bg=C.brandBg, textDark=C.brandDark }) => (
  <button onClick={onClick} style={{
    fontSize:11, padding:"5px 11px", borderRadius:99,
    border:active?`1.5px solid ${color}`:`1.5px solid ${C.inputBorder}`,
    background:active?bg:"transparent",
    color:active?textDark:C.text4,
    fontFamily:"'DM Sans'", fontWeight:600, cursor:"pointer", whiteSpace:"nowrap",
  }}>{children}</button>
);

const Alert = ({ kind, children, style }) => {
  const m = {
    info:{bg:C.blueBg,color:C.blue,border:C.blueBorder,icon:IC.warn(13)},
    warn:{bg:C.orangeBg,color:C.orangeText,border:C.orangeBorder,icon:IC.warn(13)},
    error:{bg:C.redBg,color:C.redDark,border:"#F4C9C9",icon:IC.err(13)},
    ok:{bg:C.brandBg,color:C.brandDark,border:C.brandBright,icon:IC.ok(13)},
  }[kind];
  return <div style={{ background:m.bg, border:`1px solid ${m.border}`, borderRadius:10, padding:"9px 11px", display:"flex", gap:9, alignItems:"flex-start", margin:"12px 0 4px", ...style }}>
    <span style={{ fontSize:13, fontWeight:700, color:m.color, lineHeight:1, marginTop:1, flexShrink:0 }}>{m.icon}</span>
    <div style={{ fontSize:11, color:m.color, lineHeight:1.55, fontWeight:500 }}>{children}</div>
  </div>;
};


/* ══════════════════════════════════════════════════════════════════════
   3) BUILDER — HERO SCREEN
   Node types, sample flow, canvas, blocks, settings, preview, toolbar
   ══════════════════════════════════════════════════════════════════════ */

const NT = {
  trigger: { bg:"#FCEBEB", border:"#E8A0A0", color:"#A32D2D", accent:"#791F1F", label:"TRIGGER",       icon:IC.zap },
  message: { bg:"#FDF2F2", border:"#E8B0B0", color:"#B53D3D", accent:"#A32D2D", label:"MESSAGE",       icon:IC.msg },
  condition:{ bg:"#FFF5F5", border:"#F0C0C0", color:"#C44A4A", accent:"#A32D2D", label:"CONDITION",     icon:IC.branch },
  action:  { bg:"#FAF0F0", border:"#D8B0B0", color:"#8B3A3A", accent:"#A32D2D", label:"ACTION",        icon:IC.tag },
  delay:   { bg:"#FDF8F5", border:"#E0C8B8", color:"#A05040", accent:"#A32D2D", label:"DELAY",         icon:IC.clock },
  api:     { bg:"#F5ECEC", border:"#C8A0A0", color:"#7A2A2A", accent:"#791F1F", label:"API",           icon:IC.api },
  handoff: { bg:"#FDF0F0", border:"#E0B8B8", color:"#B04040", accent:"#A32D2D", label:"HUMAN HANDOFF", icon:IC.agent },
  ai:      { bg:"#F8F0F0", border:"#D0B0B0", color:"#8B3A3A", accent:"#A32D2D", label:"AI",            icon:IC.ai },
  subflow: { bg:"#F0E8E8", border:"#C0A0A0", color:"#6A2A2A", accent:"#791F1F", label:"SUB-FLOW",      icon:IC.flow },
};

const NODE_W = 240;
export const nodeH = (n) => {
  if (n.type === "action") return Math.max(96, 44 + (n.actions?.length||0) * 54);
  if (n.type === "condition") return 118;
  if (n.type === "message") return 102;
  return 96;
};

export const getTriggerDisplay = (n) => {
  const tk = n.triggerKind || 'keyword';
  if (tk === 'keyword') {
    const kw = (n.keyword || '').trim();
    const mt = n.matchType || 'exact';
    const mtLabel = mt === 'contains' ? 'contains' : mt === 'starts' ? 'starts with' : 'exact';
    return {
      title: kw ? `Trigger: ${kw} keyword` : 'Trigger: Keyword',
      sub: kw ? `When contact sends "${kw}" · ${mtLabel} match` : 'When a contact sends a specific keyword',
    };
  }
  if (tk === 'link') return { title: 'Trigger: wa.me Link', sub: 'When contact opens a click-to-chat link' };
  if (tk === 'qr') return { title: 'Trigger: QR Scan', sub: 'When contact scans a printed QR code' };
  if (tk === 'newContact') return { title: 'Trigger: New Contact', sub: 'First-time message from a new contact' };
  if (tk === 'anyMessage') return { title: 'Trigger: Any Message', sub: 'Fires on every inbound message' };
  if (tk === 'tagApplied') {
    const tag = n.tag || 'a tag';
    const dir = n.tagDirection === 'removed' ? 'removed from' : 'added to';
    return { title: `Trigger: Tag ${dir} contact`, sub: `When "${tag}" is ${dir} a contact` };
  }
  if (tk === 'webhook') return { title: 'Trigger: Webhook', sub: 'Incoming HTTP POST webhook' };
  if (tk === 'apiEvent') return { title: 'Trigger: API Event', sub: `Event from ${n.integration || 'integration'}` };
  return { title: n.title, sub: n.sub };
};

export const outputHandlesOf = (n) => {
  if (n.type === "condition") return ["yes","no"];
  if (n.type === "message" && n.messageMode === "direct") {
    const dd = n.directData || {};
    if (n.directType === "quick_reply" && Array.isArray(dd.buttons) && dd.buttons.length > 0) {
      return dd.buttons.map((_,i)=>`btn:${i}`);
    }
    if (n.directType === "list" && Array.isArray(dd.sections) && dd.sections.length > 0) {
      return dd.sections.map((_,i)=>`row:${i}`);
    }
  }
  if (n.type === "message" && n.buttons && n.buttons.length > 0) return n.buttons.map((_,i)=>`btn:${i}`);
  return ["default"];
};

export const handlePos = (n, kind, which="default") => {
  const h = nodeH(n);
  if (kind === "input") return { x: n.x + NODE_W/2, y: n.y };
  const dd = n.directData || {};
  if (n.type === "message" && n.messageMode === "direct") {
    if (n.directType === "quick_reply" && Array.isArray(dd.buttons) && dd.buttons.length > 0 && typeof which === "string" && which.startsWith("btn:")) {
      const idx = parseInt(which.slice(4), 10);
      const total = dd.buttons.length;
      return { x: n.x + ((idx + 1) * NODE_W) / (total + 1), y: n.y + h };
    }
    if (n.directType === "list" && Array.isArray(dd.sections) && dd.sections.length > 0 && typeof which === "string" && which.startsWith("row:")) {
      const idx = parseInt(which.slice(4), 10);
      const total = dd.sections.length;
      return { x: n.x + ((idx + 1) * NODE_W) / (total + 1), y: n.y + h };
    }
  }
  if (n.buttons && typeof which === "string" && which.startsWith("btn:")) {
    const idx = parseInt(which.slice(4), 10);
    const total = n.buttons.length;
    return { x: n.x + ((idx + 1) * NODE_W) / (total + 1), y: n.y + h };
  }
  if (n.type === "condition" && which === "yes") return { x: n.x + NODE_W/3,     y: n.y + h };
  if (n.type === "condition" && which === "no")  return { x: n.x + (NODE_W*2)/3, y: n.y + h };
  return { x: n.x + NODE_W/2, y: n.y + h };
};

/* ── screenToWorld is defined inside the component so it can read viewportRef ── */

/* ── Simple tree auto-layout ── */
export const layoutTree = (nodes, edges) => {
  const roots = nodes.filter(n => !edges.some(e => e.to === n.id));
  if (roots.length === 0) return nodes;
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const childrenOf = (id) => edges.filter(e => e.from === id).map(e => byId[e.to]).filter(Boolean);
  const placed = new Set();
  const walk = (n, x, y, depth = 0) => {
    if (!n || placed.has(n.id)) return;
    n.x = x; n.y = y; placed.add(n.id);
    const kids = childrenOf(n.id);
    if (!kids.length) return;
    const gap = 300;
    const totalW = (kids.length - 1) * gap;
    kids.forEach((c, i) => walk(c, x - totalW/2 + i*gap, y + 180, depth+1));
  };
  roots.forEach((r, i) => walk(r, 80 + i*340, 60));
  return [...nodes];
};

/* ── Default trigger node ── */
const defaultTriggerNode = (x, y) => ({
  id: "n1", type: "trigger", x, y,
  title: "Trigger: PRICE keyword",
  sub: "When a contact sends PRICE via WhatsApp",
  triggerKind: "keyword",
  keyword: "PRICE",
  matchType: "exact",
  caseSensitive: false,
});

/* ── Factory for new nodes ── */
export const makeNode = (type, x, y, id, templates) => {
  const defs = {
    trigger:    { title:"Trigger", sub:"When a condition is met" },
    message:    { title:"Message", sub:"Send a WhatsApp template" },
    condition:  { title:"Condition", sub:"Check contact data or message" },
    action:     { title:"Action", sub:"Run one or more actions" },
    delay:      { title:"Delay", sub:"Wait before next step" },
    api:        { title:"API call", sub:"Send data to external system" },
    handoff:    { title:"Human handoff", sub:"Assign to team member" },
    ai:         { title:"AI step", sub:"Let AI generate a response" },
    subflow:    { title:"Sub-flow", sub:"Run another automation" },
  }[type] || { title: type, sub: "" };
  const base = { id, type, x, y, title: defs.title, sub: defs.sub };
  if (type === "trigger") return { ...base, triggerKind: "keyword", keyword: "", matchType: "exact", caseSensitive: false };
  if (type === "message") return { ...base, templateId: "", bindings: {}, messageMode: "template", directType: "text", directData: { body: "" } };
  if (type === "condition") return { ...base, matchMode: "all", rules: [] };
  if (type === "action") return { ...base, actions: [] };
  if (type === "delay") return { ...base, delayMode: "duration", waitValue: "10", waitUnit: "minutes", useContactTz: false };
  if (type === "api") return { ...base, method: "POST", apiUrl: "", headers: {}, body: "", onError: "continue" };
  if (type === "handoff") return { ...base, assignMode: "specific", assigned: [], priority: "high", slaValue: "15", slaUnit: "minutes", internalNote: "", notify: { wa:true, email:true, task:false } };
  if (type === "ai") return { ...base, aiTask: "lead_qualification", aiGoal: "", aiContext: "", aiSaveTo: "", aiFallback: "fallback_message", fallbackTemplateId: "" };
  if (type === "subflow") return { ...base, flowId: "", waitMode: "await" };
  return base;
};

/* ── Action kinds ── */
const ACTION_KINDS = [
  { kind:"Assign to BDA",       icon:IC.agent,    valueType:"bdaUser", emptyText:"Choose a BDA Sales user" },
  { kind:"Assign to Agent",     icon:IC.agent,    valueType:"agent",   emptyText:"Choose a team member" },
  { kind:"Add Tag",            icon:IC.tag,      valueType:"tag",     emptyText:"Choose a tag" },
  { kind:"Remove Tag",         icon:IC.tag,      valueType:"tag",     emptyText:"Choose a tag" },
  { kind:"Set Custom Field",   icon:IC.cog,      valueType:"field",   emptyText:"Pick a field and value" },
  { kind:"Clear Custom Field", icon:IC.cog,      valueType:"field",   emptyText:"Pick a field to clear" },
  { kind:"Update Lead Score",  icon:IC.chart,    valueType:"leadScore",emptyText:"Set point change" },
  { kind:"Subscribe Contact",  icon:IC.bcast,    valueType:"none",    emptyText:"Contact is subscribed" },
  { kind:"Unsubscribe Contact",icon:IC.bcast,    valueType:"none",    emptyText:"Contact is unsubscribed" },
  { kind:"Send Email",         icon:IC.mail,     valueType:"email",   emptyText:"Enter email address", placeholder:"name@domain.com" },
  { kind:"Start Sequence",     icon:IC.flow,     valueType:"none",    emptyText:"Sequence will start" },
  { kind:"Pause Sequence",     icon:IC.flow,     valueType:"none",    emptyText:"Sequence will pause" },
  { kind:"End Sequence",       icon:IC.flow,     valueType:"none",    emptyText:"Sequence will end" },
];
const findAction = (kind) => ACTION_KINDS.find(a => a.kind === kind) || ACTION_KINDS[0];

const DIRECT_MSG_TYPES = [
  { key:"text",        label:"Text Message",      fields:["body"] },
  { key:"image",       label:"Image Message",     fields:["url","caption"] },
  { key:"video",       label:"Video Message",     fields:["url","caption"] },
  { key:"audio",       label:"Audio Message",     fields:["url"] },
  { key:"document",    label:"Document / PDF",    fields:["url","caption","filename"] },
  { key:"location",    label:"Location Message",  fields:["latitude","longitude","name","address"] },
  { key:"contact",     label:"Contact Card",      fields:["name","phone"] },
  { key:"product",     label:"Product Message",   fields:["catalog_id","product_retailer_id"] },
  { key:"catalog",     label:"Catalog Message",   fields:["body","catalog_id"] },
  { key:"quick_reply", label:"Quick Reply",       fields:["body","buttons"] },
  { key:"list",        label:"List Message",      fields:["body","button_text","sections"] },
  { key:"dynamic_api", label:"Dynamic API Msg",   fields:["endpoint","method","headers","body"] },
];
const DIRECT_MSG_LABELS = Object.fromEntries(DIRECT_MSG_TYPES.map(t => [t.key, t.label]));

/* ── Condition sources ── */
const CONDITION_SOURCES = [
  { id:"system", label:"System fields" },
  { id:"custom", label:"Custom fields" },
  { id:"tags",   label:"Tags" },
  { id:"bot",    label:"Bot context" },
  { id:"entry",  label:"Entry source" },
  { id:"optin",  label:"Opt-in channel" },
  { id:"sequence",label:"Sequence" },
  { id:"segment", label:"Segment" },
  { id:"time",    label:"Time" },
];
const WA_SYSTEM_FIELDS = ["name","first_name","last_name","email","phone","country","language","optin_status","last_active","conversation_count"];
const GENERAL_FIELDS = ["city","state","pincode","budget","timeline","bhk_type","lead_score","source","notes"];
const OPERATORS = ["equals","does not equal","contains","does not contain","starts with","ends with","is empty","is not empty","is true","is false","is within last","is before","is after","has tag","does not have tag","is greater than","is less than"];
const WA_CONDITION_PRESETS = [
  { source:"system", field:"optin_status", op:"equals", value:"subscribed", label:"Contact is opted-in" },
  { source:"system", field:"last_active", op:"is within last", value:"24 hours", label:"Active in last 24h" },
  { source:"tags", field:"Hot Lead", op:"has tag", value:"Hot Lead", label:"Has tag: Hot Lead" },
  { source:"system", field:"conversation_count", op:"is greater than", value:"0", label:"Has prior conversation" },
  { source:"custom", field:"city", op:"equals", value:"Chennai", label:"City is Chennai" },
  { source:"custom", field:"budget", op:"is greater than", value:"1000000", label:"Budget > ₹10L" },
];


/* ── Interactive FlowNode with input/output handles ── */
const FlowNode = ({ n, selected, onSelect, onStartDrag, onStartConnect, whatsappAccounts=[] }) => {
  const t = NT[n.type];
  const h = nodeH(n);
  const isCondition = n.type === "condition";
  const isAction = n.type === "action";
  const isDisabled = !!n.disabled;
  const SEL = "#A32D2D";
  return (
    <div
      data-testid="flow-node"
      data-node-id={n.id}
      onMouseDown={(e) => { e.stopPropagation(); onStartDrag(e, n.id); }}
      onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
      style={{
        position:"absolute", left:n.x, top:n.y, width:NODE_W, minHeight:h, background:"#fff",
        border: selected ? `2px solid ${SEL}` : `1px solid ${isDisabled ? "#D0D0CA" : C.cardBorder}`,
        borderRadius:12,
        boxShadow: selected ? `0 0 0 3px rgba(0,0,0,.06), 0 10px 28px rgba(0,0,0,.08)` : "0 1px 4px rgba(0,0,0,.05)",
        cursor:"grab", userSelect:"none", fontFamily:"'DM Sans'", overflow:"visible",
        opacity: isDisabled ? 0.55 : 1,
        filter: isDisabled ? "grayscale(0.6)" : "none",
      }}
    >
      {isDisabled && (
        <div style={{
          position:"absolute", top:-9, right:8, zIndex:6,
          background:"#fff", color:"#666", border:`1px solid ${C.cardBorder}`,
          fontSize:8.5, fontWeight:700, padding:"2px 8px", borderRadius:99,
          letterSpacing:".1em", textTransform:"uppercase",
          boxShadow:"0 1px 3px rgba(0,0,0,.08)",
        }}>Disabled</div>
      )}
      <div style={{ height:3, background:selected?SEL:C.cardBorder, borderRadius:"11px 11px 0 0" }}/>

      {isAction ? (
        <div style={{ padding:"10px 12px 8px", display:"flex", alignItems:"flex-start", gap:9 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:C.sectionBg, color:C.text3, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, border:`1px solid ${C.cardBorder}` }}>{IC.tag(15)}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", color:C.muted, marginBottom:2 }}>{t.label}</div>
            <div style={{ fontSize:13, fontWeight:700, color:C.text1, lineHeight:1.25, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{n.title || "Actions"}</div>
            <div style={{ fontSize:10, color:C.text5, fontWeight:500, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {(n.actions || []).length > 0 ? `${(n.actions || []).length} action${(n.actions || []).length===1?"":"s"}` : "Click to configure"}
            </div>
          </div>
          {n.warn && <div title="Compliance warning" style={{ color:C.orange, flexShrink:0, paddingTop:2 }}>{IC.warn(14)}</div>}
          {(n.error || (isCondition && (!n.rules || n.rules.length === 0))) && <div title="Set up rules to complete this condition" style={{ color:C.red, flexShrink:0, paddingTop:2 }}>{IC.err(14)}</div>}
          {n.approved && <div title="Template approved" style={{ color:C.red, flexShrink:0, paddingTop:2 }}>{IC.ok(14)}</div>}
          {n.type === "message" && n.waitForReply && (
            <div title={`Pauses here, waits up to ${n.waitTimeoutHours || 24}h for customer's reply`} style={{ color:C.muted, flexShrink:0, paddingTop:2 }}>
              {IC.clock(14)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding:"10px 12px 8px", display:"flex", alignItems:"flex-start", gap:9 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:C.sectionBg, color:C.text3, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, border:`1px solid ${C.cardBorder}` }}>{t.icon(15)}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", color:C.muted, marginBottom:2 }}>{t.label}</div>
            <div style={{ fontSize:13, fontWeight:700, color:C.text1, lineHeight:1.25, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {n.type === 'trigger' ? getTriggerDisplay(n).title : n.title}
            </div>
            <div style={{ fontSize:10, color:C.text5, fontWeight:500, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {n.type === "message" && n.messageMode === "direct" ? (DIRECT_MSG_LABELS[n.directType] || "Direct message")
               : n.type === 'trigger' ? getTriggerDisplay(n).sub
               : n.sub}
            </div>
            {n.type === "message" && n.whatsappAccountId && (
              <div style={{ fontSize:9, color:C.muted, fontWeight:500, marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontFamily:"'DM Mono'" }}>
                via {maskPhone(whatsappAccounts.find(a => String(a.id) === String(n.whatsappAccountId))?.displayPhoneNumber) || 'custom number'}
              </div>
            )}
          </div>
          {n.warn && <div title="Compliance warning" style={{ color:C.orange, flexShrink:0, paddingTop:2 }}>{IC.warn(14)}</div>}
          {(n.error || (isCondition && (!n.rules || n.rules.length === 0))) && <div title="Set up rules to complete this condition" style={{ color:C.red, flexShrink:0, paddingTop:2 }}>{IC.err(14)}</div>}
          {n.approved && <div title="Template approved" style={{ color:C.red, flexShrink:0, paddingTop:2 }}>{IC.ok(14)}</div>}
          {n.type === "message" && n.waitForReply && (
            <div title={`Pauses here, waits up to ${n.waitTimeoutHours || 24}h for customer's reply`} style={{ color:C.muted, flexShrink:0, paddingTop:2 }}>
              {IC.clock(14)}
            </div>
          )}
        </div>
      )}

      {isCondition && (
        <div style={{ padding:"0 12px 10px", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
          <span style={{ fontSize:9, fontWeight:700, color:C.text3, background:C.sectionBg, border:`1px solid ${C.innerBorder}`, padding:"2px 7px", borderRadius:99, letterSpacing:".06em" }}>
            {n.matchMode === "any" ? "ANY MATCH" : "ALL MATCH"}
          </span>
          <span style={{ fontSize:9, fontWeight:700, color:C.muted, background:C.sectionBg, border:`1px solid ${C.innerBorder}`, padding:"2px 7px", borderRadius:99 }}>
            {(n.rules || []).length} rule{(n.rules || []).length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {/* Input handle — triggers don't accept inbound connections */}
      {n.type !== "trigger" && (
        <div
          data-handle="input"
          data-node-id={n.id}
          onMouseDown={(e) => e.stopPropagation()}
          title="Inbound connection target — drag an output handle here to connect"
          style={{ position:"absolute", top:-9, left:"50%", transform:"translateX(-50%)", display:"flex", alignItems:"center", justifyContent:"center", width:30, height:16, borderRadius:"8px 8px 4px 4px", background:"#fff", border:`1.5px solid ${t.accent}`, borderBottomWidth:0, color:t.accent, fontSize:11, fontWeight:700, lineHeight:1, boxShadow:"0 1px 3px rgba(0,0,0,.10)", zIndex:5, cursor:"crosshair", fontFamily:"'DM Sans'" }}
        >
          <svg width="11" height="9" viewBox="0 0 11 9" style={{ display:"block" }}>
            <path d="M5.5 0 L5.5 6 M2 4 L5.5 7.5 L9 4" stroke={t.accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </div>
      )}

      {/* Output handles */}
      {outputHandlesOf(n).map(h => {
        const sidePos = { bottom:-6, left:`${(()=>{
              if(h==="yes")return 33.3;
              if(h==="no")return 66.7;
              if(typeof h==="string" && h.startsWith("btn:")){
                const idx=parseInt(h.slice(4),10);
                const dd=n.directData||{};
                const total = (n.type==="message" && n.messageMode==="direct" && n.directType==="quick_reply" && Array.isArray(dd.buttons))
                  ? dd.buttons.length
                  : (Array.isArray(n.buttons) ? n.buttons.length : 1);
                return ((idx+1)*100)/(total+1);
              }
              if(typeof h==="string" && h.startsWith("row:")){
                const idx=parseInt(h.slice(4),10);
                const dd=n.directData||{};
                const total = Array.isArray(dd.sections) ? dd.sections.length : 1;
                return ((idx+1)*100)/(total+1);
              }
              return 50;
            })()}%`, transform:"translateX(-50%)" };
        const isBtnHandle = typeof h === "string" && h.startsWith("btn:");
        const labelPos = isBtnHandle
            ? { top:16, left:"50%", transform:"translateX(-50%)" }
            : { top:-16, left:"50%", transform:"translateX(-50%)" };
        let labelText = h === "yes" ? "Yes"
          : h === "no" ? "No"
          : h.startsWith("btn:") ? (() => {
              const idx = parseInt(h.slice(4), 10);
              if (n.type === "message" && n.messageMode === "direct") {
                const dd = n.directData || {};
                if (n.directType === "quick_reply" && Array.isArray(dd.buttons) && dd.buttons[idx]) {
                  return dd.buttons[idx].title || `Btn ${idx + 1}`;
                }
              }
              if (n.buttons && n.buttons[idx]) {
                const b = n.buttons[idx];
                return b.text || b || `Btn ${idx + 1}`;
              }
              return `Btn ${idx + 1}`;
            })()
          : "";
        const handleEvents = { onMouseDown: (e) => { e.stopPropagation(); onStartConnect(e, n.id, h); } };
        return (
          <div key={h}
            data-handle-kind="output"
            data-handle-which={h}
            style={{ position:"absolute", ...sidePos, width:12, height:12, borderRadius:"50%", background:"#fff", border:`2px solid ${C.cardBorder}`, zIndex:5, cursor:"crosshair" }}
            {...handleEvents}
          >
            {h !== "default" && (
              <span style={{ position:"absolute", ...labelPos, fontSize:8, fontWeight:700, color:C.muted, whiteSpace:"nowrap", fontFamily:"'DM Mono'", letterSpacing:".06em", maxWidth:72, overflow:"hidden", textOverflow:"ellipsis", textAlign:"center", background:"#fff", padding:"0 3px", borderRadius:3, zIndex:6 }}>
                {labelText}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};


/* ── SVG connectors between nodes ── */
export const edgePath = (x1,y1,x2,y2) => {
  const dy = Math.abs(y2 - y1);
  const c = Math.max(40, dy * 0.45);
  return `M ${x1} ${y1} C ${x1} ${y1+c}, ${x2} ${y2-c}, ${x2} ${y2}`;
};

const Connectors = ({ nodes, edges, ghost }) => {
  const map = Object.fromEntries(nodes.map(n=>[n.id,n]));
  return (
    <svg style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", overflow:"visible", pointerEvents:"none" }}>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#9C9B92"/>
        </marker>
        <marker id="arrGhost" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill={C.red}/>
        </marker>
      </defs>
      {edges.map((e,i)=>{
        const a=map[e.from]; const b=map[e.to]; if (!a||!b) return null;
        const p1 = handlePos(a, "output", e.fromHandle || "default");
        const p2 = handlePos(b, "input");
        const d = edgePath(p1.x, p1.y, p2.x, p2.y);
        const isCond = e.fromHandle==="yes"||e.fromHandle==="no";
        const color = isCond ? (e.fromHandle==="yes"?"#C44A4A":"#A32D2D") : "#9C9B92";
        return <g key={i}>
          <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" markerEnd="url(#arr)"/>
          <path d={d} fill="none" stroke={color} strokeWidth={10} strokeOpacity={0} style={{ pointerEvents:"stroke", cursor:"pointer" }}/>
        </g>;
      })}
      {ghost && (
        <g>
          <path d={edgePath(ghost.x1, ghost.y1, ghost.x2, ghost.y2)} stroke={C.red} strokeWidth="2.5" strokeDasharray="6 5" fill="none" markerEnd="url(#arrGhost)"/>
          <circle cx={ghost.x1} cy={ghost.y1} r="5" fill={C.brandBright}/>
        </g>
      )}
    </svg>
  );
};

const EdgePlus = ({ x, y, onClick, withConnector=false }) => (
  <div data-testid={withConnector ? "append-plus" : "edge-plus"} onClick={onClick} style={{ position:"absolute", left:x, top:y, transform:"translate(-50%,-50%)", zIndex:8, cursor:"pointer" }}>
    <div style={{ width:26, height:26, borderRadius:"50%", background:"#fff", border:`1.5px solid ${C.red}`, color:C.red, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:700, boxShadow:"0 2px 6px rgba(0,0,0,.12)", transition:"all .15s", lineHeight:1 }}>
      {IC.plus(14)}
    </div>
    {withConnector && (
      <div style={{ position:"absolute", top:-37, left:12, width:2, height:37, background:C.red, zIndex:-1 }}/>
    )}
  </div>
);

const EdgeDelete = ({ x, y, onClick }) => (
  <div onClick={onClick} style={{ position:"absolute", left:x, top:y, transform:"translate(-50%,-50%)", zIndex:8, cursor:"pointer" }}>
    <div style={{ width:20, height:20, borderRadius:"50%", background:C.redBg, border:`1.5px solid ${C.red}`, color:C.red, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, boxShadow:"0 2px 6px rgba(0,0,0,.12)", transition:"all .15s" }}>
      {IC.x(10)}
    </div>
  </div>
);

const NodeActions = ({ x, y, onDuplicate, onDelete }) => (
  <div style={{ position:"absolute", left:x, top:y, transform:"translate(-50%,-100%)", zIndex:10, display:"flex", gap:4 }}>
    <button onClick={(e)=>{e.stopPropagation(); onDuplicate();}} style={{ background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:7, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", color:C.text3, cursor:"pointer", boxShadow:"0 2px 6px rgba(0,0,0,.08)" }}>{IC.copy(13)}</button>
    <button onClick={(e)=>{e.stopPropagation(); onDelete();}} style={{ background:"#fff", border:`1px solid ${C.redBg}`, borderRadius:7, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", color:C.red, cursor:"pointer", boxShadow:"0 2px 6px rgba(0,0,0,.08)" }}>{IC.trash(13)}</button>
  </div>
);


/* ── Node Picker (add node between / append) ── */
const NodePicker = ({ x, y, onPick, onClose, mode, groups = [] }) => {
  const [q, setQ] = useState("");
  const [activeG, setActiveG] = useState(null);
  const pickerRef = useRef(null);
  const [pos, setPos] = useState({ x, y });
  const visibleGroups = groups.filter(g => g.title !== "Triggers");
  const hasSearch = q.trim().length > 0;

  useLayoutEffect(() => {
    const el = pickerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 12;
    let nx = x;
    let ny = y;
    // keep inside right edge
    if (nx + rect.width > vw - MARGIN) nx = vw - rect.width - MARGIN;
    // keep inside left edge
    if (nx < MARGIN) nx = MARGIN;
    // keep inside bottom edge — if it would overflow, shift up
    if (ny + rect.height > vh - MARGIN) ny = vh - rect.height - MARGIN;
    // keep inside top edge
    if (ny < MARGIN) ny = MARGIN;
    setPos({ x: nx, y: ny });
  }, [x, y, activeG, q]);

  return (
    <div ref={pickerRef} onClick={(e) => e.stopPropagation()} style={{ position:"fixed", left:pos.x, top:pos.y, zIndex:70, background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:12, padding:6, boxShadow:"0 12px 36px rgba(0,0,0,.14)", width:220, maxHeight:"70vh", overflowY:"auto" }}>
      <div style={{ fontSize:9, fontWeight:700, color:C.muted, letterSpacing:".1em", textTransform:"uppercase", padding:"4px 8px 6px" }}>{mode==="append"?"Add next step":"Insert block"}</div>
      <div style={{ padding:"0 8px 6px" }}>
        <Input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search blocks…" style={{ padding:"6px 9px", fontSize:11 }}/>
      </div>
      {visibleGroups.map(g => {
        const items = g.items.filter(i => !q || i.name.toLowerCase().includes(q.toLowerCase()));
        if (!items.length) return null;
        const isOpen = hasSearch ? true : activeG === g.title;
        return (
          <div key={g.title} style={{ marginBottom:4 }}>
            <div onClick={()=>setActiveG(prev => prev === g.title ? null : g.title)} style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 8px", cursor:"pointer", borderRadius:6, transition:"background .12s" }} onMouseEnter={e=>e.currentTarget.style.background="#F8F7F2"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{ width:6, height:6, borderRadius:99, background:g.color }}/>
              <span style={{ fontSize:9, color:C.text4, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", flex:1 }}>{g.title}</span>
              <span style={{ fontSize:10, fontWeight:600, color:C.muted, background:C.sectionBg, borderRadius:99, padding:"1px 6px", minWidth:18, textAlign:"center" }}>{items.length}</span>
              <span style={{ color:C.ghost, transform:isOpen?"rotate(180deg)":"rotate(0)", transition:"transform .15s" }}>{IC.cD(10)}</span>
            </div>
            {isOpen && items.map(it => {
              const t = NT[it.type];
              return (
                <button data-testid="node-picker-item" key={it.name} onClick={()=>onPick(it)} style={{
                  width:"100%", padding:"7px 9px", background:"transparent", border:"1px solid transparent", borderRadius:7, cursor:"pointer", textAlign:"left",
                  display:"flex", alignItems:"center", gap:8, fontSize:11, fontWeight:600, color:C.text2, fontFamily:"'DM Sans'",
                }}>
                  <span style={{ width:22, height:22, borderRadius:6, background:t.bg, color:t.color, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{it.icon(13)}</span>
                  <span>{it.name}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      <div style={{ borderTop:`1px solid ${C.rowDiv}`, margin:"4px 0" }}/>
      <button onClick={onClose} style={{ width:"100%", padding:"6px 10px", background:"transparent", border:"none", cursor:"pointer", textAlign:"center", fontSize:11, color:C.muted, fontWeight:600 }}>Cancel</button>
    </div>
  );
};


/* ── Block Library (left sidebar of builder) ── */
// Automations are linear keyword→message flows: the palette offers exactly two
// blocks — a Keyword Trigger and a Send Message. (All other node types —
// conditions, delays, actions, handoff, AI, API, sub-flows — were removed.)
const BLOCK_GROUPS = [
  { title:"Triggers", color:C.brand, items:[
    { name:"Keyword Trigger",  type:"trigger", icon:IC.zap,   desc:"User sends a keyword",
      defaults:{ triggerKind:"keyword", keyword:"PRICE", matchType:"exact", caseSensitive:false, summary:"Trigger when contact sends a specific keyword" } },
  ]},
  { title:"Messages", color:C.blue, items:[
    { name:"Send Message", type:"message", icon:IC.msg,   desc:"Send a WhatsApp message",
      defaults:{ templateId:"", summary:"Send a Meta-approved WhatsApp template" } },
  ]},
];

const BlockLibrary = ({ onAddBlock }) => {
  const [openG, setOpenG] = useState({ Triggers:true, Messages:true, Logic:true, Actions:true, "API & Integrations":true, AI:true, Workflows:true });
  const [q, setQ] = useState("");
  return (
    <aside style={{ width:236, borderRight:`1px solid ${C.cardBorder}`, background:"#FAFAF7", display:"flex", flexDirection:"column", flexShrink:0 }}>
      <div style={{ padding:"14px 14px 10px", borderBottom:`1px solid ${C.cardBorder}` }}>
        <div style={{ fontSize:10, color:C.muted, fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", marginBottom:6 }}>Block Library</div>
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:C.ph }}>{IC.search(13)}</span>
          <Input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search blocks…" style={{ paddingLeft:30, padding:"7px 10px 7px 30px", fontSize:11}}/>
        </div>
        <div style={{ fontSize:9, color:C.text5, marginTop:8, lineHeight:1.4, fontWeight:500 }}>Click any block to add it to the canvas</div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"10px 6px" }}>
        {BLOCK_GROUPS.map(g => {
          const items = g.items.filter(i => !q || i.name.toLowerCase().includes(q.toLowerCase()));
          if (!items.length) return null;
          const isOpen = openG[g.title] !== false;
          return (
            <div key={g.title} style={{ marginBottom:8 }}>
              <div onClick={()=>setOpenG({ ...openG, [g.title]: !isOpen })} style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 10px", cursor:"pointer" }}>
                <span style={{ width:6, height:6, borderRadius:99, background:g.color }}/>
                <span style={{ fontSize:10, color:C.text4, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", flex:1 }}>{g.title}</span>
                <span style={{ color:C.ghost, transform:isOpen?"rotate(180deg)":"rotate(0)", transition:"transform .15s" }}>{IC.cD(10)}</span>
              </div>
              {isOpen && items.map(it => {
                const t = NT[it.type];
                return (
                  <button data-testid="block-library-item" key={it.name} title={`Click to add "${it.name}" to the canvas · ${it.desc}`}
                    draggable
                    onDragStart={(e)=>{ e.dataTransfer.setData("blockType", JSON.stringify(it)); }}
                    onClick={(e)=>onAddBlock && onAddBlock(it, e)}
                    style={{ background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:8, padding:"7px 9px", margin:"3px 4px", cursor:"pointer", display:"flex", alignItems:"center", gap:8, transition:"all .12s", width:"calc(100% - 8px)", textAlign:"left", fontFamily:"'DM Sans'" }}>
                    <div style={{ width:22, height:22, borderRadius:6, background:t.bg, color:t.color, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{it.icon(13)}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:600, color:C.text2, fontFamily:"'DM Sans'" }}>{it.name}</div>
                      <div style={{ fontSize:9, color:C.text5, marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.desc}</div>
                    </div>
                    <span style={{ color:C.brand, opacity:0.6, flexShrink:0 }}>{IC.plus(12)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
};


/* ── Settings Panel content for each node type ── */
const TemplatePreview = ({ template }) => {
  if (!template) return null;
  const samples = template.samples || {};
  const body = (template.body || '').replace(/\{\{(\d+)\}\}/g, (_, num) => {
    const val = samples[String(num)] || samples[Number(num)];
    return val || `[var ${num}]`;
  });
  const buttons = Array.isArray(template.buttons) ? template.buttons : [];
  const hasHeader = template.header_type && template.header_type !== 'NONE' && template.header_text;
  const hasFooter = !!template.footer;
  const hasButtons = buttons.length > 0;

  return (
    <div style={{ marginTop:14, marginBottom:14, background:"#E5DDD5", border:`1px solid ${C.cardBorder}`, borderRadius:12, padding:"12px 10px", overflow:"hidden", position:"relative" }}>
      {/* WhatsApp chat pattern overlay */}
      <div style={{ position:"absolute", inset:0, opacity:0.06, backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cpath d='M20 20 L25 25 M55 55 L60 60' stroke='%23000' stroke-width='1'/%3E%3C/svg%3E\")", pointerEvents:"none" }}/>
      <Sec style={{ marginBottom:10, position:"relative", zIndex:1 }}>Template preview</Sec>
      <div style={{ position:"relative", zIndex:1 }}>
        {/* Date pill */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:8 }}>
          <span style={{ background:"#E1F2FA", color:"#3C6678", fontSize:9, padding:"2px 9px", borderRadius:99, fontWeight:600 }}>TODAY</span>
        </div>
        {/* Incoming message bubble */}
        <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:4 }}>
          <div style={{ background:"#fff", borderRadius:"0 8px 8px 8px", maxWidth:"88%", fontSize:12, color:"#111", lineHeight:1.45, overflow:"hidden", boxShadow:"0 1px 1px rgba(0,0,0,.07)" }}>
            {hasHeader && (
              <div style={{ padding:"7px 10px 3px", fontSize:12, fontWeight:700, color:C.text1, borderBottom:"1px solid #F0F0F0" }}>
                {template.header_text}
              </div>
            )}
            <div style={{ padding:"7px 10px 5px", whiteSpace:"pre-wrap" }}>{body}</div>
            {hasFooter && (
              <div style={{ padding:"0 10px 5px", fontSize:10, color:"#667781", fontWeight:500 }}>
                {template.footer}
              </div>
            )}
            <div style={{ fontSize:8, color:"#667781", textAlign:"right", padding:"0 10px 5px", fontFamily:"-apple-system, 'SF Pro Display', sans-serif", display:"flex", justifyContent:"flex-end", alignItems:"center", gap:3 }}>
              10:24 AM
            </div>
            {hasButtons && (
              <div style={{ borderTop:"1px solid #E0E0E0" }}>
                {buttons.map((btn, idx) => (
                  <div key={idx} style={{ display:"block", width:"100%", padding:"7px 9px", border:"none", borderTop: idx > 0 ? "1px solid #F0F0F0" : "none", textAlign:"center", color:"#00A5F4", fontSize:11, fontWeight:500, background:"transparent", fontFamily:"-apple-system, 'SF Pro Display', sans-serif" }}>
                    {btn.text || btn}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


const SettingsPanel = ({ node, nodes=[], edges=[], onUpdateNode=()=>{}, onDeleteNode=()=>{}, onDuplicateNode=()=>{}, onSaveAndClose=()=>{}, onToggleDisable=()=>{}, onDeleteButton=()=>{}, onSelectTemplate=()=>{}, templates=[], teamMembers=[], tags=[], contactFields=[], otherAutomations=[], whatsappAccounts=[], assignableUsers=[] }) => {
  const [editingTitle, setEditingTitle] = useState(false);
  const [subflowSearch, setSubflowSearch] = useState("");
  const titleInputRef = useRef(null);
  useEffect(() => { setEditingTitle(false); }, [node?.id]);
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);
  const commitTitle = () => setEditingTitle(false);
  const onTitleKey = (e) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      commitTitle();
    }
  };

  const tagNames = tags.map(t => t.name).filter(Boolean);
  const fieldNames = contactFields.map(f => f.name).filter(Boolean);

  // Hooks for message node media library — must be at top level (Rules of Hooks)
  const [mediaItems, setMediaItems] = useState([]);
  useEffect(() => {
    if (!node || node.type !== "message") { setMediaItems([]); return; }
    if (!['image','video','audio','document'].includes(node.directType)) { setMediaItems([]); return; }
    api.mediaLibrary.list().then(r => setMediaItems(r.media || [])).catch(() => setMediaItems([]));
  }, [node?.type, node?.directType]);

  if (!node) return (
    <aside style={{ width:344, borderLeft:`1px solid ${C.cardBorder}`, background:"#fff", flexShrink:0, padding:24, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", color:C.text5 }}>
      <div style={{ width:56, height:56, borderRadius:12, background:C.sectionBg, display:"flex", alignItems:"center", justifyContent:"center", color:C.muted, marginBottom:14 }}>{IC.flow(24)}</div>
      <div style={{ fontSize:14, fontWeight:700, color:C.text2, marginBottom:6 }}>Select a block to edit</div>
      <div style={{ fontSize:12, color:C.text5, lineHeight:1.5 }}>Click any node on the canvas to configure its message body, buttons, conditions, or API behavior.</div>
    </aside>
  );
  const t = NT[node.type];

  let content = null;

  if (node.type === "message") {
    const mode = node.messageMode || "template";
    const setMode = (m) => onUpdateNode(node.id, n => ({ ...n, messageMode: m }));
    const dd = node.directData || {};
    const setDirect = (patch) => onUpdateNode(node.id, n => ({ ...n, directData: { ...(n.directData || {}), ...patch } }));
    const setDirectType = (t) => onUpdateNode(node.id, n => ({ ...n, directType: t, directData: {} }));

    const tplId = node.templateId || "";
    const tpl = templates.find(t => String(t.id) === String(tplId));
    const templateButtons = tpl?.buttons || null;

    const TabBtn = ({ label, active, onClick }) => (
      <button onClick={onClick} style={{ flex:1, padding:"6px 0", fontSize:11, fontWeight:700, fontFamily:"'DM Sans'", borderRadius:8, border:"none", cursor:"pointer", background: active ? C.brandBg : "transparent", color: active ? C.brandDark : C.muted }}>
        {label}
      </button>
    );

    const DirectField = ({ label, type="text", value, onChange, placeholder="", hint="" }) => (
      <Field label={label} hint={hint}>
        {type === "textarea" ? (
          <Textarea value={value || ""} onChange={e => setDirect({ [label.toLowerCase().replace(/[^a-z]/g,"_")]: e.target.value })} placeholder={placeholder} style={{ fontSize:11 }}/>
        ) : (
          <Input value={value || ""} onChange={e => setDirect({ [label.toLowerCase().replace(/[^a-z]/g,"_")]: e.target.value })} placeholder={placeholder} style={{ padding:"6px 9px", fontSize:11 }}/>
        )}
      </Field>
    );

    const renderDirectFields = () => {
      const dt = node.directType || "text";
      switch (dt) {
        case "text":
          return <Field label="Message text" hint="Max 4096 characters. Insert variables with the {x} button (e.g. {{name}})."><VarTextarea value={dd.body || ""} onChange={e=>setDirect({body:e.target.value})} placeholder="Type your message…" style={{ fontSize:11 }}/></Field>;
        case "image":
        case "video":
        case "audio":
        case "document": {
          const selected = mediaItems.find(m => String(m.id) === String(dd.mediaLibraryId));
          const filtered = mediaItems.filter(m => m.mediaType === dt);
          return <>
            <Field label="Select from Media Library">
              <select
                value={dd.mediaLibraryId || ""}
                onChange={e => setDirect({ mediaLibraryId: e.target.value || null, url: '' })}
                style={{ width:'100%', padding:'6px 9px', fontSize:11, border:`1px solid ${C.inputBorder}`, borderRadius:8, fontFamily:"'DM Sans'", background:C.cardBg }}
              >
                <option value="">— Select {dt} —</option>
                {filtered.map(m => (
                  <option key={m.id} value={m.id}>{m.name || m.originalName || `Media #${m.id}`}</option>
                ))}
              </select>
            </Field>
            {selected && (
              <div style={{ marginTop:8, borderRadius:10, overflow:'hidden', border:`1px solid ${C.innerBorder}`, background:C.innerBg }}>
                {dt === 'image' ? (
                  <img src={api.mediaLibrary.downloadUrl(selected.id)} alt="" style={{ width:'100%', height:140, objectFit:'cover' }} />
                ) : dt === 'video' ? (
                  <div style={{ position:'relative', width:'100%', height:140 }}>
                    <video src={api.mediaLibrary.downloadUrl(selected.id)} style={{ width:'100%', height:'100%', objectFit:'cover' }} preload="metadata" muted />
                    <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.25)' }}>
                      <div style={{ width:40, height:40, borderRadius:'50%', background:'rgba(255,255,255,0.9)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding:16, display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ width:40, height:40, borderRadius:8, background:C.brandBg, display:'flex', alignItems:'center', justifyContent:'center', color:C.brand }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600, color:C.text2 }}>{selected.name || selected.originalName}</div>
                      <div style={{ fontSize:11, color:C.muted, textTransform:'capitalize' }}>{selected.mediaType} • {selected.mimeType}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {dt !== 'audio' && <Field label="Caption (optional)"><VarTextarea value={dd.caption || ""} onChange={e=>setDirect({caption:e.target.value})} placeholder="Optional caption…" style={{ fontSize:11}}/></Field>}
            {dt === 'document' && <Field label="Filename (optional)"><VarInput value={dd.filename || ""} onChange={e=>setDirect({filename:e.target.value})} placeholder="e.g. brochure.pdf" style={{ padding:"6px 9px", fontSize:11 }}/></Field>}
          </>;
        }
        case "location":
          return <>
            <div style={{ display:"flex", gap:8 }}>
              <Field label="Latitude" style={{ flex:1 }}><Input value={dd.latitude || ""} onChange={e=>setDirect({latitude:e.target.value})} placeholder="12.97" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
              <Field label="Longitude" style={{ flex:1 }}><Input value={dd.longitude || ""} onChange={e=>setDirect({longitude:e.target.value})} placeholder="80.21" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
            </div>
            <Field label="Location name (optional)"><VarInput value={dd.name || ""} onChange={e=>setDirect({name:e.target.value})} placeholder="e.g. Forge Realty HQ" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
            <Field label="Address (optional)"><VarInput value={dd.address || ""} onChange={e=>setDirect({address:e.target.value})} placeholder="e.g. 123 Anna Nagar, Chennai" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
          </>;
        case "contact":
          return <>
            <Field label="Full name" hint="Required by Meta. Shown as the card's title."><VarInput value={dd.name || ""} onChange={e=>setDirect({name:e.target.value})} placeholder="e.g. Rahul Sharma" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
            <div style={{ display:"flex", gap:8 }}>
              <Field label="First name" style={{ flex:1 }}><VarInput value={dd.first_name || ""} onChange={e=>setDirect({first_name:e.target.value})} placeholder="Rahul" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
              <Field label="Last name" style={{ flex:1 }}><VarInput value={dd.last_name || ""} onChange={e=>setDirect({last_name:e.target.value})} placeholder="Sharma" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
            </div>
            <Field label="Phone number" hint="Use E.164 format (e.g. +919876543210). Variables resolved at send time."><VarInput value={dd.phone || ""} onChange={e=>setDirect({phone:e.target.value})} placeholder="+91 98765 43210" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
            <Field label="Phone type"><Select value={dd.phone_type || "CELL"} onChange={e=>setDirect({phone_type:e.target.value})}><option value="CELL">Cell</option><option value="HOME">Home</option><option value="WORK">Work</option><option value="MAIN">Main</option><option value="IPHONE">iPhone</option></Select></Field>
            <Field label="Email (optional)"><VarInput value={dd.email || ""} onChange={e=>setDirect({email:e.target.value})} placeholder="rahul@example.com" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
            <Field label="Organization (optional)"><VarInput value={dd.org || ""} onChange={e=>setDirect({org:e.target.value})} placeholder="Company name" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
            <Alert kind="info" style={{ marginTop:4 }}>Sent as a WhatsApp contact card the recipient can save to their address book.</Alert>
          </>;
        case "product":
          return <>
            <Field label="Catalog ID"><Input value={dd.catalog_id || ""} onChange={e=>setDirect({catalog_id:e.target.value})} placeholder="Catalog ID from Meta" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
            <Field label="Product Retailer ID"><Input value={dd.product_retailer_id || ""} onChange={e=>setDirect({product_retailer_id:e.target.value})} placeholder="SKU or retailer ID" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
          </>;
        case "catalog":
          return <>
            <Field label="Body text"><Textarea value={dd.body || ""} onChange={e=>setDirect({body:e.target.value})} placeholder="Message text before catalog…" style={{ fontSize:11 }}/></Field>
            <Field label="Catalog ID"><Input value={dd.catalog_id || ""} onChange={e=>setDirect({catalog_id:e.target.value})} placeholder="Catalog ID from Meta" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
          </>;
        case "quick_reply":
          return <>
            <Field label="Header (optional)" hint="Shown bold above the body. Max 60 characters."><VarInput value={dd.header || ""} maxLength={60} onChange={e=>setDirect({header:e.target.value})} placeholder="e.g. Choose an option" style={{ padding:"6px 9px", fontSize:11, fontWeight:700 }}/></Field>
            <Field label="Body text" hint="Select text then click B/I/U, or click first to type inside the markers."><FormatTextarea value={dd.body || ""} onChange={e=>setDirect({body:e.target.value})} placeholder="Your message with quick reply options…" style={{ fontSize:11 }}/></Field>
            <Sec style={{ marginBottom:6 }}>Quick reply buttons</Sec>
            {(dd.buttons || []).map((btn, i) => (
              <div key={i} style={{ display:"flex", gap:6, marginBottom:6 }}>
                <Input value={btn.title || ""} onChange={e => { const b = [...(dd.buttons||[])]; b[i] = { ...b[i], title: e.target.value }; setDirect({ buttons: b }); }} placeholder={`Button ${i+1}`} style={{ flex:1, padding:"6px 9px", fontSize:11 }}/>
                <IconBtn onClick={()=>setDirect({ buttons: (dd.buttons||[]).filter((_,j)=>j!==i) })} danger>{IC.trash(12)}</IconBtn>
              </div>
            ))}
            {(dd.buttons || []).length < 3 && (
              <Btn kind="ghost" size="sm" icon={IC.plus(11)} onClick={()=>setDirect({ buttons: [...(dd.buttons||[]), { title: "" }] })}>Add button</Btn>
            )}
            <Alert kind="info" style={{ marginTop:8 }}>Up to 3 buttons. Each button creates an output handle.</Alert>
          </>;
        case "list": {
          const sectionsArr = dd.sections || [];
          const totalRows = sectionsArr.reduce((acc, s) => acc + ((s.rows || []).length), 0);
          const ROW_CAP = 10;
          const SECTION_CAP = 10;
          const atRowCap = totalRows >= ROW_CAP;
          const atSectionCap = sectionsArr.length >= SECTION_CAP;
          return <>
            <Field label="Header (optional)" hint="Shown bold above the body. Max 60 characters."><VarInput value={dd.header || ""} maxLength={60} onChange={e=>setDirect({header:e.target.value})} placeholder="e.g. Pick a category" style={{ padding:"6px 9px", fontSize:11, fontWeight:700 }}/></Field>
            <Field label="Body text" hint="Required. Select text then click B/I/U, or click first to type inside the markers."><FormatTextarea value={dd.body || ""} onChange={e=>setDirect({body:e.target.value})} placeholder="Your message before the list…" style={{ fontSize:11 }}/></Field>
            <Field label="List button text" hint="Max 20 characters."><Input value={dd.button_text || ""} maxLength={20} onChange={e=>setDirect({button_text:e.target.value})} placeholder="e.g. View options" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:12, marginBottom:6 }}>
              <Sec>List sections</Sec>
              <span style={{ fontSize:10, fontFamily:"'DM Mono'", color: atRowCap ? C.red : C.muted }}>{totalRows} / {ROW_CAP} rows</span>
            </div>
            {sectionsArr.map((sec, si) => (
              <div key={si} style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:8, marginBottom:8 }}>
                <div style={{ display:"flex", gap:6, marginBottom:6 }}>
                  <Input value={sec.title || ""} maxLength={24} onChange={e=>{ const s=[...(dd.sections||[])]; s[si]={...s[si],title:e.target.value}; setDirect({sections:s}); }} placeholder={sectionsArr.length > 1 ? "Section title (required)" : "Section title (optional)"} style={{ flex:1, padding:"6px 9px", fontSize:11 }}/>
                  <IconBtn onClick={()=>setDirect({ sections: (dd.sections||[]).filter((_,j)=>j!==si) })} danger>{IC.trash(12)}</IconBtn>
                </div>
                {(sec.rows || []).map((row, ri) => (
                  <div key={ri} style={{ display:"flex", gap:6, marginBottom:6, paddingLeft:8, flexWrap:"wrap" }}>
                    <Input value={row.title || ""} maxLength={24} onChange={e=>{ const s=[...(dd.sections||[])]; s[si].rows[ri]={...s[si].rows[ri],title:e.target.value}; setDirect({sections:s}); }} placeholder="Row title" style={{ flex:"1 1 130px", padding:"6px 9px", fontSize:11 }}/>
                    <Input value={row.id || ""} maxLength={200} onChange={e=>{ const s=[...(dd.sections||[])]; s[si].rows[ri]={...s[si].rows[ri],id:e.target.value}; setDirect({sections:s}); }} placeholder="ID (auto)" style={{ flex:"0 0 80px", padding:"6px 9px", fontSize:11 }}/>
                    <IconBtn onClick={()=>{ const s=[...(dd.sections||[])]; s[si].rows=s[si].rows.filter((_,j)=>j!==ri); setDirect({sections:s}); }} danger>{IC.trash(12)}</IconBtn>
                    <Input value={row.description || ""} maxLength={72} onChange={e=>{ const s=[...(dd.sections||[])]; s[si].rows[ri]={...s[si].rows[ri],description:e.target.value}; setDirect({sections:s}); }} placeholder="Description (optional)" style={{ flex:"1 1 100%", padding:"6px 9px", fontSize:11 }}/>
                  </div>
                ))}
                <Btn kind="ghost" size="sm" icon={IC.plus(11)} disabled={atRowCap} onClick={()=>{ if (atRowCap) return; const s=[...(dd.sections||[])]; s[si].rows=[...(s[si].rows||[]),{title:"",id:""}]; setDirect({sections:s}); }}>Add row</Btn>
              </div>
            ))}
            <Btn kind="ghost" size="sm" icon={IC.plus(11)} disabled={atSectionCap} onClick={()=>{ if (atSectionCap) return; setDirect({ sections: [...(dd.sections||[]), { title: "", rows: [] }] }); }}>Add section</Btn>
            <Alert kind="info" style={{ marginTop:8 }}>Meta caps a list at <strong>10 rows total</strong> across all sections (max 10 sections). Section title is required when you have more than one section. Each row creates an output handle.</Alert>
          </>;
        }
        case "dynamic_api":
          return <>
            <Alert kind="info" style={{ marginBottom:10 }}>Calls a third-party HTTP endpoint instead of sending through WhatsApp. The response is logged on the execution step.</Alert>
            <Field label="Endpoint URL" hint="Must start with http:// or https://. Variables like {{contact_number}} are resolved."><VarInput value={dd.endpoint || ""} onChange={e=>setDirect({endpoint:e.target.value})} placeholder="https://api.example.com/message" style={{ padding:"6px 9px", fontSize:11 }}/></Field>
            <Field label="Method"><Select value={dd.method || "POST"} onChange={e=>setDirect({method:e.target.value})}><option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option><option>DELETE</option></Select></Field>
            <Field label="Headers (JSON)" hint="Optional. Must be a JSON object."><VarTextarea value={dd.headers || ""} onChange={e=>setDirect({headers:e.target.value})} placeholder='{"Authorization": "Bearer …"}' style={{ fontSize:11 }}/></Field>
            <Field label="Body template" hint="Use {{variables}} for dynamic data. JSON is validated before sending."><VarTextarea value={dd.body || ""} onChange={e=>setDirect({body:e.target.value})} placeholder='{"to": "{{contact_number}}", "text": "Hello"}' style={{ fontSize:11}}/></Field>
            <Field label="On non-2xx response"><Select value={dd.onError || "continue"} onChange={e=>setDirect({onError:e.target.value})}><option value="continue">Continue automation</option><option value="fail">Fail this step (stop walker)</option></Select></Field>
            <Alert kind="warn" style={{ marginTop:8 }}>15-second timeout. The full response (truncated to 4 KB) is captured in the execution log.</Alert>
          </>;
        default:
          return <Alert kind="warn">Select a message type above.</Alert>;
      }
    };

    content = (<>
      <div style={{ display:"flex", gap:4, background:C.sectionBg, borderRadius:10, padding:3, marginBottom:14 }}>
        <TabBtn label="Template" active={mode==="template"} onClick={()=>setMode("template")}/>
        <TabBtn label="Direct" active={mode==="direct"} onClick={()=>setMode("direct")}/>
      </div>

      {/* Single-account system: no "send from" override — always uses the one connected number. */}
      {whatsappAccounts.length > 1 && (
        <Field label="Send from" hint="Which WhatsApp number to send this message from.">
          <Select
            value={node.whatsappAccountId || ""}
            onChange={e => onUpdateNode(node.id, { whatsappAccountId: e.target.value || null })}
          >
            <option value="">— Default (from triggering number) —</option>
            {whatsappAccounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.displayName} ({maskPhone(a.displayPhoneNumber)}){a.isDefault ? ' · default' : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {mode === "template" ? (<>
        <div style={{ background:C.blueBg, border:`1px solid #90CAF9`, borderRadius:10, padding:"10px 12px", marginBottom:14, display:"flex", alignItems:"flex-start", gap:9 }}>
          <span style={{ color:C.blue, flexShrink:0, paddingTop:1 }}>{IC.tpl(15)}</span>
          <div style={{ flex:1, fontSize:11, color:C.text2, lineHeight:1.5 }}>
            Messages are sent using <strong>Meta-approved templates only</strong>. Reply buttons, if any, are defined by the template. To create or edit a template, use WhatsApp Manager.
          </div>
        </div>

        <Field label="WhatsApp template" hint="Only Meta-approved templates can be sent outside the 24-hour window.">
          <Select value={tplId} onChange={(e)=>onSelectTemplate(node.id, e.target.value)}>
            <option value="">— Select template —</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.category} · {t.lang || t.language || 'English'}{t.buttons ? ` · ${t.buttons.length} buttons` : ""}
              </option>
            ))}
          </Select>
        </Field>

        {tpl ? (<>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
            <Badge label={tpl.category} bg={C.brandBg} color={C.brandDark}/>
            <Badge label={tpl.lang || tpl.language || 'English'} bg={C.sectionBg} color={C.text3}/>
            <Badge label={tpl.status} bg={tpl.status==="Approved"||tpl.status==="APPROVED"?C.brandBg:"#FFF3E0"} color={tpl.status==="Approved"||tpl.status==="APPROVED"?C.brandDark:"#B04E0E"} dot/>
            {templateButtons && (
              <Badge label={`${templateButtons.length} reply button${templateButtons.length===1?"":"s"}`} bg="#FFF8E1" color="#7A5C00"/>
            )}
          </div>

          <TemplatePreview template={tpl} />

          <Field label="Template body" hint="Read-only — edit in WhatsApp Manager.">
            <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:"10px 12px", fontSize:12, color:C.text2, lineHeight:1.5, fontFamily:"'DM Sans'", whiteSpace:"pre-wrap" }}>
              {tpl.body}
            </div>
          </Field>

          {((tpl.vars ?? tpl.variables?.length) > 0) && (<>
            <Sec style={{ marginBottom:8 }}>Variable bindings · {((tpl.vars ?? tpl.variables?.length) || 0)} {((tpl.vars ?? tpl.variables?.length) || 0)===1?"variable":"variables"}</Sec>
            {Array.from({length: (tpl.vars ?? tpl.variables?.length) || 0}, (_, i) => i+1).map(num => {
              const key = "var" + num;
              return (
                <div key={num} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:C.brand, fontFamily:"'DM Mono'", minWidth:34 }}>{"{{"+num+"}}"}</span>
                  <Select value={(node.bindings || {})[key] || ""} onChange={(e)=>onUpdateNode(node.id, n => ({ ...n, bindings: { ...(n.bindings || {}), [key]: e.target.value } }))} style={{ flex:1, fontSize:11 }}>
                    <option value="">— Pick a variable —</option>
                    <option value="{{name}}">Contact Name</option>
                    <option value="{{contact_number}}">Phone Number</option>
                    {contactFields.map(f => (
                      <option key={f.id} value={`{{${f.name}}}`}>{f.name}</option>
                    ))}
                    <option value="static">Static text…</option>
                  </Select>
                </div>
              );
            })}
          </>)}

          {templateButtons && templateButtons.length > 0 && (<>
            <Sec style={{ marginBottom:8, marginTop:18 }}>Reply buttons ({templateButtons.length})</Sec>
            <Alert kind="info" style={{ marginBottom:8 }}>Buttons are defined by the template. The node will sprout one output handle per button — wire each to the next step.</Alert>
            {templateButtons.map((b, i) => (
              <div key={i} style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:"10px 11px", marginBottom:6, display:"flex", alignItems:"center", gap:9 }}>
                <div style={{ width:22, height:22, borderRadius:5, background:"#fff", border:`1px solid ${C.cardBorder}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontFamily:"'DM Mono'", fontWeight:700, color:C.text3, flexShrink:0 }}>{i+1}</div>
                <div style={{ flex:1, fontSize:12, fontWeight:600, color:C.text1 }}>{b.text}</div>
                <span style={{ fontSize:9, fontFamily:"'DM Mono'", fontWeight:700, color:C.brandDark, background:C.brandBg, border:`1px solid ${C.brandBright}`, borderRadius:5, padding:"2px 6px", letterSpacing:".04em" }}>{`btn:${i}`}</span>
              </div>
            ))}
          </>)}

          <Alert kind="ok" style={{ marginTop:14 }}>
            This template is <strong>{tpl.status === "Approved" || tpl.status === "APPROVED" ? "approved" : "pending Meta review"}</strong>. {tpl.status === "Approved" || tpl.status === "APPROVED" ? "It can be sent any time, including outside the 24-hour service window." : "It can not be sent until Meta approves it."}
          </Alert>
          {tpl.category === "Marketing" && (
            <Alert kind="warn" style={{ marginTop:8 }}>
              <strong>Marketing template — pacing applies.</strong> Meta tests new campaigns on a small subset of recipients first (~1,000). Only after quality signals look good does it roll out fully. Plan extra time for your first send.
            </Alert>
          )}
          {tpl.category === "Authentication" && (
            <Alert kind="info" style={{ marginTop:8 }}>
              <strong>Authentication template.</strong> Reserved for OTPs, password resets, and account verification. Misuse will downgrade your WhatsApp quality rating.
            </Alert>
          )}

        </>) : (
          <Alert kind="warn">Pick a template above to configure variables and preview the message.</Alert>
        )}
      </>) : (<>
        <div style={{ background:"#FFF8E1", border:`1px solid #FFE082`, borderRadius:10, padding:"10px 12px", marginBottom:14, display:"flex", alignItems:"flex-start", gap:9 }}>
          <span style={{ color:"#7A5C00", flexShrink:0, paddingTop:1 }}>{IC.warn(15)}</span>
          <div style={{ flex:1, fontSize:11, color:"#7A5C00", lineHeight:1.5 }}>
            <strong>Direct messages</strong> are sent via the WhatsApp Cloud API without a template. They only work within the 24-hour conversation window. Outside that window, the message will fail.
          </div>
        </div>

        <Field label="Message type">
          <Select value={node.directType || "text"} onChange={e=>setDirectType(e.target.value)}>
            {DIRECT_MSG_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        </Field>

        {renderDirectFields()}
      </>)}

      <div style={{ marginTop:14, padding:"12px", background:C.sectionBg, borderRadius:10, border:`1px solid ${C.innerBorder}` }}>
        <label style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12, color:C.text1, cursor:"pointer", lineHeight:1.4 }}>
          <input type="checkbox"
            checked={!!node.waitForReply}
            onChange={e => onUpdateNode(node.id, { waitForReply: e.target.checked })}
            style={{ marginTop:2, flexShrink:0 }}/>
          <span>
            <strong>Wait for customer's reply</strong> before continuing
            <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
              When on, the execution pauses here. The next inbound message from the customer resumes the flow with that message as the input to downstream nodes.
            </div>
          </span>
        </label>
        {node.waitForReply && (
          <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, fontWeight:600, color:C.text3 }}>Timeout</span>
            <Input type="number" min={1} max={168}
              value={node.waitTimeoutHours ?? 24}
              onChange={e => onUpdateNode(node.id, { waitTimeoutHours: Math.max(1, Math.min(168, parseInt(e.target.value || '24', 10))) })}
              style={{ width:80, padding:"5px 8px", fontSize:11 }}/>
            <span style={{ fontSize:11, color:C.muted }}>hours (max 168 = 7d). Expired pauses are marked failed.</span>
          </div>
        )}
      </div>

      <div style={{ display:"flex", gap:6, marginTop:14 }}>
        <Btn kind="primary" style={{ flex:1, justifyContent:"center" }} onClick={onSaveAndClose}>Save</Btn>
        <Btn kind="ghost" icon={IC.copy(13)} onClick={()=>onDuplicateNode(node.id)}>Duplicate</Btn>
        <Btn kind="danger" icon={IC.trash(13)} onClick={()=>onDeleteNode(node.id)}>Delete</Btn>
      </div>
    </>);
  }

  else if (node.type==="condition") {
    const fieldsBySource = { system: WA_SYSTEM_FIELDS, custom: fieldNames, tags: tagNames, bot:["bot_version","conversation_count","last_intent","bot_state"], entry:["Meta Ads","Website Widget","wa.me link","QR Code","Direct"], optin:["Newsletter","Promo","Reminders"], sequence:["Welcome Sequence","Onboarding","Re-engagement"], segment:["Hot Leads (Chennai)","VIP Buyers","Cold Outreach"], time:["Current time","Day of week","Hour of day"] };
    const rules = node.rules || [];
    const matchMode = node.matchMode || "all";

    const updateRule = (idx, patch) => onUpdateNode(node.id, n => ({
      ...n, rules: (n.rules || []).map((r, i) => i === idx ? { ...r, ...patch } : r)
    }));
    const duplicateRule = (idx) => onUpdateNode(node.id, n => {
      const src = (n.rules || [])[idx]; if (!src) return n;
      const copy = { ...src };
      const rs = [...(n.rules || [])];
      rs.splice(idx + 1, 0, copy);
      return { ...n, rules: rs };
    });
    const deleteRule = (idx) => onUpdateNode(node.id, n => ({
      ...n, rules: (n.rules || []).filter((_, i) => i !== idx)
    }));
    const addRule = () => onUpdateNode(node.id, n => ({
      ...n, rules: [...(n.rules || []), { source:"custom", field: fieldNames[0] || "city", op:"equals", value:"" }]
    }));
    const addPresetAsRule = (p) => onUpdateNode(node.id, n => ({
      ...n, rules: [...(n.rules || []), { source:p.source, field:p.field, op:p.op, value:p.value }]
    }));

    const walkChain = (startId) => {
      const titles = []; let cur = startId; let safety = 0;
      while (cur && safety < 6) {
        const nx = nodes.find(n => n.id === cur); if (!nx) break;
        titles.push(nx.type === "action" ? (nx.sub || nx.title) : nx.title);
        const ne = edges.find(e => e.from === cur); cur = ne ? ne.to : null;
        safety++;
      }
      return titles;
    };
    const matchedFirst    = edges.find(e => e.from === node.id && e.fromHandle === "yes");
    const notMatchedFirst = edges.find(e => e.from === node.id && e.fromHandle === "no");
    const matchedSteps    = matchedFirst    ? walkChain(matchedFirst.to)    : [];
    const notMatchedSteps = notMatchedFirst ? walkChain(notMatchedFirst.to) : [];
    const branchSummary = (steps) => steps.length === 0 ? "Not connected" : steps.slice(0,3).join(" → ") + (steps.length>3?" → …":"");

    content = (<>
      <Field label="Match mode" hint="How rules combine to produce the Matched branch.">
        <div style={{ display:"flex", gap:6 }}>
          <Pill active={matchMode!=="any"} onClick={()=>onUpdateNode(node.id, { matchMode: "all" })}>All conditions</Pill>
          <Pill active={matchMode==="any"} onClick={()=>onUpdateNode(node.id, { matchMode: "any" })}>Any condition</Pill>
        </div>
      </Field>

      <Alert kind="warn">
        <strong>WhatsApp compliance</strong>
        <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:4 }}>
          <div style={{ display:"flex", gap:5 }}><span>•</span><span>This contact is outside the 24-hour WhatsApp window. Use an approved template.</span></div>
          <div style={{ display:"flex", gap:5 }}><span>•</span><span>This contact has not opted in for WhatsApp.</span></div>
          <div style={{ display:"flex", gap:5 }}><span>•</span><span>{(matchedFirst && notMatchedFirst) ? "Both branches connected." : "This condition has no fallback path."}</span></div>
        </div>
      </Alert>

      <Sec style={{ marginTop:18, marginBottom:8 }}>Quick WhatsApp presets</Sec>
      <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:8, marginBottom:14 }}>
        {WA_CONDITION_PRESETS.map(p=>(
          <button key={p.label} onClick={()=>addPresetAsRule(p)} className="picker-item" style={{
            width:"100%", padding:"7px 9px", background:"transparent",
            border:"1px solid transparent", borderTop:"1px solid transparent", cursor:"pointer", textAlign:"left",
            display:"flex", alignItems:"center", gap:8, borderRadius:7,
            fontSize:11, fontWeight:500, color:C.brand, fontFamily:"'DM Sans'",
            lineHeight:1.3, marginBottom:1,
          }}>
            <span style={{ width:18, height:18, borderRadius:5, background:"#fff", border:`1.2px solid ${C.cardBorder}`, display:"flex", alignItems:"center", justifyContent:"center", color:C.brand, flexShrink:0 }}>{IC.plus(11)}</span>
            <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis" }}>{p.label}</span>
          </button>
        ))}
      </div>

      <Sec style={{ marginBottom:8 }}>Conditions ({rules.length} {rules.length===1?"rule":"rules"} · {matchMode==="any"?"ANY":"ALL"} match)</Sec>
      {rules.length === 0 && (
        <div style={{ background:C.redBg, border:`1px solid #F4C9C9`, borderRadius:10, padding:"11px 13px", marginBottom:8, display:"flex", alignItems:"center", gap:9 }}>
          <span style={{ color:C.redDark }}>{IC.err(14)}</span>
          <div style={{ fontSize:11, color:C.redDark, lineHeight:1.45, fontWeight:500 }}>
            No rules defined. Add at least one condition or pick a preset above.
          </div>
        </div>
      )}
      {rules.map((r, i) => {
        const noValueOp = r.op==="is empty" || r.op==="is not empty" || r.op==="is true" || r.op==="is false";
        return (
          <div key={i} style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:11, marginBottom:6 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
              <span style={{ fontSize:9, fontWeight:700, color:C.muted, letterSpacing:".1em", textTransform:"uppercase" }}>Rule {i+1}</span>
              <div style={{ display:"flex", gap:2 }}>
                <IconBtn title="Duplicate rule" onClick={()=>duplicateRule(i)}>{IC.copy(12)}</IconBtn>
                <IconBtn title="Delete rule" danger onClick={()=>deleteRule(i)}>{IC.trash(12)}</IconBtn>
              </div>
            </div>
            <div style={{ marginBottom:5 }}>
              <Select value={r.source || "custom"} onChange={(e)=>updateRule(i, { source: e.target.value, field: (fieldsBySource[e.target.value] || GENERAL_FIELDS)[0] })} style={{ fontSize:11 }}>
                {CONDITION_SOURCES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </div>
            <div style={{ marginBottom:5 }}>
              <Select value={r.field || ""} onChange={(e)=>updateRule(i, { field: e.target.value })} style={{ fontSize:11 }}>
                {(fieldsBySource[r.source] || GENERAL_FIELDS).map(f=><option key={f} value={f}>{f}</option>)}
              </Select>
            </div>
            <div style={{ display:"flex", gap:5 }}>
              <Select value={r.op || "equals"} onChange={(e)=>updateRule(i, { op: e.target.value })} style={{ width:140, fontSize:11 }}>
                {OPERATORS.map(op=><option key={op} value={op}>{op}</option>)}
              </Select>
              {(() => {
                const f = (r.field || "").toLowerCase();
                const isNumeric = /score|budget|count|pincode|amount|points|qty|age/.test(f);
                const isEmail   = f === "email";
                const isPhone   = f === "phone";
                const v = r.value || "";
                let valid = true;
                let hint = "";
                if (!noValueOp && v) {
                  if (isNumeric) { valid = /^-?\d+(\.\d+)?$/.test(v); hint = "Numeric value required"; }
                  else if (isEmail) { valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); hint = "Valid email required"; }
                  else if (isPhone) { valid = /^\+?91[\s-]?\d{10}$/.test(v.replace(/\s/g,"")); hint = "Format: +91 9876543210"; }
                }
                return (<>
                  <Input
                    value={v}
                    onChange={(e)=>{
                      let next = e.target.value;
                      if (isNumeric) next = next.replace(/[^\d.\-]/g, "");
                      updateRule(i, { value: next });
                    }}
                    inputMode={isNumeric || isPhone ? "numeric" : "text"}
                    placeholder={noValueOp ? "—" : isEmail ? "name@domain.com" : isPhone ? "+91 9876543210" : "Value"}
                    style={{ flex:1, fontSize:11, fontFamily: (isNumeric||isPhone) ? "'DM Mono'" : undefined, borderColor: valid ? C.inputBorder : C.red }}
                    disabled={noValueOp}
                  />
                  {!valid && <span style={{ fontSize:9, color:C.red, fontWeight:600, alignSelf:"center" }}>!</span>}
                </>);
              })()}
            </div>
          </div>
        );
      })}

      <div style={{ display:"flex", gap:6, marginTop:4 }}>
        <Btn kind="ghost" size="sm" icon={IC.plus(12)} onClick={addRule}>Add condition</Btn>
        <Btn kind="ghost" size="sm" icon={IC.plus(12)} onClick={addRule}>Add group</Btn>
      </div>

      <Sec style={{ marginTop:18, marginBottom:8 }}>Test with sample contact</Sec>
      <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:11 }}>
        <Select style={{ marginBottom:8, fontSize:11, fontFamily:"'DM Mono'" }}>
          <option>— Select a sample contact —</option>
        </Select>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:rules.length?10:0 }}>
          <Btn kind="dark" size="sm" icon={IC.play(11)}>Run test</Btn>
          {rules.length > 0 && <Badge label="Matched" bg={C.brandBg} color={C.brandDark} dot style={{ padding:"4px 9px" }}/>}
        </div>
        {rules.length > 0 && (
          <div style={{ background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:8, padding:"8px 10px" }}>
            {rules.map((r, i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:7, padding:"4px 0", fontSize:10.5, color:C.text3, borderBottom:i===rules.length-1?"none":`1px solid ${C.rowDiv}` }}>
                <span style={{ color:C.brand, flexShrink:0 }}>{IC.ok(11)}</span>
                <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  <strong style={{ color:C.text2 }}>{r.field}</strong> {r.op}{r.value?" "+r.value:""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sec style={{ marginTop:18, marginBottom:8 }}>Branch connections</Sec>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <div style={{
          background: matchedSteps.length ? C.brandBg : "#fff",
          border:`1px solid ${matchedSteps.length ? C.brandBright : C.cardBorder}`,
          borderRadius:10, padding:10,
          opacity: matchedSteps.length ? 1 : 0.85,
        }}>
          <div style={{ fontSize:9, color:C.brandDark, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", marginBottom:3 }}>Matched</div>
          <div style={{ fontSize:11, color: matchedSteps.length ? C.brandDark : C.text5, fontWeight:600, lineHeight:1.4 }}>
            {branchSummary(matchedSteps)}
          </div>
          <div style={{ fontSize:9, color: matchedSteps.length ? C.brandDark : C.muted, opacity: matchedSteps.length ? 0.75 : 1, fontFamily:"'DM Mono'", marginTop:4 }}>
            {matchedSteps.length} step{matchedSteps.length===1?"":"s"} connected
          </div>
        </div>
        <div style={{
          background: notMatchedSteps.length ? "#FFF3E0" : "#fff",
          border: `1px solid ${notMatchedSteps.length ? "#FFCC80" : C.cardBorder}`,
          borderRadius:10, padding:10,
          opacity: notMatchedSteps.length ? 1 : 0.85,
        }}>
          <div style={{ fontSize:9, color:"#B04E0E", fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", marginBottom:3 }}>Not matched</div>
          <div style={{ fontSize:11, color: notMatchedSteps.length ? "#B04E0E" : C.text5, fontWeight:600, lineHeight:1.4 }}>
            {branchSummary(notMatchedSteps)}
          </div>
          <div style={{ fontSize:9, color: notMatchedSteps.length ? "#B04E0E" : C.muted, opacity: notMatchedSteps.length ? 0.75 : 1, fontFamily:"'DM Mono'", marginTop:4 }}>
            {notMatchedSteps.length} step{notMatchedSteps.length===1?"":"s"} connected
          </div>
        </div>
      </div>

      <Alert kind="info">
        Some operators only apply to certain field types. Date operators (<em>is within last</em>, <em>is before</em>) need a date/time field. Tag operators (<em>has tag</em>) need a Tags source.
      </Alert>

      <div style={{ display:"flex", gap:6, marginTop:14 }}>
        <Btn kind="primary" style={{ flex:1, justifyContent:"center" }} onClick={onSaveAndClose}>Save</Btn>
        <Btn kind="ghost" icon={IC.copy(13)} onClick={()=>onDuplicateNode(node.id)}>Duplicate</Btn>
        <Btn kind="danger" icon={IC.trash(13)} onClick={()=>onDeleteNode(node.id)}>Delete</Btn>
      </div>
    </>);
  }

  else if (node.type === "delay") {
    const delayMode = node.delayMode || "duration";
    const waitValue = node.waitValue !== undefined ? node.waitValue : "10";
    const waitUnit  = node.waitUnit  || "minutes";
    const useContactTz = !!node.useContactTz;
    const setNumeric = (v) => onUpdateNode(node.id, { waitValue: String(v).replace(/\D/g, "") });
    content = (<>
      <Field label="Delay type">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:5 }}>
          <Pill active={delayMode==="duration"} onClick={()=>onUpdateNode(node.id, { delayMode:"duration" })}>For a duration</Pill>
          <Pill active={delayMode==="date"}     onClick={()=>onUpdateNode(node.id, { delayMode:"date"     })}>Until specific date</Pill>
          <Pill active={delayMode==="field"}    onClick={()=>onUpdateNode(node.id, { delayMode:"field"    })}>Date from a field</Pill>
          <Pill active={delayMode==="until"}    onClick={()=>onUpdateNode(node.id, { delayMode:"until"    })}>Until a specific time</Pill>
        </div>
      </Field>

      {delayMode === "duration" && (
        <Field label="Wait duration" hint="How long to pause before continuing.">
          <div style={{ display:"flex", gap:6 }}>
            <Input
              inputMode="numeric"
              value={waitValue}
              onChange={(e)=>setNumeric(e.target.value)}
              placeholder="0"
              style={{ width:80, fontFamily:"'DM Mono'", fontWeight:600 }}
            />
            <Select style={{ flex:1 }} value={waitUnit} onChange={(e)=>onUpdateNode(node.id, { waitUnit: e.target.value })}>
              <option value="seconds">Seconds</option>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </Select>
          </div>
          {(!waitValue || waitValue === "0") && <div style={{ fontSize:10, color:C.red, marginTop:5, fontWeight:600 }}>Duration must be a positive number</div>}
        </Field>
      )}

      {delayMode === "date" && (
        <Field label="Wait until date & time">
          <Input type="datetime-local" defaultValue="2026-02-14T09:00"/>
        </Field>
      )}

      {delayMode === "field" && (
        <Field label="Use date from custom field">
          <Select>
            <option value="">— Select a field —</option>
            {fieldNames.map(f => <option key={f} value={f}>{f}</option>)}
          </Select>
        </Field>
      )}

      {delayMode === "until" && (
        <Field label="Wait until time-of-day">
          <Input type="time" defaultValue="09:00"/>
        </Field>
      )}

      <Field label="Use contact's timezone" hint="Detect timezone from the contact's country code. Off = use workspace timezone.">
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, color:C.text3 }}>Detect from phone number country code</span>
          <Toggle value={useContactTz} onChange={(v)=>onUpdateNode(node.id, { useContactTz: v })}/>
        </div>
      </Field>

      <Alert kind="warn">Delays beyond <strong>24 hours</strong> may require an approved WhatsApp template to re-engage the contact.</Alert>

      <div style={{ display:"flex", gap:6, marginTop:14 }}>
        <Btn kind="primary" style={{ flex:1, justifyContent:"center" }} onClick={onSaveAndClose}>Save</Btn>
        <Btn kind="ghost" icon={IC.copy(13)} onClick={()=>onDuplicateNode(node.id)}>Duplicate</Btn>
        <Btn kind="danger" icon={IC.trash(13)} onClick={()=>onDeleteNode(node.id)}>Delete</Btn>
      </div>
    </>);
  }
  else if (node.type === "api") {
    content = (<>
      <Field label="Method & URL">
        <div style={{ display:"flex", gap:6 }}>
          <Select style={{ width:84, fontFamily:"'DM Mono'", fontWeight:700, color:C.brand }}><option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option></Select>
          <Input style={{ flex:1, fontFamily:"'DM Mono'", fontSize:11 }} defaultValue="https://api.example.com/leads"/>
        </div>
      </Field>
      <Field label="Headers">
        <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:8, padding:8 }}>
          {[{k:"Authorization",v:"Bearer ********"},{k:"Content-Type",v:"application/json"}].map((h,i)=>(
            <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1.6fr 24px", gap:5, marginBottom:4 }}>
              <Input defaultValue={h.k} style={{ padding:"5px 8px", fontSize:10, fontFamily:"'DM Mono'" }}/>
              <Input defaultValue={h.v} style={{ padding:"5px 8px", fontSize:10, fontFamily:"'DM Mono'" }}/>
              <IconBtn>{IC.x(12)}</IconBtn>
            </div>
          ))}
          <button style={{ background:"none", border:"none", color:C.text4, fontSize:11, fontWeight:600, cursor:"pointer", padding:"3px 4px" }}>+ Add header</button>
        </div>
      </Field>
      <Field label="Body · JSON">
        <pre style={{ background:"#0E1F1A", color:"#7FE5BB", borderRadius:8, padding:12, fontSize:10.5, lineHeight:1.55, fontFamily:"'DM Mono'", overflowX:"auto", margin:0 }}>{`{\n  "name":       "{{first_name}}",\n  "phone":      "{{phone}}",\n  "city":       "{{city}}",\n  "bhk_type":   "{{bhk_type}}",\n  "lead_score": "{{lead_score}}",\n  "source":     "whatsapp_flow"\n}`}</pre>
      </Field>
      <Field label="Save response to field" hint="Extract a value from the API response (JSONPath) and save it on the contact.">
        <div style={{ display:"flex", gap:6 }}>
          <Input style={{ flex:1, fontFamily:"'DM Mono'", fontSize:11 }} defaultValue="$.id"/>
          <span style={{ alignSelf:"center", fontSize:12, color:C.text5 }}>→</span>
          <Select style={{ flex:1 }}>
            <option value="">— Select a field —</option>
            {fieldNames.map(f => <option key={f} value={f}>{f}</option>)}
            <option value="__new__">+ New field</option>
          </Select>
        </div>
      </Field>
      <Field label="On error">
        <div style={{ display:"flex", gap:6 }}><Pill active>Continue</Pill><Pill>Retry 3x</Pill><Pill>Exit flow</Pill></div>
      </Field>
      <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:10, marginTop:4 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <Sec>Last test</Sec>
          <span style={{ fontSize:10, color:C.brand, fontFamily:"'DM Mono'", fontWeight:700 }}>200 OK · 421ms</span>
        </div>
        <pre style={{ fontSize:10, color:C.text4, fontFamily:"'DM Mono'", margin:0 }}>{`{"id":"42851392","createdAt":"2026-05-14..."}`}</pre>
      </div>
      <div style={{ display:"flex", gap:6, marginTop:12 }}>
        <Btn kind="ghost" size="sm">Test request</Btn>
        <Btn kind="ghost" size="sm">View logs</Btn>
      </div>
    </>);
  }
  else if (node.type === "handoff") {
    const assignMode = node.assignMode || "specific";
    const priority   = node.priority   || "high";
    const slaValue   = node.slaValue   !== undefined ? node.slaValue : 15;
    const slaUnit    = node.slaUnit    || "minutes";
    const internalNote = node.internalNote !== undefined ? node.internalNote : "";
    const assigned   = node.assigned   || [];
    const notify     = node.notify     || { wa:true, email:true, task:false };

    const toggleAssigned = (id) => onUpdateNode(node.id, n => {
      const cur = n.assigned || [];
      return { ...n, assigned: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] };
    });
    const setNotify = (key, val) => onUpdateNode(node.id, n => ({ ...n, notify: { ...(n.notify || {}), [key]: val } }));

    const eligible = teamMembers.filter(m => assigned.includes(m.id));
    const previewNames = eligible.map(m => m.name).join(", ") || "Nobody selected";

    content = (<>
      <div style={{ background:C.pinkBg, border:`1px solid #E2A8C0`, borderRadius:10, padding:"11px 13px", marginBottom:14, display:"flex", alignItems:"flex-start", gap:9 }}>
        <span style={{ color:C.pink, flexShrink:0, paddingTop:1 }}>{IC.agent(15)}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.pink, marginBottom:3 }}>What this block does</div>
          <div style={{ fontSize:11, color:C.text2, lineHeight:1.5 }}>
            Pauses the automation and hands the conversation to a live <strong>team member</strong>. The bot stops responding, the contact appears in your team inbox with full chat history, and the chosen member is notified to take over.
          </div>
        </div>
      </div>

      <Field label="Assignment mode" hint="Pick one specific person, or rotate through several.">
        <div style={{ display:"flex", gap:6 }}>
          <Pill active={assignMode==="specific"}    onClick={()=>onUpdateNode(node.id, { assignMode: "specific"    })}>Specific team member</Pill>
          <Pill active={assignMode==="round-robin"} onClick={()=>onUpdateNode(node.id, { assignMode: "round-robin" })}>Round robin</Pill>
        </div>
      </Field>

      <Sec style={{ marginBottom:8 }}>
        {assignMode==="round-robin" ? `Eligible team members (${eligible.length} selected)` : "Pick the team member"}
      </Sec>
      <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:6, marginBottom:14, maxHeight:260, overflowY:"auto" }}>
        {teamMembers.map(m => {
          const isSel = assigned.includes(m.id);
          const dot = m.avail === "online" ? "#1D9E75" : m.avail === "away" ? "#E5A100" : "#9C9B92";
          return (
            <button key={m.id}
              onClick={()=>{
                if (assignMode === "specific") {
                  onUpdateNode(node.id, { assigned: isSel ? [] : [m.id] });
                } else {
                  toggleAssigned(m.id);
                }
              }}
              className="picker-item"
              style={{
                width:"100%", padding:"8px 10px",
                background: isSel ? C.brandBg : "transparent",
                border: `1px solid ${isSel ? C.brandBright : "transparent"}`,
                borderRadius:8, cursor:"pointer", textAlign:"left",
                display:"flex", alignItems:"center", gap:10, marginBottom:2,
                fontFamily:"'DM Sans'",
              }}>
              <div style={{ position:"relative", width:28, height:28, flexShrink:0 }}>
                <div style={{ width:28, height:28, borderRadius:"50%", background:"#fff", border:`1px solid ${C.cardBorder}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:C.text2, fontFamily:"'DM Sans'" }}>
                  {m.name.split(" ").map(p=>p[0]).join("").slice(0,2)}
                </div>
                <span style={{ position:"absolute", bottom:-1, right:-1, width:9, height:9, borderRadius:"50%", background:dot, border:"2px solid #fff" }}/>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:C.text1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.name}</div>
                <div style={{ fontSize:10, color:C.text5, marginTop:1 }}>{m.role} · {m.city}</div>
              </div>
              <span style={{
                width:18, height:18, borderRadius:assignMode==="round-robin" ? 5 : "50%",
                border:`1.5px solid ${isSel ? C.brand : C.cardBorder}`,
                background: isSel ? C.brand : "#fff",
                color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:10, fontWeight:700, flexShrink:0,
              }}>{isSel ? <>{IC.ok(10)}</> : ""}</span>
            </button>
          );
        })}
      </div>

      {eligible.length > 0 && (
        <div style={{ background:C.brandBg, border:`1px solid ${C.brandBright}`, borderRadius:10, padding:"9px 12px", marginBottom:14 }}>
          <div style={{ fontSize:10, color:C.brandDark, fontWeight:700, letterSpacing:".06em", textTransform:"uppercase", marginBottom:3 }}>Will assign to</div>
          <div style={{ fontSize:11, color:C.brandDark, fontWeight:600, lineHeight:1.4 }}>{previewNames}</div>
        </div>
      )}
      {eligible.length === 0 && (
        <Alert kind="warn" style={{ marginBottom:14 }}>
          No team member selected. The conversation will fall through to the next step or the team inbox queue.
        </Alert>
      )}

      <Field label="Priority">
        <div style={{ display:"flex", gap:6 }}>
          {["low","normal","high","urgent"].map(p => (
            <Pill key={p} active={priority===p} onClick={()=>onUpdateNode(node.id, { priority: p })}>{p[0].toUpperCase()+p.slice(1)}</Pill>
          ))}
        </div>
      </Field>

      <Field label="SLA timer (auto-escalate)" hint="If no team member picks it up in this time, escalate to the next member or back to the bot.">
        <div style={{ display:"flex", gap:6 }}>
          <Input
            inputMode="numeric"
            style={{ width:80, fontFamily:"'DM Mono'", fontWeight:600,
                     borderColor: (!slaValue || String(slaValue)==="0") ? C.red : C.inputBorder }}
            value={slaValue}
            onChange={(e)=>onUpdateNode(node.id, { slaValue: e.target.value.replace(/\D/g, "") })}
            placeholder="0"
          />
          <Select style={{ flex:1 }} value={slaUnit} onChange={(e)=>onUpdateNode(node.id, { slaUnit: e.target.value })}>
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
          </Select>
        </div>
        {(!slaValue || String(slaValue)==="0") && <div style={{ fontSize:10, color:C.red, marginTop:5, fontWeight:600 }}>SLA timer must be a positive number</div>}
      </Field>

      <Field label="Internal note for the team member">
        <Textarea rows={3} value={internalNote} onChange={(e)=>onUpdateNode(node.id, { internalNote: e.target.value })}/>
      </Field>

      <Field label="Notify them by">
        {[
          { key:"wa",    l:"WhatsApp internal note", disabled:false },
          { key:"email", l:"Email to team member",   disabled:false },
          { key:"task",  l:"Create Task",            disabled:true  },
        ].map(x => (
          <div key={x.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.rowDiv}`, opacity: x.disabled ? 0.55 : 1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <span style={{ fontSize:12, color:C.text3, fontWeight:500 }}>{x.l}</span>
              {x.disabled && (
                <span style={{ fontSize:8.5, fontWeight:700, padding:"2px 6px", borderRadius:99, background:"#FFF3E0", color:"#B04E0E", letterSpacing:".08em", textTransform:"uppercase", border:"1px solid #FFCC80" }}>Coming soon</span>
              )}
            </div>
            {x.disabled
              ? <div style={{ width:32, height:18, borderRadius:99, background:"#E3E1D8", position:"relative", flexShrink:0, cursor:"not-allowed" }}>
                  <div style={{ width:14, height:14, borderRadius:"50%", background:"#fff", position:"absolute", top:2, left:2, boxShadow:"0 1px 3px rgba(0,0,0,.2)" }}/>
                </div>
              : <Toggle value={!!notify[x.key]} onChange={(v)=>setNotify(x.key, v)} size="sm"/>}
          </div>
        ))}
      </Field>

      <Alert kind="info">After the team member resolves the chat, the flow either ends or continues from this node depending on the conversation status set by the agent.</Alert>

      <div style={{ display:"flex", gap:6, marginTop:14 }}>
        <Btn kind="primary" style={{ flex:1, justifyContent:"center" }} onClick={onSaveAndClose}>Save</Btn>
        <Btn kind="ghost" icon={IC.copy(13)} onClick={()=>onDuplicateNode(node.id)}>Duplicate</Btn>
        <Btn kind="danger" icon={IC.trash(13)} onClick={()=>onDeleteNode(node.id)}>Delete</Btn>
      </div>
    </>);
  }

  else if (node.type==="trigger") {
    const tk = node.triggerKind || "keyword";
    const TRIGGER_EXPLAIN = {
      keyword: {
        icon: IC.zap, color: C.brand, bg: C.brandBg, border: C.brandBright,
        source: "wa", sourceLabel: "WhatsApp inbound message webhook",
        title: "Keyword trigger",
        body: "Starts this automation when a contact sends a specific word or phrase via WhatsApp. Great for entry points like PRICE, BOOK, HELP, or INFO that you'd print on flyers, ads, or product packaging."
      },
      link: {
        icon: IC.link, color: C.blue, bg: C.blueBg, border: "#90CAF9",
        source: "wa", sourceLabel: "WhatsApp inbound message webhook",
        title: "WhatsApp click-to-chat link",
        body: "Starts when a contact opens a wa.me link from your website, Meta ads, Instagram bio, or email signature. If the link is inside a Click-to-WhatsApp Meta ad, Meta opens a 72-hour free conversation window instead of the usual 24h."
      },
      qr: {
        icon: IC.qr, color: "#6A3FAF", bg: "#E8E0F8", border: "#B5A4DD",
        source: "wa", sourceLabel: "WhatsApp inbound message webhook",
        title: "QR code scan",
        body: "Technically identical to a click-to-chat link — the QR encodes a wa.me URL with a pre-filled message that identifies the scan source. WhatsApp doesn't know it came from a QR; ForgeChat attributes it via the pre-filled text."
      },
      newContact: {
        icon: IC.user, color: C.purpleDark, bg: C.purpleBg, border: "#C7C2F4",
        source: "wa", sourceLabel: "WhatsApp inbound message webhook (first-time contact)",
        title: "New contact created",
        body: "Fires the first time an unknown WhatsApp number messages your business number. Use this for welcome flows, opt-in capture, GDPR/DPDP consent, or any first-time greeting."
      },
      anyMessage: {
        icon: IC.msg, color: C.blue, bg: C.blueBg, border: "#90CAF9",
        source: "wa", sourceLabel: "WhatsApp inbound message webhook",
        title: "Any inbound message",
        body: "Fires on every inbound WhatsApp message from any contact — a catch-all entry point. Use sparingly; combine with filters so it doesn't override more specific triggers like Keyword or Tag Applied."
      },
      tagApplied: {
        icon: IC.tag, color: "#5B5851", bg: "#F1F0EB", border: "#D9D6CE",
        source: "bsp", sourceLabel: "Workspace event · not a WhatsApp API event",
        title: "Tag applied to contact",
        body: "Fires the moment a specific tag is added to a contact — by another flow, manual tagging in the inbox, or an import. This is a workspace-level event, not something WhatsApp itself emits."
      },
      webhook: {
        icon: IC.api, color: C.navy, bg: C.navyBg, border: "#9FAFD0",
        source: "bsp", sourceLabel: "External HTTP webhook · not a WhatsApp API event",
        title: "Incoming webhook",
        body: "Starts when an external service sends an HTTP POST to this flow's unique webhook URL. Each field in the request body becomes a variable downstream. Connect Razorpay, Stripe, Google Forms, Make.com, Zapier — anything that can fire a webhook."
      },
      apiEvent: {
        icon: IC.api, color: "#4A2D7A", bg: "#E8E0F8", border: "#B5A4DD",
        source: "bsp", sourceLabel: "Integrated app event · not a WhatsApp API event",
        title: "Integrated app event",
        body: "Starts on a typed event from an integrated app — Razorpay payment success, Calendly booking confirmed, Google Form submission, etc. Filter to just the events you care about."
      },
    };
    const ex = TRIGGER_EXPLAIN[tk] || TRIGGER_EXPLAIN.keyword;

    let kindFields = null;

    if (tk === "keyword") {
      const keyword     = node.keyword     !== undefined ? node.keyword     : "";
      const matchType   = node.matchType   || "exact";
      const caseSens    = !!node.caseSensitive;
      const keywordOk   = !!(keyword && keyword.trim());
      const updateKeyword = (val) => {
        const mt = node.matchType || 'exact';
        const mtLabel = mt === 'contains' ? 'contains' : mt === 'starts' ? 'starts with' : 'exact';
        onUpdateNode(node.id, {
          keyword: val,
          title: val.trim() ? `Trigger: ${val.trim()} keyword` : 'Trigger: Keyword',
          sub: val.trim() ? `When contact sends "${val.trim()}" · ${mtLabel} match` : 'When a contact sends a specific keyword',
        });
      };
      const updateMatchType = (mt) => {
        const kw = node.keyword || '';
        const mtLabel = mt === 'contains' ? 'contains' : mt === 'starts' ? 'starts with' : 'exact';
        onUpdateNode(node.id, {
          matchType: mt,
          title: kw.trim() ? `Trigger: ${kw.trim()} keyword` : 'Trigger: Keyword',
          sub: kw.trim() ? `When contact sends "${kw.trim()}" · ${mtLabel} match` : 'When a contact sends a specific keyword',
        });
      };
      kindFields = (<>
        <Field label="Keyword" hint="The word or phrase the contact must send to start this flow.">
          <Input
            value={keyword}
            onChange={(e)=>updateKeyword(e.target.value.slice(0, 64))}
            placeholder="e.g. PRICE, BOOK, INFO"
            style={{ borderColor: keywordOk ? C.inputBorder : C.red, fontFamily:"'DM Mono'", fontWeight:600 }}
          />
          {!keywordOk && <div style={{ fontSize:10, color:C.red, marginTop:5, fontWeight:600 }}>Keyword is required</div>}
        </Field>
        <Field label="Match type">
          <div style={{ display:"flex", gap:6 }}>
            <Pill active={matchType==="exact"}    onClick={()=>updateMatchType("exact")}>Exact match</Pill>
            <Pill active={matchType==="contains"} onClick={()=>updateMatchType("contains")}>Contains</Pill>
            <Pill active={matchType==="starts"}   onClick={()=>updateMatchType("starts")}>Starts with</Pill>
          </div>
        </Field>
        <Field label="Case sensitive">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:12, color:C.text3 }}>{caseSens ? "On · only matches exact case" : "Off · matches PRICE, price, Price"}</span>
            <Toggle value={caseSens} onChange={(v)=>onUpdateNode(node.id, { caseSensitive: v })}/>
          </div>
        </Field>
        <Field label="Example preview">
          <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:11 }}>
            <div style={{ fontSize:10, color:C.muted, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", marginBottom:6 }}>When user sends</div>
            <div style={{ background:"#DCF8C6", borderRadius:"8px 0 8px 8px", padding:"5px 9px", fontSize:11, color:C.text1, alignSelf:"flex-end", marginBottom:6, display:"inline-block", fontFamily:"'DM Mono'", fontWeight:600 }}>{(keyword || "").trim() || "price"}</div>
            <div style={{ fontSize:10, color:C.muted, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", marginBottom:6 }}>Bot starts</div>
            <div style={{ fontSize:11, color:C.brandDark, fontWeight:600 }}>→ This flow runs</div>
          </div>
        </Field>
      </>);
    }

    else if (tk === "link") {
      const phone        = node.businessPhone  || "919876543210";
      const trackingCode = node.trackingCode   || "WEB_HOMEPAGE_HERO";
      const linkSource   = node.linkSource     || "Website";
      const prefilledMsg = node.prefilledMsg   || "Hi, I'd like to know more";
      const codeOk = !!(trackingCode && trackingCode.trim());
      const generatedUrl = `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(prefilledMsg + " · " + trackingCode)}`;
      kindFields = (<>
        <Field label="Business WhatsApp number" hint="The number visitors will start chatting with. No leading + needed.">
          <Input
            value={phone}
            onChange={(e)=>onUpdateNode(node.id, { businessPhone: e.target.value.replace(/[^\d]/g, "").slice(0, 15) })}
            placeholder="919876543210"
            style={{ fontFamily:"'DM Mono'", fontWeight:600 }}
            inputMode="numeric"
          />
        </Field>
        <Field label="Tracking code" hint="Appended to the wa.me link's prefilled text. Used to attribute the lead back to a campaign.">
          <Input
            value={trackingCode}
            onChange={(e)=>onUpdateNode(node.id, { trackingCode: e.target.value.toUpperCase().replace(/[^\w_]/g, "").slice(0, 40) })}
            placeholder="WEB_HOMEPAGE_HERO"
            style={{ borderColor: codeOk ? C.inputBorder : C.red, fontFamily:"'DM Mono'", fontWeight:600 }}
          />
          {!codeOk && <div style={{ fontSize:10, color:C.red, marginTop:5, fontWeight:600 }}>Tracking code is required to attribute leads</div>}
        </Field>
        <Field label="Campaign source">
          <Select value={linkSource} onChange={(e)=>onUpdateNode(node.id, { linkSource: e.target.value })}>
            <option>Website</option>
            <option>Meta Ads</option>
            <option>Google Ads</option>
            <option>Instagram Bio</option>
            <option>Email Signature</option>
            <option>Newsletter</option>
            <option>Other</option>
          </Select>
        </Field>
        <Field label="Pre-filled message" hint="What auto-appears in the contact's WhatsApp message box.">
          <Input value={prefilledMsg} onChange={(e)=>onUpdateNode(node.id, { prefilledMsg: e.target.value })}/>
        </Field>
        <Field label="Generated wa.me URL">
          <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:"9px 11px", fontSize:10, color:C.text3, fontFamily:"'DM Mono'", wordBreak:"break-all", lineHeight:1.5 }}>
            {generatedUrl}
          </div>
          <div style={{ fontSize:10, color:C.muted, marginTop:5, fontWeight:500 }}>Copy this URL into your website CTA, ads, or email signature.</div>
        </Field>
      </>);
    }

    else if (tk === "qr") {
      const qrLabel    = node.qrLabel    || "FLYER_DIWALI_2025";
      const qrLocation = node.qrLocation || "Anna Nagar billboard";
      const phone      = node.businessPhone || "919876543210";
      const prefilledMsg = node.prefilledMsg || `Scanned from ${qrLocation}`;
      const labelOk = !!(qrLabel && qrLabel.trim());
      kindFields = (<>
        <Field label="QR code label" hint="A unique name for this QR. The flow will know exactly which printed asset triggered the scan.">
          <Input
            value={qrLabel}
            onChange={(e)=>onUpdateNode(node.id, { qrLabel: e.target.value.toUpperCase().replace(/[^\w_]/g, "").slice(0, 40) })}
            placeholder="FLYER_DIWALI_2025"
            style={{ borderColor: labelOk ? C.inputBorder : C.red, fontFamily:"'DM Mono'", fontWeight:600 }}
          />
          {!labelOk && <div style={{ fontSize:10, color:C.red, marginTop:5, fontWeight:600 }}>Label is required</div>}
        </Field>
        <Field label="Where this QR is printed" hint="For internal tracking only.">
          <Input
            value={qrLocation}
            onChange={(e)=>onUpdateNode(node.id, { qrLocation: e.target.value })}
            placeholder="e.g. Anna Nagar billboard, brochure"
          />
        </Field>
        <Field label="Business number">
          <Input
            value={phone}
            onChange={(e)=>onUpdateNode(node.id, { businessPhone: e.target.value.replace(/[^\d]/g, "").slice(0, 15) })}
            placeholder="919876543210"
            style={{ fontFamily:"'DM Mono'", fontWeight:600 }}
            inputMode="numeric"
          />
        </Field>
        <Field label="Pre-filled message">
          <Input value={prefilledMsg} onChange={(e)=>onUpdateNode(node.id, { prefilledMsg: e.target.value })}/>
        </Field>
        <Field label="QR code preview">
          <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:14, textAlign:"center" }}>
            <div style={{ width:104, height:104, margin:"0 auto 8px", background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:6, padding:6, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ width:"100%", height:"100%", backgroundImage:`radial-gradient(circle at 18% 18%, #111 0, #111 8%, transparent 8%), radial-gradient(circle at 82% 18%, #111 0, #111 8%, transparent 8%), radial-gradient(circle at 18% 82%, #111 0, #111 8%, transparent 8%), linear-gradient(45deg, transparent 0 45%, #111 45% 55%, transparent 55%), linear-gradient(135deg, transparent 0 30%, #111 30% 40%, transparent 40% 60%, #111 60% 70%, transparent 70%)`, backgroundSize:"100% 100%", borderRadius:4 }}/>
            </div>
            <div style={{ fontSize:9, fontFamily:"'DM Mono'", fontWeight:700, color:C.text3 }}>{qrLabel}</div>
            <Btn kind="ghost" size="sm" icon={IC.copy(11)} style={{ marginTop:8 }}>Download SVG</Btn>
          </div>
        </Field>
      </>);
    }

    else if (tk === "newContact") {
      const onlyFirstEver = node.onlyFirstEver !== undefined ? node.onlyFirstEver : true;
      const optIn = !!node.requireOptIn;
      kindFields = (<>
        <Field label="Trigger condition">
          <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:"10px 12px", fontSize:11, color:C.text3, lineHeight:1.5 }}>
            <strong style={{ color:C.text2 }}>Fires when:</strong> An unknown WhatsApp number messages this business number for the very first time.
          </div>
        </Field>
        <Field label="Only first-ever message">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:12, color:C.text3 }}>{onlyFirstEver ? "On · ignore returning contacts" : "Off · also fire on returning contacts that left the previous flow"}</span>
            <Toggle value={onlyFirstEver} onChange={(v)=>onUpdateNode(node.id, { onlyFirstEver: v })}/>
          </div>
        </Field>
        <Field label="Require DPDP / GDPR opt-in">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:12, color:C.text3 }}>{optIn ? "On · ask consent before continuing" : "Off · proceed without explicit opt-in"}</span>
            <Toggle value={optIn} onChange={(v)=>onUpdateNode(node.id, { requireOptIn: v })}/>
          </div>
        </Field>
        <Alert kind="info">Combine this trigger with a Welcome Message and an AI step that captures the contact's name, city, and intent in one flow.</Alert>
      </>);
    }

    else if (tk === "anyMessage") {
      const skipIfInFlow = node.skipIfInFlow !== undefined ? node.skipIfInFlow : true;
      const requireTag = node.requireTag || "";
      kindFields = (<>
        <Field label="Skip if contact is already in another flow">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:12, color:C.text3 }}>{skipIfInFlow ? "On · recommended" : "Off · run alongside other flows"}</span>
            <Toggle value={skipIfInFlow} onChange={(v)=>onUpdateNode(node.id, { skipIfInFlow: v })}/>
          </div>
        </Field>
        <Field label="Only run for contacts with tag" hint="Leave empty to run for all contacts.">
          <Select value={requireTag} onChange={(e)=>onUpdateNode(node.id, { requireTag: e.target.value })}>
            <option value="">— Any contact —</option>
            {tagNames.map(tg => <option key={tg} value={tg}>{tg}</option>)}
          </Select>
        </Field>
        <Alert kind="warn">This is a catch-all trigger — keep it as a low-priority fallback. More specific triggers (Keyword, Tag Applied) should take precedence.</Alert>
      </>);
    }

    else if (tk === "tagApplied") {
      const tag = node.tag || "";
      const fireOnce = node.fireOncePerTag !== undefined ? node.fireOncePerTag : true;
      const direction = node.tagDirection || "added";
      const tagOk = !!tag;
      kindFields = (<>
        <Field label="Tag to watch" hint="Which tag to listen for.">
          <Select value={tag} onChange={(e)=>onUpdateNode(node.id, { tag: e.target.value })}
            style={{ borderColor: tagOk ? C.inputBorder : C.red }}>
            <option value="">— Select a tag —</option>
            {tagNames.map(tg => <option key={tg} value={tg}>{tg}</option>)}
          </Select>
          {!tagOk && <div style={{ fontSize:10, color:C.red, marginTop:5, fontWeight:600 }}>Pick a tag — this trigger needs to know which one to watch</div>}
        </Field>
        <Field label="Trigger when tag is">
          <div style={{ display:"flex", gap:6 }}>
            <Pill active={direction==="added"}   onClick={()=>onUpdateNode(node.id, { tagDirection:"added" })}>Added</Pill>
            <Pill active={direction==="removed"} onClick={()=>onUpdateNode(node.id, { tagDirection:"removed" })}>Removed</Pill>
          </div>
        </Field>
        <Field label="Fire only the first time" hint="If on, the trigger fires only the first time this tag is added to each contact.">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:12, color:C.text3 }}>{fireOnce ? "On · once per contact" : "Off · fire on every tag application"}</span>
            <Toggle value={fireOnce} onChange={(v)=>onUpdateNode(node.id, { fireOncePerTag: v })}/>
          </div>
        </Field>
      </>);
    }

    else if (tk === "webhook") {
      const flowId = node.id || "flow_unknown";
      const webhookUrl = `https://hooks.whatsflow.ai/${flowId}`;
      const secret = node.webhookSecret || "whsec_8f3a92...x42p";
      const samplePayload = node.samplePayload || `{\n  "contact_phone": "+919876543210",\n  "contact_name":  "Anjali Iyer",\n  "event":         "lead.created",\n  "source":        "facebook_lead_ad"\n}`;
      kindFields = (<>
        <Field label="Your webhook URL" hint="Send a POST with a JSON body to this URL to fire the trigger.">
          <div style={{ display:"flex", gap:6 }}>
            <Input value={webhookUrl} readOnly style={{ fontFamily:"'DM Mono'", fontSize:10, color:C.text3, background:C.sectionBg }}/>
            <Btn kind="ghost" size="sm" icon={IC.copy(13)}>Copy</Btn>
          </div>
        </Field>
        <Field label="Signing secret" hint="Validate that the request came from a trusted source by checking the X-Whatsflow-Signature header.">
          <div style={{ display:"flex", gap:6 }}>
            <Input value={secret} readOnly style={{ fontFamily:"'DM Mono'", fontSize:10, color:C.text3, background:C.sectionBg }}/>
            <Btn kind="ghost" size="sm">Rotate</Btn>
          </div>
        </Field>
        <Field label="Expected JSON payload">
          <Textarea
            rows={6}
            value={samplePayload}
            onChange={(e)=>onUpdateNode(node.id, { samplePayload: e.target.value })}
            style={{ fontFamily:"'DM Mono'", fontSize:11 }}
          />
          <div style={{ fontSize:10, color:C.text5, marginTop:5, fontWeight:500 }}>Each top-level field becomes a variable downstream — e.g. <code style={{ background:C.sectionBg, padding:"1px 4px", borderRadius:3, fontFamily:"'DM Mono'", fontWeight:600 }}>{`{{contact_name}}`}</code></div>
        </Field>
        <Alert kind="info">Test the webhook in the simulator with a sample payload, or POST to the URL above from cURL/Postman.</Alert>
      </>);
    }

    else if (tk === "apiEvent") {
      const integration = node.integration || "razorpay";
      const eventType   = node.eventType   || "";
      const eventOk     = !!eventType;
      const EVENT_OPTIONS = {
        razorpay:    ["payment.captured","payment.failed","payment.authorized","refund.created","refund.processed","subscription.charged"],
        stripe:      ["payment_intent.succeeded","payment_intent.payment_failed","invoice.paid","customer.subscription.created","charge.refunded"],
        calendly:    ["invitee.created","invitee.canceled","invitee.rescheduled"],
        googleforms: ["response.submitted","response.updated"],
        makecom:     ["scenario.completed","scenario.failed","data.received"],
        zapier:      ["zap.triggered","zap.completed"],
      };
      kindFields = (<>
        <Field label="Source integration">
          <Select value={integration} onChange={(e)=>onUpdateNode(node.id, { integration: e.target.value, eventType: "" })}>
            <option value="razorpay">Razorpay Payments</option>
            <option value="stripe">Stripe Payments</option>
            <option value="calendly">Calendly</option>
            <option value="googleforms">Google Forms</option>
            <option value="makecom">Make.com</option>
            <option value="zapier">Zapier</option>
          </Select>
        </Field>
        <Field label="Event type">
          <Select value={eventType} onChange={(e)=>onUpdateNode(node.id, { eventType: e.target.value })}
            style={{ borderColor: eventOk ? C.inputBorder : C.red, fontFamily:"'DM Mono'", fontSize:11 }}>
            <option value="">— Select an event —</option>
            {(EVENT_OPTIONS[integration] || []).map(ev => <option key={ev} value={ev}>{ev}</option>)}
          </Select>
          {!eventOk && <div style={{ fontSize:10, color:C.red, marginTop:5, fontWeight:600 }}>Pick the event this trigger should listen for</div>}
        </Field>
        <Field label="Filter (optional)" hint="Only fire when the event matches additional criteria.">
          <Input placeholder="e.g. payment.amount > 100000" style={{ fontFamily:"'DM Mono'", fontSize:11 }}/>
        </Field>
        <Alert kind="info">{
          integration === "razorpay"   ? "Razorpay webhook configured · 1,820 events last 7d" :
          integration === "stripe"     ? "Stripe webhook configured · 280 events last 7d" :
          integration === "calendly"   ? "Calendly is connected · OAuth token valid" :
          integration === "googleforms"? "Google Forms is connected · 4 forms watched" :
          integration === "makecom"    ? "Make.com webhook configured" :
                                         "Zapier webhook configured"
        }</Alert>
      </>);
    }

    content = (<>
      <div style={{ background:ex.bg, border:`1px solid ${ex.border}`, borderRadius:10, padding:"11px 13px", marginBottom:14, display:"flex", alignItems:"flex-start", gap:9 }}>
        <span style={{ color:ex.color, flexShrink:0, paddingTop:1 }}>{ex.icon(15)}</span>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3, flexWrap:"wrap" }}>
            <div style={{ fontSize:12, fontWeight:700, color:ex.color }}>{ex.title}</div>
            <span style={{
              fontSize:8.5, fontWeight:700, padding:"2px 6px", borderRadius:99,
              letterSpacing:".08em", textTransform:"uppercase",
              background: ex.source === "wa" ? "#1F8451" : "#7A5C00",
              color:"#fff",
            }}>{ex.source === "wa" ? "WhatsApp event" : "Workspace event"}</span>
          </div>
          <div style={{ fontSize:11, color:C.text2, lineHeight:1.5, marginBottom:5 }}>{ex.body}</div>
          <div style={{ fontSize:9.5, color:C.muted, fontFamily:"'DM Mono'", fontWeight:600 }}>Source: {ex.sourceLabel}</div>
        </div>
      </div>

      <Field label="Trigger type" hint="Automations are keyword-triggered.">
        <Select value="keyword" disabled style={{ fontWeight:600 }}>
          <option value="keyword">Keyword Trigger</option>
        </Select>
      </Field>

      {/* WhatsApp account filter — only meaningful with multiple numbers. A single-account
          system always fires on the one connected number (empty triggerAccounts = any). */}
      {whatsappAccounts.length > 1 && (() => {
        const selected = Array.isArray(node.triggerAccounts) ? node.triggerAccounts : [];
        const toggle = (phone) => {
          const next = selected.includes(phone) ? selected.filter(p => p !== phone) : [...selected, phone];
          onUpdateNode(node.id, { triggerAccounts: next });
        };
        const all = whatsappAccounts || [];
        return (
          <Field
            label="Listen on WhatsApp accounts"
            hint={selected.length === 0
              ? "Empty = fire when the message arrives on ANY of your WhatsApp numbers."
              : `${selected.length} account${selected.length === 1 ? '' : 's'} selected — trigger only fires for inbound messages on these.`}
          >
            {all.length === 0 ? (
              <div style={{ background:C.sectionBg, border:`1px dashed ${C.cardBorder}`, borderRadius:8, padding:"10px 12px", fontSize:11, color:C.muted, fontStyle:"italic" }}>
                No WhatsApp accounts configured. Add one in Admin Settings → WhatsApp Accounts.
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:5, maxHeight:200, overflowY:"auto", border:`1px solid ${C.cardBorder}`, borderRadius:8, padding:6, background:"#fff" }}>
                {all.map(acc => {
                  const phone = acc.displayPhoneNumber;
                  const checked = selected.includes(phone);
                  return (
                    <label key={acc.id}
                      style={{ display:"flex", alignItems:"center", gap:9, padding:"6px 8px", borderRadius:6, cursor:"pointer", background: checked ? C.brandBg : "transparent" }}
                      onMouseEnter={(e)=>{ if (!checked) e.currentTarget.style.background = C.sectionBg; }}
                      onMouseLeave={(e)=>{ if (!checked) e.currentTarget.style.background = "transparent"; }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={()=>toggle(phone)}
                        style={{ accentColor: C.brand, cursor:"pointer" }}
                      />
                      <span style={{ fontSize:12, fontWeight:600, color: checked ? C.brandDark : C.text1, fontFamily:"'DM Sans'" }}>
                        {acc.displayName}
                      </span>
                      {acc.isDefault && (
                        <span style={{ fontSize:9, fontWeight:700, padding:"1px 5px", borderRadius:4, background:C.sectionBg, color:C.muted, letterSpacing:".04em", textTransform:"uppercase" }}>default</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </Field>
        );
      })()}

      {kindFields}

      <div style={{ display:"flex", gap:6, marginTop:14 }}>
        <Btn kind="primary" style={{ flex:1, justifyContent:"center" }} onClick={onSaveAndClose}>Save</Btn>
        <Btn kind="ghost" icon={IC.copy(13)} onClick={()=>onDuplicateNode(node.id)}>Duplicate</Btn>
        <Btn kind="danger" icon={IC.trash(13)} onClick={()=>onDeleteNode(node.id)}>Delete</Btn>
      </div>
    </>);
  }

  else if (node.type==="ai") {
    const aiTask    = node.aiTask    || "lead_qualification";
    const aiGoal    = node.aiGoal    !== undefined ? node.aiGoal    : "Qualify the lead by asking about budget, timeline, and preferred area. Politely escalate to a human if the lead is hot.";
    const aiContext = node.aiContext !== undefined ? node.aiContext : "We are Forge Realty, a Chennai-based real-estate agency. Our active inventory: 2BHK & 3BHK apartments in Anna Nagar (₹85L–₹1.2Cr), Adyar (₹1.4Cr–₹2.1Cr), and Velachery (₹70L–₹95L). Site visits Mon–Sat 11 AM – 6 PM. Token amount ₹50,000 (refundable).";
    const aiSaveTo  = node.aiSaveTo  || "ai_summary";
    const aiFallback= node.aiFallback|| "fallback_message";
    const fallbackTemplateId = node.fallbackTemplateId || "";
    const goalOk    = !!(aiGoal && aiGoal.trim());
    content = (<>
      <div style={{ background:"#FFF3E0", border:"1px solid #FFCC80", borderRadius:10, padding:"11px 13px", marginBottom:14, display:"flex", alignItems:"flex-start", gap:9 }}>
        <span style={{ color:"#B04E0E", flexShrink:0, paddingTop:1 }}>{IC.warn(15)}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#B04E0E", marginBottom:3 }}>Meta AI policy · January 2026</div>
          <div style={{ fontSize:11, color:C.text2, lineHeight:1.5 }}>
            Open-ended general-purpose AI chatbots on WhatsApp are <strong>not allowed</strong>. Every AI step must serve a concrete business task. Pick one below so this step stays compliant.
          </div>
        </div>
      </div>

      <Field label="Business task" hint="Per Meta's policy the AI must be tied to a specific business task.">
        <Select value={aiTask} onChange={(e)=>onUpdateNode(node.id, { aiTask: e.target.value })}>
          <option value="lead_qualification">Lead qualification</option>
          <option value="customer_support">Customer support</option>
          <option value="appointment_booking">Appointment booking</option>
          <option value="product_recommendation">Product recommendation</option>
          <option value="order_status">Order status lookup</option>
          <option value="payment_assistance">Payment assistance</option>
          <option value="faq_answering">FAQ answering</option>
          <option value="data_collection">Structured data collection</option>
        </Select>
      </Field>

      <Field label="Tell AI what to do" hint="Set the goal for this step. Be specific and task-bounded.">
        <Textarea
          rows={4}
          value={aiGoal}
          onChange={(e)=>onUpdateNode(node.id, { aiGoal: e.target.value })}
          placeholder="Set a goal for the conversation"
          style={{ borderColor: goalOk ? C.inputBorder : C.red }}
        />
        {!goalOk && <div style={{ fontSize:10, color:C.red, marginTop:5, fontWeight:600 }}>Goal is required — tell the AI what it should do at this step</div>}
      </Field>

      <Field label="Give AI context" hint="Share all the info AI needs (catalog, hours, pricing, FAQs).">
        <Textarea
          rows={6}
          value={aiContext}
          onChange={(e)=>onUpdateNode(node.id, { aiContext: e.target.value })}
          placeholder="Share all the info"
        />
      </Field>

      <Alert kind="warn" style={{ marginTop:4 }}>
        <strong>24-hour service window required.</strong> AI generates free-form text, which WhatsApp only allows inside the customer service window. Outside it, the flow falls back to the approved template you pick below.
      </Alert>

      <Field label="Save AI output to field" style={{ marginTop:14 }}>
        <Select value={aiSaveTo} onChange={(e)=>onUpdateNode(node.id, { aiSaveTo: e.target.value })}>
          {fieldNames.map(f => <option key={f} value={f}>{f}</option>)}
          <option value="__new__">+ New custom field</option>
        </Select>
      </Field>

      <Field label="Fallback if outside 24h window or AI fails">
        <Select value={aiFallback} onChange={(e)=>onUpdateNode(node.id, { aiFallback: e.target.value })}>
          <option value="fallback_message">Send an approved template</option>
          <option value="handoff">Hand off to team member</option>
          <option value="exit">Exit flow</option>
        </Select>
      </Field>

      {aiFallback === "fallback_message" && (
        <Field label="Fallback template" hint="Required since AI free-form is window-restricted.">
          <Select value={fallbackTemplateId} onChange={(e)=>onUpdateNode(node.id, { fallbackTemplateId: e.target.value })}
            style={{ borderColor: fallbackTemplateId ? C.inputBorder : C.red }}>
            <option value="">— Pick a template —</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name} · {t.category}</option>
            ))}
          </Select>
          {!fallbackTemplateId && <div style={{ fontSize:10, color:C.red, marginTop:5, fontWeight:600 }}>Pick a fallback template — required for outside-window scenarios</div>}
        </Field>
      )}

      <div style={{ display:"flex", gap:6, marginTop:14 }}>
        <Btn kind="primary" style={{ flex:1, justifyContent:"center" }} onClick={onSaveAndClose}>Save</Btn>
        <Btn kind="ghost" icon={IC.copy(13)} onClick={()=>onDuplicateNode(node.id)}>Duplicate</Btn>
        <Btn kind="danger" icon={IC.trash(13)} onClick={()=>onDeleteNode(node.id)}>Delete</Btn>
      </div>
    </>);
  }
  else if (node.type === "action") {
    const actions = node.actions || [];
    const updateAction = (idx, patch) => onUpdateNode(node.id, n => ({
      ...n, actions: (n.actions || []).map((a, i) => i === idx ? { ...a, ...patch } : a)
    }));
    const duplicateAction = (idx) => onUpdateNode(node.id, n => {
      const src = (n.actions || [])[idx]; if (!src) return n;
      const copy = { ...src, id: "a" + Date.now() };
      const as = [...(n.actions || [])];
      as.splice(idx + 1, 0, copy);
      return { ...n, actions: as };
    });
    const deleteAction = (idx) => onUpdateNode(node.id, n => ({
      ...n, actions: (n.actions || []).filter((_, i) => i !== idx)
    }));
    const addAction = (kind) => onUpdateNode(node.id, n => ({
      ...n, actions: [...(n.actions || []), { id:"a"+Date.now(), kind, value:"" }]
    }));

    content = (<>
      <div style={{ fontSize:14, fontWeight:600, color:C.text1, marginBottom:14, fontFamily:"'DM Sans'" }}>Perform following actions:</div>

      {actions.length === 0 && (
        <div style={{ background:C.sectionBg, border:`1px dashed ${C.cardBorder}`, borderRadius:10, padding:"18px 14px", textAlign:"center", fontSize:12, color:C.muted, fontStyle:"italic", marginBottom:12 }}>
          No actions yet. Click "+ Action" below to add one.
        </div>
      )}

      {actions.map((a, i) => {
        const kind = findAction(a.kind);
        return (
          <div key={a.id} style={{ marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:7 }}>
              <span style={{ color:"#C8881F", display:"flex", flexShrink:0 }}>{kind.icon(17)}</span>
              <Select value={a.kind} onChange={(e)=>updateAction(i, { kind: e.target.value })} style={{ flex:1, fontSize:13, fontWeight:600, color:C.text1, border:"none", background:"transparent", padding:"2px 6px 2px 0" }}>
                {ACTION_KINDS.map(k=><option key={k.kind} value={k.kind}>{k.kind}</option>)}
              </Select>
              <IconBtn title="Duplicate action" onClick={()=>duplicateAction(i)}>{IC.copy(13)}</IconBtn>
              <IconBtn danger title="Remove action" onClick={()=>deleteAction(i)}>{IC.trash(13)}</IconBtn>
            </div>
            {kind.valueType === "bdaUser" ? (() => {
              const roleFilter = a.roleFilter || 'all'; // 'all' | 'admin' | 'bda_sales'
              const assignMode = a.assignMode || 'pick';  // 'pick' | 'variable'
              const filtered = assignableUsers.filter(u =>
                roleFilter === 'all' || u.role === roleFilter
              );
              return (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {/* Mode toggle: pick a user, or resolve from a variable */}
                  <div style={{ display:"flex", gap:4 }}>
                    {[
                      { v:'pick',     label:'Pick a user' },
                      { v:'variable', label:'By variable' },
                    ].map(opt => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={()=>updateAction(i, { assignMode: opt.v, value: '' })}
                        style={{
                          flex:1, padding:"5px 8px", fontSize:11, fontWeight:700, fontFamily:"'DM Sans'",
                          border:`1px solid ${assignMode===opt.v ? C.brand : C.cardBorder}`,
                          background: assignMode===opt.v ? C.brandBg : "#fff",
                          color: assignMode===opt.v ? C.brandDark : C.text3,
                          borderRadius:6, cursor:"pointer",
                        }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {assignMode === 'variable' ? (
                    <>
                      <VarInput
                        value={a.value || ""}
                        onChange={(e)=>updateAction(i, { value: e.target.value })}
                        placeholder="{{assigned_bda_id}}"
                        style={{ fontFamily:"'DM Mono'", fontSize:11 }}
                      />
                      <div style={{ fontSize:10, color:C.text5, fontWeight:500, lineHeight:1.4 }}>
                        The resolved value must be a numeric user id (forgecrm_users.id). If it's missing, disabled, or not an admin/BDA Sales user, the step fails.
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ display:"flex", gap:4 }}>
                        {[
                          { v:'all',       label:'All' },
                          { v:'admin',     label:'Admin' },
                          { v:'bda_sales', label:'BDA Sales' },
                        ].map(opt => (
                          <button
                            key={opt.v}
                            type="button"
                            onClick={()=>updateAction(i, { roleFilter: opt.v })}
                            style={{
                              flex:1, padding:"5px 8px", fontSize:11, fontWeight:600, fontFamily:"'DM Sans'",
                              border:`1px solid ${roleFilter===opt.v ? C.brand : C.cardBorder}`,
                              background: roleFilter===opt.v ? C.brandBg : "#fff",
                              color: roleFilter===opt.v ? C.brandDark : C.text3,
                              borderRadius:6, cursor:"pointer",
                            }}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <Select value={a.value || ""} onChange={(e)=>updateAction(i, { value: e.target.value })}>
                        <option value="">— Select user ({filtered.length} match) —</option>
                        {filtered.map(u => (
                          <option key={u.id} value={String(u.id)}>
                            {u.displayName} · {u.role === 'admin' ? 'Admin' : 'BDA Sales'}{u.email ? ` · ${u.email}` : ''}
                          </option>
                        ))}
                      </Select>
                    </>
                  )}
                </div>
              );
            })() : kind.valueType === "agent" ? (
              <Select value={a.value || ""} onChange={(e)=>updateAction(i, { value: e.target.value })}>
                <option value="">— Select a team member —</option>
                {teamMembers.map(m => (
                  <option key={m.id} value={m.name}>
                    {m.avail === "online" ? "🟢" : m.avail === "away" ? "🟡" : "⚫"} {m.name} · {m.role} · {m.city}
                  </option>
                ))}
              </Select>
            ) : kind.valueType === "tag" ? (
              <Select value={a.value || ""} onChange={(e)=>updateAction(i, { value: e.target.value })}>
                <option value="">— Select a tag —</option>
                {tagNames.map(tg => <option key={tg} value={tg}>{tg}</option>)}
              </Select>
            ) : kind.valueType === "field" ? (() => {
              const isSetKind = kind.kind === "Set Custom Field";
              const raw = a.value || "";
              let curField = "", curValue = "";
              if (isSetKind && raw.includes("=")) {
                const ix = raw.indexOf("=");
                curField = raw.slice(0, ix).trim();
                curValue = raw.slice(ix + 1).trim();
              } else {
                curField = raw.trim();
              }
              const setField = (f) => { updateAction(i, { value: isSetKind ? `${f} = ${curValue}` : f }); };
              const setValue = (v) => { updateAction(i, { value: `${curField} = ${v}` }); };
              const f = (curField || "").toLowerCase();
              const isNumeric = /score|budget|count|pincode|amount|points|qty|age/.test(f);
              const isEmail   = f === "email";
              const isPhone   = f === "phone";
              const isDate    = /date|_at$|_on$/.test(f);
              let valueValid = true, valueHint = "";
              if (isSetKind && curValue) {
                if (isNumeric) { valueValid = /^-?\d+(\.\d+)?$/.test(curValue); valueHint = "Numeric value required"; }
                else if (isEmail) { valueValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(curValue); valueHint = "Valid email required (name@domain.com)"; }
                else if (isPhone) { valueValid = /^\+?91[\s-]?\d{10}$/.test(curValue.replace(/\s/g, "")); valueHint = "Use format +91 9876543210"; }
                else if (isDate)  { valueValid = curValue.length > 0; valueHint = ""; }
              }
              const fieldOk = !!curField;
              return (<>
                <Select value={curField} onChange={(e)=>setField(e.target.value)}
                  style={{ marginBottom: isSetKind ? 6 : 0, borderColor: fieldOk ? C.inputBorder : C.red }}>
                  <option value="">— Select a field —</option>
                  {fieldNames.map(fld => <option key={fld} value={fld}>{fld}</option>)}
                  <option value="__new__">+ Create new field…</option>
                </Select>
                {isSetKind && (<>
                  <VarInput
                    value={curValue}
                    onChange={(e)=>{
                      let v = e.target.value;
                      // Skip the strip-non-numeric when a {{var}} token is in flight.
                      if (isNumeric && !/{{/.test(v)) v = v.replace(/[^\d.\-]/g, "");
                      setValue(v);
                    }}
                    inputMode={isNumeric || isPhone ? "numeric" : "text"}
                    placeholder={ !curField ? "Pick a field first" : isPhone ? "+91 9876543210" : isEmail ? "name@domain.com" : isDate ? "YYYY-MM-DD or relative date" : isNumeric ? "0" : `Value for ${curField}` }
                    disabled={!curField}
                    style={{ fontFamily: (isNumeric || isPhone || isEmail) ? "'DM Mono'" : undefined, borderColor: valueValid ? C.inputBorder : C.red, opacity: curField ? 1 : 0.55 }}
                  />
                  {curField && (
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5 }}>
                      <span style={{ fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:5, background: isNumeric ? "#FFF8E1" : isEmail ? C.blueBg : isPhone ? C.purpleBg : isDate ? C.tealBg : C.sectionBg, color: isNumeric ? "#7A5C00" : isEmail ? C.blue : isPhone ? C.purpleDark : isDate ? C.teal : C.text4, fontFamily:"'DM Mono'", letterSpacing:".04em", textTransform:"uppercase" }}>
                        {isNumeric ? "Number" : isEmail ? "Email" : isPhone ? "Phone +91" : isDate ? "Date" : "Text"}
                      </span>
                      {!valueValid && <span style={{ fontSize:10, color:C.red, fontWeight:600 }}>{valueHint}</span>}
                    </div>
                  )}
                </>)}
              </>);
            })() : kind.valueType === "leadScore" ? (() => {
              const raw = (a.value || "").trim();
              const sign = raw.startsWith("-") ? "-" : "+";
              const mag  = raw.replace(/^[+\-]/, "").replace(/\D/g, "");
              const setLeadScore = (newSign, newMag) => {
                const cleanMag = String(newMag).replace(/\D/g, "");
                updateAction(i, { value: cleanMag ? `${newSign}${cleanMag}` : "" });
              };
              return (
                <div style={{ display:"flex", gap:6, alignItems:"stretch" }}>
                  <Select value={sign} onChange={(e)=>setLeadScore(e.target.value, mag)} style={{ width:74, fontFamily:"'DM Mono'", fontWeight:700 }}>
                    <option value="+">+ Add</option>
                    <option value="-">− Subtract</option>
                  </Select>
                  <Input inputMode="numeric" value={mag} onChange={(e)=>setLeadScore(sign, e.target.value)} placeholder="0" style={{ flex:1, fontFamily:"'DM Mono'", fontWeight:600 }}/>
                  <span style={{ display:"flex", alignItems:"center", fontSize:11, color:C.muted, fontWeight:600, paddingLeft:2 }}>points</span>
                </div>
              );
            })() : kind.valueType === "email" ? (() => {
              const v = a.value || "";
              const valid = !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
              return (<>
                <VarInput value={v} onChange={(e)=>updateAction(i, { value: e.target.value })}
                  placeholder={kind.placeholder}
                  style={{ borderColor: valid ? C.inputBorder : C.red }}/>
                {!valid && !/{{/.test(v) && <div style={{ fontSize:10, color:C.red, marginTop:4, fontWeight:600 }}>Enter a valid email address</div>}
              </>);
            })() : kind.valueType === "none" ? (
              <div style={{ padding:"8px 11px", border:`1.5px dashed ${C.inputBorder}`, borderRadius:8, fontSize:11, color:C.muted, background:C.sectionBg, fontFamily:"'DM Sans'", fontStyle:"italic" }}>
                No options to configure — this action runs as-is.
              </div>
            ) : (
              <VarInput value={a.value || ""} onChange={(e)=>updateAction(i, { value: e.target.value })} placeholder={kind.placeholder}/>
            )}
          </div>
        );
      })}

      <details style={{ marginTop:4 }}>
        <summary style={{
          padding:"13px 16px", listStyle:"none",
          background:"transparent",
          border:`2px dashed #E5A100`,
          borderRadius:10, cursor:"pointer",
          color:"#C8881F", fontSize:14, fontWeight:600,
          fontFamily:"'DM Sans'",
          display:"flex", alignItems:"center", justifyContent:"center", gap:7,
        }}>
          <span style={{ display:"flex" }}>{IC.plus(13)}</span>
          Action
        </summary>
        <div style={{ background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:10, padding:6, marginTop:6, boxShadow:"0 6px 18px rgba(0,0,0,.08)", maxHeight:240, overflowY:"auto" }}>
          {ACTION_KINDS.map(k => (
            <button key={k.kind} onClick={()=>addAction(k.kind)} className="picker-item" style={{
              width:"100%", padding:"8px 10px", background:"transparent",
              border:"1px solid transparent", borderRadius:7, cursor:"pointer", textAlign:"left",
              display:"flex", alignItems:"center", gap:9, marginBottom:1,
              fontSize:12, fontWeight:500, color:C.text2, fontFamily:"'DM Sans'",
            }}>
              <span style={{ color:"#C8881F", display:"flex", flexShrink:0 }}>{k.icon(15)}</span>
              <span>{k.kind}</span>
            </button>
          ))}
        </div>
      </details>

      <div style={{ display:"flex", gap:6, marginTop:18 }}>
        <Btn kind="primary" style={{ flex:1, justifyContent:"center" }} onClick={onSaveAndClose}>Save</Btn>
        <Btn kind="ghost" icon={IC.copy(13)} onClick={()=>onDuplicateNode(node.id)}>Duplicate</Btn>
        <Btn kind="danger" icon={IC.trash(13)} onClick={()=>onDeleteNode(node.id)}>Delete</Btn>
      </div>
    </>);
  }

  else if (node.type === "subflow") {
    const flowId = node.flowId || "";
    const wf = otherAutomations.find(w => w.id === flowId);
    const waitMode = node.waitMode || "await";
    const q = subflowSearch.trim().toLowerCase();
    const filtered = otherAutomations.filter(w => !q || w.name.toLowerCase().includes(q));
    const active = filtered.filter(w=>w.status==="active"||w.status==="Active");
    const paused = filtered.filter(w=>w.status==="paused"||w.status==="Paused"||w.status==="inactive"||w.status==="Inactive");
    content = (<>
      <Field label="Sub-flow to run" hint="The selected automation will execute. Pause and resume options apply on return.">
        <div style={{ position:"relative" }}>
          <div style={{ position:"relative", marginBottom:6 }}>
            <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:C.muted, pointerEvents:"none" }}>{IC.search(12)}</span>
            <Input value={subflowSearch} onChange={e=>setSubflowSearch(e.target.value)} placeholder="Search automations…" style={{ paddingLeft:28, fontSize:12 }}/>
          </div>
          <div style={{ border:`1.5px solid ${C.inputBorder}`, borderRadius:8, background:"#fff", maxHeight:220, overflowY:"auto" }}>
            {active.length === 0 && paused.length === 0 && (
              <div style={{ padding:"10px 11px", fontSize:11, color:C.muted, textAlign:"center" }}>No automations found</div>
            )}
            {active.length > 0 && (
              <div>
                <div style={{ padding:"5px 11px", fontSize:9, fontWeight:700, color:C.muted, letterSpacing:".08em", textTransform:"uppercase", background:C.sectionBg, position:"sticky", top:0, zIndex:1 }}>Active</div>
                {active.map(w => {
                  const selected = w.id === flowId;
                  return (
                    <div key={w.id} onClick={()=>onUpdateNode(node.id, { flowId: w.id })} style={{
                      padding:"7px 11px", cursor:"pointer", display:"flex", alignItems:"center", gap:8,
                      background: selected ? C.brandBg : "transparent",
                      borderBottom:`1px solid ${C.rowDiv}`,
                    }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background: C.brandBright, flexShrink:0 }}/>
                      <span style={{ fontSize:11, fontWeight:600, color: selected ? C.brandDark : C.text2, flex:1 }}>{w.name}</span>
                      {selected && <span style={{ fontSize:10, color:C.brandDark, fontWeight:700 }}>✓</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {paused.length > 0 && (
              <div>
                <div style={{ padding:"5px 11px", fontSize:9, fontWeight:700, color:C.muted, letterSpacing:".08em", textTransform:"uppercase", background:C.sectionBg, position:"sticky", top:0, zIndex:1 }}>Paused</div>
                {paused.map(w => {
                  const selected = w.id === flowId;
                  return (
                    <div key={w.id} onClick={()=>onUpdateNode(node.id, { flowId: w.id })} style={{
                      padding:"7px 11px", cursor:"pointer", display:"flex", alignItems:"center", gap:8,
                      background: selected ? C.orangeBg : "transparent",
                      borderBottom:`1px solid ${C.rowDiv}`,
                    }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background: C.orange, flexShrink:0 }}/>
                      <span style={{ fontSize:11, fontWeight:600, color: selected ? C.orangeText : C.text2, flex:1 }}>{w.name}</span>
                      {selected && <span style={{ fontSize:10, color:C.orangeText, fontWeight:700 }}>✓</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Field>

      {wf && (
        <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:"11px 13px", marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.text1, marginBottom:6 }}>{wf.name}</div>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <Badge label={wf.status} bg={wf.status==="active"||wf.status==="Active"?C.brandBg:"#FFF3E0"} color={wf.status==="active"||wf.status==="Active"?C.brandDark:"#B04E0E"} dot/>
            <span style={{ fontSize:10.5, color:C.text5, fontFamily:"'DM Mono'", fontWeight:600 }}>{(wf.triggers ?? 0).toLocaleString("en-IN")} triggers · last 30 days</span>
          </div>
        </div>
      )}

      <Field label="When sub-flow finishes" hint="Choose how the parent flow proceeds after the sub-flow completes.">
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          <Pill active={waitMode==="await"}    onClick={()=>onUpdateNode(node.id, { waitMode: "await"    })}>Wait for sub-flow, then continue</Pill>
          <Pill active={waitMode==="fire"}     onClick={()=>onUpdateNode(node.id, { waitMode: "fire"     })}>Fire and continue immediately</Pill>
          <Pill active={waitMode==="handoff"}  onClick={()=>onUpdateNode(node.id, { waitMode: "handoff"  })}>Hand off — end this flow</Pill>
        </div>
      </Field>

      <Field label="Pass variables to sub-flow">
        <div style={{ background:C.sectionBg, border:`1px solid ${C.innerBorder}`, borderRadius:10, padding:9 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, alignItems:"center", marginBottom:5 }}>
            <span style={{ fontSize:9, fontWeight:700, color:C.muted, letterSpacing:".08em", textTransform:"uppercase" }}>Sub-flow var</span>
            <span style={{ fontSize:9, fontWeight:700, color:C.muted, letterSpacing:".08em", textTransform:"uppercase" }}>From this flow</span>
          </div>
          {[
            { left:"lead_name", right:"{{first_name}}" },
            { left:"lead_phone", right:"{{phone}}" },
            { left:"city", right:"{{city}}" },
          ].map((row,i)=>(
            <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:5 }}>
              <Input defaultValue={row.left} style={{ fontSize:11, fontFamily:"'DM Mono'" }}/>
              <Input defaultValue={row.right} style={{ fontSize:11, fontFamily:"'DM Mono'" }}/>
            </div>
          ))}
          <Btn kind="ghost" size="sm" icon={IC.plus(11)} style={{ marginTop:4 }}>Add variable</Btn>
        </div>
      </Field>

      <Alert kind="info">Sub-flows let you reuse common patterns. <strong>{wf?.name || "Pick a flow"}</strong> {wf ? "will run with the variables above. Edits to the sub-flow apply everywhere it's used." : "before the parent flow can proceed."}</Alert>

      <div style={{ display:"flex", gap:6, marginTop:14 }}>
        <Btn kind="primary" style={{ flex:1, justifyContent:"center" }} onClick={onSaveAndClose}>Save</Btn>
        <Btn kind="ghost" icon={IC.copy(13)} onClick={()=>onDuplicateNode(node.id)}>Duplicate</Btn>
        <Btn kind="danger" icon={IC.trash(13)} onClick={()=>onDeleteNode(node.id)}>Delete</Btn>
      </div>
    </>);
  }

  if (content === null) {
    content = (<>
      <Field label="Description"><Textarea rows={3} value={node.sub || ""} onChange={(e)=>onUpdateNode(node.id, { sub: e.target.value })} placeholder="Describe what this step does…"/></Field>
      <Alert kind="info">This <strong>{t.label}</strong> block uses default settings. Configure it inline or open the advanced editor for more options.</Alert>
      <div style={{ display:"flex", gap:6, marginTop:14 }}>
        <Btn kind="primary" style={{ flex:1, justifyContent:"center" }} onClick={onSaveAndClose}>Save</Btn>
        <Btn kind="ghost" icon={IC.copy(13)} onClick={()=>onDuplicateNode(node.id)}>Duplicate</Btn>
        <Btn kind="danger" icon={IC.trash(13)} onClick={()=>onDeleteNode(node.id)}>Delete</Btn>
      </div>
    </>);
  }

  const isActionHeader = node.type === "action";

  return (
    <aside style={{ width:344, borderLeft:`1px solid ${C.cardBorder}`, background:"#fff", flexShrink:0, overflowY:"auto" }}>
      <div style={{
        padding:"15px 18px 13px",
        borderBottom:`1px solid ${isActionHeader ? "#F0E0A8" : C.cardBorder}`,
        background: isActionHeader ? "#FFF6D6" : "#fff",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom: isActionHeader ? 0 : 10 }}>
          <div style={{
            width:32, height:32, borderRadius:8,
            background: isActionHeader ? "#FFFFFF80" : t.bg,
            color: isActionHeader ? "#C8881F" : t.color,
            display:"flex", alignItems:"center", justifyContent:"center",
            border:`1px solid ${isActionHeader ? "#F0E0A8" : t.border}`,
            flexShrink:0,
          }}>{isActionHeader ? IC.zap(16) : t.icon(16)}</div>
          <div style={{ flex:1, minWidth:0 }}>
            {!isActionHeader && <div style={{ fontSize:9, fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", color:t.accent, marginBottom:1 }}>{t.label} BLOCK</div>}
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={node.title || ""}
                  onChange={(e)=>onUpdateNode(node.id, { title: e.target.value.slice(0, 60) })}
                  onBlur={commitTitle}
                  onKeyDown={onTitleKey}
                  placeholder="Type a node name…"
                  className="rename-input"
                  style={{
                    fontSize: isActionHeader ? 17 : 14,
                    fontWeight:700,
                    color: isActionHeader ? "#7A5C00" : C.text1,
                    fontFamily:"'DM Sans'", flex:1, minWidth:0,
                    border:`1px solid ${C.brandBright}`,
                    borderRadius:5,
                    outline:"none", background:"#fff",
                    padding:"2px 6px",
                    margin:"-2px -6px",
                    boxShadow:`0 0 0 3px ${C.brandBg}`,
                  }}
                />
              ) : (
                <div
                  onClick={()=>setEditingTitle(true)}
                  title="Click the pencil to rename"
                  style={{
                    fontSize: isActionHeader ? 17 : 14,
                    fontWeight:700,
                    color: isActionHeader ? "#7A5C00" : ((node.title && node.title.trim()) || node.type === 'trigger' ? C.text1 : C.muted),
                    fontFamily:"'DM Sans'", flex:1, minWidth:0,
                    padding:"2px 0",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    cursor:"default",
                    fontStyle: ((node.title && node.title.trim()) || node.type === 'trigger') ? "normal" : "italic",
                  }}
                >{node.type === 'trigger' ? getTriggerDisplay(node).title : ((node.title && node.title.trim()) ? node.title : "Unnamed node")}</div>
              )}
              <IconBtn
                title={editingTitle ? "Done editing" : "Rename this node"}
                onClick={()=>setEditingTitle(v => !v)}
                style={{
                  color: editingTitle ? C.brand : (isActionHeader ? "#7A5C00" : C.text5),
                  background: editingTitle ? C.brandBg : "transparent",
                }}
              >{editingTitle ? IC.ok(13) : IC.edit(13)}</IconBtn>
            </div>
            {editingTitle && (!node.title || !String(node.title).trim()) && <div style={{ fontSize:9.5, color:C.red, marginTop:3, fontWeight:600 }}>Node name can't be empty</div>}
          </div>
          {!isActionHeader && <IconBtn title="Duplicate" onClick={()=>onDuplicateNode(node.id)}>{IC.copy(15)}</IconBtn>}
          {!isActionHeader && <IconBtn danger title="Delete" onClick={()=>onDeleteNode(node.id)}>{IC.trash(15)}</IconBtn>}
        </div>
        {!isActionHeader && (
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <Btn kind="ghost" size="sm" onClick={()=>onToggleDisable(node.id)}>{node.disabled ? "Enable" : "Disable"}</Btn>
            <Btn kind="ghost" size="sm" onClick={()=>onDuplicateNode(node.id)}>Duplicate</Btn>
            <div style={{ flex:1 }}/>
            <Badge label="Saved" bg={C.brandBg} color={C.brandDark} dot/>
          </div>
        )}
      </div>
      <div style={{ padding:18 }}>
        <VarContext.Provider value={{ nodes, edges, currentNodeId: node.id, contactFields }}>
          {content}
        </VarContext.Provider>
      </div>
    </aside>
  );
};


const BuilderToolbar = ({ automationName, status, onBack, onSave, isDirty, saving, onToggleStatus, toggleBusy, onPreview, showPreview, activeTab, onTabChange, onUndo, onRedo, canUndo, canRedo, onZoomIn, onZoomOut, onFit, onAutoLayout }) => {
  const isActive = status === 'active';
  const tabs = [
    { key: 'editor', label: 'Editor' },
    { key: 'executions', label: 'Executions' },
  ];
  return (
    <div style={{ background:"#fff", borderBottom:`1px solid ${C.cardBorder}`, padding:"9px 16px", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
      <Btn kind="ghost" icon={IC.back(13)} onClick={onBack}>Back</Btn>
      <div style={{ height:22, width:1, background:C.cardBorder }}/>
      <div style={{ display:"flex", flexDirection:"column", minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:700, color:C.text1, fontFamily:"'DM Sans'" }}>{automationName || "Untitled Automation"}</div>
      </div>
      <StatusPill status={status || "draft"}/>
      <div style={{ flex:1 }}/>

      {/* Center tabs */}
      <div style={{ display:"flex", gap:4, background:C.innerBg, borderRadius:10, padding:4 }}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange && onTabChange(tab.key)}
              style={{
                padding: '6px 18px',
                borderRadius: 8,
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "'DM Sans'",
                cursor: 'pointer',
                background: isActive ? '#fff' : 'transparent',
                color: isActive ? C.text1 : C.text5,
                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                transition: 'all .15s',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex:1 }}/>
      <div style={{ display:"flex", gap:2 }}>
        <IconBtn title="Undo" onClick={onUndo} style={{ opacity: canUndo ? 1 : 0.35 }}>{IC.undo(15)}</IconBtn>
        <IconBtn title="Redo" onClick={onRedo} style={{ opacity: canRedo ? 1 : 0.35 }}>{IC.redo(15)}</IconBtn>
        <IconBtn title="Auto-arrange" onClick={onAutoLayout}>{IC.arr(15)}</IconBtn>
        <div style={{ height:22, width:1, background:C.cardBorder, margin:"0 6px", alignSelf:"center" }}/>
        <IconBtn title="Zoom out" onClick={onZoomOut}>{IC.zOut(15)}</IconBtn>
        <IconBtn title="Fit to screen" onClick={onFit}>{IC.fit(15)}</IconBtn>
        <IconBtn title="Zoom in" onClick={onZoomIn}>{IC.zIn(15)}</IconBtn>
      </div>
      <div style={{ height:22, width:1, background:C.cardBorder }}/>
      <Btn kind="ghost" icon={IC.eye(13)} onClick={onPreview} data-testid="preview-toggle">{showPreview ? "Hide preview" : "Preview"}</Btn>
      {onToggleStatus && (
        <Btn
          kind={isActive ? "ghost" : "primary"}
          icon={IC.power(13)}
          onClick={() => !toggleBusy && onToggleStatus(isActive ? 'inactive' : 'active')}
          title={isActive ? "Disable this automation" : "Enable this automation"}
          style={toggleBusy ? { opacity: 0.6, pointerEvents: 'none' } : (isActive ? { color: C.redDark, border: `1px solid ${C.redBg}` } : undefined)}
        >
          {toggleBusy ? (isActive ? "Disabling…" : "Enabling…") : (isActive ? "Disable" : "Enable")}
        </Btn>
      )}
      {saving ? (
        <Btn kind="ghost" disabled style={{ opacity: .7, pointerEvents: 'none' }}>Saving…</Btn>
      ) : isDirty ? (
        <Btn kind="primary" icon={IC.play(12)} onClick={onSave} title="Save changes">Save</Btn>
      ) : (
        <Btn kind="ghost" icon={IC.check(13)} disabled
          title="No unsaved changes"
          style={{ color: C.green || '#0F6E56', borderColor: C.green || '#0F6E56', opacity: .85, pointerEvents: 'none', cursor: 'default' }}>
          Saved
        </Btn>
      )}
    </div>
  );
};

const PhonePreview = ({ onClose, nodes = [], edges = [], templates = [], teamMembers = [], otherAutomations = [] }) => {
  const [conv, setConv] = useState([]);
  const [waiting, setWaiting] = useState(null);
  const [ended, setEnded] = useState(false);
  const chatRef = useRef(null);
  const timersRef = useRef([]);
  const runRef = useRef(0);

  const clearTimers = () => { timersRef.current.forEach(t => clearTimeout(t)); timersRef.current = []; };
  const sched = (cb, ms) => { const t = setTimeout(cb, ms); timersRef.current.push(t); };

  const SAMPLE_VARS = {
    "{{first_name}}": "Anjali",
    "{{phone}}":      "+91 98765 43210",
    "{{city}}":       "Chennai",
    "{{bhk_type}}":   "2BHK",
    "{{order_id}}":   "ORD-12345",
    "{{lead_score}}": "85",
    "{{budget}}":     "₹1.2 Cr",
    "{{name}}":       "Anjali",
    "{{contact_number}}": "+91 98765 43210",
  };
  const resolveBody = (body, bindings = {}) =>
    (body || "").replace(/\{\{(\d+)\}\}/g, (_, num) => {
      const bound = bindings["var" + num];
      if (!bound) return `[var${num}]`;
      return SAMPLE_VARS[bound] || bound;
    });

  const now = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };

  const resolveNext = (nodeId, fromHandle = null) => {
    const candidates = edges.filter(e =>
      e.from === nodeId &&
      (fromHandle ? e.fromHandle === fromHandle : (!e.fromHandle || e.fromHandle === "default"))
    );
    if (!candidates.length) return null;
    let target = candidates[0].to;
    const visited = new Set([nodeId]);
    while (target && !visited.has(target)) {
      visited.add(target);
      const t = nodes.find(n => n.id === target);
      if (!t || !t.disabled) return target;
      const nx = edges.find(e => e.from === target);
      if (!nx) return null;
      target = nx.to;
    }
    return target;
  };

  const playNode = (nodeId, runId) => {
    if (runId !== runRef.current) return;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) { setEnded(true); return; }
    if (node.disabled) {
      const next = resolveNext(node.id);
      next ? sched(() => playNode(next, runId), 80) : setEnded(true);
      return;
    }

    if (node.type === "message") {
      if (node.messageMode === "direct") {
        const dd = node.directData || {};
        const dt = node.directType || "text";
        let text = "";
        let buttons = null;
        switch (dt) {
          case "text": text = dd.body || "(empty text)"; break;
          case "image": text = `📷 Image\n${dd.caption || ""}`; break;
          case "video": text = `🎬 Video\n${dd.caption || ""}`; break;
          case "audio": text = "🔊 Audio message"; break;
          case "document": text = `📄 Document${dd.filename ? ` · ${dd.filename}` : ""}\n${dd.caption || ""}`; break;
          case "location": text = `📍 ${dd.name || "Location"}\n${dd.address || ""}`.trim(); break;
          case "contact": text = `👤 ${dd.name || "Contact"}\n${dd.phone || ""}`; break;
          case "product": text = `🛒 Product`; break;
          case "catalog": text = `📋 Catalog\n${dd.body || ""}`; break;
          case "quick_reply": text = dd.body || ""; buttons = (dd.buttons || []).map(b => ({ text: b.title || "Button" })); break;
          case "list": text = dd.body || ""; buttons = (dd.sections || []).flatMap(s => (s.rows || []).map(r => ({ text: r.title || "Option" }))); break;
          case "dynamic_api": text = `[Dynamic API] ${dd.endpoint || "API call"}`; break;
          default: text = "(direct message)";
        }
        setConv(c => [...c, { from:"bot", text, time: now(), buttons, ownerNodeId: node.id }]);
        if (buttons && buttons.length) {
          setWaiting({ nodeId: node.id, buttons });
        } else {
          const next = resolveNext(node.id);
          next ? sched(() => playNode(next, runId), 900) : setEnded(true);
        }
        return;
      }
      const tpl = templates.find(t => String(t.id) === String(node.templateId));
      if (!tpl) {
        setConv(c => [...c, { from:"system", text:"[Warning] Message node has no template selected", time: now() }]);
        const next = resolveNext(node.id);
        next ? sched(() => playNode(next, runId), 600) : setEnded(true);
        return;
      }
      const text = resolveBody(tpl.body, node.bindings || {});
      const buttons = tpl.buttons;
      setConv(c => [...c, { from:"bot", text, time: now(), buttons, ownerNodeId: node.id }]);
      if (buttons && buttons.length) {
        setWaiting({ nodeId: node.id, buttons });
      } else {
        const next = resolveNext(node.id);
        next ? sched(() => playNode(next, runId), 900) : setEnded(true);
      }
    } else if (node.type === "condition") {
      const branch = (node.matchMode === "random") ? (Math.random() < 0.5 ? "yes" : "no") : "yes";
      setConv(c => [...c, { from:"system", text:`[Condition] ${node.title || "Condition"} — ${branch === "yes" ? "Matched" : "Not-matched"} branch`, time: now() }]);
      const next = resolveNext(node.id, branch);
      next ? sched(() => playNode(next, runId), 650) : setEnded(true);
    } else if (node.type === "action") {
      const actList = (node.actions || []).map(a => `${a.kind}${a.value ? " → " + a.value : ""}`);
      setConv(c => [...c, { from:"system", text:`[Action] ${actList.join(" · ") || (node.title || "Action")}`, time: now() }]);
      const next = resolveNext(node.id);
      next ? sched(() => playNode(next, runId), 600) : setEnded(true);
    } else if (node.type === "delay") {
      setConv(c => [...c, { from:"system", text:`[Delay] Wait ${node.waitValue || "10"} ${node.waitUnit || "minutes"}`, time: now() }]);
      const next = resolveNext(node.id);
      next ? sched(() => playNode(next, runId), 900) : setEnded(true);
    } else if (node.type === "ai") {
      const snippet = (node.aiGoal || "AI generates an answer").slice(0, 80);
      setConv(c => [...c, { from:"bot", text:`[AI] ${snippet}${(node.aiGoal || "").length > 80 ? "…" : ""}`, time: now() }]);
      const next = resolveNext(node.id);
      next ? sched(() => playNode(next, runId), 900) : setEnded(true);
    } else if (node.type === "handoff") {
      const member = teamMembers.find(m => (node.assigned || []).includes(m.id));
      setConv(c => [...c, { from:"system", text:`[Handoff] Assigned to ${member?.name || "team member"} · ${node.priority || "high"} priority · ${node.slaValue || 15} ${node.slaUnit || "minutes"} SLA`, time: now() }]);
      setConv(c => [...c, { from:"system", text:"Bot has paused — a live agent will continue.", time: now() }]);
      setEnded(true);
    } else if (node.type === "subflow") {
      const flow = otherAutomations.find(f => f.id === node.flowId);
      setConv(c => [...c, { from:"system", text:`[Sub-flow] ${flow?.name || "(none selected)"} · ${node.waitMode || "await"}`, time: now() }]);
      if (node.waitMode === "handoff") { setEnded(true); return; }
      const next = resolveNext(node.id);
      next ? sched(() => playNode(next, runId), 700) : setEnded(true);
    } else if (node.type === "api") {
      setConv(c => [...c, { from:"system", text:`[API] ${node.method || "POST"} ${(node.apiUrl || "API request").slice(0, 40)}`, time: now() }]);
      const next = resolveNext(node.id);
      next ? sched(() => playNode(next, runId), 700) : setEnded(true);
    } else if (node.type === "trigger") {
      const next = resolveNext(node.id);
      next ? sched(() => playNode(next, runId), 400) : setEnded(true);
    } else {
      setConv(c => [...c, { from:"system", text:`(${node.type} node — no preview)`, time: now() }]);
      const next = resolveNext(node.id);
      next ? sched(() => playNode(next, runId), 500) : setEnded(true);
    }
  };

  const onTapButton = (text, idx) => {
    if (!waiting) return;
    const { nodeId } = waiting;
    setConv(c => [...c, { from:"user", text, time: now() }]);
    setWaiting(null);
    const next = resolveNext(nodeId, `btn:${idx}`);
    if (next) sched(() => playNode(next, runRef.current), 600);
    else setEnded(true);
  };

  const restart = () => {
    clearTimers();
    setWaiting(null);
    setEnded(false);
    runRef.current += 1;
    const runId = runRef.current;
    setConv([]);
    const trigger = nodes.find(n => n.type === "trigger" && !n.disabled);
    if (!trigger) {
      setConv([{ from:"system", text:"[Warning] No active trigger node in this flow.", time: now() }]);
      setEnded(true);
      return;
    }
    const tk = trigger.triggerKind || "keyword";
    let firstItem;
    if (tk === "keyword") {
      firstItem = { from:"user",   text: (trigger.keyword || "PRICE").trim(), time: now() };
    } else if (tk === "link") {
      const code = trigger.trackingCode || "WEB_HOMEPAGE_HERO";
      const msg  = trigger.prefilledMsg || "Hi, I'd like to know more";
      firstItem = { from:"user",   text: `${msg} · ${code}`, time: now() };
      setConv([{ from:"system", text:`[Link] Contact opened wa.me link · ${trigger.linkSource || "Website"}`, time: now() }, firstItem]);
      const next = resolveNext(trigger.id);
      if (next) sched(() => playNode(next, runId), 700);
      else setEnded(true);
      return;
    } else if (tk === "qr") {
      firstItem = { from:"user",   text: trigger.prefilledMsg || `Scanned from ${trigger.qrLocation || "QR"}`, time: now() };
      setConv([{ from:"system", text:`[QR] Contact scanned QR · ${trigger.qrLabel || "FLYER_2025"}`, time: now() }, firstItem]);
      const next = resolveNext(trigger.id);
      if (next) sched(() => playNode(next, runId), 700);
      else setEnded(true);
      return;
    } else if (tk === "newContact") {
      firstItem = { from:"user", text:"Hello", time: now() };
      setConv([{ from:"system", text:"[New Contact] First time messaging this number", time: now() }, firstItem]);
      const next = resolveNext(trigger.id);
      if (next) sched(() => playNode(next, runId), 700);
      else setEnded(true);
      return;
    } else if (tk === "anyMessage") {
      firstItem = { from:"user", text:"Hi there", time: now() };
    } else if (tk === "tagApplied") {
      setConv([{ from:"system", text:`[Tag] "${trigger.tag || "Hot Lead"}" was ${trigger.tagDirection === "removed" ? "removed from" : "added to"} the contact`, time: now() }]);
      const next = resolveNext(trigger.id);
      if (next) sched(() => playNode(next, runId), 700);
      else setEnded(true);
      return;
    } else if (tk === "webhook") {
      setConv([{ from:"system", text:`[Webhook] POST /hooks/${trigger.id}`, time: now() }]);
      const next = resolveNext(trigger.id);
      if (next) sched(() => playNode(next, runId), 700);
      else setEnded(true);
      return;
    } else if (tk === "apiEvent") {
      setConv([{ from:"system", text:`[Event] ${trigger.integration || "Razorpay"} · ${trigger.eventType || "(no event selected)"}`, time: now() }]);
      const next = resolveNext(trigger.id);
      if (next) sched(() => playNode(next, runId), 700);
      else setEnded(true);
      return;
    } else {
      firstItem = { from:"user", text:"(triggered)", time: now() };
    }
    setConv([firstItem]);
    const next = resolveNext(trigger.id);
    if (next) sched(() => playNode(next, runId), 700);
    else setEnded(true);
  };

  useEffect(() => {
    restart();
    return () => clearTimers();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [conv, waiting, ended]);

  return (
    <div style={{ width:308, borderLeft:`1px solid ${C.cardBorder}`, background:"#FAFAF7", flexShrink:0, display:"flex", flexDirection:"column", minHeight:0 }}>
      <div style={{ padding:"11px 14px", borderBottom:`1px solid ${C.cardBorder}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div>
          <div style={{ fontSize:10, color:C.muted, fontWeight:700, letterSpacing:".1em", textTransform:"uppercase" }}>Live Preview</div>
          <div style={{ fontSize:13, fontWeight:700, color:C.text1, marginTop:2 }}>WhatsApp simulator</div>
        </div>
        <IconBtn onClick={onClose}>{IC.x(15)}</IconBtn>
      </div>
      <div style={{ flex:1, minHeight:0, overflow:"hidden", padding:"14px 14px 10px", display:"flex", flexDirection:"column", alignItems:"center" }}>
        <div style={{
          width: 278, flex: 1, minHeight: 0, maxHeight: 600,
          background: "linear-gradient(155deg, #D8D8DE 0%, #A6A6AD 30%, #82828A 58%, #BFBFC5 82%, #6E6E76 100%)",
          borderRadius: 52, padding: 3.5,
          boxShadow: "0 22px 50px rgba(0,0,0,.28), 0 4px 10px rgba(0,0,0,.10), inset 0 0 0 0.5px rgba(255,255,255,.55), inset 0 -2px 4px rgba(0,0,0,.18)",
          position: "relative", display: "flex", flexDirection: "column",
        }}>
          <div style={{ position:"absolute", left:0, top:84,  width:3, height:30, background:"linear-gradient(90deg,#4A4A50,#6B6B72)", borderRadius:"3px 0 0 3px" }}/>
          <div style={{ position:"absolute", left:0, top:130, width:3, height:48, background:"linear-gradient(90deg,#4A4A50,#6B6B72)", borderRadius:"3px 0 0 3px" }}/>
          <div style={{ position:"absolute", left:0, top:188, width:3, height:48, background:"linear-gradient(90deg,#4A4A50,#6B6B72)", borderRadius:"3px 0 0 3px" }}/>
          <div style={{ position:"absolute", right:0, top:130, width:3, height:64, background:"linear-gradient(270deg,#4A4A50,#6B6B72)", borderRadius:"0 3px 3px 0" }}/>
          <div style={{ position:"absolute", right:0, top:208, width:3, height:38, background:"linear-gradient(270deg,#4A4A50,#6B6B72)", borderRadius:"0 3px 3px 0" }}/>

          <div style={{ background: "#000", borderRadius: 48.5, padding: 2, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,.12)" }}>
            <div style={{ flex: 1, minHeight: 0, position: "relative", borderRadius: 46.5, overflow: "hidden", display: "flex", flexDirection: "column", background: "#075E54" }}>
              <div style={{ position:"absolute", top:0, left:0, right:0, height:46, padding:"14px 28px 0", display:"flex", justifyContent:"space-between", alignItems:"flex-start", color:"#fff", zIndex:5, fontFamily:"-apple-system, 'SF Pro Display', system-ui, sans-serif", fontWeight:600, fontSize:14, letterSpacing:"-.01em", pointerEvents:"none" }}>
                <span style={{ minWidth:48, textAlign:"left" }}>{now()}</span>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <svg width="17" height="11" viewBox="0 0 17 11" style={{ display:"block" }}>
                    <rect x="0"  y="6.5" width="3" height="4.5" rx="0.7" fill="#fff"/>
                    <rect x="4"  y="4.5" width="3" height="6.5" rx="0.7" fill="#fff"/>
                    <rect x="8"  y="2.5" width="3" height="8.5" rx="0.7" fill="#fff"/>
                    <rect x="12" y="0.5" width="3" height="10.5" rx="0.7" fill="#fff"/>
                  </svg>
                  <svg width="15" height="11" viewBox="0 0 15 11" style={{ display:"block" }}>
                    <path d="M7.5 2.5 C 4 2.5, 1.5 4.5, 0.5 5.5 L 1.7 7 C 2.6 6.1, 4.6 4.5, 7.5 4.5 C 10.4 4.5, 12.4 6.1, 13.3 7 L 14.5 5.5 C 13.5 4.5, 11 2.5, 7.5 2.5 Z" fill="#fff"/>
                    <path d="M7.5 5.5 C 5.5 5.5, 4 6.6, 3.3 7.4 L 4.5 8.7 C 5 8.1, 6 7.5, 7.5 7.5 C 9 7.5, 10 8.1, 10.5 8.7 L 11.7 7.4 C 11 6.6, 9.5 5.5, 7.5 5.5 Z" fill="#fff"/>
                    <circle cx="7.5" cy="9.7" r="1.1" fill="#fff"/>
                  </svg>
                  <svg width="27" height="13" viewBox="0 0 27 13" style={{ display:"block" }}>
                    <rect x="0.5" y="0.5" width="23" height="12" rx="3" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="1"/>
                    <rect x="24.5" y="4" width="1.5" height="5" rx="0.6" fill="#fff" fillOpacity="0.45"/>
                    <rect x="2" y="2" width="20" height="9" rx="1.7" fill="#fff"/>
                  </svg>
                </div>
              </div>

              <div style={{ position:"absolute", top:11, left:"50%", transform:"translateX(-50%)", width:108, height:32, background:"#000", borderRadius:99, zIndex:6, boxShadow:"inset 0 0 0 0.5px rgba(255,255,255,.08), 0 0 0 0.5px #000" }}>
                <div style={{ position:"absolute", top:11, right:14, width:9, height:9, borderRadius:"50%", background:"#1a1a1d", boxShadow:"inset 0 0 0 1px #050505, inset 0 0 4px rgba(80,120,200,.3)" }}/>
              </div>

              <div style={{ background:"#075E54", paddingTop:50, paddingBottom:8, paddingLeft:12, paddingRight:12, color:"#fff", fontFamily:"-apple-system, 'SF Pro Display', system-ui, sans-serif", flexShrink:0, position:"relative", zIndex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ color:"#fff", fontSize:20, lineHeight:1, opacity:.9, marginRight:-2 }}>‹</span>
                  <div style={{ width:30, height:30, borderRadius:"50%", background:`linear-gradient(135deg,${C.brandBright},${C.brand})`, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:700, flexShrink:0 }}>F</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>Forge Automation</div>
                    <div style={{ fontSize:10, opacity:.82, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ended ? "Conversation ended" : waiting ? "Waiting for your reply" : "typing…"}</div>
                  </div>
                  <svg width="20" height="14" viewBox="0 0 20 14" style={{ display:"block", flexShrink:0 }}>
                    <rect x="0.5" y="1.5" width="13" height="11" rx="2.5" fill="none" stroke="#fff" strokeWidth="1.4"/>
                    <path d="M14 5.5 L19 3 L19 11 L14 8.5 Z" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round"/>
                  </svg>
                  <svg width="15" height="15" viewBox="0 0 15 15" style={{ display:"block", flexShrink:0 }}>
                    <path d="M3 1 L5 1 L6.5 4.5 L5 6 C 6 8, 7 9, 9 10 L 10.5 8.5 L 14 10 L 14 12 C 14 13, 13 14, 12 14 C 6 14, 1 9, 1 3 C 1 2, 2 1, 3 1 Z" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>

              <div ref={chatRef} style={{ flex:1, minHeight:0, overflowY:"auto", background:"#E5DDD5", padding:"10px 7px", backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cpath d='M20 20 L25 25 M55 55 L60 60' stroke='%23D9CFC4' stroke-width='1'/%3E%3C/svg%3E\")" }}>
                <div style={{ display:"flex", justifyContent:"center", marginBottom:8 }}>
                  <span style={{ background:"#E1F2FA", color:"#3C6678", fontSize:9, padding:"2px 9px", borderRadius:99, fontWeight:600 }}>TODAY</span>
                </div>
                {conv.map((m, i) => {
                  if (m.from === "system") {
                    return (
                      <div key={i} style={{ display:"flex", justifyContent:"center", margin:"6px 0" }}>
                        <div style={{ background:"#FFF8E1", border:"1px solid #FFE082", color:"#7A5C00", fontSize:9, padding:"3px 9px", borderRadius:99, fontWeight:600, maxWidth:"90%", textAlign:"center", lineHeight:1.4 }}>{m.text}</div>
                      </div>
                    );
                  }
                  const isUser = m.from === "user";
                  const hasButtons = m.buttons && m.buttons.length > 0;
                  const isWaitingOnThese = waiting && waiting.nodeId === m.ownerNodeId;
                  return (
                    <div key={i} style={{ display:"flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom:4 }}>
                      <div style={{ background: isUser ? "#DCF8C6" : "#fff", borderRadius: isUser ? "8px 0 8px 8px" : "0 8px 8px 8px", maxWidth: "82%", fontSize:11, color:"#111", lineHeight:1.4, overflow:"hidden", boxShadow:"0 1px 1px rgba(0,0,0,.07)" }}>
                        <div style={{ padding:"5px 9px" }}>
                          {m.text}
                          <div style={{ fontSize:8, color:"#667781", textAlign:"right", marginTop:2, fontFamily:"-apple-system, 'SF Pro Display', sans-serif", display:"flex", justifyContent:"flex-end", alignItems:"center", gap:3 }}>
                            {m.time}
                          </div>
                        </div>
                        {hasButtons && (
                          <div style={{ borderTop:"1px solid #E0E0E0" }}>
                            {m.buttons.map((btn, idx) => (
                              <button key={idx} onClick={()=>isWaitingOnThese && onTapButton(btn, idx)} disabled={!isWaitingOnThese}
                                style={{ display:"block", width:"100%", padding:"7px 9px", border:"none", borderTop:"1px solid #F0F0F0", textAlign:"center", color:"#00A5F4", fontSize:11, fontWeight:500, background:"transparent", cursor: isWaitingOnThese ? "pointer" : "default", opacity: isWaitingOnThese ? 1 : 0.4, fontFamily:"-apple-system, 'SF Pro Display', sans-serif", transition:"background .12s" }}
                                onMouseEnter={(e)=>{ if (isWaitingOnThese) e.currentTarget.style.background = "#F5FBFF"; }}
                                onMouseLeave={(e)=>{ e.currentTarget.style.background = "transparent"; }}
                              >{btn.text || btn}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {ended && (
                  <div style={{ display:"flex", justifyContent:"center", marginTop:10 }}>
                    <span style={{ background:"#E1F5EE", color:C.brandDark, fontSize:9, padding:"3px 10px", borderRadius:99, fontWeight:700, letterSpacing:".06em", textTransform:"uppercase" }}>End of flow</span>
                  </div>
                )}
              </div>

              <div style={{ background:"#F0F0F0", padding:"7px 9px 22px", display:"flex", alignItems:"center", gap:6, flexShrink:0, position:"relative" }}>
                <div style={{ flex:1, background:"#fff", borderRadius:99, padding:"6px 12px", fontSize:10, color:"#999", border:"1px solid #E5E5E0" }}>
                  {waiting ? "↑ Tap a reply button above" : ended ? "Conversation ended — tap Restart" : "Message"}
                </div>
                <div style={{ width:28, height:28, background:"#25D366", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", flexShrink:0, boxShadow:"0 1px 2px rgba(0,0,0,.15)" }}>{IC.send(13)}</div>
                <div style={{ position:"absolute", bottom:6, left:"50%", transform:"translateX(-50%)", width:110, height:4, background:"#111", borderRadius:99, opacity:.85 }}/>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ padding:"10px 12px 12px", borderTop:`1px solid ${C.cardBorder}`, display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, flexShrink:0 }}>
        <Btn kind="ghost" size="sm" onClick={restart}>↻ Restart</Btn>
        <Btn kind="primary" size="sm" icon={IC.send(12)} onClick={restart}>Run again</Btn>
      </div>
    </div>
  );
};


/* ══════════════════════════════════════════════════════════════════════
   CANVAS + BUILDER — Full pan / zoom / drag / connect
   ══════════════════════════════════════════════════════════════════════ */

const findDataAttr = (el, attr) => {
  while (el && el !== document.body) {
    if (el.dataset && el.dataset[attr] !== undefined) return el;
    el = el.parentElement;
  }
  return null;
};

const Canvas = ({
  nodes, edges, selectedId, setSelectedId, transform, setTransform,
  onStartDrag, onStartConnect, ghost, panning,
  onClickEdgePlus, onClickAppendPlus, onClickEdgeDelete, onDeleteNode, onDuplicateNode,
  viewportRef, onViewportMouseDown, onAutoLayout, whatsappAccounts,
}) => {
  const map = Object.fromEntries(nodes.map(n=>[n.id,n]));
  const edgePluses = edges.map((e, i) => {
    const a = map[e.from]; const b = map[e.to]; if (!a||!b) return null;
    const p1 = handlePos(a, "output", e.fromHandle || "default");
    const p2 = handlePos(b, "input");
    return { x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2, edgeIndex: i, isLabeled: !!e.label };
  }).filter(Boolean);

  const appendPluses = [];
  nodes.forEach(n => {
    const handles = outputHandlesOf(n);
    handles.forEach(handle => {
      const hasEdge = edges.some(e => e.from === n.id && (e.fromHandle || "default") === handle);
      if (!hasEdge) {
        const p = handlePos(n, "output", handle);
        appendPluses.push({ x:p.x, y:p.y+50, fromId:n.id, fromHandle:handle });
      }
    });
  });

  const selectedNode = nodes.find(n => n.id === selectedId);

  return (
    <div
      ref={viewportRef}
      onMouseDown={onViewportMouseDown}
      onClick={(e) => { if (!e.target.closest("[data-node-id]")) setSelectedId(null); }}
      style={{
        flex:1, position:"relative", overflow:"hidden", background:C.pageBg,
        cursor: panning ? "grabbing" : "grab",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div className="canvas-bg" style={{
        position:"absolute", inset:0,
        backgroundImage:`radial-gradient(${C.cardBorder} 1px, transparent 1px)`,
        backgroundSize: `${18*transform.scale}px ${18*transform.scale}px`,
        backgroundPosition: `${transform.x}px ${transform.y}px`,
        pointerEvents:"none",
      }}/>

      <div style={{
        position:"absolute", top:0, left:0, width:"100%", height:"100%",
        transform:`translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        transformOrigin:"0 0",
      }}>
        <Connectors nodes={nodes} edges={edges} ghost={ghost}/>

        {nodes.map(n => (
          <FlowNode
            key={n.id} n={n} selected={selectedId===n.id}
            onSelect={setSelectedId}
            onStartDrag={onStartDrag}
            onStartConnect={onStartConnect}
            whatsappAccounts={whatsappAccounts}
          />
        ))}

        {edgePluses.map((p, i) => (
          <React.Fragment key={"ep"+i}>
            <EdgePlus   x={p.x - 16} y={p.y} onClick={(e)=>onClickEdgePlus(e, p.edgeIndex)}/>
            <EdgeDelete x={p.x + 16} y={p.y} onClick={(e)=>onClickEdgeDelete(e, p.edgeIndex)}/>
          </React.Fragment>
        ))}

        {appendPluses.map((p, i) => (
          <EdgePlus key={"ap"+i} x={p.x} y={p.y} withConnector
            onClick={(e)=>onClickAppendPlus(e, p.fromId, p.fromHandle)}/>
        ))}

        {selectedNode && (
          <NodeActions
            x={selectedNode.x + NODE_W/2}
            y={selectedNode.y - 8}
            onDuplicate={()=>onDuplicateNode(selectedNode.id)}
            onDelete={()=>onDeleteNode(selectedNode.id)}
          />
        )}
      </div>

      <div style={{ position:"absolute", top:14, left:"50%", transform:"translateX(-50%)", background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:99, padding:"6px 14px", display:"flex", alignItems:"center", gap:10, boxShadow:"0 2px 8px rgba(0,0,0,.05)", fontSize:11, color:C.text3, fontWeight:500, fontFamily:"'DM Sans'", whiteSpace:"nowrap" }}>
        <span>Tap a step to edit</span>
        <span style={{ width:1, height:12, background:C.cardBorder }}/>
        <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
          <span style={{ width:16, height:16, borderRadius:"50%", background:"#fff", border:`1.5px dashed ${C.text4}`, color:C.text4, fontSize:11, fontWeight:600, display:"inline-flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>+</span>
          Click to add a block
        </span>
        <span style={{ width:1, height:12, background:C.cardBorder }}/>
        <span>Drag handle to connect · Drag canvas to pan</span>
      </div>

      <div style={{ position:"absolute", bottom:14, left:14, display:"flex", gap:6 }}>
        <button onClick={()=>setTransform({ x:30, y:30, scale:0.7 })} style={{ background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:10, padding:"6px 10px", display:"flex", alignItems:"center", gap:6, fontSize:11, fontFamily:"'DM Mono'", fontWeight:700, color:C.text2, cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,.04)" }}>{IC.fit(13)} Fit</button>
        <button onClick={onAutoLayout} style={{ background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:10, padding:"6px 10px", display:"flex", alignItems:"center", gap:6, fontSize:11, fontFamily:"'DM Mono'", fontWeight:700, color:C.text2, cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,.04)" }}>{IC.flow(13)} Auto layout</button>
      </div>

      <MiniMap nodes={nodes} transform={transform}/>
    </div>
  );
};

const MiniMap = ({ nodes, transform }) => {
  const mw = 164, mh = 100;
  if (!nodes || !nodes.length) {
    return (
      <div style={{ position:"absolute", bottom:14, right:14, width:mw+16, background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:10, padding:8, boxShadow:"0 4px 14px rgba(0,0,0,.05)" }}>
        <div style={{ fontSize:8, fontWeight:700, color:C.muted, letterSpacing:".1em", textTransform:"uppercase", marginBottom:5 }}>Mini-map</div>
        <div style={{ width:mw, height:mh, background:C.sectionBg, borderRadius:6 }}/>
      </div>
    );
  }
  const minX = Math.min(...nodes.map(n=>n.x)) - 40;
  const minY = Math.min(...nodes.map(n=>n.y)) - 40;
  const maxX = Math.max(...nodes.map(n=>n.x + NODE_W)) + 40;
  const maxY = Math.max(...nodes.map(n=>n.y + nodeH(n))) + 40;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const s = Math.min(mw / w, mh / h);
  const offX = (mw - w * s) / 2;
  const offY = (mh - h * s) / 2;
  return (
    <div style={{ position:"absolute", bottom:14, right:14, width:mw+16, background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:10, padding:8, boxShadow:"0 4px 14px rgba(0,0,0,.05)" }}>
      <div style={{ fontSize:8, fontWeight:700, color:C.muted, letterSpacing:".1em", textTransform:"uppercase", marginBottom:5 }}>Mini-map</div>
      <div style={{ position:"relative", width:mw, height:mh, background:C.sectionBg, borderRadius:6, overflow:"hidden" }}>
        {nodes.map(n=>{
          const t = NT[n.type];
          return <div key={n.id} style={{
            position:"absolute",
            left: offX + (n.x - minX) * s,
            top:  offY + (n.y - minY) * s,
            width: NODE_W * s,
            height: nodeH(n) * s,
            background:t.accent, borderRadius:1, opacity:.9,
          }}/>;
        })}
      </div>
    </div>
  );
};


/* ══════════════════════════════════════════════════════════════════════
   AUTOMATION BUILDER VIEW — exported component
   ══════════════════════════════════════════════════════════════════════ */

const AutomationBuilderView = ({ automation, onBack, onSave, onToggleStatus, activeTab, onTabChange, initialExecutionId }) => {
  const [toggleBusy, setToggleBusy] = useState(false);
  const handleToggleStatus = onToggleStatus ? async (next) => {
    if (toggleBusy) return;
    setToggleBusy(true);
    try { await onToggleStatus(next); } finally { setToggleBusy(false); }
  } : undefined;
  const [templates,       setTemplates]       = useState([]);
  const [teamMembers,     setTeamMembers]     = useState([]);
  const [tags,            setTags]            = useState([]);
  const [contactFields,   setContactFields]   = useState([]);
  const [otherAutomations, setOtherAutomations] = useState([]);
  const [whatsappAccounts, setWhatsappAccounts] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [loading,         setLoading]         = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [tpls, mems, tgs, cFields, flows, accs, usrs] = await Promise.all([
          api.templates.list(),
          Promise.resolve([]),            // team members removed (single-owner system)
          api.tags.list(),
          api.contactFields.list(),
          api.chatbots.list(),
          api.whatsappAccounts.list(true).catch(() => []),
          Promise.resolve([]),            // multi-user removed (single-owner system)
        ]);
        if (!alive) return;
        // Include APPROVED (sendable) and SUBMITTED (pending Meta review) so a
        // just-submitted template can be wired into an automation now and will
        // send once Meta approves it. The picker shows a status badge + a
        // "can not be sent until approved" note for non-approved ones.
        setTemplates((tpls || []).filter(t => {
          const s = String(t.status || "").toUpperCase();
          return s === "APPROVED" || s === "SUBMITTED";
        }));
        setTeamMembers(mems || []);
        setTags(tgs || []);
        setContactFields(cFields || []);
        setOtherAutomations((flows || []).filter(f => f.id !== automation?.id));
        setWhatsappAccounts(accs || []);
        setAssignableUsers((usrs || []).filter(u => u.isActive !== false && (u.role === 'bda_sales' || u.role === 'admin')));
      } catch (e) {
        console.error("AutomationBuilderView load error:", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [automation?.id]);

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [saving, setSaving] = useState(false);
  const savedSnapshotRef = useRef("");
  const [savedSnapshot, setSavedSnapshot] = useState("");

  const idRef = useRef(1);
  const computeNextId = useCallback((currentNodes) => {
    let max = 0;
    for (const n of currentNodes) {
      const num = parseInt(String(n.id).replace(/^\D+/, ""), 10);
      if (!isNaN(num) && num > max) max = num;
    }
    return max + 1;
  }, []);
  const newId = useCallback(() => {
    const v = idRef.current;
    idRef.current += 1;
    return "n" + v;
  }, []);

  useEffect(() => {
    const cfg = automation?.config || {};
    let initialNodes, initialEdges;
    if (cfg.nodes && cfg.nodes.length > 0) {
      initialNodes = cfg.nodes.map(n => ({ ...n, disabled: n.disabled === true }));
      initialEdges = cfg.edges || [];
      setNodes(initialNodes);
      setEdges(initialEdges);
      const next = computeNextId(cfg.nodes);
      idRef.current = next;
    } else {
      const t = defaultTriggerNode(0, 0);
      idRef.current = computeNextId([t]) + 1;
      initialNodes = [t];
      initialEdges = [];
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
    // Reset history with initial state
    setHistory([{ nodes: JSON.parse(JSON.stringify(initialNodes)), edges: JSON.parse(JSON.stringify(initialEdges)) }]);
    setHistoryIndex(0);
    // Reset saved snapshot to the loaded state — builder opens "clean"
    const initialSnap = JSON.stringify({ nodes: initialNodes, edges: initialEdges });
    savedSnapshotRef.current = initialSnap;
    setSavedSnapshot(initialSnap);
  }, [automation?.id]);

  const [selectedId, setSelectedId] = useState(null);
  const [transform,  setTransform]  = useState({ x:30, y:30, scale:0.7 });
  const [panning,    setPanning]    = useState(false);
  const [showPreview,setShowPreview]= useState(false);
  const [picker,     setPicker]     = useState(null);
  const [confirmOpen,setConfirmOpen]= useState(false);
  const [backConfirmOpen,setBackConfirmOpen]= useState(false);
  const [ghost,      setGhost]      = useState(null);

  // ── Undo / Redo history ──
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyLockRef = useRef(false);
  const dragStartStateRef = useRef(null);

  const pushHistory = useCallback((currentNodes, currentEdges) => {
    if (historyLockRef.current) return;
    setHistory(prev => {
      const next = prev.slice(0, historyIndex + 1);
      next.push({
        nodes: JSON.parse(JSON.stringify(currentNodes)),
        edges: JSON.parse(JSON.stringify(currentEdges)),
      });
      return next.slice(-50);
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    historyLockRef.current = true;
    const entry = history[historyIndex - 1];
    setNodes(entry.nodes);
    setEdges(entry.edges);
    setHistoryIndex(historyIndex - 1);
    requestAnimationFrame(() => { historyLockRef.current = false; });
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    historyLockRef.current = true;
    const entry = history[historyIndex + 1];
    setNodes(entry.nodes);
    setEdges(entry.edges);
    setHistoryIndex(historyIndex + 1);
    requestAnimationFrame(() => { historyLockRef.current = false; });
  }, [history, historyIndex]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const viewportRef   = useRef(null);
  const dragRef       = useRef(null);
  const connectRef    = useRef(null);
  const panRef        = useRef(null);
  const longPressRef  = useRef(null);

  const [selSet, setSelSet] = useState(new Set());
  const addSel = (id) => setSelSet(s => new Set([...Array.from(s), id]));
  const toggleSel = (id) => setSelSet(s => { const ns = new Set(s); if (ns.has(id)) ns.delete(id); else ns.add(id); return ns; });

  const transformRef = useRef(transform);
  useEffect(() => { transformRef.current = transform; }, [transform]);
  const selSetRef = useRef(selSet);
  useEffect(() => { selSetRef.current = selSet; }, [selSet]);

  const screenToWorld = (sx, sy) => {
    const t = transformRef.current;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: sx, y: sy };
    return { x: (sx - rect.left - t.x) / t.scale, y: (sy - rect.top - t.y) / t.scale };
  };

  const autoLayout = useCallback(() => {
    setNodes(prev => {
      const next = layoutTree(prev, edges);
      pushHistory(next, edges);
      return next;
    });
  }, [edges]);

  const updateNode = (id, patch) => {
    if (typeof patch === "function") {
      setNodes(prev => prev.map(n => n.id === id ? patch(n) : n));
    } else {
      setNodes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));
    }
  };

  const onSelectTemplate = (nodeId, templateId) => {
    const tpl = templates.find(t => String(t.id) === String(templateId));
    if (!tpl) return;
    updateNode(nodeId, { templateId, title: tpl.name, buttons: tpl.buttons || null });
    setEdges(prev => {
      const next = prev.filter(e => e.from !== nodeId || !e.fromHandle?.startsWith("btn:"));
      if (tpl.buttons && tpl.buttons.length > 0) {
        next.push(...tpl.buttons.map((_, i) => ({ from: nodeId, to: null, fromHandle: `btn:${i}` })));
      }
      pushHistory(nodes, next);
      return next;
    });
  };

  const removeNode = (id) => {
    setNodes(prev => {
      const nextNodes = prev.filter(n => n.id !== id);
      setEdges(prevEdges => {
        const nextEdges = prevEdges.filter(e => e.from !== id && e.to !== id);
        pushHistory(nextNodes, nextEdges);
        return nextEdges;
      });
      return nextNodes;
    });
    if (selectedId === id) setSelectedId(null);
    setSelSet(s => { const ns = new Set(s); ns.delete(id); return ns; });
  };

  const duplicateNode = (id) => {
    const src = nodes.find(n => n.id === id);
    if (!src) return;
    const nid = newId();
    const copy = { ...src, id: nid, x: src.x + 50, y: src.y + 50 };
    if (copy.actions) copy.actions = copy.actions.map(a => ({ ...a, id: "a" + Date.now() + Math.random() }));
    setNodes(prev => {
      const next = [...prev, copy];
      pushHistory(next, edges);
      return next;
    });
    setSelectedId(nid);
  };

  const toggleNodeDisable = (id) => {
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    const willDisable = !node.disabled;
    let nextEdges = edges;
    if (willDisable) {
      const inbound = edges.filter(e => e.to === id);
      const outbound = edges.filter(e => e.from === id);
      const bypass = [];
      for (const inEdge of inbound) {
        for (const outEdge of outbound) {
          bypass.push({ from: inEdge.from, to: outEdge.to, fromHandle: inEdge.fromHandle });
        }
      }
      nextEdges = [
        ...edges.filter(e => e.from !== id && e.to !== id),
        ...bypass,
      ];
      setEdges(nextEdges);
    }
    setNodes(prev => {
      const next = prev.map(n => n.id === id ? { ...n, disabled: willDisable } : n);
      pushHistory(next, nextEdges);
      return next;
    });
  };

  const onStartDrag = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!selSet.has(id)) setSelectedId(id);
    const node = nodes.find(n => n.id === id);
    const pos = screenToWorld(e.clientX, e.clientY);
    const dx = pos.x - node.x;
    const dy = pos.y - node.y;
    dragRef.current = { id, dx, dy, multi: e.metaKey || e.ctrlKey, shift: e.shiftKey };
    dragStartStateRef.current = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    if (e.metaKey || e.ctrlKey) { toggleSel(id); }
    else if (e.shiftKey) { if (!selSet.has(id)) addSel(id); }
    else { setSelSet(new Set([id])); }
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragUp);
  };

  const onDragMove = useCallback((e) => {
    const d = dragRef.current; if (!d) return;
    const pos = screenToWorld(e.clientX, e.clientY);
    const nx = pos.x - d.dx;
    const ny = pos.y - d.dy;
    const s = selSetRef.current;
    if (s.has(d.id) && s.size > 1) {
      setNodes(prev => prev.map(n => {
        if (!s.has(n.id)) return n;
        const src = prev.find(x => x.id === d.id);
        const diffX = nx - src.x, diffY = ny - src.y;
        return { ...n, x: n.x + diffX, y: n.y + diffY };
      }));
    } else {
      setNodes(prev => prev.map(n => n.id === d.id ? { ...n, x: nx, y: ny } : n));
    }
  }, []);

  const onDragUp = useCallback(() => {
    if (dragStartStateRef.current) {
      const startNodes = dragStartStateRef.current.nodes;
      const hasMoved = JSON.stringify(startNodes) !== JSON.stringify(nodes);
      if (hasMoved) pushHistory(nodes, edges);
      dragStartStateRef.current = null;
    }
    dragRef.current = null;
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragUp);
  }, [nodes, edges, pushHistory]);

  const onViewportMouseDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target.closest("[data-node-id]")) return;
    panRef.current = { x: e.clientX, y: e.clientY, ox: transform.x, oy: transform.y };
    setPanning(true);
    window.addEventListener("mousemove", onPanMove);
    window.addEventListener("mouseup", onPanUp);
  };
  const onPanMove = useCallback((e) => {
    const p = panRef.current; if (!p) return;
    setTransform(t => ({ ...t, x: p.ox + e.clientX - p.x, y: p.oy + e.clientY - p.y }));
  }, []);
  const onPanUp = useCallback(() => {
    panRef.current = null;
    setPanning(false);
    window.removeEventListener("mousemove", onPanMove);
    window.removeEventListener("mouseup", onPanUp);
  }, []);

  const onStartConnect = (e, fromId, fromHandle) => {
    e.stopPropagation();
    connectRef.current = { fromId, fromHandle };
    const from = nodes.find(n => n.id === fromId);
    const p = from ? handlePos(from, "output", fromHandle) : { x:0, y:0 };
    setGhost({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    window.addEventListener("mousemove", onConnectMove);
    window.addEventListener("mouseup", onConnectUp);
  };
  const onConnectMove = useCallback((e) => {
    const c = connectRef.current; if (!c) return;
    const pos = screenToWorld(e.clientX, e.clientY);
    setGhost(g => g ? { ...g, x2: pos.x, y2: pos.y } : null);
  }, []);
  const onConnectUp = useCallback((e) => {
    const c = connectRef.current; if (!c) return;
    connectRef.current = null;
    setGhost(null);
    window.removeEventListener("mousemove", onConnectMove);
    window.removeEventListener("mouseup", onConnectUp);
    const target = findDataAttr(e.target, "handle");
    if (target && target.dataset.handle === "input") {
      const toId = target.dataset.nodeId;
      if (toId && toId !== c.fromId) {
        setEdges(prev => {
          const handle = c.fromHandle || "default";
          const filtered = prev.filter(ed => !(ed.from === c.fromId && (ed.fromHandle || "default") === handle));
          const newEdge = { from: c.fromId, to: toId };
          if (c.fromHandle && c.fromHandle !== "default") newEdge.fromHandle = c.fromHandle;
          const next = [...filtered, newEdge];
          pushHistory(nodes, next);
          return next;
        });
      }
    }
  }, [nodes, pushHistory]);

  const onClickEdgePlus = (e, edgeIndex) => {
    e.stopPropagation();
    const edge = edges[edgeIndex]; if (!edge) return;
    setEdges(prev => prev.filter((_, i) => i !== edgeIndex));
    setPicker({ x: e.clientX, y: e.clientY, connectTo: edge.from, fromHandle: edge.fromHandle, mode: "insert" });
  };

  const onClickAppendPlus = (e, fromId, fromHandle) => {
    e.stopPropagation();
    setPicker({ x: e.clientX, y: e.clientY, connectTo: fromId, fromHandle, mode: "append" });
  };

  const onClickEdgeDelete = (e, edgeIndex) => {
    e.stopPropagation();
    setEdges(prev => {
      const next = prev.filter((_, i) => i !== edgeIndex);
      pushHistory(nodes, next);
      return next;
    });
  };

  const addNodeFromPicker = (tpl) => {
    const { x, y, connectTo, fromHandle } = picker;
    const nid = newId();
    const pos = screenToWorld(x + 60, y - 60);
    const newNode = makeNode(tpl.type, pos.x, pos.y, nid, templates);
    if (tpl.defaults) Object.assign(newNode, tpl.defaults);
    if (!newNode.title) newNode.title = tpl.name;
    if (!newNode.sub) newNode.sub = tpl.desc;
    if (newNode.actions && newNode.actions.length > 0) {
      newNode.actions = newNode.actions.map((a, idx) => ({ ...a, id: a.id || ("a" + Date.now() + idx) }));
    }
    const nextNodes = [...nodes, newNode];
    const nextEdges = connectTo ? [...edges, { from: connectTo, to: nid, fromHandle }] : edges;
    setNodes(nextNodes);
    if (connectTo) setEdges(nextEdges);
    pushHistory(nextNodes, nextEdges);
    setPicker(null);
    setSelectedId(nid);
  };

  const closePicker = () => setPicker(null);

  const onWheel = useCallback((e) => {
    if (!viewportRef.current || !viewportRef.current.contains(e.target)) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+scroll or trackpad pinch → zoom
      const ds = e.deltaY > 0 ? 0.92 : 1.08;
      setTransform(t => ({ ...t, scale: Math.min(2, Math.max(0.3, t.scale * ds)) }));
    } else {
      // Regular scroll → pan
      setTransform(t => ({ ...t, x: t.x - e.deltaX, y: t.y - e.deltaY }));
    }
  }, []);
  useEffect(() => {
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !e.target.closest("input,textarea,select")) {
        e.preventDefault();
        removeNode(selectedId);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && selectedId) {
        e.preventDefault();
        duplicateNode(selectedId);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !e.target.closest("input,textarea,select")) {
        e.preventDefault();
        setSelSet(new Set(nodes.map(n => n.id)));
      }
      if (e.key === "Escape") {
        setPicker(null);
        if (!e.target.closest("input,textarea,select")) setSelectedId(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, nodes, undo, redo]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onTS = (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        longPressRef.current = setTimeout(() => {
          const target = findDataAttr(document.elementFromPoint(t.clientX, t.clientY), "nodeId");
          if (target) setSelectedId(target.dataset.nodeId);
        }, 500);
      }
    };
    const onTE = () => { clearTimeout(longPressRef.current); };
    const onTM = () => { clearTimeout(longPressRef.current); };
    el.addEventListener("touchstart", onTS, { passive: true });
    el.addEventListener("touchend", onTE, { passive: true });
    el.addEventListener("touchmove", onTM, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTS);
      el.removeEventListener("touchend", onTE);
      el.removeEventListener("touchmove", onTM);
    };
  }, []);

  const openConfirm = () => setConfirmOpen(true);
  const closeConfirm = () => setConfirmOpen(false);
  const confirmDelete = () => { setConfirmOpen(false); removeNode(selectedId); };

  const selectedNode = nodes.find(n => n.id === selectedId) || null;

  const isDirty = useMemo(() => {
    return JSON.stringify({ nodes, edges }) !== savedSnapshot;
  }, [nodes, edges, savedSnapshot]);

  const handleSave = async () => {
    if (saving) return true;
    const snap = JSON.stringify({ nodes, edges });
    if (snap === savedSnapshotRef.current) return true; // nothing to save
    setSaving(true);
    try {
      await onSave({ config: { nodes, edges } });
      savedSnapshotRef.current = snap;
      setSavedSnapshot(snap);
      return true;
    } catch (err) {
      console.error('[builder] save failed:', err);
      alert('Failed to save: ' + (err?.message || 'unknown error'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Guard the Back button: if there are unsaved edits, ask before leaving so
  // the user can save or knowingly discard (reverts to the last saved version).
  const handleBack = () => {
    if (isDirty) { setBackConfirmOpen(true); return; }
    onBack();
  };
  const saveAndExit = async () => {
    const ok = await handleSave();
    if (ok) { setBackConfirmOpen(false); onBack(); }
  };
  const discardAndExit = () => { setBackConfirmOpen(false); onBack(); };

  if (loading) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:C.text5, fontFamily:"'DM Sans'" }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ width:40, height:40, borderRadius:"50%", border:`3px solid ${C.cardBorder}`, borderTopColor:C.brand, animation:"spin .8s linear infinite", margin:"0 auto 16px" }}/>
          <div style={{ fontSize:14, fontWeight:600 }}>Loading automation builder…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:C.pageBg, fontFamily:"'DM Sans', system-ui, sans-serif" }}>
      <BuilderToolbar
        automationName={automation?.name || "Untitled Automation"}
        status={automation?.status || "draft"}
        onBack={handleBack}
        onSave={handleSave}
        isDirty={isDirty}
        saving={saving}
        onToggleStatus={handleToggleStatus}
        toggleBusy={toggleBusy}
        onPreview={()=>setShowPreview(v=>!v)}
        showPreview={showPreview}
        activeTab={activeTab || 'editor'}
        onTabChange={onTabChange}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onZoomIn={() => setTransform(t => ({ ...t, scale: Math.min(2, t.scale * 1.2) }))}
        onZoomOut={() => setTransform(t => ({ ...t, scale: Math.max(0.3, t.scale / 1.2) }))}
        onFit={() => {
          if (!nodes.length || !viewportRef.current) return;
          const rect = viewportRef.current.getBoundingClientRect();
          const xs = nodes.map(n => n.x);
          const ys = nodes.map(n => n.y);
          const hs = nodes.map(n => nodeH(n));
          const minX = Math.min(...xs) - 40;
          const minY = Math.min(...ys) - 40;
          const maxX = Math.max(...xs.map((x, i) => x + NODE_W)) + 40;
          const maxY = Math.max(...ys.map((y, i) => y + hs[i])) + 40;
          const contentW = maxX - minX;
          const contentH = maxY - minY;
          const scale = Math.min(rect.width / contentW, rect.height / contentH, 1.0);
          setTransform({ x: 40 - minX * scale + (rect.width - contentW * scale) / 2, y: 30 - minY * scale + (rect.height - contentH * scale) / 2, scale: Math.max(0.3, scale * 0.9) });
        }}
        onAutoLayout={autoLayout}
      />

      {activeTab === 'executions' ? (
        <AutomationExecutions automation={automation} onBack={onBack} hideTopBar initialExecutionId={initialExecutionId} />
      ) : (
        <div style={{ display:"flex", flex:1, minHeight:0 }}>
          <BlockLibrary onAddBlock={(tpl, e) => {
            const nid = newId();
            // Place node at the center of the visible viewport
            const rect = viewportRef.current?.getBoundingClientRect();
            const t = transformRef.current;
            let pos;
            if (rect && t) {
              pos = { x: (rect.width / 2 - t.x) / t.scale, y: (rect.height / 2 - t.y) / t.scale };
            } else {
              pos = screenToWorld(e.clientX, e.clientY);
            }
            const n = makeNode(tpl.type, pos.x, pos.y, nid, templates);
            if (tpl.defaults) Object.assign(n, tpl.defaults);
            if (!n.title) n.title = tpl.name;
            if (!n.sub) n.sub = tpl.desc;
            if (n.actions && n.actions.length > 0) {
              n.actions = n.actions.map((a, idx) => ({ ...a, id: a.id || ("a" + Date.now() + idx) }));
            }
            setNodes(prev => {
              const next = [...prev, n];
              pushHistory(next, edges);
              return next;
            });
            setSelectedId(nid);
          }}/>

          <Canvas
            nodes={nodes} edges={edges} selectedId={selectedId}
            setSelectedId={setSelectedId} transform={transform} setTransform={setTransform}
            onStartDrag={onStartDrag} onStartConnect={onStartConnect}
            ghost={ghost} panning={panning}
            onClickEdgePlus={onClickEdgePlus} onClickAppendPlus={onClickAppendPlus}
            onClickEdgeDelete={onClickEdgeDelete}
            onDeleteNode={openConfirm} onDuplicateNode={duplicateNode}
            viewportRef={viewportRef} onViewportMouseDown={onViewportMouseDown}
            onAutoLayout={autoLayout}
            whatsappAccounts={whatsappAccounts}
          />

          {selectedNode && (
            <SettingsPanel
              node={selectedNode} nodes={nodes} edges={edges}
              onUpdateNode={updateNode}
              onDeleteNode={openConfirm}
              onDuplicateNode={duplicateNode}
              onSaveAndClose={() => { handleSave(); setSelectedId(null); }}
              onToggleDisable={toggleNodeDisable}
              onDeleteButton={(nid, bid)=>updateNode(nid, n => ({
                ...n, actions: (n.actions || []).filter(a => a.id !== bid)
              }))}
              onSelectTemplate={onSelectTemplate}
              templates={templates}
              teamMembers={teamMembers}
              tags={tags}
              contactFields={contactFields}
              otherAutomations={otherAutomations}
              whatsappAccounts={whatsappAccounts}
              assignableUsers={assignableUsers}
            />
          )}

          {showPreview && (
            <PhonePreview
              onClose={()=>setShowPreview(false)}
              nodes={nodes} edges={edges}
              templates={templates}
              teamMembers={teamMembers}
              otherAutomations={otherAutomations}
            />
          )}
        </div>
      )}

      {picker && (
        <div style={{ position:"fixed", inset:0, zIndex:60 }} onClick={closePicker}>
          <NodePicker x={picker.x} y={picker.y} onPick={addNodeFromPicker} onClose={closePicker} mode={picker.mode} groups={BLOCK_GROUPS}/>
        </div>
      )}

      {confirmOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.35)", zIndex:80, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={closeConfirm}>
          <div style={{ background:"#fff", borderRadius:12, padding:"24px", width:360, boxShadow:"0 20px 50px rgba(0,0,0,.2)" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text1, marginBottom:8 }}>Delete this block?</div>
            <div style={{ fontSize:13, color:C.text3, lineHeight:1.5, marginBottom:20 }}>
              "{selectedNode?.title || selectedNode?.sub || "this block"}" will be removed and any connected links will be deleted. This can not be undone.
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <Btn kind="ghost" onClick={closeConfirm}>Cancel</Btn>
              <Btn kind="danger" onClick={confirmDelete}>Delete block</Btn>
            </div>
          </div>
        </div>
      )}

      {backConfirmOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.35)", zIndex:80, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={()=>setBackConfirmOpen(false)}>
          <div style={{ background:"#fff", borderRadius:12, padding:"24px", width:400, boxShadow:"0 20px 50px rgba(0,0,0,.2)" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text1, marginBottom:8 }}>Unsaved changes</div>
            <div style={{ fontSize:13, color:C.text3, lineHeight:1.5, marginBottom:20 }}>
              You have unsaved changes to this automation. Save them, or go back without saving (this discards your edits and keeps the last saved version)?
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <Btn kind="ghost" onClick={()=>setBackConfirmOpen(false)}>Cancel</Btn>
              <Btn kind="ghost" onClick={discardAndExit}>Discard &amp; exit</Btn>
              <Btn kind="primary" onClick={saveAndExit}>{saving ? 'Saving…' : 'Save &amp; exit'}</Btn>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .picker-item:hover {
          background: #F8F7F2 !important;
          border-color: #E5E5E0 !important;
        }
        .picker-item:active {
          background: #F0EFEA !important;
        }
        .rename-input::placeholder {
          color: #AAA;
          font-style: italic;
        }
        .rename-input:focus {
          border-color: #1D9E75 !important;
          box-shadow: 0 0 0 3px #E1F5EE !important;
        }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #D5D5D0; border-radius: 99px; }
        ::-webkit-scrollbar-thumb:hover { background: #AAA; }
      `}</style>
    </div>
  );
};

export default AutomationBuilderView;
