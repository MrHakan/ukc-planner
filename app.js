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
    requiredFixed: 1.50, requiredPercent: 15, additionalSafetyMargin: 0
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
    return rows.map(([a,b,c='']) => `<div class="break-row ${c}"><span>${a}</span><b>${b}</b></div>`).join('');
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

  function traceHTML(r) {
    const methodFormula = r.squatMethod === 'barrass-blockage'
      ? `δ = Cb × S^0.81 × V^2.08 / 20 = <b>${fmt(r.squat,3)} m</b>`
      : r.squatMethod === 'simple-confined'
        ? `δ = 2 × Cb × V² / 100 = <b>${fmt(r.squat,3)} m</b>`
        : `δ = Cb × V² / 100 = <b>${fmt(r.squat,3)} m</b>`;
    return [
      ['Mean draft', `T = (TF + TA) / 2 = (${fmt(r.input.draftForward)} + ${fmt(r.input.draftAft)}) / 2 = <b>${fmt(r.meanDraft,3)} m</b>`],
      ['Block coefficient', r.input.cbOverride > 0 ? `Cb override = <b>${fmt(r.cb,3)}</b>` : `Cb = (Δ / ρ) / (LBP × B × T) = <b>${fmt(r.cb,3)}</b>`],
      ['Barrass width of influence', `Wᵢ = B × [7.7 + 20(1 − Cb)²] = <b>${fmt(r.widthInfluence,1)} m</b>`],
      ['Blockage factor', `S = (B × T) / (W × H) = <b>${fmt(r.blockage,4)}</b> (${fmt(r.blockage*100,2)}%)`],
      ['Squat', methodFormula],
      ['Gross static UKC', `H − Tadjusted = ${fmt(r.totalDepth)} − ${fmt(r.adjustedDraft)} = <b>${fmt(r.grossUKC)} m</b>`],
      ['Dynamic UKC', `Gross UKC − squat − heel − wave − survey − other = <b>${fmt(r.dynamicUKC)} m</b>`],
      ['Required UKC', `max(${fmt(r.input.requiredFixed)} m, ${fmt(r.input.requiredPercent,0)}% × adjusted draft) + company margin = <b>${fmt(r.requiredUKC)} m</b>`]
    ].map(([title, code]) => `<div class="trace-card"><span>${title}</span><code>${code}</code></div>`).join('');
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

  function renderScenarios(){const host=$('#scenarioCards');if(!state.scenarios.length){host.innerHTML='<div class="scenario-card"><h3>No comparison scenarios yet</h3><p class="help">Tune the passage inputs, then add the current condition to compare tide, speed, squat and UKC side by side.</p></div>';return}host.innerHTML=state.scenarios.map((s,i)=>{const r=E.calculate(s.input);return `<article class="scenario-card"><h3>${esc(s.name)}</h3><dl><dt>Depth + tide</dt><dd>${fmt(r.totalDepth)} m</dd><dt>Speed</dt><dd>${fmt(s.input.speed,1)} kn</dd><dt>Adjusted draft</dt><dd>${fmt(r.adjustedDraft)} m</dd><dt>Squat</dt><dd>${fmt(r.squat)} m</dd><dt>Dynamic UKC</dt><dd>${fmt(r.dynamicUKC)} m</dd><dt>Required</dt><dd>${fmt(r.requiredUKC)} m</dd><dt>Status</dt><dd>${r.status}</dd></dl><div class="card-actions"><button data-load-scenario="${i}">Load</button><button data-delete-scenario="${i}">Delete</button></div></article>`}).join('')}

  function recalc(){const input=readForm();updateFormulaNote();const errors=E.validate(input);$('#errors').classList.toggle('hidden',!errors.length);$('#errors').innerHTML=errors.map(x=>`<div>• ${esc(x)}</div>`).join('');if(errors.length)return;const r=E.calculate(input),safe=E.maxSafeSpeed(input,Math.max(25,input.speed+5));setStatus(r.status);$('#dynamicUKC').textContent=fmt(r.dynamicUKC);$('#margin').textContent=`${r.margin>=0?'+':'−'}${fmt(Math.abs(r.margin))}`;$('#breakdown').innerHTML=breakdownHTML(r);$('#safeSpeed').textContent=fmt(safe.speed,1);$('#speedReason').textContent=safe.reason;$('#cbValue').textContent=fmt(r.cb,3);$('#widthInfluence').textContent=`${fmt(r.widthInfluence,1)} m`;$('#effectiveWidth').textContent=`${fmt(r.effectiveWidth,1)} m`;$('#blockage').textContent=`${fmt(r.blockage*100,2)}%`;$('#formulaTrace').innerHTML=traceHTML(r);updateDiagram(r);updateCharts(input,r);renderSquatTable(input)}

  function addScenario(){const input=readForm(),name=`Scenario ${state.scenarios.length+1} · ${fmt(input.speed,1)} kn / tide ${fmt(input.tideHeight,2)} m`;state.scenarios.push({name,input:{...input},createdAt:Date.now()});if(state.scenarios.length>8)state.scenarios.shift();localStorage.setItem('ukcPlannerScenarios',JSON.stringify(state.scenarios));renderScenarios();toast('Scenario added to comparison')}

  function bind(){ $$('[data-field]').forEach(el=>{el.addEventListener('input',recalc);el.addEventListener('change',recalc)});$('#chartMaxSpeed').addEventListener('input',recalc);$('#sampleBtn').addEventListener('click',()=>{writeForm(DEFAULTS);recalc();toast('Example values loaded')});$('#resetBtn').addEventListener('click',()=>{writeForm(DEFAULTS);recalc()});$('#saveScenarioBtn').addEventListener('click',()=>{localStorage.setItem('ukcPlannerCurrent',JSON.stringify(readForm()));toast('Current passage saved locally')});$('#printBtn').addEventListener('click',()=>window.print());$('#addScenarioBtn').addEventListener('click',addScenario);$('#scenarioCards').addEventListener('click',e=>{const load=e.target.closest('[data-load-scenario]'),del=e.target.closest('[data-delete-scenario]');if(load){const s=state.scenarios[Number(load.dataset.loadScenario)];if(s){writeForm(s.input);recalc();toast('Scenario loaded')}}if(del){state.scenarios.splice(Number(del.dataset.deleteScenario),1);localStorage.setItem('ukcPlannerScenarios',JSON.stringify(state.scenarios));renderScenarios()}})}

  const saved=JSON.parse(localStorage.getItem('ukcPlannerCurrent')||'null');writeForm(saved||DEFAULTS);bind();renderScenarios();recalc();
})();