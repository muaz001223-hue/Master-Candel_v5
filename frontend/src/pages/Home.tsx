import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import CountryFlags from "@/components/terminal/CountryFlags";
import TradingChart from "@/components/terminal/TradingChart";
import Brand from "@/components/terminal/Brand";
import MarketRail from "@/components/terminal/MarketRail";
import AgentRegistry from "@/components/terminal/AgentRegistry";
import { MobileNavigation } from '@/components/terminal/MobileNavigation';
import { getMarket } from "@/lib/markets";
import { analyzePair, useBackendEvents, useLatestAnalysis, useRuntime } from '@/hooks/useMarketBackend';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  BrainCircuit,
  ChevronDown,
  CircleHelp,
  Clock3,
  DatabaseZap,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeft,
  PanelRightClose,
  PanelRight,
  Radio,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Terminal,
  TrendingDown,
  TrendingUp,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";

type MonitorModule = {
  id: string;
  name: string;
  description: string;
  state: string;
  status: "LIVE" | "IDLE" | "WARN" | "ERROR";
  icon: LucideIcon;
  metrics: string[];
};

interface SignalPreview {
  pairId: string;
  pair: string;
  duration: "1 Minute";
  time: string;
  direction: "CALL" | "PUT";
  sequence: number;
}

const monitorModules: MonitorModule[] = [
  {
    id: "main-server",
    name: "Main Server Core",
    description: "API endpoints · health checks · orchestration",
    state: "RUNNING",
    status: "LIVE",
    icon: DatabaseZap,
    metrics: ["Uptime 99.98%", "CPU 18%", "RAM 1.2 GB"],
  },
  {
    id: "provider-bridge",
    name: "LiveProviderBridge",
    description: "Deriv WS feed · normalized price ticks",
    state: "DATA_RECEIVING",
    status: "LIVE",
    icon: Radio,
    metrics: ["42 ticks/s", "28 ms latency", "7 symbols"],
  },
  {
    id: "websocket-relay",
    name: "DashboardRelay / WS",
    description: "Terminal sockets · candle broadcast relay",
    state: "CONNECTED",
    status: "LIVE",
    icon: Wifi,
    metrics: ["1 client", "0 ms buffer", "1.8k candles"],
  },
  {
    id: "tick-pipeline",
    name: "LiveTickPipeline",
    description: "Cleanses · normalizes · packages tick streams",
    state: "NOT WIRED",
    status: "WARN",
    icon: GitBranch,
    metrics: ["Input —", "Output 0", "Not wired"],
  },
  {
    id: "data-quality",
    name: "DataQuality Engine",
    description: "Sanity checks · spikes · timestamp ordering",
    state: "WAITING",
    status: "IDLE",
    icon: ShieldCheck,
    metrics: ["Score —", "Pending", "No input"],
  },
  {
    id: "agent-orchestrator",
    name: "Agent Orchestrator",
    description: "Autonomous agents · rule evaluation evidence",
    state: "IDLE",
    status: "IDLE",
    icon: Bot,
    metrics: ["Active 0", "Evidence 0", "Awaiting"],
  },
  {
    id: "binary-signal",
    name: "BinarySignalEngine",
    description: "Signal gates · evidence · decision output",
    state: "NO_SIGNAL",
    status: "IDLE",
    icon: BrainCircuit,
    metrics: ["Edge —", "Votes 0", "Gate held"],
  },
  {
    id: "risk-validation",
    name: "Risk & Validation",
    description: "Exposure limits · backtest · drawdown guard",
    state: "NOT VALIDATED",
    status: "IDLE",
    icon: Gauge,
    metrics: ["Risk cap 2%", "Samples 0", "Blocked"],
  },
];

