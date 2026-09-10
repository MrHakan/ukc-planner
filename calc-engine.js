(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.UKCEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SEA_WATER_DENSITY = 1.025;
  const MINUTES_PER_DAY = 1440;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const n = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const round = (v, d = 3) => Number(Number(v).toFixed(d));

  const CATZOC = {
    A1: { label: 'A1', fixed: 0.50, percent: 0.01, note: 'Reference allowance: 0.50 m + 1% of depth' },
    A2: { label: 'A2', fixed: 1.00, percent: 0.02, note: 'Reference allowance: 1.00 m + 2% of depth' },
    B:  { label: 'B',  fixed: 1.00, percent: 0.02, note: 'Reference allowance: 1.00 m + 2% of depth' },
    C:  { label: 'C',  fixed: 2.00, percent: 0.05, note: 'Reference allowance: 2.00 m + 5% of depth' },
    D:  { label: 'D',  fixed: null, percent: null, note: 'Worse than CATZOC C — use a manual company / hydrographic allowance' },
    U:  { label: 'U',  fixed: null, percent: null, note: 'Unassessed — use a manual company / hydrographic allowance' },
    MANUAL: { label: 'Manual', fixed: null, percent: null, note: 'Manual survey uncertainty allowance' }
  };

  function statusFromMargin(margin, tightBand = 0.25) {
    return margin < 0 ? 'FAIL' : margin < tightBand ? 'TIGHT' : 'PASS';
  }

  function meanDraft(i) {
    return (n(i.draftForward) + n(i.draftAft)) / 2;
  }

  function displacementVolume(i) {
    const rho = Math.max(0.8, n(i.waterDensity, SEA_WATER_DENSITY));
    return n(i.displacement) / rho;
  }

  function blockCoefficient(i) {
    if (n(i.cbOverride) > 0) return clamp(n(i.cbOverride), 0.2, 1.2);
    const L = Math.max(0.1, n(i.lbp));
    const B = Math.max(0.1, n(i.beam));
    const T = Math.max(0.1, meanDraft(i));
    return clamp(displacementVolume(i) / (L * B * T), 0.2, 1.2);
  }

  function widthOfInfluence(i, cb) {
    const B = Math.max(0.1, n(i.beam));
    return B * (7.7 + 20 * Math.pow(1 - cb, 2));
  }

  function effectiveChannelWidth(i, cb) {
    const entered = n(i.channelWidth);
    if (entered > 0) return entered;
    return widthOfInfluence(i, cb);
  }

  function blockageFactor(i, cb, waterDepth) {
    const B = Math.max(0.1, n(i.beam));
    const T = Math.max(0.1, meanDraft(i));
    const W = Math.max(B + 0.1, effectiveChannelWidth(i, cb));
    const H = Math.max(T + 0.01, waterDepth);
    return clamp((B * T) / (W * H), 0, 0.95);
  }

  function squatAtSpeed(i, speed, waterDepthOverride) {
    const V = Math.max(0, n(speed));
    const H = Math.max(0.1, n(waterDepthOverride, n(i.chartedDepth) + n(i.tideHeight)));
    const cb = blockCoefficient(i);
    const method = i.squatMethod || 'barrass-blockage';

    if (method === 'simple-open') {
      return { squat: cb * V * V / 100, method, cb, widthInfluence: widthOfInfluence(i, cb), effectiveWidth: effectiveChannelWidth(i, cb), blockage: 0 };
    }
    if (method === 'simple-confined') {
      return { squat: 2 * cb * V * V / 100, method, cb, widthInfluence: widthOfInfluence(i, cb), effectiveWidth: effectiveChannelWidth(i, cb), blockage: 0 };
    }

    const S = blockageFactor(i, cb, H);
    const squat = cb * Math.pow(Math.max(S, 1e-9), 0.81) * Math.pow(V, 2.08) / 20;
    return { squat, method: 'barrass-blockage', cb, widthInfluence: widthOfInfluence(i, cb), effectiveWidth: effectiveChannelWidth(i, cb), blockage: S };
  }

  function densityDraftCorrection(i) {
    const fwaMm = Math.max(0, n(i.fwaMm));
    const rho = n(i.waterDensity, SEA_WATER_DENSITY);
    if (!fwaMm || !rho) return 0;
    return (fwaMm / 1000) * ((SEA_WATER_DENSITY - rho) / 0.025);
  }

  function heelAllowance(i) {
    const manual = Math.max(0, n(i.heelAllowanceManual));
    if (manual > 0) return manual;
    const angle = Math.abs(n(i.heelAngle));
    return (Math.max(0, n(i.beam)) / 2) * Math.sin(angle * Math.PI / 180);
  }

  function surveyAllowance(i, totalDepth) {
    const key = i.catzoc || 'MANUAL';
    const zoc = CATZOC[key] || CATZOC.MANUAL;
    const manual = Math.max(0, n(i.surveyAllowanceManual));
    if (zoc.fixed == null) return manual;
    return zoc.fixed + zoc.percent * Math.max(0, totalDepth) + manual;
  }

  function requiredUKC(i, adjustedDraft) {
    const pct = Math.max(0, n(i.requiredPercent)) / 100 * adjustedDraft;
    const fixed = Math.max(0, n(i.requiredFixed));
    return Math.max(pct, fixed) + Math.max(0, n(i.additionalSafetyMargin));
  }

  function bridgeClearance(input, tideHeightOverride, speedOverride) {
    const i = { ...input };
    const enabled = n(i.bridgeEnabled) > 0.5;
    if (!enabled) {
      return { enabled: false, status: 'N/A', margin: Infinity, currentVerticalClearance: Infinity, availableAirClearance: Infinity, effectiveAirDraft: 0, requiredAirClearance: 0, squatCredit: 0 };
    }

    const tide = n(tideHeightOverride, n(i.tideHeight));
    const charted = Math.max(0, n(i.chartedBridgeClearance));
    const referenceTide = n(i.bridgeReferenceTide);
    const airDraft = Math.max(0, n(i.airDraft));
    const verticalMotion = Math.max(0, n(i.verticalMotionAllowance));
    const survey = Math.max(0, n(i.bridgeSurveyAllowance));
    const required = Math.max(0, n(i.requiredAirClearance));
    const speed = Math.max(0, n(speedOverride, n(i.speed)));
    const waterDepth = Math.max(0.1, n(i.chartedDepth) + tide);
    const allowSquatCredit = n(i.bridgeSquatCredit) > 0.5;
    const squatCredit = allowSquatCredit ? Math.max(0, squatAtSpeed({ ...i, tideHeight: tide }, speed, waterDepth).squat) : 0;

    const currentVerticalClearance = charted + referenceTide - tide;
    const effectiveAirDraft = Math.max(0, airDraft + verticalMotion + survey - squatCredit);
    const availableAirClearance = currentVerticalClearance - effectiveAirDraft;
    const margin = availableAirClearance - required;

    return {
      enabled: true,
      chartedVerticalClearance: charted,
      referenceTide,
      tideHeight: tide,
      currentVerticalClearance,
      airDraft,
      verticalMotionAllowance: verticalMotion,
      surveyAllowance: survey,
      squatCredit,
      effectiveAirDraft,
      availableAirClearance,
      requiredAirClearance: required,
      margin,
      status: statusFromMargin(margin, 0.50)
    };
  }

  function calculate(input) {
    const i = { ...input };
    const forward = Math.max(0, n(i.draftForward));
    const aft = Math.max(0, n(i.draftAft));
    const md = (forward + aft) / 2;
    const totalDepth = n(i.chartedDepth) + n(i.tideHeight);
    const densityCorr = densityDraftCorrection(i) + n(i.manualDraftCorrection);
    const adjustedDraft = md + densityCorr;
    const grossUKC = totalDepth - adjustedDraft;
    const squatData = squatAtSpeed(i, n(i.speed), totalDepth);
    const heel = heelAllowance(i);
    const wave = Math.max(0, n(i.waveAllowance));
    const survey = Math.max(0, surveyAllowance(i, totalDepth));
    const other = Math.max(0, n(i.otherAllowance));
    const dynamicUKC = grossUKC - squatData.squat - heel - wave - survey - other;
    const required = requiredUKC(i, adjustedDraft);
    const margin = dynamicUKC - required;
    const status = statusFromMargin(margin, 0.25);
    const bridge = bridgeClearance(i, n(i.tideHeight), n(i.speed));
    const overallStatus = status === 'FAIL' || bridge.status === 'FAIL' ? 'FAIL' : status === 'TIGHT' || bridge.status === 'TIGHT' ? 'TIGHT' : 'PASS';

    return {
      input: i, meanDraft: md, totalDepth, densityDraftCorrection: densityCorr, adjustedDraft, grossUKC,
      squat: squatData.squat, squatMethod: squatData.method, cb: squatData.cb,
      widthInfluence: squatData.widthInfluence, effectiveWidth: squatData.effectiveWidth, blockage: squatData.blockage,
      heelAllowance: heel, waveAllowance: wave, surveyAllowance: survey, otherAllowance: other,
      dynamicUKC, requiredUKC: required, margin, status, overallStatus, trim: aft - forward,
      bridge,
      catzoc: CATZOC[i.catzoc || 'MANUAL'] || CATZOC.MANUAL
    };
  }

  function constraintMargin(result) {
    return Math.min(result.margin, result.bridge.enabled ? result.bridge.margin : Infinity);
  }

  function maxSafeSpeed(input, upper = 25) {
    const top = Math.max(1, n(upper, 25));
    const atZero = calculate({ ...input, speed: 0 });
    if (constraintMargin(atZero) < 0) return { speed: 0, bounded: true, reason: atZero.bridge.enabled && atZero.bridge.margin < 0 ? 'Bridge air-clearance requirement is not met at the current tide' : 'Insufficient UKC even at zero speed' };
    const atTop = calculate({ ...input, speed: top });
    if (constraintMargin(atTop) >= 0) return { speed: top, bounded: false, reason: `All enabled clearance requirements remain satisfied through ${top} kn` };

    if (n(input.bridgeSquatCredit) <= 0.5) {
      let lo = 0, hi = top;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (constraintMargin(calculate({ ...input, speed: mid })) >= 0) lo = mid;
        else hi = mid;
      }
      return { speed: lo, bounded: true, reason: 'Maximum speed before an enabled clearance constraint is breached' };
    }

    let best = 0;
    for (let v = 0; v <= top + 1e-9; v += 0.05) if (constraintMargin(calculate({ ...input, speed: v })) >= 0) best = v;
    return { speed: Math.min(top, best), bounded: best < top - 0.025, reason: 'Maximum safe speed from combined UKC and overhead-clearance scan' };
  }

  function speedSeries(input, maxSpeed = 20, step = 0.5) {
    const out = [];
    for (let v = 0; v <= maxSpeed + 1e-9; v += step) {
      const r = calculate({ ...input, speed: v });
      out.push({ speed: round(v, 2), squat: r.squat, dynamicUKC: r.dynamicUKC, requiredUKC: r.requiredUKC, margin: r.margin, airMargin: r.bridge.enabled ? r.bridge.margin : null, overallSafe: constraintMargin(r) >= 0 });
    }
    return out;
  }

  function squatMatrix(input, depths, speeds) {
    return depths.map(depth => ({
      depth,
      cells: speeds.map(speed => {
        const squat = squatAtSpeed({ ...input, chartedDepth: depth, tideHeight: 0 }, speed, depth).squat;
        const r = calculate({ ...input, chartedDepth: depth, tideHeight: 0, speed });
        return { speed, squat, dynamicUKC: r.dynamicUKC, safe: r.margin >= 0 };
      })
    }));
  }

  function normalizeTideEvents(events) {
    const cleaned = (Array.isArray(events) ? events : [])
      .map(e => ({ minute: ((n(e.minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY, height: n(e.height), label: e.label || '' }))
      .filter(e => Number.isFinite(e.minute) && Number.isFinite(e.height))
      .sort((a, b) => a.minute - b.minute);
    const deduped = [];
    for (const e of cleaned) {
      const prev = deduped[deduped.length - 1];
      if (prev && Math.abs(prev.minute - e.minute) < 1e-9) prev.height = e.height;
      else deduped.push(e);
    }
    return deduped;
  }

  function tideHeightAt(events, minute) {
    const ev = normalizeTideEvents(events);
    if (!ev.length) return 0;
    if (ev.length === 1) return ev[0].height;
    const t = ((n(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    let prev = null, next = null;
    for (const e of ev) {
      if (e.minute <= t) prev = e;
      if (e.minute > t) { next = e; break; }
    }
    if (!prev) prev = { ...ev[ev.length - 1], minute: ev[ev.length - 1].minute - MINUTES_PER_DAY };
    if (!next) next = { ...ev[0], minute: ev[0].minute + MINUTES_PER_DAY };
    const span = Math.max(1, next.minute - prev.minute);
    const f = clamp((t - prev.minute) / span, 0, 1);
    const cosine = (1 - Math.cos(Math.PI * f)) / 2;
    return prev.height + (next.height - prev.height) * cosine;
  }

  function tideWindowSeries(input, events, options = {}) {
    const startMinute = n(options.startMinute, 0);
    const durationMinutes = clamp(n(options.durationMinutes, MINUTES_PER_DAY), 30, 3 * MINUTES_PER_DAY);
    const stepMinutes = clamp(n(options.stepMinutes, 10), 1, 120);
    const maxSpeed = clamp(n(options.maxSpeed, 25), 1, 40);
    const out = [];
    for (let elapsed = 0; elapsed <= durationMinutes + 1e-9; elapsed += stepMinutes) {
      const minute = startMinute + elapsed;
      const tide = tideHeightAt(events, minute);
      const r = calculate({ ...input, tideHeight: tide });
      const speed = maxSafeSpeed({ ...input, tideHeight: tide }, maxSpeed);
      const airMargin = r.bridge.enabled ? r.bridge.margin : null;
      const safe = r.margin >= 0 && (!r.bridge.enabled || r.bridge.margin >= 0);
      let limiting = 'UKC';
      if (r.bridge.enabled && r.bridge.margin < r.margin) limiting = 'Air clearance';
      out.push({
        minute, elapsed, tide, ukcMargin: r.margin, dynamicUKC: r.dynamicUKC, requiredUKC: r.requiredUKC,
        airMargin, bridgeClearance: r.bridge.enabled ? r.bridge.currentVerticalClearance : null,
        safeSpeed: speed.speed, safe, limiting
      });
    }
    return out;
  }

  function safeWindows(series, stepMinutes = 10) {
    const points = Array.isArray(series) ? series : [];
    const windows = [];
    let current = null;
    for (let idx = 0; idx < points.length; idx++) {
      const p = points[idx];
      if (p.safe && !current) current = { startMinute: p.minute, endMinute: p.minute, points: [p] };
      else if (p.safe && current) { current.endMinute = p.minute; current.points.push(p); }
      if ((!p.safe || idx === points.length - 1) && current) {
        if (p.safe && idx === points.length - 1) current.endMinute = p.minute;
        else current.endMinute = Math.max(current.startMinute, points[Math.max(0, idx - 1)].minute + stepMinutes);
        const speeds = current.points.map(x => x.safeSpeed);
        const ukcMargins = current.points.map(x => x.ukcMargin);
        const airMargins = current.points.map(x => x.airMargin).filter(Number.isFinite);
        current.durationMinutes = Math.max(0, current.endMinute - current.startMinute);
        current.minimumSpeedCeiling = speeds.length ? Math.min(...speeds) : 0;
        current.minimumUKCMargin = ukcMargins.length ? Math.min(...ukcMargins) : NaN;
        current.minimumAirMargin = airMargins.length ? Math.min(...airMargins) : null;
        current.limiting = current.points.reduce((acc, x) => x.limiting === 'Air clearance' ? 'Air clearance' : acc, 'UKC');
        delete current.points;
        windows.push(current);
        current = null;
      }
    }
    return windows;
  }

  function validate(input) {
    const errors = [];
    if (n(input.lbp) <= 0) errors.push('LBP must be greater than zero.');
    if (n(input.beam) <= 0) errors.push('Beam must be greater than zero.');
    if (n(input.draftForward) <= 0 || n(input.draftAft) <= 0) errors.push('Forward and aft drafts must be greater than zero.');
    if (n(input.displacement) <= 0 && n(input.cbOverride) <= 0) errors.push('Provide displacement or a block coefficient override.');
    if (n(input.chartedDepth) <= 0) errors.push('Charted depth must be greater than zero.');
    if (n(input.chartedDepth) + n(input.tideHeight) <= 0) errors.push('Total water depth must be greater than zero.');
    if (n(input.waterDensity) < 0.95 || n(input.waterDensity) > 1.05) errors.push('Water density should normally be between 0.950 and 1.050 t/m³.');
    if (n(input.bridgeEnabled) > 0.5) {
      if (n(input.chartedBridgeClearance) <= 0) errors.push('Charted bridge vertical clearance must be greater than zero when overhead clearance is enabled.');
      if (n(input.airDraft) <= 0) errors.push('Vessel air draft must be greater than zero when overhead clearance is enabled.');
      if (n(input.requiredAirClearance) < 0) errors.push('Required air-clearance margin cannot be negative.');
    }
    return errors;
  }

  return {
    SEA_WATER_DENSITY, MINUTES_PER_DAY, CATZOC, statusFromMargin, meanDraft, displacementVolume, blockCoefficient,
    widthOfInfluence, effectiveChannelWidth, blockageFactor, squatAtSpeed, densityDraftCorrection, heelAllowance,
    surveyAllowance, requiredUKC, bridgeClearance, calculate, constraintMargin, maxSafeSpeed, speedSeries, squatMatrix,
    normalizeTideEvents, tideHeightAt, tideWindowSeries, safeWindows, validate, round
  };
});