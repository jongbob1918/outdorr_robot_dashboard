import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bell,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Crosshair,
  Database,
  Gauge,
  Layers3,
  LocateFixed,
  Map as MapIcon,
  MapPinned,
  Minus,
  Mountain,
  Pause,
  Play,
  Plus,
  Radio,
  Route,
  Satellite,
  Shield,
  Signal,
  SlidersHorizontal,
  TriangleAlert,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

const ROBOTS = [
  {
    id: "SR-01",
    name: "해솔",
    status: "운행 중",
    tone: "active",
    battery: 87,
    task: "북측 순찰로 점검",
    speed: "1.8",
    signal: "-58",
    position: { x: 52, y: 43 },
    heading: 28,
    updated: "방금 전",
  },
  {
    id: "SR-02",
    name: "솔비",
    status: "대기",
    tone: "idle",
    battery: 64,
    task: "충전소 대기",
    speed: "0.0",
    signal: "-62",
    position: { x: 31, y: 69 },
    heading: 112,
    updated: "4초 전",
  },
  {
    id: "SR-03",
    name: "누리",
    status: "점검 필요",
    tone: "warning",
    battery: 31,
    task: "센서 점검",
    speed: "0.0",
    signal: "-76",
    position: { x: 72, y: 32 },
    heading: 238,
    updated: "18초 전",
  },
];

const LAYERS = [
  { id: "route", label: "운행 경로", color: "#306a51", icon: Route },
  { id: "fence", label: "안전 구역", color: "#d79927", icon: Shield },
  { id: "obstacle", label: "장애물", color: "#c2543d", icon: TriangleAlert },
  { id: "terrain", label: "지형 음영", color: "#6e8575", icon: Mountain },
];

const EVENTS = [
  { time: "14:32:18", tone: "warning", text: "SR-03 배터리 잔량 35% 미만" },
  { time: "14:30:41", tone: "success", text: "SR-01 구간 B-04 통과" },
  { time: "14:28:03", tone: "neutral", text: "작업 구역 동기화 완료" },
];

function StatusDot({ tone }) {
  return <span className={`status-dot ${tone}`} aria-hidden="true" />;
}

function RobotList({ selected, onSelect }) {
  return (
    <section className="panel robot-panel" aria-label="로봇 목록">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FLEET</span>
          <h2>로봇 현황</h2>
        </div>
        <span className="count-pill">3대</span>
      </div>
      <div className="robot-list">
        {ROBOTS.map((robot) => (
          <button
            className={`robot-card ${selected === robot.id ? "selected" : ""}`}
            key={robot.id}
            onClick={() => onSelect(robot.id)}
          >
            <div className="robot-card-top">
              <span className={`robot-avatar ${robot.tone}`}>
                <Bot size={18} strokeWidth={1.8} />
              </span>
              <span className="robot-title">
                <strong>{robot.id}</strong>
                <small>{robot.name}</small>
              </span>
              <ChevronRight size={16} className="robot-arrow" />
            </div>
            <div className="robot-meta">
              <span>
                <StatusDot tone={robot.tone} />
                {robot.status}
              </span>
              <span className={robot.battery < 40 ? "battery-low" : ""}>
                <Zap size={12} fill="currentColor" />
                {robot.battery}%
              </span>
            </div>
          </button>
        ))}
      </div>
      <div className="fleet-summary">
        <span><strong>1</strong> 운행</span>
        <span><strong>1</strong> 대기</span>
        <span><strong className="amber">1</strong> 점검</span>
      </div>
    </section>
  );
}

function LayerPanel({ activeLayers, onToggle }) {
  return (
    <section className="panel layer-panel">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">MAP DATA</span>
          <h2>지도 레이어</h2>
        </div>
        <Layers3 size={17} />
      </div>
      <div className="layer-list">
        {LAYERS.map(({ id, label, color, icon: Icon }) => (
          <label className="layer-row" key={id}>
            <span className="layer-label">
              <Icon size={15} style={{ color }} />
              {label}
            </span>
            <input
              type="checkbox"
              checked={activeLayers[id]}
              onChange={() => onToggle(id)}
            />
            <span className="toggle" aria-hidden="true" />
          </label>
        ))}
      </div>
    </section>
  );
}

function RobotMarker({ robot, selected, onClick }) {
  return (
    <button
      className={`map-robot ${robot.tone} ${selected ? "selected" : ""}`}
      style={{ left: `${robot.position.x}%`, top: `${robot.position.y}%` }}
      onClick={onClick}
      aria-label={`${robot.id} ${robot.status}`}
    >
      <span className="robot-pulse" />
      <span
        className="robot-heading"
        style={{ transform: `rotate(${robot.heading}deg)` }}
      />
      <span className="robot-dot"><Bot size={15} /></span>
      <span className="robot-map-label">
        <b>{robot.id}</b>
        <small>{robot.status}</small>
      </span>
    </button>
  );
}

