import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';

const MAX_HEATS = 8;
const FEATURES = [
  { key: 'A', label: 'A Feature' },
  { key: 'B', label: 'B Feature' },
];

// Assignment for one driver: which heat (1..N, 0 = none) and which feature
// ('A'/'B'/'' = none). A driver typically runs one heat AND the feature.
const emptyState = () => ({ heatCount: 0, features: { A: false, B: false }, assign: {} });

function DivisionBuilder({ division, state, setState }) {
  const entries = division.entries;
  const { heatCount, features, assign } = state;

  const setAssign = (entryId, patch) =>
    setState((s) => ({
      ...s,
      assign: { ...s.assign, [entryId]: { ...s.assign[entryId], ...patch } },
    }));

  const counts = useMemo(() => {
    const c = { heats: {}, A: 0, B: 0, unassigned: 0 };
    for (const e of entries) {
      const a = assign[e.id] || {};
      if (a.heat) c.heats[a.heat] = (c.heats[a.heat] || 0) + 1;
      if (a.feature) c[a.feature] = (c[a.feature] || 0) + 1;
      if (!a.heat && !a.feature) c.unassigned += 1;
    }
    return c;
  }, [entries, assign]);

  const setHeatCount = (n) =>
    setState((s) => {
      // Dropping heats clears assignments that pointed at removed heats.
      const assign = { ...s.assign };
      for (const id of Object.keys(assign)) {
        if (assign[id]?.heat > n) assign[id] = { ...assign[id], heat: 0 };
      }
      return { ...s, heatCount: n, assign };
    });

  const toggleFeature = (key) =>
    setState((s) => {
      const on = !s.features[key];
      const assign = { ...s.assign };
      if (!on) {
        for (const id of Object.keys(assign)) {
          if (assign[id]?.feature === key) assign[id] = { ...assign[id], feature: '' };
        }
      }
      return { ...s, features: { ...s.features, [key]: on }, assign };
    });

  // Round-robin the field across the heats, in current lineup order.
  const autoHeats = () =>
    setState((s) => {
      if (s.heatCount < 1) return s;
      const assign = { ...s.assign };
      entries.forEach((e, i) => {
        assign[e.id] = { ...assign[e.id], heat: (i % s.heatCount) + 1 };
      });
      return { ...s, assign };
    });

  const allToFeature = (key) =>
    setState((s) => {
      const assign = { ...s.assign };
      entries.forEach((e) => {
        assign[e.id] = { ...assign[e.id], feature: key };
      });
      return { ...s, features: { ...s.features, [key]: true }, assign };
    });

  const clearAll = () => setState((s) => ({ ...s, assign: {} }));

  const enabledFeatures = FEATURES.filter((f) => features[f.key]);

  return (
    <div className="card">
      <div className="results-head">
        <h2>{division.name}</h2>
        <span className="muted">{entries.length} entries</span>
      </div>

      <div className="lineup-controls">
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
        <button type="button" className="btn btn-dark" onClick={autoHeats} disabled={heatCount < 1}>
          Auto-fill heats
        </button>
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
        {Array.from({ length: heatCount }, (_, i) => i + 1).map((h) => (
          <span key={h}>Heat {h}: {counts.heats[h] || 0} · </span>
        ))}
        {enabledFeatures.map((f) => (
          <span key={f.key}>{f.label}: {counts[f.key] || 0} · </span>
        ))}
        <span>Unassigned: {counts.unassigned}</span>
      </p>

      <ol className="predict-list">
        {entries.map((e) => {
          const a = assign[e.id] || {};
          return (
            <li key={e.id} className="predict-row">
              <span className="driver-num">#{e.carNumber}</span>
              <span className="predict-name">{e.driverName}</span>
              <span className="muted predict-home">{e.hometown}</span>
              <span className="lineup-assign">
                <select
                  className="result-status-select"
                  value={a.heat || 0}
                  onChange={(ev) => setAssign(e.id, { heat: Number(ev.target.value) })}
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
                <select
                  className="result-status-select"
                  value={a.feature || ''}
                  onChange={(ev) => setAssign(e.id, { feature: ev.target.value })}
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

// Turn the per-division assignment state into the saveManualLineups payload,
// skipping empty sessions and divisions with nothing assigned.
function buildPayload(provisional, stateByDiv) {
  const divisions = [];
  for (const div of provisional) {
    const s = stateByDiv[div.id];
    if (!s) continue;
    const sessions = [];
    for (let h = 1; h <= s.heatCount; h++) {
      const entryIds = div.entries
        .filter((e) => s.assign[e.id]?.heat === h)
        .map((e) => e.id);
      if (entryIds.length) sessions.push({ raceType: `Heat ${h}`, entryIds });
    }
    for (const f of FEATURES) {
      if (!s.features[f.key]) continue;
      const entryIds = div.entries
        .filter((e) => s.assign[e.id]?.feature === f.key)
        .map((e) => e.id);
      if (entryIds.length) sessions.push({ raceType: f.label, entryIds });
    }
    if (sessions.length) {
      divisions.push({ provisionalClassId: div.id, name: div.name, sessions });
    }
  }
  return divisions;
}

export default function BuildLineups() {
  const { raceId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [stateByDiv, setStateByDiv] = useState({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);

  const load = () =>
    api
      .getRace(raceId)
      .then((d) => {
        setData(d);
        const init = {};
        for (const div of d.classes.filter((c) => !c.raceType)) init[div.id] = emptyState();
        setStateByDiv(init);
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  const setStateFor = (divId) => (updater) =>
    setStateByDiv((prev) => ({
      ...prev,
      [divId]: typeof updater === 'function' ? updater(prev[divId]) : updater,
    }));

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading race…</p>;

  const { race, classes } = data;
  const provisional = classes.filter((c) => !c.raceType);

  const save = async () => {
    const divisions = buildPayload(provisional, stateByDiv);
    if (!divisions.length) {
      setBanner({ type: 'error', text: 'Assign at least one driver to a heat or feature first.' });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const res = await api.saveManualLineups(race.id, { divisions });
      setBanner({
        type: 'success',
        text: `Lineups saved for "${race.name}" — ${res?.classesCreated ?? 0} classes created${
          res?.predictionsCleared ? `, ${res.predictionsCleared} predictions cleared` : ''
        }. Players can predict them now.`,
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
        Split each division's imported entry list into Heats and Features so players can
        predict them before MyRacePass posts the lineups. Assign each driver to a heat
        and/or a feature, then save. Drivers keep their MyRacePass id, so real results
        still auto-match later — though a manual build is best scored with manual results
        entry, and a later MyRacePass import may duplicate any sessions whose labels don't
        match.
      </p>

      {banner && <p className={banner.type}>{banner.text}</p>}

      {provisional.length === 0 ? (
        <div className="card">
          <p className="muted">
            No entry-list divisions to build from. Import the entry list first (Admin →
            “Import entries”). Divisions that already have Heat/Feature lineups aren't shown
            here.
          </p>
        </div>
      ) : (
        <>
          {provisional.map((div) => (
            <DivisionBuilder
              key={div.id}
              division={div}
              state={stateByDiv[div.id] ?? emptyState()}
              setState={setStateFor(div.id)}
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
