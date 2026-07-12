import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';

const MAX_HEATS = 8;
const FEATURES = [
  { key: 'A', label: 'A Feature' },
  { key: 'B', label: 'B Feature' },
];

const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
// Stable driver identity across the entry-list field and any saved class.
const driverKey = (d) => d.mrpEntryId || `${d.driverName}|${d.carNumber}`;

const HEAT_RE = /^heat (\d+)$/i;
const FEATURE_RE = /^([ab]) feature$/i;

// Derive what a division already has in the app, and seed the manual assignment
// from any manual classes so re-editing round-trips.
function deriveDivision(field, raceClasses) {
  const dbClasses = raceClasses.filter((c) => sameName(c.name, field.name));
  const importedHeats = dbClasses.filter(
    (c) => c.manual !== true && /heat/i.test(c.raceType || ''),
  );
  const importedOther = dbClasses.filter(
    (c) => c.manual !== true && c.raceType && !/heat/i.test(c.raceType),
  );
  const manualClasses = dbClasses.filter((c) => c.manual === true);
  const provisional = dbClasses.find((c) => !c.raceType) || null;
  const canonicalName = (dbClasses.find((c) => c.name) || field).name;
  const hasImportedHeats = importedHeats.length > 0;

  const assign = {};
  const features = { A: false, B: false };
  let heatCount = 0;
  for (const mc of manualClasses) {
    const h = HEAT_RE.exec((mc.raceType || '').trim());
    const f = FEATURE_RE.exec((mc.raceType || '').trim());
    if (h) heatCount = Math.max(heatCount, Number(h[1]));
    if (f) features[f[1].toUpperCase()] = true;
    for (const e of mc.entries || []) {
      const k = driverKey(e);
      assign[k] = assign[k] || {};
      if (h) assign[k].heat = Number(h[1]);
      if (f) assign[k].feature = f[1].toUpperCase();
    }
  }

  return {
    field,
    canonicalName,
    provisional,
    importedHeats,
    importedOther,
    manualClasses,
    hasImportedHeats,
    initState: { heatCount, features, assign },
  };
}

