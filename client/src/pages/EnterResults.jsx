import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';

const DNX_OPTIONS = [
  { value: '', label: 'Finished' },
  { value: 'DNF', label: 'DNF' },
  { value: 'DNS', label: 'DNS' },
  { value: 'DQ', label: 'DQ' },
];

// Build the starting rows for a class: prefer already-saved results (in their
// stored order — finishers first, DNS/DNF last), then append any entries that
// have no result row yet as finishers. Falls back to entry order when no
// results exist. A row is { entryId, status } where status is null for a
// finisher, or 'DNF' / 'DNS' / 'DQ'.
function initialRows(cls) {
  const entryIds = cls.entries.map((e) => e.id);
  const entrySet = new Set(entryIds);
  if (cls.results?.length) {
    const rows = [];
    const used = new Set();
    for (const r of cls.results) {
      if (r.entryId && entrySet.has(r.entryId) && !used.has(r.entryId)) {
        rows.push({
          entryId: r.entryId,
          status: r.finishPosition > 0 ? null : r.status || 'DNF',
        });
        used.add(r.entryId);
      }
    }
    for (const id of entryIds) {
      if (!used.has(id)) rows.push({ entryId: id, status: null });
    }
    return rows;
  }
  return entryIds.map((id) => ({ entryId: id, status: null }));
}

// Move the row at `fromIndex` so it becomes the `targetRank`-th finisher
// (1-based), leaving DNS/DNF rows where they are. Used by the position dropdown.
function moveToFinisherRank(rows, fromIndex, targetRank) {
  const row = rows[fromIndex];
  const rest = rows.filter((_, i) => i !== fromIndex);
  let count = 0;
  let insertAt = rest.length;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].status == null) {
      count += 1;
      if (count === targetRank) {
        insertAt = i;
        break;
      }
    }
  }
  rest.splice(insertAt, 0, row);
  return rest;
}

