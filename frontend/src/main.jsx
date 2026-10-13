import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { createRoot } from 'react-dom/client';

import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Check, CheckCircle2, ChevronDown, CircleDollarSign, Clock3, Database, Download, FileCheck2, Gauge, LayoutDashboard, LogOut, Play, Pause, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Users, Wifi, X, Zap } from 'lucide-react';

import './styles.css';



const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const DEMO_EMAIL = 'admin@pureinsights.demo';

const DEMO_PASSWORD = 'PureInsights#2026';

const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);

const number = n => new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(Number(n)||0);

const pct = n => `${number(n)}%`;



function App(){

 const [token,setToken] = useState(()=>sessionStorage.getItem('pi_token')||'');

 const [user,setUser] = useState(()=>{try{return JSON.parse(sessionStorage.getItem('pi_user')||'null')}catch{return null}});

 const [page,setPage] = useState('Overview');

 const [summary,setSummary] = useState(null); const [reports,setReports] = useState({items:[],total:0});

 const [alerts,setAlerts] = useState({items:[],total:0}); const [anomalies,setAnomalies] = useState({items:[],total:0,summary:[]});

 const [costs,setCosts] = useState({items:[],total:0}); const [recon,setRecon] = useState(null); const [telemetry,setTelemetry] = useState(null);

 const [loading,setLoading] = useState(false); const [error,setError] = useState(''); const [notice,setNotice] = useState('');

 const [search,setSearch] = useState(''); const [alertFilter,setAlertFilter] = useState('OPEN'); const [refreshKey,setRefreshKey] = useState(0);

 const [loginEmail,setLoginEmail] = useState(DEMO_EMAIL); const [loginPassword,setLoginPassword] = useState(DEMO_PASSWORD); const [loginBusy,setLoginBusy] = useState(false);

 const [injectLoad,setInjectLoad] = useState('55'); const [injectStatus,setInjectStatus] = useState('SUCCESS'); const [showInject,setShowInject] = useState(false);

 const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({ message: 'Invalid server response' }));
    if (!res.ok) {
      const message = data?.error?.message || data?.message ||
        (typeof data?.error === 'string' ? data.error : '') ||
        `Request failed (${res.status})`;
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    if (data && Array.isArray(data.data) && !Array.isArray(data.items)) data.items = data.data;
    return data;
  }, [token]);

 const load = useCallback(async()=>{if(!token)return;setLoading(true);setError('');try{

  const [s,r,a,d,c,cr,t] = await Promise.all([

   api('/api/health/summary'),api('/api/reports?page=1&page_size=100'),api(`/api/alerts?state=${alertFilter}&page=1&page_size=100`),api('/api/data-quality/anomalies?page=1&page_size=100'),api('/api/costs/attribution?page=1&page_size=100'),api('/api/costs/reconciliation'),api('/api/telemetry/status')

  ]);setSummary(s);setReports(r);setAlerts(a);setAnomalies(d);setCosts(c);setRecon(cr);setTelemetry(t);

 } catch (e) {
    setError(e.message || 'Unable to load dashboard data.');
    if (e.status === 401) logout();
  } finally {
    setLoading(false);
  }
 }, [token, api, alertFilter, refreshKey]);

 useEffect(()=>{if(token)load()},[token,load]);

 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),3200);return()=>clearTimeout(t)},[notice]);

 const logout=()=>{sessionStorage.removeItem('pi_token');sessionStorage.removeItem('pi_user');setToken('');setUser(null)};

 const login = async (e) => {
    e.preventDefault();
    setLoginBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error?.message || result?.message ||
          (typeof result?.error === 'string' ? result.error : '') || `Login failed (${response.status})`);
      }
      if (!result.token) throw new Error('Login response did not include a token.');
      sessionStorage.setItem('pi_token', result.token);
      sessionStorage.setItem('pi_user', JSON.stringify(result.user || {}));
      setToken(result.token);
      setUser(result.user || null);
      setNotice('Welcome to Pure Insights');
    } catch (error) {
      setError(`${error.message || 'Login failed'}. Check the backend and your demo credentials.`);
    } finally {
      setLoginBusy(false);
    }
  };

 const act=async(path,body)=>{try{await api(path,{method:'POST',body:JSON.stringify(body)});setNotice('Action completed');setRefreshKey(k=>k+1)}catch(e){setError(e.message)}};

 const ack=async(id)=>{try{await api(`/api/alerts/${encodeURIComponent(id)}/ack`,{method:'POST',body:'{}'});setNotice(`Alert ${id} acknowledged`);setRefreshKey(k=>k+1)}catch(e){setError(e.message)}};

 const visibleReports=useMemo(()=>{const q=search.toLowerCase();return (reports.items||[]).filter(r=>!q||`${r.report_name} ${r.report_id} ${r.owner_email||''}`.toLowerCase().includes(q))},[reports,search]);

 const visibleAlerts=useMemo(()=>alerts.items||[],[alerts]);

 const exportCsv=()=>{const rows=visibleReports;const cols=['report_id','report_name','owner_status','latest_refresh_status','avg_load_time_sec','latency_breaches','total_views','aws_cost_usd'];const csv=[cols.join(','),...rows.map(r=>cols.map(k=>JSON.stringify(r[k]??'')).join(','))].join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='pure-insights-reports.csv';a.click();URL.revokeObjectURL(url)};

 if(!token)return <Login email={loginEmail} setEmail={setLoginEmail} password={loginPassword} setPassword={setLoginPassword} busy={loginBusy} error={error} onSubmit={login}/>;

 const nav=[['Overview',LayoutDashboard],['Live alerts',Bell],['Reports',Activity],['Data quality',ShieldCheck],['Cost attribution',CircleDollarSign]];

 return <div className="app-shell">

  <aside className="sidebar"><div className="brand"><div className="brand-mark"><Sparkles size={20}/></div><div><div className="brand-name">pure insights</div><div className="brand-sub">COMMAND CENTER</div></div></div>

   <div className="workspace-label">WORKSPACE</div><div className="workspace"><div className="workspace-icon">PI</div><div className="workspace-copy"><b>Monetization</b><span>Deal Strategy</span></div><ChevronDown size={15}/></div>

   <div className="nav-label">MONITOR</div><nav>{nav.map(([label,Icon])=><button key={label} onClick={()=>setPage(label)} className={`nav-item ${page===label?'active':''}`}><Icon size={17}/><span>{label}</span>{label==='Live alerts'&&summary?.refresh?.problem_records>0&&<i className="nav-count">{Math.min(summary.refresh.problem_records,99)}</i>}</button>)}</nav>

   <div className="sidebar-bottom"><div className="source-card"><div className="source-heading"><Database size={15}/><span>Data connection</span></div><div className="source-status"><span className="status-dot"/>Hybrid data</div><p>Snowflake costs · CSV monitoring</p></div><div className="profile"><div className="avatar">{(user?.name||'A').split(' ').map(x=>x[0]).join('').slice(0,2)}</div><div className="profile-copy"><b>{user?.name||'Demo user'}</b><span>{user?.role||'analyst'}</span></div><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={16}/></button></div></div>

  </aside>

  <main className="main"><header className="topbar"><div className="crumb">Workspace <span>/</span> <b>{page}</b></div><div className="top-actions"><span className="live-indicator"><span className="pulse-dot"/> SYSTEM OPERATIONAL</span><button className="icon-button" title="Refresh data" onClick={()=>setRefreshKey(k=>k+1)}><RefreshCw size={17}/></button><div className="top-avatar">{(user?.name||'A')[0]}</div></div></header>

   <div className="page-content"><div className="page-heading"><div><div className="eyebrow">MONETIZATION INTELLIGENCE</div><h1>{page==='Overview'?'Command center':page}</h1><p>{page==='Overview'?'Monitor report health, validate metrics, and catch anomalies before they affect decisions.':page==='Live alerts'?'Review, acknowledge, and investigate real-time telemetry alerts.':page==='Reports'?'Explore report performance and ownership with source-backed metrics.':page==='Data quality'?'Inspect source-data issues and prioritize data-quality exceptions.':'Reconcile attributed warehouse usage and report-level costs.'}</p></div><div className="heading-actions"><span className="data-badge"><span className="status-dot"/> API DATA</span><button className="btn btn-secondary" onClick={()=>setRefreshKey(k=>k+1)}><RefreshCw size={15}/> Refresh</button></div></div>

   {error&&<div className="alert-banner error-banner"><AlertTriangle size={17}/><span>{error}</span><button onClick={()=>setError('')}><X size={16}/></button></div>}

   {notice&&<div className="alert-banner success-banner"><CheckCircle2 size={17}/>{notice}<button onClick={()=>setNotice('')}><X size={16}/></button></div>}

   {loading&&!summary?<div className="loading-card"><div className="spinner"/> Loading analytics from API…</div>:<>

   {page==='Overview'&&<Overview summary={summary} alerts={alerts} reports={reports} recon={recon} telemetry={telemetry} setPage={setPage} onAck={ack} onControl={act} onInject={()=>setShowInject(true)} loading={loading}/>}

   {page==='Live alerts'&&<AlertsPage alerts={visibleAlerts} filter={alertFilter} setFilter={setAlertFilter} onAck={ack} onInject={()=>setShowInject(true)} user={user}/>}

   {page==='Reports'&&<ReportsPage reports={visibleReports} search={search} setSearch={setSearch} onExport={exportCsv}/>}

   {page==='Data quality'&&<QualityPage anomalies={anomalies}/>}

   {page==='Cost attribution'&&<CostsPage costs={costs} recon={recon} summary={summary}/>}

   </>}

   <footer className="footer"><span>PURE INSIGHTS <span className="footer-sep">·</span> VALIDATION WORKSPACE</span><span>API <b className={error?'text-danger':'text-green'}>{error?'Needs attention':'Connected'}</b> <span className="footer-sep">·</span> {new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></footer>

   </div>

  </main>

  {showInject&&<div className="modal-backdrop" onClick={()=>setShowInject(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">VALIDATION TOOL</div><h2>Inject a test event</h2></div><button className="icon-button" onClick={()=>setShowInject(false)}><X size={18}/></button></div><p className="muted">Send a synthetic monitoring reading through the same alert rules. This is a demo-only test action.</p><label>Average load time (seconds)<input value={injectLoad} type="number" min="0" max="999" onChange={e=>setInjectLoad(e.target.value)}/></label><label>Refresh status<select value={injectStatus} onChange={e=>setInjectStatus(e.target.value)}>{['SUCCESS','FAILED','TIMED_OUT','UNKNOWN'].map(s=><option key={s}>{s}</option>)}</select></label><div className="modal-actions"><button className="btn btn-secondary" onClick={()=>setShowInject(false)}>Cancel</button><button className="btn btn-primary" onClick={async()=>{await act('/api/telemetry/inject',{report_id:'DEMO-INJECTED',report_name:'Synthetic validation event',avg_load_time_sec:Number(injectLoad),last_refresh_status:injectStatus,source:'injected'});setShowInject(false)}}><Zap size={15}/> Send test event</button></div></div></div>}

 </div>

}

function Login({email,setEmail,password,setPassword,busy,error,onSubmit}){return <div className="login-page"><div className="login-orb orb-one"/><div className="login-orb orb-two"/><div className="login-panel"><div className="brand login-brand"><div className="brand-mark"><Sparkles size={20}/></div><div><div className="brand-name">pure insights</div><div className="brand-sub">COMMAND CENTER</div></div></div><div className="login-kicker"><span className="pulse-dot"/> MONETIZATION INTELLIGENCE</div><h1>Clarity behind<br/><span>every decision.</span></h1><p className="login-description">A validation workspace for report health, data quality, real-time alerts, and cost attribution.</p><form onSubmit={onSubmit} className="login-form"><label>Work email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="username"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label>{error&&<div className="login-error"><AlertTriangle size={15}/>{error}</div>}<button className="btn btn-primary login-submit" disabled={busy}>{busy?'Signing in…':'Enter workspace'} <ArrowUpRight size={17}/></button></form><div className="demo-credentials"><div><ShieldCheck size={16}/><span>Demo credentials prefilled</span></div><span>Admin · Local sample data</span></div><div className="login-foot">SECURE SESSION <span>•</span> HUMAN-IN-THE-LOOP VALIDATION</div></div><div className="login-side"><div className="side-graphic"><div className="graphic-ring ring-a"/><div className="graphic-ring ring-b"/><div className="graphic-core"><Activity size={36}/></div><div className="float-card float-top"><span className="float-icon green"><CheckCircle2 size={15}/></span><div><b>Metrics reconciled</b><small>Source data aligned</small></div></div><div className="float-card float-bottom"><span className="float-icon amber"><AlertTriangle size={15}/></span><div><b>Review required</b><small>Exception detected</small></div></div></div><div className="side-caption"><b>Trust the numbers.</b><span>Verify the signal. Explain the why.</span></div></div></div>}

function StatCard({label,value,sub,icon:Icon,tone='blue',trend}){return <div className="stat-card"><div className="stat-top"><span>{label}</span><div className={`stat-icon ${tone}`}><Icon size={18}/></div></div><div className="stat-value">{value??'—'}</div><div className="stat-sub">{trend&&<span className="trend"><ArrowUpRight size={13}/></span>}{sub}</div></div>}

function Panel({title,subtitle,action,children,className=''}){return <section className={`panel ${className}`}><div className="panel-head"><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>{children}</section>}

function Status({value}){const v=String(value||'UNKNOWN').toUpperCase();const cls=['SUCCESS','ASSIGNED','RESOLVED','OK'].includes(v)?'good':['FAILED','TIMED_OUT','CRITICAL','ORPHANED','HIGH'].includes(v)?'bad':['WARNING','UNKNOWN','MEDIUM','ACKNOWLEDGED'].includes(v)?'warn':'neutral';return <span className={`status-pill ${cls}`}><i/>{v.replaceAll('_',' ')}</span>}

function Overview({summary:s,alerts,reports,recon,telemetry,setPage,onAck,onControl,onInject,loading}){if(!s)return <div className="loading-card">Waiting for summary data…</div>;const top=(reports.items||[]).slice(0,5);const active=(alerts.items||[]).slice(0,5);const max=Math.max(s.latency?.warning_records||0,s.latency?.critical_records||0,1);return <>

 <div className="stat-grid"><StatCard label="Monitored reports" value={number(s.records?.unique_reports)} sub={`${number(s.records?.total)} source snapshots`} icon={LayoutDashboard} tone="blue"/><StatCard label="Latency breach rate" value={pct(s.latency?.breach_rate_pct)} sub={`Threshold > ${s.latency?.warning_threshold_sec}s`} icon={Gauge} tone="amber"/><StatCard label="Refresh problems" value={number(s.refresh?.problem_records)} sub={`${pct(s.refresh?.problem_rate_pct)} of records`} icon={RefreshCw} tone="red"/><StatCard label="Data quality issues" value={number(s.data_quality?.issues_total)} sub={`${number(s.data_quality?.records_with_issues)} records flagged`} icon={ShieldCheck} tone="purple"/></div>

 <div className="overview-grid"><Panel title="Report performance" subtitle="Latency distribution across source snapshots" action={<button className="text-action" onClick={()=>setPage('Reports')}>View reports <ArrowUpRight size={14}/></button>}><div className="chart-summary"><div><span className="legend-dot amber-dot"/> Warning <b>{number(s.latency?.warning_records)}</b></div><div><span className="legend-dot red-dot"/> Critical <b>{number(s.latency?.critical_records)}</b></div><div className="chart-metric"><span>Average load</span><b>{number(s.latency?.avg_sec)}s</b></div></div><div className="bar-chart">{[{label:'Warning',value:s.latency?.warning_records||0,color:'amber'},{label:'Critical',value:s.latency?.critical_records||0,color:'red'}].map(x=><div className="bar-row" key={x.label}><span>{x.label}</span><div className="bar-track"><div className={`bar-fill ${x.color}`} style={{width:`${Math.max(2,x.value/max*100)}%`}}/></div><b>{number(x.value)}</b></div>)}</div><div className="chart-foot"><span>P50 <b>{number(s.latency?.p50_sec)}s</b></span><span>P95 <b>{number(s.latency?.p95_sec)}s</b></span><span>Max <b>{number(s.latency?.max_sec)}s</b></span></div></Panel>

 <Panel title="Telemetry stream" subtitle="Replay control & event processing" action={<span className={`live-tag ${telemetry?.running?'':'paused'}`}><span className="pulse-dot"/>{telemetry?.running?'LIVE':'PAUSED'}</span>}><div className="telemetry-stats"><div><span>Events processed</span><b>{number(telemetry?.counters?.events)}</b></div><div><span>Alerts created</span><b>{number(telemetry?.counters?.alerts_created)}</b></div><div><span>Resolved</span><b>{number(telemetry?.counters?.alerts_resolved)}</b></div></div><div className="telemetry-progress"><div style={{width:`${Math.min(100,((telemetry?.cursor||0)/Math.max(1,telemetry?.total_records||1))*100)}%`}}/></div><div className="telemetry-meta"><span>Reading {number(telemetry?.cursor)} of {number(telemetry?.total_records)}</span><span>{number(telemetry?.speed||1)}× speed</span></div><div className="telemetry-controls"><button className="btn btn-secondary" onClick={()=>onControl('/api/telemetry/control',{action:telemetry?.running?'pause':'resume'})}>{telemetry?.running?<Pause size={14}/>:<Play size={14}/>} {telemetry?.running?'Pause stream':'Resume stream'}</button><button className="btn btn-quiet" onClick={onInject}><Zap size={14}/> Test event</button></div></Panel></div>

 <div className="overview-grid lower-grid"><Panel title="Active alerts" subtitle="Latest open items requiring attention" action={<button className="text-action" onClick={()=>setPage('Live alerts')}>All alerts <ArrowUpRight size={14}/></button>}>{active.length?<div className="alert-list">{active.map(a=><div className="alert-row" key={a.id}><div className={`alert-symbol ${a.severity==='CRITICAL'?'critical':'warning'}`}><AlertTriangle size={16}/></div><div className="alert-copy"><b>{a.report_name||a.report_id}</b><span>{a.message||`${a.rule} threshold breached`}</span><small>{a.id} · {a.occurrences||1} occurrence(s)</small></div><div className="alert-row-end"><Status value={a.severity}/>{a.state==='OPEN'&&<button className="mini-action" onClick={()=>onAck(a.id)} title="Acknowledge"><Check size={15}/></button>}</div></div>)}</div>:<Empty icon={CheckCircle2} title="No alerts in this filter" detail="The stream may be paused or all alerts resolved."/>}</Panel>

 <Panel title="Cost reconciliation" subtitle="Allocated usage vs. source totals" action={<button className="text-action" onClick={()=>setPage('Cost attribution')}>Details <ArrowUpRight size={14}/></button>}><div className="cost-big"><div><span>Attributed Snowflake cost</span><b>{money(s.cost?.snowflake_cost_usd)}</b></div><div className="cost-icon"><CircleDollarSign size={22}/></div></div><div className="recon-list"><div><span>Attributed credits</span><b>{number(recon?.attributed_credits??s.cost?.attributed_credits)}</b></div><div><span>Reports checked</span><b>{number(recon?.validation?.reports_checked)}</b></div><div><span>Outside tolerance</span><b className={recon?.validation?.reports_outside_tolerance>0?'text-danger':'text-green'}>{number(recon?.validation?.reports_outside_tolerance)}</b></div></div><div className="validation-note"><FileCheck2 size={15}/><span>{recon?.validation?.reports_outside_tolerance===0?'Reconciliation checks passed.':'Reconciliation exceptions need review.'}</span></div></Panel></div>

 <div className="disclaimer"><Database size={15}/><span><b>Data source: hybrid.</b> Cost attribution and reconciliation use Snowflake; report monitoring and telemetry use local CSV/demo data.</span></div>

 </>}

function AlertsPage({alerts,filter,setFilter,onAck,onInject,user}){return <><div className="filter-toolbar"><div className="filter-tabs">{['OPEN','ACKNOWLEDGED','RESOLVED'].map(x=><button key={x} className={filter===x?'selected':''} onClick={()=>setFilter(x)}>{x.replace('_',' ')}</button>)}</div><button className="btn btn-primary" onClick={onInject}><Zap size={15}/> Inject test event</button></div><Panel title={`${filter[0]+filter.slice(1).toLowerCase()} alerts`} subtitle="Alerts are deduplicated by report and rule; repeated breaches increment the occurrence count."><div className="table-wrap"><table><thead><tr><th>Alert / report</th><th>Rule</th><th>Severity</th><th>Occurrences</th><th>Last seen</th><th>State</th><th>Action</th></tr></thead><tbody>{alerts.map(a=><tr key={a.id}><td><div className="cell-primary">{a.report_name||a.report_id}</div><div className="cell-secondary">{a.id} · {a.message||''}</div></td><td>{a.rule}</td><td><Status value={a.severity}/></td><td>{number(a.occurrences)}</td><td>{a.last_seen?new Date(a.last_seen).toLocaleString(): '—'}</td><td><Status value={a.state}/></td><td>{a.state==='OPEN'&&user?.role==='admin'?<button className="mini-action wide" onClick={()=>onAck(a.id)}><Check size={14}/> Ack</button>:<span className="muted">—</span>}</td></tr>)}</tbody></table>{!alerts.length&&<Empty icon={Bell} title={`No ${filter.toLowerCase()} alerts`} detail="Try another state or inject a test event to validate the alert pipeline."/>}</div></Panel><div className="rule-grid"><div className="rule-card"><div className="rule-icon amber"><Clock3 size={18}/></div><div><b>Latency warning</b><span>Average load time exceeds 15 seconds.</span></div><Status value="WARNING"/></div><div className="rule-card"><div className="rule-icon red"><AlertTriangle size={18}/></div><div><b>Critical latency / refresh</b><span>Load time exceeds 30 seconds, or refresh fails / times out.</span></div><Status value="CRITICAL"/></div></div></>}

function ReportsPage({reports,search,setSearch,onExport}){return <><div className="toolbar"><div className="searchbox"><Search size={16}/><input placeholder="Search reports, IDs, owners…" value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="btn btn-secondary" onClick={onExport}><Download size={15}/> Export CSV</button></div><Panel title="Report inventory" subtitle={`${reports.length} reports in current result set`}><div className="table-wrap"><table><thead><tr><th>Report</th><th>Owner status</th><th>Latest refresh</th><th>Avg. load</th><th>Latency breaches</th><th>Total views</th><th>AWS cost</th></tr></thead><tbody>{reports.map(r=><tr key={r.report_id}><td><div className="report-cell"><div className="report-mini"><Activity size={16}/></div><div><div className="cell-primary">{r.report_name}</div><div className="cell-secondary">{r.report_id}</div></div></div></td><td><Status value={r.owner_status}/></td><td><Status value={r.latest_refresh_status}/></td><td><b>{number(r.avg_load_time_sec)}s</b></td><td><span className={r.latency_breaches?'text-danger':'text-green'}>{number(r.latency_breaches)}</span></td><td>{number(r.total_views)}</td><td>{money(r.aws_cost_usd)}</td></tr>)}</tbody></table>{!reports.length&&<Empty icon={Search} title="No reports match" detail="Try a different report name or ID."/>}</div></Panel><div className="disclaimer"><ShieldCheck size={15}/><span>Use these rollups to investigate anomalies. Verify any important metric against the source snapshots before making a business decision.</span></div></>}

function QualityPage({anomalies}){const items=anomalies.items||[];const counts=(anomalies.summary||[]).slice(0,6);return <><div className="stat-grid quality-stats"><StatCard label="Issues in result set" value={number(anomalies.total)} sub="Source data exceptions" icon={AlertTriangle} tone="red"/><StatCard label="Issue categories" value={number(new Set(items.map(i=>i.issue_type)).size)} sub="Distinct detected patterns" icon={SlidersHorizontal} tone="purple"/><StatCard label="High severity" value={number(items.filter(i=>i.severity==='HIGH').length)} sub="Prioritize for review" icon={ShieldCheck} tone="amber"/><StatCard label="Rows inspected" value={number(items.length)} sub="Current page" icon={Database} tone="blue"/></div><div className="overview-grid"><Panel title="Issue breakdown" subtitle="Counts grouped by issue type and severity">{counts.length?<div className="breakdown-list">{counts.map((c,i)=><div className="breakdown-row" key={`${c.issue_type}-${c.severity}`}><div className="breakdown-index">{String(i+1).padStart(2,'0')}</div><div className="breakdown-copy"><b>{String(c.issue_type).replaceAll('_',' ')}</b><span><Status value={c.severity}/></span></div><b className="breakdown-count">{number(c.count)}</b></div>)}</div>:<Empty icon={CheckCircle2} title="No issue breakdown available" detail="The API returned no grouped issue counts."/>}</Panel><Panel title="Validation principles" subtitle="Human review checklist"><div className="principles">{[['Traceability','Every exception should link back to a report and source row.'],['Reproducibility','Re-run the SQL or data-quality check before closing an issue.'],['Business impact','Prioritize errors that could change a commercial recommendation.'],['Human review','Flag ambiguous or unsupported AI-generated claims for review.']].map(([a,b])=><div className="principle" key={a}><div className="principle-check"><Check size={14}/></div><div><b>{a}</b><span>{b}</span></div></div>)}</div></Panel></div><Panel title="Data-quality exceptions" subtitle="Source row issues returned by the validation API"><div className="table-wrap"><table><thead><tr><th>Issue type</th><th>Report</th><th>Severity</th><th>Source row</th><th>Details</th></tr></thead><tbody>{items.slice(0,50).map((x,i)=><tr key={`${x.report_id}-${x.src_row_num}-${i}`}><td><span className="cell-primary">{String(x.issue_type||'UNKNOWN').replaceAll('_',' ')}</span></td><td>{x.report_name||x.report_id||'—'}</td><td><Status value={x.severity}/></td><td>{x.src_row_num??'—'}</td><td className="truncate-cell">{x.description||x.details||x.issue_detail||'Review source record and validation rule.'}</td></tr>)}</tbody></table>{!items.length&&<Empty icon={FileCheck2} title="No exceptions returned" detail="The data-quality API returned an empty result set."/>}</div></Panel></>}

function CostsPage({costs,recon,summary}){const items=costs.items||[];const top=items.slice(0,10);const max=Math.max(...top.map(x=>Number(x.total_cost_usd)||0),1);return <><div className="stat-grid"><StatCard label="Snowflake attributed cost" value={money(summary?.cost?.snowflake_cost_usd)} sub="Estimated from attributed credits" icon={Database} tone="blue"/><StatCard label="AWS hosting cost" value={money(summary?.cost?.aws_cost_usd)} sub="Source snapshot total" icon={CircleDollarSign} tone="purple"/><StatCard label="Attributed credits" value={number(recon?.attributed_credits??summary?.cost?.attributed_credits)} sub={`Credit price ${money(summary?.cost?.credit_price_usd)} / credit`} icon={Gauge} tone="amber"/><StatCard label="Reports outside tolerance" value={number(recon?.validation?.reports_outside_tolerance)} sub={`Tolerance ${recon?.validation?.tolerance_credits??0.05} credits`} icon={FileCheck2} tone={recon?.validation?.reports_outside_tolerance?'red':'green'}/></div><div className="overview-grid"><Panel title="Highest attributed cost" subtitle="Top reports by total cost"><div className="cost-rank-list">{top.map((r,i)=><div className="cost-rank-row" key={r.report_id}><div className="rank-number">{String(i+1).padStart(2,'0')}</div><div className="rank-main"><div className="rank-label"><b>{r.report_name||r.report_id}</b><span>{money(r.total_cost_usd)}</span></div><div className="rank-track"><div style={{width:`${(Number(r.total_cost_usd)||0)/max*100}%`}}/></div></div></div>)}</div></Panel><Panel title="Reconciliation result" subtitle="Source credits compared with allocated credits"><div className="recon-hero"><div className={`recon-check ${recon?.validation?.reports_outside_tolerance===0?'ok':'review'}`}>{recon?.validation?.reports_outside_tolerance===0?<CheckCircle2 size={26}/>:<AlertTriangle size={26}/>}</div><h2>{recon?.validation?.reports_outside_tolerance===0?'Checks passed':'Review required'}</h2><p>{number(recon?.validation?.reports_checked)} reports checked against source usage.</p></div><div className="recon-list"><div><span>Maximum absolute difference</span><b>{number(recon?.validation?.max_abs_diff_credits)} credits</b></div><div><span>Tolerance</span><b>{number(recon?.validation?.tolerance_credits)} credits</b></div><div><span>Data source</span><b>Snowflake</b></div></div><div className="validation-note"><AlertTriangle size={15}/><span>Credit reconciliation and attribution values are queried from Snowflake; monitoring data remains demo-backed.</span></div></Panel></div><Panel title="Cost allocation table" subtitle={`${items.length} report-level cost records returned`}><div className="table-wrap"><table><thead><tr><th>Rank</th><th>Report</th><th>Credits</th><th>Snowflake cost</th><th>AWS cost</th><th>Total cost</th><th>Cost / view</th><th>Active views</th></tr></thead><tbody>{items.map((r,i)=><tr key={r.report_id}><td>#{r.cost_per_view_rank??i+1}</td><td><div className="cell-primary">{r.report_name||r.report_id}</div><div className="cell-secondary">{r.report_id}</div></td><td>{number(r.attributed_credits)}</td><td>{money(r.snowflake_cost_usd)}</td><td>{money(r.aws_cost_usd)}</td><td><b>{money(r.total_cost_usd)}</b></td><td>{money(r.total_cost_per_view_usd)}</td><td>{number(r.active_views)}</td></tr>)}</tbody></table>{!items.length&&<Empty icon={CircleDollarSign} title="No cost rows returned" detail="Check that the cost-attribution SQL and input data are available."/>}</div></Panel></>}

function Empty({icon:Icon,title,detail}){return <div className="empty-state"><div><Icon size={21}/></div><b>{title}</b><span>{detail}</span></div>}



createRoot(document.getElementById('root')).render(<App/>);
