import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';

function formatDate(iso) {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'TBD'
    : d.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
}

// Build the starting predicted order: a saved prediction (if any), with any
// entries it doesn't mention appended in their default order.
function initialOrder(cls) {
  const ids = cls.entries.map((e) => e.id);
  const saved = (cls.myPrediction?.orderedEntryIds ?? []).filter((id) =>
    ids.includes(id),
  );
  const missing = ids.filter((id) => !saved.includes(id));
  return [...saved, ...missing];
}

function ClassPanel({ race, cls, scoringRules, onSaved }) {
  const entryById = useMemo(
    () => new Map(cls.entries.map((e) => [e.id, e])),
    [cls.entries],
  );
  const [order, setOrder] = useState(() => initialOrder(cls));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const hasResults = cls.results.length > 0;
  // A class is closed to prediction edits when the whole race is locked (master
  // switch) or this specific class has been locked for scoring.
  const locked = race.predictionsLocked || cls.locked;

  // Move the item at `from` to position `to`, shifting the rest.
  const reorder = (from, to) => {
    if (from === to || from == null || to == null) return;
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setMsg(null);
  };

  // Up/down arrows (touch / keyboard fallback for the drag-and-drop).
  const move = (i, dir) => reorder(i, i + dir);

  const onDragStart = (i) => (e) => {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires data to be set for a drag to start.
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

  const save = async () => {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      await api.savePrediction(race.id, cls.id, order);
      setMsg('Prediction saved.');
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ---- finished: show actual results, my prediction, and which picks scored -
  if (hasResults) {
    const orderedIds = cls.myPrediction?.orderedEntryIds ?? [];
    const hasPrediction = orderedIds.length > 0;
    // Mirror the Lambda's F1-style scoring: the entry the user placed at
    // position P scores points(P) when it actually finished at position P.
    const pickAt = (pos) => (pos > 0 ? entryById.get(orderedIds[pos - 1]) : null);
    let scoredCount = 0;
    let scorablePositions = 0;
    const rows = cls.results.map((r) => {
      const pos = r.finishPosition;
      const picked = pickAt(pos);
      const scored = !!picked && !!r.entryId && picked.id === r.entryId;
      const points = scored ? scoringRules?.[pos] ?? 0 : 0;
      if (pos > 0 && scoringRules?.[pos] != null) {
        scorablePositions += 1;
        if (scored) scoredCount += 1;
      }
      return { r, picked, scored, points };
    });

    return (
      <div className="card">
        <div className="results-head">
          <h2>
            {cls.name}
            {cls.series ? <span className="muted"> · {cls.series}</span> : null}
          </h2>
          {cls.myPrediction?.pointsAwarded != null && (
            <span className="badge badge-finished">
              You scored {cls.myPrediction.pointsAwarded} pts
            </span>
          )}
        </div>
        {hasPrediction && (
          <p className="compare-legend">
            Your picks shown next to the finish. Highlighted rows are the ones
            you nailed — {scoredCount} of {scorablePositions} scoring positions.
          </p>
        )}
        <table className="results-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>#</th>
              <th>Driver</th>
              {hasPrediction ? (
                <>
                  <th>Your pick</th>
                  <th>Pts</th>
                </>
              ) : (
                <>
                  <th>Hometown</th>
                  <th>Start</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, picked, scored, points }) => (
              <tr key={r.id} className={scored ? 'scored' : undefined}>
                <td>{r.finishPosition > 0 ? `P${r.finishPosition}` : r.status || '—'}</td>
                <td>{r.carNumber || ''}</td>
                <td>{r.driverName || ''}</td>
                {hasPrediction ? (
                  <>
                    <td className="pick-cell">
                      {r.finishPosition > 0 ? (
                        picked ? (
                          <>
                            {scored && <span className="pick-scored">✓ </span>}
                            <span className="driver-num">#{picked.carNumber}</span>{' '}
                            {picked.driverName}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )
                      ) : (
                        ''
                      )}
                    </td>
                    <td className="pts-cell">{scored ? `+${points}` : ''}</td>
                  </>
                ) : (
                  <>
                    <td>{r.hometown || ''}</td>
                    <td>{r.startPosition ?? ''}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {hasPrediction && (
          <p className="muted compare-legend">
            “Your pick” is the driver you predicted to finish in that position.
          </p>
        )}
      </div>
    );
  }

  // ---- open / locked: prediction UI ----------------------------------------
  return (
    <div className="card">
      <div className="results-head">
        <h2>
          {cls.name}
          {cls.series ? <span className="muted"> · {cls.series}</span> : null}
        </h2>
        <span className="muted">
          {cls.entries.length} entries · {cls.predictionCount}{' '}
          {cls.predictionCount === 1 ? 'prediction' : 'predictions'}
        </span>
      </div>

      {cls.entries.length === 0 ? (
        <p className="muted">No entries listed for this class yet.</p>
      ) : locked ? (
        <>
          <p className="muted">
            🔒 Predictions are locked. {cls.myPrediction ? 'Your order:' : 'You did not enter a prediction.'}
          </p>
          {cls.myPrediction && (
            <ol className="predict-list">
              {order.map((id) => {
                const e = entryById.get(id);
                return (
                  <li key={id} className="predict-row">
                    <span className="predict-pos" />
                    <span className="driver-num">#{e?.carNumber}</span>
                    <span>{e?.driverName}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            Drag rows to reorder (or use the arrows) — your #1 is your predicted winner.
          </p>
          <ol className="predict-list">
            {order.map((id, i) => {
              const e = entryById.get(id);
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
                  key={id}
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
                  <span className="predict-pos">{i + 1}</span>
                  <span className="driver-num">#{e?.carNumber}</span>
                  <span className="predict-name">{e?.driverName}</span>
                  <span className="muted predict-home">{e?.hometown}</span>
                  <span className="predict-moves">
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
                      disabled={i === order.length - 1}
                      aria-label="Move down"
                    >
                      ▼
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          {error && <p className="error">{error}</p>}
          {msg && <p className="success">{msg}</p>}
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : cls.myPrediction ? 'Update prediction' : 'Save prediction'}
          </button>
        </>
      )}
    </div>
  );
}

export default function RaceDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    api
      .getRace(id)
      .then(setData)
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading race...</p>;

  const { race, classes, scoringRules, predictionUserCount } = data;

  return (
    <section>
      <div className="detail-head">
        <h1>{race.name}</h1>
        <span
          className={`badge ${
            race.status === 'completed' ? 'badge-finished' : 'badge-scheduled'
          }`}
        >
          {race.status === 'completed' ? 'Results in' : 'Open'}
        </span>
      </div>
      <p className="muted">
        {[race.track, race.location].filter(Boolean).join(' · ')}
        {race.track || race.location ? ' · ' : ''}
        {formatDate(race.eventDate)}
      </p>
      <p className="muted">
        {predictionUserCount} {predictionUserCount === 1 ? 'player has' : 'players have'}{' '}
        entered predictions
      </p>
      {race.predictionsLocked && race.status !== 'completed' && (
        <div className="card info">🔒 Predictions are locked for this event.</div>
      )}

      {classes.length === 0 ? (
        <div className="card">
          <p className="muted">No classes imported for this event yet.</p>
        </div>
      ) : (
        classes.map((cls) => (
          <ClassPanel
            key={cls.id}
            race={race}
            cls={cls}
            scoringRules={scoringRules}
            onSaved={load}
          />
        ))
      )}
    </section>
  );
}