function ClassResultsEditor({ raceId, cls, rows, setRows }) {
  const entryById = useMemo(
    () => new Map(cls.entries.map((e) => [e.id, e])),
    [cls.entries],
  );
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [scoring, setScoring] = useState(false);
  const [msg, setMsg] = useState(null); // { type, text }

  // Finisher rank (1-based) per row index, or null for a DNS/DNF/DQ row.
  const ranks = useMemo(() => {
    let c = 0;
    return rows.map((r) => (r.status == null ? (c += 1) : null));
  }, [rows]);
  const finisherCount = ranks.filter((r) => r != null).length;

  const reorder = (from, to) => {
    if (from === to || from == null || to == null) return;
    setRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };
  const move = (i, dir) => reorder(i, i + dir);

  const onDragStart = (i) => (e) => {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  };
  const onDragOver = (i) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== i) setOverIndex(i);
  };
  const onDrop = (i) => (e) => {
    e.preventDefault();
    reorder(dragIndex, i);
    setDragIndex(null);
    setOverIndex(null);
  };
  const onDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  // Jump a finisher to a chosen place via the P1/P2/P3… dropdown.
  const setRank = (i, targetRank) => setRows((prev) => moveToFinisherRank(prev, i, targetRank));

  // Mark a driver's result. Selecting a DNS/DNF/DQ pushes the row to the bottom
  // so the finishing positions above stay contiguous; back to "Finished" leaves
  // it in place (it re-numbers where it sits).
  const setStatus = (i, value) => {
    const status = value || null;
    setRows((prev) => {
      const next = prev.map((r, idx) => (idx === i ? { ...r, status } : r));
      if (status) {
        const [row] = next.splice(i, 1);
        next.push(row);
      }
      return next;
    });
  };

  // Save + score just this class. Scoring is scoped server-side to this class,
  // so it never disturbs other classes' predictions or the race's status until
  // every class is in.
  const scoreClass = async () => {
    setScoring(true);
    setMsg(null);
    try {
      const payload = [
        {
          classId: cls.id,
          rows: rows.map((r) => ({ entryId: r.entryId, status: r.status })),
        },
      ];
      const res = await api.enterRaceResults(raceId, payload);
      setMsg({
        type: 'success',
        text: `Results saved — ${res?.scoredPredictions ?? 0} predictions scored${
          res?.raceCompleted ? '. All classes scored — race complete.' : '.'
        }`,
      });
    } catch (err) {
      setMsg({ type: 'error', text: `Scoring failed: ${err.message}` });
    } finally {
      setScoring(false);
    }
  };

  if (cls.entries.length === 0) {
    return (
      <div className="card">
        <div className="results-head">
          <h2>{cls.name}</h2>
        </div>
        <p className="muted">No entries for this class — nothing to place.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="results-head">
        <h2>
          {cls.name}
          {cls.series ? <span className="muted"> · {cls.series}</span> : null}
        </h2>
        <span className="muted">{cls.entries.length} entries</span>
      </div>
      <p className="muted">
        Drag rows, use the ▲/▼ buttons, or pick a place on the left to set the
        finish. Mark non-finishers with the results dropdown.
      </p>
      <ol className="predict-list">
        {rows.map((row, i) => {
          const e = entryById.get(row.entryId);
          const rank = ranks[i];
          const klass = [
            'predict-row',
            'predict-draggable',
            dragIndex === i ? 'dragging' : '',
            overIndex === i && dragIndex !== i ? 'drag-over' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li
              key={row.entryId}
              className={klass}
              draggable
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver(i)}
              onDrop={onDrop(i)}
              onDragEnd={onDragEnd}
            >
              <span className="predict-handle" aria-hidden="true">
                ⠿
              </span>
              {row.status ? (
                <span className="predict-pos predict-pos-dnx">{row.status}</span>
              ) : (
                <select
                  className="result-pos-select"
                  value={rank}
                  onChange={(ev) => setRank(i, Number(ev.target.value))}
                  aria-label="Finish position"
                >
                  {Array.from({ length: finisherCount }, (_, k) => k + 1).map((p) => (
                    <option key={p} value={p}>
                      P{p}
                    </option>
                  ))}
                </select>
              )}
              <span className="driver-num">#{e?.carNumber}</span>
              <span className="predict-name">{e?.driverName}</span>
              <span className="muted predict-home">{e?.hometown}</span>
              <span className="predict-moves">
                <select
                  className="result-status-select"
                  value={row.status ?? ''}
                  onChange={(ev) => setStatus(i, ev.target.value)}
                  aria-label="Result status"
                >
                  {DNX_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="predict-move"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="predict-move"
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label="Move down"
                >
                  ▼
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      {msg && <p className={msg.type}>{msg.text}</p>}
      <button
        type="button"
        className="btn btn-primary"
        onClick={scoreClass}
        disabled={scoring}
      >
        {scoring ? 'Scoring…' : 'Score race'}
      </button>
    </div>
  );
}

export default function EnterResults() {
  const { raceId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [rowsByClass, setRowsByClass] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getRace(raceId)
      .then((d) => {
        setData(d);
        const init = {};
        for (const cls of d.classes) init[cls.id] = initialRows(cls);
        setRowsByClass(init);
      })
      .catch((err) => setError(err.message));
  }, [raceId]);

  const setRowsFor = (classId) => (updater) =>
    setRowsByClass((prev) => ({
      ...prev,
      [classId]: typeof updater === 'function' ? updater(prev[classId]) : updater,
    }));

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading race…</p>;

  const { race, classes } = data;

  return (
    <section>
      <div className="detail-head">
        <h1>Enter results — {race.name}</h1>
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
        Set each class's finishing order, then score that class to award points to
        its predictions. Each class scores on its own — you can score them as they
        finish and re-run any class later to correct results.
      </p>

      {classes.length === 0 ? (
        <div className="card">
          <p className="muted">No classes imported for this event yet.</p>
        </div>
      ) : (
        classes.map((cls) => (
          <ClassResultsEditor
            key={cls.id}
            raceId={race.id}
            cls={cls}
            rows={rowsByClass[cls.id] ?? []}
            setRows={setRowsFor(cls.id)}
          />
        ))
      )}
    </section>
  );
}