function MapStage({
  selected,
  setSelected,
  activeLayers,
  zoom,
  setZoom,
  onOpenSource,
}) {
  const selectedRobot = ROBOTS.find((robot) => robot.id === selected);
  return (
    <main className="map-stage">
      <div className="map-toolbar">
        <div className="map-location">
          <MapPinned size={17} />
          <div>
            <span>경기도 고양시 덕양구</span>
            <strong>서오릉 · 운영 구역 A</strong>
          </div>
          <ChevronDown size={15} />
        </div>
        <button className="source-badge" onClick={onOpenSource}>
          <Database size={15} />
          <span><b>DEMO MAP</b> · GeoTIFF 연결 전</span>
        </button>
      </div>

      <div
        className="map-surface"
        style={{ "--map-scale": 1 + (zoom - 15) * 0.045 }}
      >
        <svg
          className="terrain-map"
          viewBox="0 0 1200 800"
          preserveAspectRatio="xMidYMid slice"
          aria-label="서오릉 운영 구역 데모 지도"
        >
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#31523f" strokeOpacity=".08" />
            </pattern>
            <filter id="softShadow">
              <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#17392b" floodOpacity=".15" />
            </filter>
          </defs>
          <rect width="1200" height="800" fill="#dfe7de" />
          {activeLayers.terrain && (
            <g className="contours" fill="none" stroke="#819986" strokeWidth="1.5" opacity=".42">
              <path d="M-30 100 C150 0 260 160 420 75 S725 15 900 100 1090 140 1240 45" />
              <path d="M-20 155 C140 65 275 225 445 130 S720 80 900 155 1095 200 1230 105" />
              <path d="M-10 590 C185 470 305 660 490 565 S780 490 930 585 1120 650 1240 555" />
              <path d="M-30 650 C175 520 315 720 505 625 S770 555 945 650 1100 705 1240 610" />
            </g>
          )}
          <path d="M0 0H430C385 118 301 154 326 281S221 466 0 423Z" fill="#adc2aa" />
          <path d="M820 0H1200V363C1082 330 1045 205 935 232S813 101 820 0Z" fill="#b4c9b0" />
          <path d="M768 500C914 415 997 470 1200 426V800H707C745 692 684 548 768 500Z" fill="#a8bea6" />
          <g fill="#91ab91" opacity=".72">
            <circle cx="90" cy="90" r="53" /><circle cx="182" cy="67" r="68" />
            <circle cx="273" cy="143" r="58" /><circle cx="1110" cy="120" r="88" />
            <circle cx="1010" cy="610" r="95" /><circle cx="1118" cy="678" r="115" />
            <circle cx="865" cy="723" r="80" />
          </g>
          <g fill="none" strokeLinecap="round">
            <path d="M-20 677C145 590 224 652 331 548S494 393 613 409 770 497 858 382 1003 241 1225 296" stroke="#f4f1e8" strokeWidth="44" />
            <path d="M-20 677C145 590 224 652 331 548S494 393 613 409 770 497 858 382 1003 241 1225 296" stroke="#c4cabc" strokeWidth="2" strokeDasharray="12 10" />
            <path d="M353 545C325 439 357 341 486 300S696 170 716 -20" stroke="#f4f1e8" strokeWidth="27" />
            <path d="M614 411C625 528 561 622 553 820" stroke="#f4f1e8" strokeWidth="24" />
            <path d="M863 382C854 284 788 203 809 91" stroke="#f4f1e8" strokeWidth="22" />
          </g>
          <g filter="url(#softShadow)">
            <path d="M168 490h94v60h-94z" fill="#9c765b" transform="rotate(-8 215 520)" />
            <path d="M895 314h70v46h-70z" fill="#ab8260" transform="rotate(7 930 337)" />
            <path d="M461 238h112v70h-112z" fill="#a77f5f" transform="rotate(-13 517 273)" />
          </g>
          <rect width="1200" height="800" fill="url(#grid)" />
          {activeLayers.fence && (
            <path
              d="M260 610C305 475 388 345 506 279S731 193 853 261 989 420 921 545 735 674 567 691 354 699 260 610Z"
              fill="#e7ac3f"
              fillOpacity=".06"
              stroke="#d3962f"
              strokeWidth="3"
              strokeDasharray="12 9"
            />
          )}
          {activeLayers.route && (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M373 567L427 480 526 405 623 430 706 394 810 308 890 336" stroke="#eef7f1" strokeWidth="12" opacity=".9" />
              <path d="M373 567L427 480 526 405 623 430 706 394 810 308 890 336" stroke="#2f6b50" strokeWidth="5" strokeDasharray="7 9" />
              <circle cx="373" cy="567" r="8" fill="#2f6b50" />
              <circle cx="890" cy="336" r="8" fill="#f7f3e7" stroke="#2f6b50" strokeWidth="4" />
            </g>
          )}
          {activeLayers.obstacle && (
            <g>
              <circle cx="687" cy="416" r="19" fill="#c45842" fillOpacity=".16" stroke="#bd513d" strokeWidth="2" />
              <path d="M678 424l18-18M678 406l18 18" stroke="#a84332" strokeWidth="3" />
              <circle cx="826" cy="300" r="14" fill="#c45842" fillOpacity=".15" stroke="#bd513d" strokeWidth="2" />
            </g>
          )}
          <g className="map-labels" fill="#486454">
            <text x="118" y="249">서어나무 숲</text>
            <text x="928" y="174">창릉 권역</text>
            <text x="188" y="582">운영 베이스</text>
            <text x="484" y="225">관리 시설</text>
            <text x="792" y="715">완충 녹지</text>
          </g>
        </svg>

        {ROBOTS.map((robot) => (
          <RobotMarker
            key={robot.id}
            robot={robot}
            selected={robot.id === selected}
            onClick={() => setSelected(robot.id)}
          />
        ))}

        <div className="north-arrow"><span>N</span><i /></div>
        <div className="map-controls">
          <button onClick={() => setZoom((value) => Math.min(value + 1, 19))} aria-label="확대"><Plus size={17} /></button>
          <span>{zoom}</span>
          <button onClick={() => setZoom((value) => Math.max(value - 1, 12))} aria-label="축소"><Minus size={17} /></button>
          <button className="locate" onClick={() => setZoom(16)} aria-label="선택 로봇 위치"><LocateFixed size={17} /></button>
        </div>
        <div className="scale-bar"><span /> 100 m</div>
        <div className="coordinates">37.6308° N&nbsp;&nbsp; 126.8942° E</div>
        <div className="selected-hint">
          <Crosshair size={14} />
          {selectedRobot.id} 추적 중
        </div>
      </div>
    </main>
  );
}