function DivisionBuilder({ division, state, setState }) {
  const { field, hasImportedHeats, importedHeats, importedOther } = division;
  const entries = field.entries;
  const { heatCount, features, assign } = state;

  const setAssign = (key, patch) =>
    setState((s) => ({
      ...s,
      assign: { ...s.assign, [key]: { ...s.assign[key], ...patch } },
    }));

  const counts = useMemo(() => {
    const c = { heats: {}, A: 0, B: 0, unassigned: 0 };
    for (const e of entries) {
      const a = assign[driverKey(e)] || {};
      if (a.heat) c.heats[a.heat] = (c.heats[a.heat] || 0) + 1;
      if (a.feature) c[a.feature] = (c[a.feature] || 0) + 1;
      if (!a.heat && !a.feature) c.unassigned += 1;
    }
    return c;
  }, [entries, assign]);

  const setHeatCount = (n) =>
    setState((s) => {
      const assign = { ...s.assign };
      for (const k of Object.keys(assign)) {
        if (assign[k]?.heat > n) assign[k] = { ...assign[k], heat: 0 };
      }
      return { ...s, heatCount: n, assign };
    });

  const toggleFeature = (key) =>
    setState((s) => {
      const on = !s.features[key];
      const assign = { ...s.assign };
      if (!on) {
        for (const k of Object.keys(assign)) {
          if (assign[k]?.feature === key) assign[k] = { ...assign[k], feature: '' };
        }
      }
      return { ...s, features: { ...s.features, [key]: on }, assign };
    });

  const autoHeats = () =>
    setState((s) => {
      if (s.heatCount < 1) return s;
      const assign = { ...s.assign };
      entries.forEach((e, i) => {
        assign[driverKey(e)] = { ...assign[driverKey(e)], heat: (i % s.heatCount) + 1 };
      });
      return { ...s, assign };
    });

  const allToFeature = (key) =>
    setState((s) => {
      const assign = { ...s.assign };
      entries.forEach((e) => {
        assign[driverKey(e)] = { ...assign[driverKey(e)], feature: key };
      });
      return { ...s, features: { ...s.features, [key]: true }, assign };
    });

  const clearAll = () => setState((s) => ({ ...s, assign: {} }));

  const enabledFeatures = FEATURES.filter((f) => features[f.key]);
  const importedChips = [...importedHeats, ...importedOther];

  return (
    <div className="card">
      <div className="results-head">
        <h2>{division.canonicalName}</h2>
        <span className="muted">{entries.length} entries</span>
      </div>

      {importedChips.length > 0 && (
        <p className="muted">
          Already imported from MyRacePass:{' '}
          {importedChips.map((c) => c.raceType).join(' · ')} — left untouched.
        </p>
      )}

      <div className="lineup-controls">
        {hasImportedHeats ? (
          <span className="muted">Heats imported — build Features below.</span>
        ) : (
          <label>
            Heats:{' '}
            <select
              className="result-status-select"
              value={heatCount}
              onChange={(e) => setHeatCount(Number(e.target.value))}
            >
              {Array.from({ length: MAX_HEATS + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {FEATURES.map((f) => (
          <label key={f.key} className="lineup-check">
            <input
              type="checkbox"
              checked={features[f.key]}
              onChange={() => toggleFeature(f.key)}
            />{' '}
            {f.label}
          </label>
        ))}
        <span className="lineup-spacer" />
        {!hasImportedHeats && (
          <button type="button" className="btn btn-dark" onClick={autoHeats} disabled={heatCount < 1}>
            Auto-fill heats
          </button>
        )}
        {features.A && (
          <button type="button" className="btn btn-dark" onClick={() => allToFeature('A')}>
            All → A Feature
          </button>
        )}
        <button type="button" className="btn btn-dark" onClick={clearAll}>
          Clear
        </button>
      </div>

      <p className="muted lineup-counts">
        {!hasImportedHeats &&
          Array.from({ length: heatCount }, (_, i) => i + 1).map((h) => (
            <span key={h}>Heat {h}: {counts.heats[h] || 0} · </span>
          ))}
        {enabledFeatures.map((f) => (
          <span key={f.key}>{f.label}: {counts[f.key] || 0} · </span>
        ))}
        <span>Unassigned: {counts.unassigned}</span>
      </p>

      <ol className="predict-list">
        {entries.map((e) => {
          const k = driverKey(e);
          const a = assign[k] || {};
          return (
            <li key={k} className="predict-row">
              <span className="driver-num">#{e.carNumber}</span>
              <span className="predict-name">{e.driverName}</span>
              <span className="muted predict-home">{e.hometown}</span>
              <span className="lineup-assign">
                {!hasImportedHeats && (
                  <select
                    className="result-status-select"
                    value={a.heat || 0}
                    onChange={(ev) => setAssign(k, { heat: Number(ev.target.value) })}
                    aria-label={`Heat for ${e.driverName}`}
                    disabled={heatCount < 1}
                  >
                    <option value={0}>Heat —</option>
                    {Array.from({ length: heatCount }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h}>
                        Heat {h}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  className="result-status-select"
                  value={a.feature || ''}
                  onChange={(ev) => setAssign(k, { feature: ev.target.value })}
                  aria-label={`Feature for ${e.driverName}`}
                  disabled={enabledFeatures.length === 0}
                >
                  <option value="">Feature —</option>
                  {enabledFeatures.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Turn per-division assignment state into the saveManualLineups payload, carrying
// each driver's descriptor inline. Skips empty sessions and untouched divisions.
function buildPayload(divisions, stateByDiv) {
  const out = [];
  for (const div of divisions) {
    const s = stateByDiv[div.field.name];
    if (!s) continue;
    const poolByKey = new Map(div.field.entries.map((e) => [driverKey(e), e]));
    const descriptorsFor = (pred) =>
      div.field.entries
        .filter((e) => pred(s.assign[driverKey(e)] || {}))
        .map((e) => {
          const d = poolByKey.get(driverKey(e));
          return {
            mrpEntryId: d.mrpEntryId ?? null,
            carNumber: d.carNumber ?? null,
            driverName: d.driverName,
            hometown: d.hometown ?? null,
          };
        });
    const sessions = [];
    if (!div.hasImportedHeats) {
      for (let h = 1; h <= s.heatCount; h++) {
        const drivers = descriptorsFor((a) => a.heat === h);
        if (drivers.length) sessions.push({ raceType: `Heat ${h}`, drivers });
      }
    }
    for (const f of FEATURES) {
      if (!s.features[f.key]) continue;
      const drivers = descriptorsFor((a) => a.feature === f.key);
      if (drivers.length) sessions.push({ raceType: f.label, drivers });
    }
    if (sessions.length) {
      out.push({
        provisionalClassId: div.provisional?.id ?? null,
        name: div.canonicalName,
        sessions,
      });
    }
  }
  return out;
}

export default function BuildLineups() {
  const { raceId } = useParams();
  const [race, setRace] = useState(null);
  const [divisions, setDivisions] = useState(null); // derived, from field + classes
  const [stateByDiv, setStateByDiv] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);

  const load = () =>
    Promise.all([api.getRace(raceId), api.getRaceField(raceId)])
      .then(([raceData, fieldData]) => {
        setRace(raceData.race);
        const derived = (fieldData.divisions || []).map((f) =>
          deriveDivision(f, raceData.classes),
        );
        setDivisions(derived);
        const init = {};
        for (const d of derived) init[d.field.name] = d.initState;
        setStateByDiv(init);
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  const setStateFor = (name) => (updater) =>
    setStateByDiv((prev) => ({
      ...prev,
      [name]: typeof updater === 'function' ? updater(prev[name]) : updater,
    }));

  if (error) return <p className="error">{error}</p>;
  if (!race || !divisions) return <p>Loading field…</p>;

  const save = async () => {
    const payload = buildPayload(divisions, stateByDiv);
    if (!payload.length) {
      setBanner({ type: 'error', text: 'Assign at least one driver to a heat or feature first.' });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const res = await api.saveManualLineups(race.id, { divisions: payload });
      const bits = [`${res?.classesCreated ?? 0} created`];
      if (res?.predictionsCleared) bits.push(`${res.predictionsCleared} predictions cleared`);
      if (res?.skippedExisting) bits.push(`${res.skippedExisting} skipped (already imported)`);
      setBanner({
        type: 'success',
        text: `Lineups saved for "${race.name}" — ${bits.join(', ')}. Players can predict them now.`,
      });
      await load();
    } catch (err) {
      setBanner({ type: 'error', text: `Save failed: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="detail-head">
        <h1>Build lineups — {race.name}</h1>
        <div className="admin-actions">
          <Link to={`/races/${race.id}`} className="btn btn-dark">
            View race
          </Link>
          <Link to="/admin" className="btn btn-dark">
            Back to admin
          </Link>
        </div>
      </div>
      <p className="muted">
        Split each division's entry list into Heats and Features so players can predict
        before MyRacePass posts the lineups. Divisions whose Heats already imported show
        them as read-only — you can still add their Features here. Drivers keep their
        MyRacePass id, so real results still auto-match later; a manual build is best
        scored with manual results entry.
      </p>

      {banner && <p className={banner.type}>{banner.text}</p>}

      {divisions.length === 0 ? (
        <div className="card">
          <p className="muted">
            No entry list published on MyRacePass for this event yet — nothing to build
            from. Try again once entries are posted.
          </p>
        </div>
      ) : (
        <>
          {divisions.map((div) => (
            <DivisionBuilder
              key={div.field.name}
              division={div}
              state={stateByDiv[div.field.name] ?? { heatCount: 0, features: { A: false, B: false }, assign: {} }}
              setState={setStateFor(div.field.name)}
            />
          ))}
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save lineups'}
          </button>
        </>
      )}
    </section>
  );
}