export default function Home() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [activePairId, setActivePairId] = useState(() => getMarket(params.get("pair") || 'eur-usd-regular').id);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [systemOnline, setSystemOnline] = useState(true);
  const [signal, setSignal] = useState<"NO_SIGNAL" | "CALL" | "PUT">("NO_SIGNAL");
  const [signalPreview, setSignalPreview] = useState<SignalPreview | null>(null);
  const previewSequence = useRef(0);
  const [logFilter, setLogFilter] = useState("ALL");
  const [mobilePanel, setMobilePanel] = useState("chart");
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const activePair = getMarket(activePairId);
  const [timeframe, setTimeframe] = useState('1m');
  const [signalReason, setSignalReason] = useState('Waiting for analysis');
  const [analyzing, setAnalyzing] = useState(false);
  const requestId = useRef(0);
  const runtime = useRuntime(systemOnline);
  const analysis = useLatestAnalysis(activePair, timeframe);
  const events = useBackendEvents();
  useEffect(() => { requestId.current += 1; setAnalyzing(false); }, [activePairId, timeframe]);
  useEffect(() => { setTimeframe('1m'); }, [activePairId]);
  useEffect(() => { setSignalPreview(null); setSignal('NO_SIGNAL'); setSignalReason(analysis.data?.signal.reason.replaceAll('_', ' ') || 'Waiting for analysis'); }, [activePairId, analysis.data]);
  const runAction = async (label: string) => {
    const started = performance.now();
    const result = await runtime.refetch();
    const elapsed = Math.round(performance.now() - started);
    if (result.isError) { toast.error('Backend connection unavailable'); return; }
    const data = result.data;
    const errors = [data?.analysisError, ...data?.providers.map(p => p.error) || []].filter(Boolean);
    toast(label.includes('latency') ? `API response · ${elapsed} ms` : label.includes('error') ? 'Connection diagnostics' : 'Data refreshed', { description: label.includes('error') ? errors.join(' · ') || 'No current connection errors.' : `${data?.database} · ${data?.analysisCycles} analysis cycles · ${data?.agents.active} active agents` });
  };
  const actualLogs = events.data?.items.map(row => ({ ...row, time: row.time.slice(11, 23) })) || [];
  const filteredLogs = logFilter === "ALL" ? actualLogs : actualLogs.filter((row) => row.level === logFilter);
  const generateSignalPreview = async (_requestedDirection?: "CALL" | "PUT") => {
    const id = ++requestId.current;
    setAnalyzing(true);
    try {
      const result = await analyzePair(activePair, timeframe);
      if (id !== requestId.current) return;
      setSignal(result.signal.direction);
      setSignalReason(result.signal.reason.replaceAll('_', ' '));
      setSignalPreview(null);
      if (result.signal.direction !== 'NO_SIGNAL') {
        previewSequence.current += 1;
        setSignalPreview({ pairId: activePair.id, pair: activePair.label, duration: '1 Minute', time: new Date().toLocaleTimeString(), direction: result.signal.direction, sequence: previewSequence.current });
      }
      await analysis.refetch();
    } catch { setSignal('NO_SIGNAL'); setSignalReason('Backend analysis unavailable'); toast.error('Analysis unavailable'); }
    finally { if (id === requestId.current) setAnalyzing(false); }
  };
  const provider = runtime.data?.providers.find(p => p.source === 'deriv');
  const observer = runtime.data?.providers.find(p => p.source === 'market-qx-observer-v2');
  const connected = !runtime.isError && !!runtime.data;
  const moduleStates = [
    { state: connected ? 'RUNNING' : 'CONNECTING', status: connected ? 'LIVE' : 'WARN', metrics: [runtime.data?.database || 'Waiting', 'Read-only API', 'MongoDB'] },
    { state: provider?.state || 'WAITING', status: provider?.state === 'DATA_RECEIVING' ? 'LIVE' : 'WARN', metrics: [`${runtime.data?.ticksReceived ?? 0} ticks`, `${provider?.symbolCount ?? 0} symbols`, provider?.error || 'Public API'] },
    { state: observer?.state === 'DATA_RECEIVING' ? 'OBSERVING' : 'WAITING', status: observer?.state === 'DATA_RECEIVING' ? 'LIVE' : 'IDLE', metrics: ['QX observer v2', 'Visible DOM', 'Unverified'] },
    { state: connected ? 'CONNECTED' : 'WAITING', status: connected ? 'LIVE' : 'IDLE', metrics: [`${runtime.data?.analysisCycles ?? 0} cycles`, '5 timeframes', 'Source isolated'] },
    { state: analysis.data?.quality ? 'ANALYZED' : 'WAITING', status: analysis.data?.quality ? 'LIVE' : 'IDLE', metrics: [`Score ${analysis.data?.quality?.score ?? '—'}`, `${analysis.data?.candleCount ?? 0} candles`, `${analysis.data?.indicators?.count ?? 0} outputs`] },
    { state: 'SOURCE MISSING', status: 'WARN', metrics: ['Active 0', '500 slots', 'Not trained'] },
    { state: 'NO_SIGNAL', status: 'IDLE', metrics: ['Edge —', 'Votes 0', 'Gate held'] },
    { state: 'NOT VALIDATED', status: 'IDLE', metrics: ['OOS pending', 'No accuracy', 'Blocked'] },
  ];
  const liveModules: MonitorModule[] = monitorModules.map((module, i) => ({ ...module, ...moduleStates[i], status: moduleStates[i].status as MonitorModule['status'] }));
  const resetSignalPreview = () => {
    setSignalPreview(null);
    setSignal("NO_SIGNAL");
    previewSequence.current = 0;
  };
  const hidePanel = (side: "left" | "right") => {
    if (window.matchMedia("(max-width: 980px)").matches) {
      setMobilePanel("chart");
      document.querySelector<HTMLButtonElement>('[data-testid="mobile-panel-chart"]')?.focus();
      return;
    }
    if (side === "left") setLeftPanelVisible(false);
    else setRightPanelVisible(false);
    document.querySelector<HTMLButtonElement>(`[data-testid="toggle-${side}-panel-button"]`)?.focus();
  };

  return (
    <div data-testid="terminal-app" className="terminal-shell">
      <Toaster position="bottom-right" richColors theme="dark" />
      <MobileNavigation open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} />

      <header data-testid="terminal-header" className="terminal-header">
        <button data-testid="mobile-menu-button" aria-label="Open navigation" aria-expanded={mobileMenuOpen} className="rounded-lg p-2 text-slate-400 transition hover:bg-[#1f2635] hover:text-white md:hidden" onClick={() => setMobileMenuOpen(true)}>
          <Menu size={18} />
        </button>
        <Brand />
        <div data-testid="header-system-state" className={`header-system-state ${systemOnline ? "" : "offline"}`}>
          <span className="tiny-dot" /> {systemOnline ? (connected ? 'Backend connected' : 'Connecting backend') : 'Updates paused'}
        </div>
        <div data-testid="header-spacer" className="flex-1" />
        <div data-testid="terminal-mode-controls" className="panel-visibility-controls mode-controls" role="group" aria-label="Agent registry and trading mode">
          <Button data-testid="open-agents-button" variant="ghost" className="panel-visibility-button" aria-expanded={agentsOpen} onClick={() => setAgentsOpen(true)}><Bot size={16} /><span>Agents</span><b>500</b></Button>
          <Button data-testid="trade-mode-button" variant="ghost" className="panel-visibility-button trade-mode-button" onClick={() => navigate(`/trade?pair=${encodeURIComponent(activePair.id)}`)}><BarChart3 size={16} /><span>Trade</span><span className="panel-toggle-track" aria-hidden="true"><i /></span></Button>
        </div>
        <div data-testid="header-market-source" className="header-market-source">
          <span data-testid="source-label">REFERENCE SOURCE</span>
          <strong data-testid="source-value">Deriv <span>· QX observer</span></strong>
        </div>
        <button data-testid="header-notification-button" aria-label="Notifications" className="notification-button" onClick={() => toast("2 configuration notices", { description: "Agent implementation missing from source · model training and validation pending." })}>
          <Bell size={17} />
          <span data-testid="notification-count" className="absolute right-1 top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[#f23645] px-1 text-[8px] font-bold text-white">2</span>
        </button>
        <button data-testid="header-account-button" className="account-button" onClick={() => runAction("Workspace panel opened")}>
          <span data-testid="account-avatar" className="grid h-6 w-6 place-items-center rounded-full bg-[#1f8a78] text-[10px] font-bold">AM</span>
          <span data-testid="account-copy"><span className="block text-[9px] text-[#00c278]">DEMO WORKSPACE</span><span className="block text-xs font-semibold text-white">alpha-monitor</span></span>
          <ChevronDown size={14} className="text-slate-500" />
        </button>
      </header>

      <div className="terminal-body">
        <aside data-testid="left-navigation-rail" className="navigation-rail">
          <div data-testid="nav-primary-group" className="flex w-full flex-col items-center gap-2">
            <NavButton icon={LayoutDashboard} label="Terminal" active testId="nav-terminal-button" onClick={() => runAction("Terminal view selected")} />
            <NavButton icon={Activity} label="Signals" testId="nav-signals-button" onClick={() => navigate('/signals')} />
            <NavButton icon={BarChart3} label="Analytics" testId="nav-analytics-button" onClick={() => navigate('/analytics')} />
            <NavButton icon={GitBranch} label="Flow map" testId="nav-flow-button" onClick={() => navigate('/flow')} />
          </div>
          <div data-testid="nav-divider" className="my-5 h-px w-8 bg-[#222a3b]" />
          <div data-testid="nav-secondary-group" className="flex w-full flex-col items-center gap-2">
            <NavButton icon={Terminal} label="Logs" testId="nav-logs-button" onClick={() => navigate('/logs')} />
            <NavButton icon={Settings2} label="Settings" testId="nav-settings-button" onClick={() => navigate('/settings')} />
          </div>
          <div data-testid="nav-footer" className="mt-auto flex flex-col items-center gap-3">
            <button data-testid="nav-help-button" className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-[#1f2635] hover:text-white" onClick={() => toast("Master Candle", { description: "Live source-isolated analysis. No real-money execution. Trade screen remains a MOCKED simulation." })}><CircleHelp size={17} /></button>
            <div data-testid="nav-build-version" className="font-mono text-[9px] text-slate-600">v0.8.4</div>
          </div>
        </aside>

        <main data-testid="terminal-workspace" className="terminal-workspace">
          <div data-testid="mobile-nav-strip" className="mobile-panel-tabs">
            {[{ id: "infrastructure", label: "Data & connection" }, { id: "chart", label: "Trading chart" }, { id: "analysis", label: "Analysis & output" }].map(item => <button key={item.id} data-testid={`mobile-panel-${item.id}`} className={mobilePanel === item.id ? "selected" : ""} onClick={() => setMobilePanel(item.id)}>{item.label}</button>)}
          </div>

          <MarketRail activePairId={activePairId} onSelect={setActivePairId} online={systemOnline} live />

          <div data-testid="main-terminal-grid" className={`main-terminal-grid mobile-show-${mobilePanel} ${leftPanelVisible ? "" : "left-panel-hidden"} ${rightPanelVisible ? "" : "right-panel-hidden"}`}>
            <aside id="infrastructure-panel" data-testid="left-monitoring-rail" className="monitor-panel infrastructure-panel">
              <div data-testid="infrastructure-header" className="panel-heading"><span className="panel-heading-icon"><DatabaseZap size={17} /></span><div><h2 data-testid="infrastructure-title">System monitor</h2><p data-testid="infrastructure-subtitle">INFRASTRUCTURE & INGESTION</p></div><Button data-testid="hide-left-panel-button" variant="ghost" size="icon-sm" className="panel-collapse-button" aria-label="Hide system monitor" title="Hide panel to enlarge chart" onClick={() => hidePanel("left")}><PanelLeftClose size={17} /></Button></div>
              <div data-testid="monitoring-summary-strip" className="monitor-summary"><SummaryMetric value="08" label="modules" tone="blue" /><SummaryMetric value={systemOnline ? String(liveModules.filter(m => m.status === 'LIVE').length) : "00"} label="streaming" tone="green" /><SummaryMetric value={systemOnline ? String(liveModules.filter(m => m.status !== 'LIVE').length) : "08"} label="not-ready" tone="amber" /></div>
              <div data-testid="left-monitoring-cards-list" className="monitor-cards-list">{liveModules.slice(0, 4).map(module => <MonitorCard key={module.id} module={module} systemOnline={systemOnline} onAction={runAction} />)}</div>
              <div data-testid="data-route-card" className="data-route-card"><h3 data-testid="data-route-title"><GitBranch size={13} /> Chart data path</h3><div data-testid="data-route-steps" className={systemOnline ? "data-route-steps" : "data-route-steps offline"}><span>Provider</span><i /><span>Storage</span><i /><span>Chart</span></div><p data-testid="data-route-note">Source-isolated candles feed the analysis pipeline.</p></div>
              <div data-testid="system-control-panel" className="system-control-panel"><div data-testid="system-control-heading" className="control-heading"><Zap size={12} /> DISPLAY UPDATES</div><Button data-testid="system-online-toggle" className={`system-toggle ${systemOnline ? "" : "offline"}`} onClick={() => { setSystemOnline(!systemOnline); toast(systemOnline ? "Display updates paused" : "Display updates resumed", { description: "Backend collection continues independently" }); }}><span className="tiny-dot" />{systemOnline ? "Updates enabled" : "Updates paused"}<span className="switch-track"><i /></span></Button><p data-testid="system-control-note">Backend collection remains active</p></div>
            </aside>
            <TradingChart key={activePair.id} pair={activePair} online={systemOnline} live onTimeframeChange={setTimeframe} controls={<div className="chart-panel-controls" data-testid="chart-panel-controls"><Button data-testid="toggle-left-panel-button" variant="ghost" size="icon-sm" aria-label="Toggle system monitor" aria-pressed={leftPanelVisible} title="Show / hide system monitor" onClick={() => setLeftPanelVisible(value => !value)}><PanelLeft size={15} /></Button><Button data-testid="toggle-right-panel-button" variant="ghost" size="icon-sm" aria-label="Toggle intelligence engine" aria-pressed={rightPanelVisible} title="Show / hide intelligence engine" onClick={() => setRightPanelVisible(value => !value)}><PanelRight size={15} /></Button></div>} />

            <aside id="analysis-panel" data-testid="monitoring-rail" className="monitor-panel analysis-panel">
              <div data-testid="monitoring-header" className="panel-heading"><span className="panel-heading-icon"><BrainCircuit size={18} /></span><div><h2 data-testid="monitoring-title">Intelligence engine</h2><p data-testid="monitoring-subtitle">ANALYSIS & DECISION OUTPUT</p></div><Button data-testid="hide-right-panel-button" variant="ghost" size="icon-sm" className="panel-collapse-button" aria-label="Hide intelligence engine" title="Hide panel to enlarge chart" onClick={() => hidePanel("right")}><PanelRightClose size={17} /></Button></div>
              <div data-testid="signal-dock" className="signal-dock">
                <div data-testid="signal-dock-heading" className="signal-heading"><Activity size={13} /><h3 data-testid="decision-output-title" className="decision-output-title">Decision output</h3><Button data-testid="generate-signal-button" className="generate-signal-button" size="xs" disabled={analyzing} aria-label="Analyze current market" onClick={() => void generateSignalPreview()}><Zap size={12} /> {analyzing ? 'Wait' : 'Signal'}</Button><Button data-testid="signal-reset-button" variant="ghost" size="icon-xs" aria-label="Reset signal" onClick={resetSignalPreview}><RefreshCw size={12} /></Button></div>
                <div className="signal-result-region" aria-live="polite" aria-atomic="true">
                  {signalPreview ? <div key={signalPreview.sequence} data-testid="signal-output-card" className={`signal-output-card generated-signal-card signal-${signalPreview.direction.toLowerCase()}`}>
                    <div className="signal-preview-caption"><span data-testid="signal-preview-caption">ANALYTICAL SIGNAL</span><span data-testid="signal-mocked-badge">RESEARCH</span></div>
                    <div className="signal-pair-heading"><CountryFlags pairId={signalPreview.pairId} /><div><span data-testid="signal-pair-label" className="signal-field-label">Pair</span><strong data-testid="signal-result-pair">{signalPreview.pair}</strong></div></div>
                    <div className="signal-result-details"><div><span data-testid="signal-duration-label" className="signal-field-label"><Clock3 size={11} /> Duration</span><strong data-testid="signal-result-duration">{signalPreview.duration}</strong></div><div><span data-testid="signal-time-label" className="signal-field-label">Local time</span><strong data-testid="signal-result-time">{signalPreview.time}</strong></div></div>
                    <div data-testid="signal-output-state" className="generated-signal-direction">{signalPreview.direction === "CALL" ? <TrendingUp size={23} /> : <TrendingDown size={23} />}<strong data-testid="signal-result-direction">{signalPreview.direction}</strong><span data-testid="signal-result-direction-label">{signalPreview.direction === "CALL" ? "UP" : "DOWN"}</span></div>
                    <p data-testid="signal-output-reason" className="signal-preview-disclaimer">Analytical only · not an executed trade</p>
                  </div> : <div data-testid="signal-output-card" className={`signal-output-card signal-${signal.toLowerCase()}`}><div data-testid="signal-output-state" className="signal-state"><span className="tiny-dot" />NO_SIGNAL<span data-testid="signal-output-time">GATED</span></div><p data-testid="signal-output-reason">{signalReason}</p><p data-testid="signal-preview-hint" className="signal-preview-hint">No qualified signal available.</p></div>}
                </div>
                <div data-testid="signal-gates" className="signal-gates"><span>Evidence <b>0 / 3</b></span><span>Model <b>Not ready</b></span></div>
                <div data-testid="signal-action-row" className="signal-action-row"><Button data-testid="trade-call-button" className="call-button" disabled={analyzing} onClick={() => void generateSignalPreview("CALL")}><span>CALL <small>Check signal</small></span><TrendingUp size={18} /></Button><Button data-testid="trade-put-button" className="put-button" disabled={analyzing} onClick={() => void generateSignalPreview("PUT")}><span>PUT <small>Check signal</small></span><TrendingDown size={18} /></Button></div>
              </div>
              <div data-testid="monitoring-cards-list" className="monitor-cards-list">{liveModules.slice(4).map(module => <MonitorCard key={module.id} module={module} systemOnline={systemOnline} onAction={runAction} />)}</div>
              <div data-testid="model-readiness-note" className="model-readiness-note"><ShieldCheck size={13} /><span>Model adapters not configured.<br />Signal execution remains blocked.</span></div>
            </aside>
            <section data-testid="event-log-panel" className="event-log-panel"><div data-testid="event-log-header" className="event-log-header"><h2 data-testid="event-log-title"><Terminal size={13} /> Event stream <span data-testid="event-log-live-badge">BACKEND</span></h2><div data-testid="log-filter-controls" className="log-filter-controls">{["ALL", "INFO", "WARN", "SIGNAL"].map(filter => <button key={filter} data-testid={`log-filter-${filter.toLowerCase()}-button`} aria-pressed={logFilter === filter} className={logFilter === filter ? "selected" : ""} onClick={() => setLogFilter(filter)}>{filter}</button>)}</div></div><div data-testid="terminal-log-container" className="terminal-log-container">{filteredLogs.map((row, index) => <div key={`${row.time}-${index}`} data-testid={`log-row-${row.level.toLowerCase()}-${index}`} className="log-row"><span data-testid={`log-time-${index}`} className="log-time">{row.time}</span><span data-testid={`log-level-${index}`} className={`log-level level-${row.level.toLowerCase()}`}>{row.level}</span><span data-testid={`log-source-${index}`} className="log-source">{row.source}</span><span data-testid={`log-message-${index}`} className="log-message" title={row.message}>{row.message}</span></div>)}</div></section>
          </div>
          <footer data-testid="terminal-footer" className="terminal-footer"><span data-testid="prototype-disclaimer"><span className="tiny-dot" /> LIVE DATA · ANALYTICAL ONLY · NO REAL TRADES</span><span data-testid="terminal-footer-status">Deriv public · QX unverified <span>Master Candle v1.0</span></span></footer>
          <AgentRegistry open={agentsOpen} onOpenChange={setAgentsOpen} online={systemOnline} live />
        </main>
      </div>
    </div>
  );
}

