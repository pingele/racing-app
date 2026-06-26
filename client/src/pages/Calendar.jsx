import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

const WEEK_STARTS_SUNDAY = true;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoForInput(d) {
  return dayKey(d);
}
function parseInputDate(value) {
  if (!value) return null;
  const [y, m, day] = value.split('-').map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day);
}
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// 42-cell month grid (6 rows × 7 cols) starting from the Sunday/Monday on or
// before the first of the displayed month.
function buildMonthGrid(viewDate) {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const offset = WEEK_STARTS_SUNDAY ? first.getDay() : (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function weekdayLabels() {
  // 2024-01-07 is a Sunday.
  const base = new Date(2024, 0, WEEK_STARTS_SUNDAY ? 7 : 8);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return WEEKDAY_FMT.format(d);
  });
}

export default function Calendar() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewDate, setViewDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getCalendar()
      .then((data) => setRaces(data.races || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const racesByDay = useMemo(() => {
    const map = new Map();
    for (const race of races) {
      if (!race.start_time) continue;
      const d = new Date(race.start_time);
      if (Number.isNaN(d.getTime())) continue;
      const key = dayKey(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(race);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
    }
    return map;
  }, [races]);

  const cells = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const weekdays = useMemo(weekdayLabels, []);
  const todayKey = dayKey(today);
  const selectedKey = dayKey(selectedDate);
  const monthIndex = viewDate.getMonth();

  const handleDatePick = (e) => {
    const d = parseInputDate(e.target.value);
    if (!d) return;
    setSelectedDate(d);
    setViewDate(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const goPrev = () => setViewDate(addMonths(viewDate, -1));
  const goNext = () => setViewDate(addMonths(viewDate, 1));
  const goToday = () => {
    setSelectedDate(today);
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  if (loading) return <p>Loading calendar...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section className="calendar">
      <header className="calendar-head">
        <div>
          <h1>Race Calendar</h1>
          <p className="muted">Month view · live from Race Monitor</p>
        </div>
        <div className="calendar-controls">
          <button type="button" className="btn btn-ghost" onClick={goPrev} aria-label="Previous month">‹</button>
          <span className="calendar-current-month">{MONTH_FMT.format(viewDate)}</span>
          <button type="button" className="btn btn-ghost" onClick={goNext} aria-label="Next month">›</button>
          <button type="button" className="btn btn-ghost" onClick={goToday}>Today</button>
          <label className="calendar-date-picker">
            <span className="muted">Jump to</span>
            <input
              type="date"
              value={isoForInput(selectedDate)}
              onChange={handleDatePick}
            />
          </label>
        </div>
      </header>

      <div className="calendar-grid" role="grid">
        {weekdays.map((w) => (
          <div key={w} className="calendar-grid-weekday" role="columnheader">
            {w}
          </div>
        ))}
        {cells.map((cell) => {
          const key = dayKey(cell);
          const inMonth = cell.getMonth() === monthIndex;
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const dayRaces = racesByDay.get(key) || [];
          const cls = [
            'calendar-grid-cell',
            inMonth ? '' : 'calendar-grid-cell-muted',
            isToday ? 'calendar-grid-cell-today' : '',
            isSelected ? 'calendar-grid-cell-selected' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={key}
              className={cls}
              role="gridcell"
              onClick={() => setSelectedDate(cell)}
            >
              <div className="calendar-grid-cell-head">
                <span className="calendar-grid-day-num">{cell.getDate()}</span>
                {dayRaces.length > 0 && (
                  <span className="calendar-grid-day-count">{dayRaces.length}</span>
                )}
              </div>
              {dayRaces.length > 0 && (
                <ul className="calendar-grid-day-races">
                  {dayRaces.slice(0, 3).map((race) => (
                    <CalendarRaceItem key={race.external_id || race.id} race={race} />
                  ))}
                  {dayRaces.length > 3 && (
                    <li className="calendar-grid-more">+{dayRaces.length - 3} more</li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CalendarRaceItem({ race }) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const time = race.start_time ? TIME_FMT.format(new Date(race.start_time)) : 'TBD';
  const label = (
    <>
      <span className="calendar-grid-race-time">{time}</span>
      <span className="calendar-grid-race-name">{race.name}</span>
    </>
  );

  if (race.id) {
    return (
      <li>
        <Link
          to={`/races/${race.id}`}
          className="calendar-grid-race"
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </Link>
      </li>
    );
  }

  const handleClick = async (e) => {
    e.stopPropagation();
    if (syncing || !race.external_id) return;
    setSyncing(true);
    setError(null);
    try {
      const data = await api.syncRaceByExternalId(race.external_id);
      const id = data?.race?.id;
      if (!id) throw new Error('Race could not be imported');
      navigate(`/races/${id}`);
    } catch (err) {
      setError(err.message || 'Sync failed');
      setSyncing(false);
    }
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        disabled={syncing}
        className="calendar-grid-race calendar-grid-race-button"
        title={error || undefined}
      >
        {label}
        {syncing && <span className="calendar-grid-race-syncing">…</span>}
      </button>
    </li>
  );
}