function TelemetryGraph({ running }) {
  return (
    <div className="telemetry-chart">
      <svg viewBox="0 0 320 92" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f6b50" stopOpacity=".22" />
            <stop offset="100%" stopColor="#2f6b50" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chart-grid" d="M0 18H320M0 46H320M0 74H320" />
        <path
          className={running ? "chart-line running" : "chart-line"}
          d="M0 65C25 59 27 38 54 43S78 60 104 50 132 22 158 31 183 61 211 52 238 38 263 42 289 24 320 28V92H0Z"
          fill="url(#chartFill)"
        />
        <path
          className={running ? "chart-stroke running" : "chart-stroke"}
          d="M0 65C25 59 27 38 54 43S78 60 104 50 132 22 158 31 183 61 211 52 238 38 263 42 289 24 320 28"
        />
      </svg>
      <span className="chart-now">NOW</span>
    </div>
  );
}

function DetailPanel({ robot, running, onToggleRunning }) {
  return (
    <aside className="detail-column">
      <section className="panel detail-panel">
        <div className="detail-identity">
          <span className={`robot-avatar large ${robot.tone}`}><Bot size={24} /></span>
          <div>
            <span className="eyebrow">SELECTED ROBOT</span>
            <h2>{robot.id} <small>{robot.name}</small></h2>
            <span className={`status-label ${robot.tone}`}><StatusDot tone={robot.tone} />{robot.status}</span>
          </div>
          <button className="icon-button" aria-label="로봇 설정"><SlidersHorizontal size={17} /></button>
        </div>
        <div className="task-block">
          <span>현재 임무</span>
          <strong>{robot.task}</strong>
          <small><Clock3 size={13} /> 00:24:18 경과</small>
        </div>
        <div className="metric-grid">
          <div><Gauge size={17} /><span>속도<small>m/s</small></span><strong>{robot.speed}</strong></div>
          <div><Zap size={17} /><span>배터리<small>잔량</small></span><strong>{robot.battery}%</strong></div>
          <div><Signal size={17} /><span>신호<small>dBm</small></span><strong>{robot.signal}</strong></div>
          <div><Crosshair size={17} /><span>정확도<small>RTK</small></span><strong>2.4<small>cm</small></strong></div>
        </div>
        <div className="telemetry-heading">
          <span>속도 텔레메트리</span>
          <small><StatusDot tone={running ? "active" : "idle"} />LIVE · 30s</small>
        </div>
        <TelemetryGraph running={running} />
        <button className={`mission-button ${running ? "pause" : "resume"}`} onClick={onToggleRunning}>
          {running ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          {running ? "임무 일시정지" : "임무 다시 시작"}
        </button>
      </section>

      <section className="panel events-panel">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">EVENT LOG</span>
            <h2>최근 이벤트</h2>
          </div>
          <button className="text-button">전체 보기</button>
        </div>
        <div className="event-list">
          {EVENTS.map((event) => (
            <div className="event-row" key={event.time}>
              <span className={`event-icon ${event.tone}`}>
                {event.tone === "warning" ? <CircleAlert size={14} /> : event.tone === "success" ? <CircleCheck size={14} /> : <Radio size={14} />}
              </span>
              <span><strong>{event.text}</strong><small>{event.time}</small></span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function SourceModal({ onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="source-modal" role="dialog" aria-modal="true" aria-labelledby="source-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        <span className="modal-icon"><Satellite size={25} /></span>
        <span className="eyebrow">BASEMAP SOURCE</span>
        <h2 id="source-title">국토지리정보원 GeoTIFF 연결</h2>
        <p>
          현재 화면은 기능 확인용 벡터 데모입니다. 실제 운영에서는 내려받은 서오릉
          정사영상을 타일로 변환한 뒤, 지도 소스로 연결하세요.
        </p>
        <ol>
          <li><b>국토정보플랫폼</b>에서 “서오릉” 검색</li>
          <li><b>정사영상 · TIFF</b> 선택 후 다운로드</li>
          <li><b>QGIS/GDAL</b>로 영역 자르기 및 타일 변환</li>
          <li><b>MapLibre/OpenLayers</b> raster source로 연결</li>
        </ol>
        <div className="license-note">
          <Shield size={17} />
          <span><b>상업 이용 전 확인</b>다운로드한 개별 성과의 이용허락·출처표시·보안등급을 보관하세요.</span>
        </div>
        <a href="https://www.data.go.kr/data/15059919/fileData.do" target="_blank" rel="noreferrer">
          공식 정사영상 페이지 열기 <ChevronRight size={16} />
        </a>
      </section>
    </div>
  );
}

function App() {
  const [selected, setSelected] = useState("SR-01");
  const [running, setRunning] = useState(true);
  const [zoom, setZoom] = useState(16);
  const [showSource, setShowSource] = useState(false);
  const [notifications, setNotifications] = useState(1);
  const [activeLayers, setActiveLayers] = useState({
    route: true,
    fence: true,
    obstacle: true,
    terrain: true,
  });
  const selectedRobot = useMemo(
    () => ROBOTS.find((robot) => robot.id === selected),
    [selected],
  );

  const toggleLayer = (id) => {
    setActiveLayers((layers) => ({ ...layers, [id]: !layers[id] }));
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="서오릉 로봇 관제 홈">
          <span className="brand-mark"><MapIcon size={22} /></span>
          <span><strong>서오릉</strong><small>OUTDOOR ROBOT CONTROL</small></span>
        </a>
        <div className="system-state">
          <span><Wifi size={14} /><b>관제망 정상</b></span>
          <i />
          <span>마지막 동기화 <b>14:32:24</b></span>
        </div>
        <div className="top-actions">
          <button className="site-select"><span className="online-dot" />서오릉 운영센터<ChevronDown size={14} /></button>
          <button
            className="notification-button"
            onClick={() => setNotifications(0)}
            aria-label="알림 확인"
          >
            <Bell size={18} />
            {notifications > 0 && <span>{notifications}</span>}
          </button>
          <button className="user-avatar" aria-label="사용자 메뉴">OP</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="left-column">
          <RobotList selected={selected} onSelect={setSelected} />
          <LayerPanel activeLayers={activeLayers} onToggle={toggleLayer} />
          <div className="map-source-card">
            <span><Satellite size={17} /></span>
            <div><small>배경 데이터</small><strong>데모 벡터 맵</strong></div>
            <button onClick={() => setShowSource(true)}>연결</button>
          </div>
        </aside>
        <MapStage
          selected={selected}
          setSelected={setSelected}
          activeLayers={activeLayers}
          zoom={zoom}
          setZoom={setZoom}
          onOpenSource={() => setShowSource(true)}
        />
        <DetailPanel
          robot={selectedRobot}
          running={running}
          onToggleRunning={() => setRunning((value) => !value)}
        />
      </div>
      {showSource && <SourceModal onClose={() => setShowSource(false)} />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