function NavButton({ icon: Icon, label, active = false, testId, onClick }: { icon: LucideIcon; label: string; active?: boolean; testId: string; onClick: () => void }) {
  return <button data-testid={testId} className={`nav-button ${active ? "active" : ""}`} onClick={onClick}><Icon size={19} /><span>{label}</span></button>;
}

function SummaryMetric({ value, label, tone }: { value: string; label: string; tone: "blue" | "green" | "amber" }) {
  return <div data-testid={`summary-metric-${label}`} className={`summary-metric tone-${tone}`}><strong data-testid={`summary-value-${label}`}>{value}</strong><span data-testid={`summary-label-${label}`}>{label.replaceAll("-", " ")}</span></div>;
}

function MonitorCard({ module, systemOnline, onAction }: { module: MonitorModule; systemOnline: boolean; onAction: (label: string) => void }) {
  const Icon = module.icon;
  const effectiveStatus = systemOnline ? module.status : "ERROR";
  return <article data-testid={`monitor-card-${module.id}`} className={`monitor-card status-${effectiveStatus.toLowerCase()}`}>
    <div className="monitor-card-top"><span data-testid={`monitor-card-icon-${module.id}`} className="monitor-icon"><Icon size={14} /></span><h3 data-testid={`monitor-card-name-${module.id}`}>{module.name}</h3><span className="monitor-activity" aria-hidden="true"><i /><i /><i /><i /><i /></span></div>
    <div data-testid={`module-status-badge-${module.id}`} className="module-status"><span data-testid={`status-dot-${module.id}`} className="tiny-dot" />{systemOnline ? module.state : "DISCONNECTED"}</div>
    <p className="module-description" data-testid={`monitor-card-description-${module.id}`}>{module.description}</p>
    <div data-testid={`monitor-card-metrics-${module.id}`} className="monitor-metrics">{module.metrics.map((metric, index) => <span key={metric} data-testid={`monitor-metric-${module.id}-${index}`}>{systemOnline ? metric : "—"}</span>)}</div>
    <div data-testid={`monitor-card-actions-${module.id}`} className="monitor-actions"><button data-testid={`monitor-reconnect-${module.id}`} onClick={() => onAction(`${module.name} reconnect previewed`)}><RefreshCw size={10} /> Reconnect</button><button data-testid={`monitor-latency-${module.id}`} onClick={() => onAction(`${module.name} latency previewed`)}><Clock3 size={10} /> Latency</button><button data-testid={`monitor-error-${module.id}`} onClick={() => onAction(`${module.name} error previewed`)}><AlertTriangle size={10} /> Error</button></div>
  </article>;
}