(() => {
  'use strict';

  const E = window.UKCEngine;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const fmt = (v, d = 2) => Number.isFinite(v) ? Number(v).toFixed(d) : '—';
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const DEFAULTS = {
    lbp: 176.1, beam: 29.4, draftForward: 9.00, draftAft: 9.07, displacement: 35900, cbOverride: 0,
    chartedDepth: 11.69, tideHeight: 0.80, speed: 10.0, waterDensity: 1.025, channelWidth: 0, fwaMm: 180,
    squatMethod: 'barrass-blockage', heelAngle: 0, heelAllowanceManual: 0.07, waveAllowance: 0.20,
    manualDraftCorrection: 0, catzoc: 'MANUAL', surveyAllowanceManual: 0.60, otherAllowance: 0,
    requiredFixed: 1.50, requiredPercent: 15, additionalSafetyMargin: 0,
    bridgeEnabled: '1', chartedBridgeClearance: 60.00, bridgeReferenceTide: 3.78, airDraft: 51.72,
    verticalMotionAllowance: 0.50, bridgeSurveyAllowance: 0.20, requiredAirClearance: 2.00, bridgeSquatCredit: '0'
  };

  const DEFAULT_TIDE_PLAN = {
    start: '00:00', duration: 24, step: 10, maxSpeed: 20,
    events: [
      { time: '00:30', height: 0.40 },
      { time: '06:45', height: 2.40 },
      { time: '13:05', height: 0.50 },
      { time: '19:20', height: 2.50 }
    ]
  };

  const state = {
    input: { ...DEFAULTS },
    scenarios: JSON.parse(localStorage.getItem('ukcPlannerScenarios') || '[]').slice(0, 8),
    charts: {}
  };

  function readForm() {
    const next = {};
    $$('[data-field]').forEach(el => next[el.dataset.field] = el.tagName === 'SELECT' ? el.value : Number(el.value || 0));
    state.input = next;
    return next;
  }

  function writeForm(data) {
    const merged = { ...DEFAULTS, ...data };
    $$('[data-field]').forEach(el => {
      const v = merged[el.dataset.field];
      if (v !== undefined && v !== null) el.value = v;
    });
    state.input = merged;
  }

  function timeToMinutes(value) {
    const m = String(value || '00:00').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 0;
    return (Number(m[1]) % 24) * 60 + clamp(Number(m[2]), 0, 59);
  }

  function formatClock(minute) {
    const total = Math.round(minute);
    const day = Math.floor(total / 1440);
    const m = ((total % 1440) + 1440) % 1440;
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return `${day > 0 ? `D${day + 1} ` : ''}${hh}:${mm}`;
  }

  function readTidePlan() {
    const rows = $$('#tideEvents .tide-event');
    return {
      start: $('#tideStart').value || '00:00',
      duration: clamp(Number($('#tideDuration').value) || 24, 1, 48),
      step: clamp(Number($('#tideStep').value) || 10, 5, 60),
      maxSpeed: clamp(Number($('#tideMaxSpeed').value) || 20, 5, 30),
      events: rows.map(row => ({
        time: row.querySelector('[data-tide-time]').value || '00:00',
        height: Number(row.querySelector('[data-tide-height]').value || 0)
      }))
    };
  }

  function writeTidePlan(plan) {
    const p = { ...DEFAULT_TIDE_PLAN, ...(plan || {}) };
    $('#tideStart').value = p.start || DEFAULT_TIDE_PLAN.start;
    $('#tideDuration').value = p.duration ?? DEFAULT_TIDE_PLAN.duration;
    $('#tideStep').value = p.step ?? DEFAULT_TIDE_PLAN.step;
    $('#tideMaxSpeed').value = p.maxSpeed ?? DEFAULT_TIDE_PLAN.maxSpeed;
    const rows = $$('#tideEvents .tide-event');
    rows.forEach((row, i) => {
      const e = p.events?.[i] || DEFAULT_TIDE_PLAN.events[i] || { time: '00:00', height: 0 };
      row.querySelector('[data-tide-time]').value = e.time;
      row.querySelector('[data-tide-height]').value = e.height;
    });
  }

  function tideEventsForEngine(plan = readTidePlan()) {
    return plan.events.map((e, i) => ({ minute: timeToMinutes(e.time), height: Number(e.height), label: ['LW 1','HW 1','LW 2','HW 2'][i] || `Tide ${i + 1}` }));
  }

  function toast(text) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = document.createElement('div'); t.className = 'toast';
      Object.assign(t.style,{position:'fixed',right:'18px',bottom:'18px',zIndex:99,padding:'10px 14px',borderRadius:'10px',background:'#16394a',border:'1px solid #3d7289',color:'#ecf4f7',fontSize:'12px',boxShadow:'0 14px 34px rgba(0,0,0,.3)',transition:'opacity .2s'});
      document.body.appendChild(t);
    }
    t.textContent = text; t.style.opacity = '1'; clearTimeout(t._timer); t._timer = setTimeout(() => t.style.opacity = '0', 1800);
  }

  function updateFormulaNote() {
    const method = state.input.squatMethod, el = $('#formulaNote');
    if (method === 'simple-open') el.innerHTML = '<b>Simple open-water estimate:</b> squat = Cb × V² / 100.';
    else if (method === 'simple-confined') el.innerHTML = '<b>Simple confined-water estimate:</b> squat = 2 × Cb × V² / 100.';
    else el.innerHTML = '<b>Barrass empirical blockage:</b> squat = Cb × S<sup>0.81</sup> × V<sup>2.08</sup> / 20, where S is the ship/channel sectional blockage ratio.';
  }

  function setStatus(status) {
    const badge = $('#statusBadge');
    badge.className = 'status-badge ' + status.toLowerCase();
    badge.textContent = status === 'TIGHT' ? 'TIGHT MARGIN' : status;
  }

  function statusText(el, status) {
    el.className = `inline-status ${String(status).toLowerCase().replace('/','')}`;
    el.textContent = status === 'TIGHT' ? 'TIGHT MARGIN' : status;
  }

  function breakdownHTML(r) {
    const allowanceTotal = r.squat + r.heelAllowance + r.waveAllowance + r.surveyAllowance + r.otherAllowance;
    const rows = [
      ['Charted depth', `+ ${fmt(r.input.chartedDepth)} m`],
      ['Tide height', `${r.input.tideHeight >= 0 ? '+' : '−'} ${fmt(Math.abs(r.input.tideHeight))} m`],
      ['Total water depth', `${fmt(r.totalDepth)} m`, 'total'],
      ['Mean draft', `− ${fmt(r.meanDraft)} m`],
      ['Density / manual draft correction', `${r.densityDraftCorrection >= 0 ? '−' : '+'} ${fmt(Math.abs(r.densityDraftCorrection))} m`],
      ['Gross static UKC', `${fmt(r.grossUKC)} m`, 'total'],
      ['Squat', `− ${fmt(r.squat)} m`],
      ['Heel / list allowance', `− ${fmt(r.heelAllowance)} m`],
      ['Wave allowance', `− ${fmt(r.waveAllowance)} m`],
      ['Survey / CATZOC allowance', `− ${fmt(r.surveyAllowance)} m`],
      ['Other allowance', `− ${fmt(r.otherAllowance)} m`],
      ['Total dynamic deductions', `− ${fmt(allowanceTotal)} m`],
      ['Available dynamic UKC', `${fmt(r.dynamicUKC)} m`, 'total'],
      ['Required UKC', `${fmt(r.requiredUKC)} m`],
      ['Operational margin', `${r.margin >= 0 ? '+' : '−'} ${fmt(Math.abs(r.margin))} m`, r.margin < 0 ? 'negative total' : 'total']
    ];
    return `<div class="subsection-title">Under-keel clearance</div>` + rows.map(([a,b,c='']) => `<div class="break-row ${c}"><span>${a}</span><b>${b}</b></div>`).join('');
  }

  function bridgeBreakdownHTML(r) {
    const b = r.bridge;
    if (!b.enabled) return '<div class="bridge-disabled">Bridge / overhead-clearance constraint is disabled.</div>';
    const rows = [
      ['Charted vertical clearance', `${fmt(b.chartedVerticalClearance)} m`],
      ['Reference tide for charted clearance', `+ ${fmt(b.referenceTide)} m`],
      ['Current tide height', `− ${fmt(b.tideHeight)} m`],
      ['Current bridge clearance', `${fmt(b.currentVerticalClearance)} m`, 'total'],
      ['Vessel air draft', `− ${fmt(b.airDraft)} m`],
      ['Vertical motion allowance', `− ${fmt(b.verticalMotionAllowance)} m`],
      ['Bridge / survey allowance', `− ${fmt(b.surveyAllowance)} m`],
      ['Squat credit', `+ ${fmt(b.squatCredit)} m`],
      ['Physical gap above vessel envelope', `${fmt(b.availableAirClearance)} m`, 'total'],
      ['Required air-clearance margin', `− ${fmt(b.requiredAirClearance)} m`],
      ['Air-clearance margin', `${b.margin >= 0 ? '+' : '−'} ${fmt(Math.abs(b.margin))} m`, b.margin < 0 ? 'negative total' : 'total']
    ];
    return `<div class="subsection-title">Bridge / overhead clearance</div>` + rows.map(([a,bv,c='']) => `<div class="break-row ${c}"><span>${a}</span><b>${bv}</b></div>`).join('');
  }

  function updateDiagram(r) {
    const top = 88, bottom = 380, span = bottom - top, depth = Math.max(0.1, r.totalDepth);
    const yKeel = top + clamp(r.adjustedDraft / depth, 0, 1.25) * span;
    const ySquat = top + clamp((r.adjustedDraft + r.squat) / depth, 0, 1.35) * span;
    const dynamicDeductions = r.squat + r.heelAllowance + r.waveAllowance + r.surveyAllowance + r.otherAllowance;
    const yAllow = top + clamp((r.adjustedDraft + dynamicDeductions) / depth, 0, 1.45) * span;
    $('#keelLine').setAttribute('y1', yKeel); $('#keelLine').setAttribute('y2', yKeel);
    $('#squatLine').setAttribute('y1', ySquat); $('#squatLine').setAttribute('y2', ySquat);
    $('#allowanceLine').setAttribute('y1', yAllow); $('#allowanceLine').setAttribute('y2', yAllow);
    $('#diagramDepth').textContent = `Total depth ${fmt(r.totalDepth)} m`;
    $('#diagramDraft').textContent = `Adjusted draft ${fmt(r.adjustedDraft)} m`;
    $('#diagramSquat').textContent = `Squat ${fmt(r.squat)} m`;
    $('#diagramAllowances').textContent = `Other deductions ${fmt(dynamicDeductions - r.squat)} m`;
    $('#diagramUKC').textContent = `Dynamic UKC ${fmt(r.dynamicUKC)} m`;
    $('#hull').setAttribute('transform', `translate(0 ${Math.max(-14, Math.min(30, yKeel - 284))})`);
  }

  function updateBridgeDiagram(r) {
    const b = r.bridge;
    const badge = $('#bridgeDiagramStatus');
    if (!b.enabled) {
      badge.className = 'mini-status disabled'; badge.textContent = 'DISABLED';
      $('#bridgeClearanceLabel').textContent = 'Bridge constraint not included';
      $('#bridgeAirDraftLabel').textContent = 'Enable bridge clearance in inputs';
      $('#bridgeGapLabel').textContent = '—';
      $('#bridgeTideLabel').textContent = `Current tide ${fmt(r.input.tideHeight)} m`;
      return;
    }
    badge.className = `mini-status ${b.status.toLowerCase()}`;
    badge.textContent = b.status === 'TIGHT' ? 'TIGHT MARGIN' : b.status;
    const deckY = 103, waterY = 336, span = waterY - deckY;
    const ratio = clamp(b.effectiveAirDraft / Math.max(0.1, b.currentVerticalClearance), 0, 1.2);
    const topY = waterY - ratio * span;
    $('#bridgeMastTop').setAttribute('y1', topY); $('#bridgeMastTop').setAttribute('y2', topY);
    $('#bridgeGapLine').setAttribute('y2', topY);
    $('#bridgeClearanceLabel').textContent = `Current bridge clearance ${fmt(b.currentVerticalClearance)} m`;
    $('#bridgeAirDraftLabel').textContent = `Effective air-draft envelope ${fmt(b.effectiveAirDraft)} m`;
    $('#bridgeGapLabel').textContent = `Physical gap ${fmt(b.availableAirClearance)} m · margin ${b.margin >= 0 ? '+' : '−'}${fmt(Math.abs(b.margin))} m`;
    $('#bridgeTideLabel').textContent = `Tide ${fmt(b.tideHeight)} m · charted reference ${fmt(b.referenceTide)} m`;
  }

  function traceHTML(r) {
    const methodFormula = r.squatMethod === 'barrass-blockage'
      ? `δ = Cb × S^0.81 × V^2.08 / 20 = <b>${fmt(r.squat,3)} m</b>`
      : r.squatMethod === 'simple-confined'
        ? `δ = 2 × Cb × V² / 100 = <b>${fmt(r.squat,3)} m</b>`
        : `δ = Cb × V² / 100 = <b>${fmt(r.squat,3)} m</b>`;
    const rows = [
      ['Mean draft', `T = (TF + TA) / 2 = (${fmt(r.input.draftForward)} + ${fmt(r.input.draftAft)}) / 2 = <b>${fmt(r.meanDraft,3)} m</b>`],
      ['Block coefficient', r.input.cbOverride > 0 ? `Cb override = <b>${fmt(r.cb,3)}</b>` : `Cb = (Δ / ρ) / (LBP × B × T) = <b>${fmt(r.cb,3)}</b>`],
      ['Barrass width of influence', `Wᵢ = B × [7.7 + 20(1 − Cb)²] = <b>${fmt(r.widthInfluence,1)} m</b>`],
      ['Blockage factor', `S = (B × T) / (W × H) = <b>${fmt(r.blockage,4)}</b> (${fmt(r.blockage*100,2)}%)`],
      ['Squat', methodFormula],
      ['Gross static UKC', `H − Tadjusted = ${fmt(r.totalDepth)} − ${fmt(r.adjustedDraft)} = <b>${fmt(r.grossUKC)} m</b>`],
      ['Dynamic UKC', `Gross UKC − squat − heel − wave − survey − other = <b>${fmt(r.dynamicUKC)} m</b>`],
      ['Required UKC', `max(${fmt(r.input.requiredFixed)} m, ${fmt(r.input.requiredPercent,0)}% × adjusted draft) + company margin = <b>${fmt(r.requiredUKC)} m</b>`]
    ];
    if (r.bridge.enabled) {
      rows.push(
        ['Current bridge clearance', `Ccurrent = Ccharted + Hreference − Htide = ${fmt(r.bridge.chartedVerticalClearance)} + ${fmt(r.bridge.referenceTide)} − ${fmt(r.bridge.tideHeight)} = <b>${fmt(r.bridge.currentVerticalClearance)} m</b>`],
        ['Effective air-draft envelope', `Aeffective = air draft + vertical motion + bridge survey − optional squat credit = <b>${fmt(r.bridge.effectiveAirDraft)} m</b>`],
        ['Air-clearance margin', `Ccurrent − Aeffective − required margin = <b>${fmt(r.bridge.margin)} m</b>`]
      );
    }
    return rows.map(([title, code]) => `<div class="trace-card"><span>${title}</span><code>${code}</code></div>`).join('');
  }

  function chartDefaults(title) {
    return {responsive:true,maintainAspectRatio:false,animation:{duration:180},interaction:{mode:'index',intersect:false},scales:{x:{grid:{color:'rgba(120,160,180,.12)'},ticks:{color:'#8faab6'},title:{display:true,text:'Speed (kn)',color:'#91aab5'}},y:{grid:{color:'rgba(120,160,180,.12)'},ticks:{color:'#8faab6'},title:{display:true,text:title,color:'#91aab5'}}},plugins:{legend:{labels:{color:'#bcd0d8',boxWidth:12}}}};
  }

  function updateCharts(input, r) {
    if (!window.Chart) return;
    const maxSpeed = clamp(Number($('#chartMaxSpeed').value) || 20, 5, 30), series = E.speedSeries(input,maxSpeed,.5), labels = series.map(x=>x.speed);
    const squat=series.map(x=>x.squat), ukc=series.map(x=>x.dynamicUKC), req=series.map(x=>x.requiredUKC);
    const current=labels.map(v=>Math.abs(v-input.speed)<.25?E.squatAtSpeed(input,v,r.totalDepth).squat:null);
    if(!state.charts.squat) state.charts.squat=new Chart($('#squatChart'),{type:'line',data:{labels,datasets:[{label:'Squat (m)',data:squat,borderColor:'#f0be63',backgroundColor:'rgba(240,190,99,.12)',fill:true,tension:.2,pointRadius:0},{label:'Current speed',data:current,borderColor:'#58c8e8',pointRadius:5,showLine:false}]},options:chartDefaults('Squat (m)')});
    else {state.charts.squat.data.labels=labels;state.charts.squat.data.datasets[0].data=squat;state.charts.squat.data.datasets[1].data=current;state.charts.squat.update('none');}
    if(!state.charts.ukc) state.charts.ukc=new Chart($('#ukcChart'),{type:'line',data:{labels,datasets:[{label:'Dynamic UKC',data:ukc,borderColor:'#58c8e8',backgroundColor:'rgba(88,200,232,.12)',fill:true,tension:.2,pointRadius:0},{label:'Required UKC',data:req,borderColor:'#f06f70',borderDash:[7,5],pointRadius:0,tension:0}]},options:chartDefaults('UKC (m)')});
    else {state.charts.ukc.data.labels=labels;state.charts.ukc.data.datasets[0].data=ukc;state.charts.ukc.data.datasets[1].data=req;state.charts.ukc.update('none');}
  }

  function renderSquatTable(input) {
    const center=Math.max(5,input.chartedDepth),depthStart=Math.max(5,Math.floor(center-3)),depths=Array.from({length:9},(_,i)=>depthStart+i),speeds=[4,6,8,10,12,14,16,18,20],matrix=E.squatMatrix(input,depths,speeds);
    let html='<thead><tr><th>Depth \\ Speed</th>'+speeds.map(v=>`<th>${v} kn</th>`).join('')+'</tr></thead><tbody>';
    for(const row of matrix){html+=`<tr><td class="depth">${fmt(row.depth,1)} m</td>`;for(const c of row.cells){const current=Math.abs(row.depth-input.chartedDepth)<.51&&Math.abs(c.speed-input.speed)<1.1;html+=`<td class="${c.safe?'cell-safe':'cell-unsafe'} ${current?'cell-current':''}" title="Dynamic UKC ${fmt(c.dynamicUKC)} m">${fmt(c.squat,2)}</td>`}html+='</tr>'}$('#squatTable').innerHTML=html+'</tbody>';
  }

  function updateTideChart(series, bridgeEnabled) {
    if (!window.Chart) return;
    const labels = series.map(p => formatClock(p.minute));
    const datasets = [
      {label:'Tide height (m)',data:series.map(p=>p.tide),borderColor:'#58c8e8',backgroundColor:'rgba(88,200,232,.08)',fill:false,tension:.25,pointRadius:0,borderWidth:2},
      {label:'UKC margin (m)',data:series.map(p=>p.ukcMargin),borderColor:'#6ad59a',backgroundColor:'rgba(106,213,154,.10)',fill:false,tension:.18,pointRadius:0,borderWidth:2},
      {label:'Safety boundary',data:series.map(()=>0),borderColor:'#f06f70',borderDash:[6,5],pointRadius:0,borderWidth:1}
    ];
    if (bridgeEnabled) datasets.splice(2,0,{label:'Air-clearance margin (m)',data:series.map(p=>p.airMargin),borderColor:'#f0be63',backgroundColor:'rgba(240,190,99,.08)',fill:false,tension:.18,pointRadius:0,borderWidth:2});
    const options={responsive:true,maintainAspectRatio:false,animation:{duration:120},interaction:{mode:'index',intersect:false},scales:{x:{grid:{color:'rgba(120,160,180,.10)'},ticks:{color:'#8faab6',maxTicksLimit:12},title:{display:true,text:'Time',color:'#91aab5'}},y:{grid:{color:'rgba(120,160,180,.12)'},ticks:{color:'#8faab6'},title:{display:true,text:'Height / margin (m)',color:'#91aab5'}}},plugins:{legend:{labels:{color:'#bcd0d8',boxWidth:12}}}};
    if(!state.charts.tide) state.charts.tide=new Chart($('#tideChart'),{type:'line',data:{labels,datasets},options});
    else {state.charts.tide.data.labels=labels;state.charts.tide.data.datasets=datasets;state.charts.tide.update('none');}
  }

  function renderTidePlanner(input) {
    const plan = readTidePlan();
    const events = tideEventsForEngine(plan);
    const series = E.tideWindowSeries(input, events, {
      startMinute: timeToMinutes(plan.start), durationMinutes: plan.duration*60, stepMinutes: plan.step, maxSpeed: plan.maxSpeed
    });
    const windows = E.safeWindows(series, plan.step);
    $('#safeWindowCount').textContent = windows.length;
    updateTideChart(series, Number(input.bridgeEnabled) > 0.5);

    const cards = $('#tideWindows');
    if (!windows.length) {
      cards.innerHTML = '<article class="window-card fail"><span>NO COMBINED SAFE WINDOW</span><b>Current speed / constraints cannot be satisfied during this planning interval.</b><small>Try a lower transit speed, revise the tide events, or review the entered allowances and approved limits.</small></article>';
    } else {
      cards.innerHTML = windows.map((w,i)=>`<article class="window-card"><span>SAFE WINDOW ${i+1}</span><b>${formatClock(w.startMinute)} → ${formatClock(w.endMinute)}</b><small>${fmt(w.durationMinutes/60,1)} h · worst speed ceiling ${fmt(w.minimumSpeedCeiling,1)} kn · limiting: ${esc(w.limiting)}</small><div><em>Min UKC margin</em><strong>${fmt(w.minimumUKCMargin)} m</strong>${Number.isFinite(w.minimumAirMargin)?`<em>Min air margin</em><strong>${fmt(w.minimumAirMargin)} m</strong>`:''}</div></article>`).join('');
    }

    const sampleEvery = Math.max(1, Math.round(60 / plan.step));
    const rows = series.filter((_,i)=>i%sampleEvery===0 || i===series.length-1);
    let html='<thead><tr><th>Time</th><th>Tide</th><th>Dynamic UKC</th><th>UKC margin</th><th>Bridge clearance</th><th>Air margin</th><th>Speed ceiling</th><th>Status</th></tr></thead><tbody>';
    for(const p of rows){html+=`<tr><td>${formatClock(p.minute)}</td><td>${fmt(p.tide)} m</td><td>${fmt(p.dynamicUKC)} m</td><td class="${p.ukcMargin>=0?'positive-text':'negative-text'}">${fmt(p.ukcMargin)} m</td><td>${Number.isFinite(p.bridgeClearance)?fmt(p.bridgeClearance)+' m':'—'}</td><td class="${p.airMargin==null?'':p.airMargin>=0?'positive-text':'negative-text'}">${p.airMargin==null?'—':fmt(p.airMargin)+' m'}</td><td>${fmt(p.safeSpeed,1)} kn</td><td><span class="window-pill ${p.safe?'safe':'unsafe'}">${p.safe?'SAFE':'NO-GO'}</span></td></tr>`}html+='</tbody>';$('#tideTable').innerHTML=html;
  }

  function renderScenarios(){const host=$('#scenarioCards');if(!state.scenarios.length){host.innerHTML='<div class="scenario-card"><h3>No comparison scenarios yet</h3><p class="help">Tune the passage inputs, then add the current condition to compare tide, speed, UKC and bridge clearance side by side.</p></div>';return}host.innerHTML=state.scenarios.map((s,i)=>{const r=E.calculate(s.input);return `<article class="scenario-card"><h3>${esc(s.name)}</h3><dl><dt>Depth + tide</dt><dd>${fmt(r.totalDepth)} m</dd><dt>Speed</dt><dd>${fmt(s.input.speed,1)} kn</dd><dt>Adjusted draft</dt><dd>${fmt(r.adjustedDraft)} m</dd><dt>Squat</dt><dd>${fmt(r.squat)} m</dd><dt>Dynamic UKC</dt><dd>${fmt(r.dynamicUKC)} m</dd><dt>UKC status</dt><dd>${r.status}</dd><dt>Air margin</dt><dd>${r.bridge.enabled?fmt(r.bridge.margin)+' m':'—'}</dd><dt>Overall</dt><dd>${r.overallStatus}</dd></dl><div class="card-actions"><button data-load-scenario="${i}">Load</button><button data-delete-scenario="${i}">Delete</button></div></article>`}).join('')}

  function recalc(){
    const input=readForm();updateFormulaNote();const errors=E.validate(input);$('#errors').classList.toggle('hidden',!errors.length);$('#errors').innerHTML=errors.map(x=>`<div>• ${esc(x)}</div>`).join('');if(errors.length)return;
    const r=E.calculate(input),safe=E.maxSafeSpeed(input,Math.max(25,input.speed+5));setStatus(r.overallStatus);
    $('#dynamicUKC').textContent=fmt(r.dynamicUKC);$('#margin').textContent=`${r.margin>=0?'+':'−'}${fmt(Math.abs(r.margin))}`;
    $('#airMargin').textContent=r.bridge.enabled?`${r.bridge.margin>=0?'+':'−'}${fmt(Math.abs(r.bridge.margin))}`:'—';
    statusText($('#ukcStatus'),r.status);statusText($('#bridgeStatus'),r.bridge.enabled?r.bridge.status:'N/A');
    $('#breakdown').innerHTML=breakdownHTML(r);$('#bridgeBreakdown').innerHTML=bridgeBreakdownHTML(r);
    $('#safeSpeed').textContent=fmt(safe.speed,1);$('#speedReason').textContent=safe.reason;$('#cbValue').textContent=fmt(r.cb,3);$('#widthInfluence').textContent=`${fmt(r.widthInfluence,1)} m`;$('#effectiveWidth').textContent=`${fmt(r.effectiveWidth,1)} m`;$('#blockage').textContent=`${fmt(r.blockage*100,2)}%`;
    $('#formulaTrace').innerHTML=traceHTML(r);updateDiagram(r);updateBridgeDiagram(r);updateCharts(input,r);renderSquatTable(input);renderTidePlanner(input)
  }

  function addScenario(){const input=readForm(),name=`Scenario ${state.scenarios.length+1} · ${fmt(input.speed,1)} kn / tide ${fmt(input.tideHeight,2)} m`;state.scenarios.push({name,input:{...input},createdAt:Date.now()});if(state.scenarios.length>8)state.scenarios.shift();localStorage.setItem('ukcPlannerScenarios',JSON.stringify(state.scenarios));renderScenarios();toast('Scenario added to comparison')}

  function saveCurrent(){localStorage.setItem('ukcPlannerCurrent',JSON.stringify({input:readForm(),tidePlan:readTidePlan()}));toast('Passage and tidal plan saved locally')}

  function useCurrentTideEvent(){
    const rows=$$('#tideEvents .tide-event');
    if(!rows.length)return;
    const now=new Date(),mins=now.getHours()*60+now.getMinutes();let best=rows[0],bestD=Infinity;
    for(const row of rows){const t=timeToMinutes(row.querySelector('[data-tide-time]').value),d=Math.min(Math.abs(t-mins),1440-Math.abs(t-mins));if(d<bestD){best=row;bestD=d}}
    best.querySelector('[data-tide-height]').value=state.input.tideHeight;recalc();toast('Nearest tide event height updated from current passage tide')
  }

  function bind(){
    $$('[data-field]').forEach(el=>{el.addEventListener('input',recalc);el.addEventListener('change',recalc)});
    $$('[data-tide-setting], [data-tide-time], [data-tide-height]').forEach(el=>{el.addEventListener('input',recalc);el.addEventListener('change',recalc)});
    $('#chartMaxSpeed').addEventListener('input',recalc);
    $('#sampleBtn').addEventListener('click',()=>{writeForm(DEFAULTS);writeTidePlan(DEFAULT_TIDE_PLAN);recalc();toast('Example values loaded')});
    $('#resetBtn').addEventListener('click',()=>{writeForm(DEFAULTS);writeTidePlan(DEFAULT_TIDE_PLAN);recalc()});
    $('#saveScenarioBtn').addEventListener('click',saveCurrent);
    $('#printBtn').addEventListener('click',()=>window.print());
    $('#addScenarioBtn').addEventListener('click',addScenario);
    $('#applyCurrentTide').addEventListener('click',useCurrentTideEvent);
    $('#scenarioCards').addEventListener('click',e=>{const load=e.target.closest('[data-load-scenario]'),del=e.target.closest('[data-delete-scenario]');if(load){const s=state.scenarios[Number(load.dataset.loadScenario)];if(s){writeForm(s.input);recalc();toast('Scenario loaded')}}if(del){state.scenarios.splice(Number(del.dataset.deleteScenario),1);localStorage.setItem('ukcPlannerScenarios',JSON.stringify(state.scenarios));renderScenarios()}})
  }

  const saved=JSON.parse(localStorage.getItem('ukcPlannerCurrent')||'null');
  if(saved?.input){writeForm(saved.input);writeTidePlan(saved.tidePlan||DEFAULT_TIDE_PLAN)}else{writeForm(saved||DEFAULTS);writeTidePlan(DEFAULT_TIDE_PLAN)}
  bind();renderScenarios();recalc();
})();