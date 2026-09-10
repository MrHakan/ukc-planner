(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.UKCEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SEA_WATER_DENSITY = 1.025;
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
    const status = margin < 0 ? 'FAIL' : margin < 0.25 ? 'TIGHT' : 'PASS';

    return {
      input: i, meanDraft: md, totalDepth, densityDraftCorrection: densityCorr, adjustedDraft, grossUKC,
      squat: squatData.squat, squatMethod: squatData.method, cb: squatData.cb,
      widthInfluence: squatData.widthInfluence, effectiveWidth: squatData.effectiveWidth, blockage: squatData.blockage,
      heelAllowance: heel, waveAllowance: wave, surveyAllowance: survey, otherAllowance: other,
      dynamicUKC, requiredUKC: required, margin, status, trim: aft - forward,
      catzoc: CATZOC[i.catzoc || 'MANUAL'] || CATZOC.MANUAL
    };
  }

  function maxSafeSpeed(input, upper = 25) {
    const top = Math.max(1, n(upper, 25));
    const atZero = calculate({ ...input, speed: 0 });
    if (atZero.margin < 0) return { speed: 0, bounded: true, reason: 'Insufficient UKC even at zero speed' };
    const atTop = calculate({ ...input, speed: top });
    if (atTop.margin >= 0) return { speed: top, bounded: false, reason: `Requirement remains satisfied through ${top} kn` };
    let lo = 0, hi = top;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (calculate({ ...input, speed: mid }).margin >= 0) lo = mid;
      else hi = mid;
    }
    return { speed: lo, bounded: true, reason: 'Maximum speed before dynamic UKC falls below requirement' };
  }

  function speedSeries(input, maxSpeed = 20, step = 0.5) {
    const out = [];
    for (let v = 0; v <= maxSpeed + 1e-9; v += step) {
      const r = calculate({ ...input, speed: v });
      out.push({ speed: round(v, 2), squat: r.squat, dynamicUKC: r.dynamicUKC, requiredUKC: r.requiredUKC, margin: r.margin });
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

  function validate(input) {
    const errors = [];
    if (n(input.lbp) <= 0) errors.push('LBP must be greater than zero.');
    if (n(input.beam) <= 0) errors.push('Beam must be greater than zero.');
    if (n(input.draftForward) <= 0 || n(input.draftAft) <= 0) errors.push('Forward and aft drafts must be greater than zero.');
    if (n(input.displacement) <= 0 && n(input.cbOverride) <= 0) errors.push('Provide displacement or a block coefficient override.');
    if (n(input.chartedDepth) <= 0) errors.push('Charted depth must be greater than zero.');
    if (n(input.chartedDepth) + n(input.tideHeight) <= 0) errors.push('Total water depth must be greater than zero.');
    if (n(input.waterDensity) < 0.95 || n(input.waterDensity) > 1.05) errors.push('Water density should normally be between 0.950 and 1.050 t/m³.');
    return errors;
  }

  return { SEA_WATER_DENSITY, CATZOC, meanDraft, displacementVolume, blockCoefficient, widthOfInfluence, effectiveChannelWidth, blockageFactor, squatAtSpeed, densityDraftCorrection, heelAllowance, surveyAllowance, requiredUKC, calculate, maxSafeSpeed, speedSeries, squatMatrix, validate, round };
});