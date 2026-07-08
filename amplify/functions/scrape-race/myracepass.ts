import * as cheerio from 'cheerio';

/**
 * Pure parsers for MyRacePass event pages. Selectors were pinned against live
 * HTML (server-rendered ASP.NET, jQuery/Bootstrap):
 *   - details: /events/{id}
 *   - entries: /events/{id}/entries
 *   - results: /events/{id}/races   (multiple sessions per class; we take the
 *               A-Feature as the official finish order)
 */

export type ParsedDetails = {
  name: string | null;
  track: string | null;
  trackId: string | null;
  location: string | null;
  eventDate: string | null; // ISO
};

export type ParsedClass = {
  mrpClassId: string | null;
  name: string;
  series: string | null;
  entryCount: number | null;
  entries: ParsedEntry[];
};

export type ParsedEntry = {
  mrpEntryId: string | null; // MyRacePass driver id
  carNumber: string | null;
  driverName: string;
  hometown: string | null;
};

export type ParsedResultRow = {
  mrpEntryId: string | null;
  finishPosition: number;
  startPosition: number | null;
  carNumber: string | null;
  driverName: string | null;
  hometown: string | null;
  status: string | null;
};

export type ParsedResultClass = {
  mrpClassId: string | null;
  className: string;
  sessionName: string | null;
  rows: ParsedResultRow[];
};

// One predictable session (a division running a specific race type). The races
// page lists each division's Feature/Heat/Qualifying sessions separately, each
// with its own lineup; we treat each as its own class so it can be predicted
// and scored on its own.
export type ParsedSessionClass = {
  mrpClassId: string | null; // composite session id, e.g. "787942-2"
  name: string; // division, e.g. "B Mod (Non-CRUSA)"
  raceType: string; // session label, e.g. "A Feature 1" / "Heat 2"
  entryCount: number | null;
  entries: ParsedEntry[];
};

// ---- helpers ----------------------------------------------------------------

function firstTextNode($el: cheerio.Cheerio<any>): string {
  // The direct text of an element, excluding child element text.
  const node = $el.contents().filter((_, n) => n.type === 'text').first();
  return (node.text() || '').trim();
}

function classIdFrom(id: string | undefined): string | null {
  if (!id) return null;
  const m = id.match(/class(\d+)-/);
  return m ? m[1] : null;
}

// The full session id, e.g. "class787942-2" -> "787942-2". Unique per session
// (division + race type), unlike classIdFrom which drops the session suffix.
function sessionIdFrom(id: string | undefined | null): string | null {
  if (!id) return null;
  const m = id.match(/class(\d+(?:-\d+)?)/);
  return m ? m[1] : null;
}

const collapseWs = (s: string | null | undefined) =>
  (s ?? '').replace(/\s+/g, ' ').trim();

function driverIdFrom(href: string | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/drivers\/(\d+)/);
  return m ? m[1] : null;
}

function parseIntOrNull(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// "6/29/2026" -> ISO datetime at local midnight (UTC), best-effort.
function parseEventDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

// ---- details ----------------------------------------------------------------

export function parseEventDetails(html: string): ParsedDetails {
  const $ = cheerio.load(html);

  const headerH2 = $('#mrp-profile-header h2').first();
  const dateText = firstTextNode(headerH2);
  const trackLink = $('#mrp-profile-header .track-link').first();
  const track = trackLink.text().trim() || null;
  const trackHref = trackLink.attr('href');
  const trackId = trackHref ? (trackHref.match(/\/tracks\/(\d+)/)?.[1] ?? null) : null;

  // Event name lives in the EVENT INFORMATION section's <h5>.
  let name: string | null = null;
  $('header.mrp-heading h2').each((_, el) => {
    if ($(el).text().trim().toUpperCase() === 'EVENT INFORMATION') {
      name = $(el).closest('section').find('h5').first().text().trim() || null;
    }
  });
  if (!name) {
    // Fall back to the og:title / page title (e.g. "6/29/2026 - Camden Speedway").
    name =
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').text().trim() ||
      null;
  }

  // Best-effort location from the Contact block's map-marker line:
  // street (the <li>'s own text) + the nested city/state/zip line.
  let location: string | null = null;
  const marker = $('i.fa-map-marker-alt').first();
  if (marker.length) {
    const li = marker.closest('li');
    const street = firstTextNode(li);
    const cityLine = li.find('ul li').first().text().trim();
    location = [street, cityLine].filter(Boolean).join(', ') || null;
  }

  return {
    name,
    track,
    trackId,
    location,
    eventDate: parseEventDate(dateText),
  };
}

// ---- classes (from the details page) ---------------------------------------

// The event details page lists the night's divisions in a "classes" section
// (`<header><h4>classes</h4></header><ul class="mrp-iconDetails"><li>…</li></ul>`),
// present even before any entries are posted to the /entries page. Returns the
// class names in listed order. Only the section whose heading is exactly
// "classes" is read — the details page has other `mrp-iconDetails` lists (event
// times, location). Names here are title-cased and may differ in case from the
// UPPERCASE names on the entries page, so downstream matching is case-insensitive.
export function parseEventClasses(html: string): string[] {
  const $ = cheerio.load(html);
  const names: string[] = [];
  $('header.mrp-heading').each((_, headerEl) => {
    const $header = $(headerEl);
    if ($header.find('h4').first().text().trim().toLowerCase() !== 'classes') return;
    $header
      .nextAll('ul.mrp-iconDetails')
      .first()
      .find('li')
      .each((__, li) => {
        // Once entries are posted each <li> also holds a "<span>N entries</span>"
        // count; take only the direct text node (the class name).
        const name = firstTextNode($(li));
        if (name) names.push(name);
      });
  });
  return names;
}

// ---- entries ----------------------------------------------------------------

export function parseEntries(html: string): ParsedClass[] {
  const $ = cheerio.load(html);
  const classes: ParsedClass[] = [];

  $('header.mrp-heading').each((_, headerEl) => {
    const $header = $(headerEl);
    const $h2 = $header.find('h2').first();
    if (!$h2.length) return;
    const table = $header.nextAll('table.table').first();
    if (!table.length) return;
    // Only class sections have driver rows.
    if (!table.find('a[href^="/drivers/"]').length) return;

    const name = firstTextNode($h2);
    if (!name) return;
    const series = $h2.find('small').first().text().trim() || null;
    const entryCount = parseIntOrNull($header.find('.float-right').first().text());
    const mrpClassId = classIdFrom(
      table.find('[id^="class"]').first().attr('id') ||
        $header.attr('id'),
    );

    const entries: ParsedEntry[] = [];
    table.find('tbody tr').each((__, tr) => {
      const $tr = $(tr);
      // The first /drivers/ anchor wraps the (text-less) avatar image; the
      // named link is last. Both carry the same driver id.
      const a = $tr.find('a[href^="/drivers/"]').last();
      const driverName = a.text().trim();
      if (!driverName) return;
      entries.push({
        mrpEntryId: driverIdFrom(a.attr('href')),
        carNumber: $tr.find('td.text-right h3').first().text().trim() || null,
        driverName,
        hometown: $tr.find('p.text-muted').first().text().trim() || null,
      });
    });

    classes.push({ mrpClassId, name, series, entryCount, entries });
  });

  return classes;
}

// ---- results ----------------------------------------------------------------

// Returns one entry per class: the feature finishing order. Heats/qualifying
// sessions are ignored.
export function parseResults(html: string): ParsedResultClass[] {
  const $ = cheerio.load(html);
  const byClass = new Map<string, ParsedResultClass>();

  $('header.mrp-heading').each((_, headerEl) => {
    const $header = $(headerEl);
    const $h2 = $header.find('h2').first();
    if (!$h2.length) return;
    const sessionName = $h2.find('small').first().text().trim() || null;
    // Any feature session counts. Labels vary by track/series — "A Feature",
    // "ESS A Feature" (series-prefixed), or plain "Feature". The first feature
    // per class (kept below) is the main event, since features are listed
    // A, B, C in order.
    if (!sessionName || !/feature/i.test(sessionName)) return;

    const table = $header.nextAll('table').first();
    if (!table.length || !table.find('a[href^="/drivers/"]').length) return;

    const className = firstTextNode($h2);
    if (!className) return;
    // Keep only the first feature seen per class (the main event).
    if (byClass.has(className)) return;

    const mrpClassId = classIdFrom(
      $header.attr('id') || table.find('[id^="class"]').first().attr('id'),
    );

    const rows: ParsedResultRow[] = [];
    table.find('tbody tr').each((__, tr) => {
      const $tr = $(tr);
      const tds = $tr.find('> td');
      if (tds.length < 3) return;
      const a = $tr.find('a[href^="/drivers/"]').last();
      const driverName = a.text().trim() || null;
      const finishRaw = tds.eq(0).text().trim();
      const finishPosition = parseIntOrNull(finishRaw);
      rows.push({
        mrpEntryId: driverIdFrom(a.attr('href')),
        finishPosition: finishPosition ?? 0,
        startPosition: parseIntOrNull(tds.eq(1).text()),
        carNumber: tds.eq(2).text().trim() || null,
        driverName,
        hometown: tds.eq(5).text().trim() || null,
        // Non-numeric finish (DNS/DNF/DQ) is captured as status.
        status: finishPosition == null ? finishRaw || null : null,
      });
    });

    if (rows.length) {
      byClass.set(className, { mrpClassId, className, sessionName, rows });
    }
  });

  return [...byClass.values()];
}

// ---- sessions (predictable Feature/Heat lineups from the races page) --------

// Features and Heats are predictable; Qualifying (timed) and anything else are
// skipped.
function isPredictableSession(label: string): boolean {
  return /feature|heat/i.test(label) && !/qual/i.test(label);
}

// Parse the races page (/events/{id}/races) into one class per Feature/Heat
// session, each with its lineup as entries. Same page the results scraper reads,
// but here we keep every predictable session (not just the feature) and read its
// full field. The tbody carries an extra avatar cell the thead lacks, so the
// driver's cell is found via its /drivers/ link and hometown is the next cell;
// the car number ("#" column, before the avatar) is read via the header map.
export function parseSessions(html: string): ParsedSessionClass[] {
  const $ = cheerio.load(html);
  const out: ParsedSessionClass[] = [];

  $('header.mrp-heading').each((_, headerEl) => {
    const $header = $(headerEl);
    const $h2 = $header.find('h2').first();
    if (!$h2.length) return;

    const raceType = collapseWs($h2.find('small').first().text());
    if (!raceType || !isPredictableSession(raceType)) return;

    const name = firstTextNode($h2);
    if (!name) return;

    const table = $header.nextAll('table').first();
    if (!table.length || !table.find('a[href^="/drivers/"]').length) return;

    const mrpClassId = sessionIdFrom(
      $header.attr('id') || table.find('[id^="class"]').first().attr('id'),
    );

    // Map header labels -> column index; the car-number column sits before the
    // avatar cell so its index is consistent between thead and tbody.
    const col: Record<string, number> = {};
    table.find('thead th').each((i, th) => {
      const key = collapseWs($(th).text()).toLowerCase();
      if (key) col[key] = i;
    });
    const carCol = col['#'] ?? col['no'] ?? col['car'];

    const entries: ParsedEntry[] = [];
    table.find('tbody tr').each((__, tr) => {
      const $tr = $(tr);
      const a = $tr.find('a[href^="/drivers/"]').last();
      const driverName = collapseWs(a.text());
      if (!driverName) return;
      const tds = $tr.find('> td');
      const compTd = a.closest('td');
      entries.push({
        mrpEntryId: driverIdFrom(a.attr('href')),
        carNumber: carCol != null ? collapseWs(tds.eq(carCol).text()) || null : null,
        driverName,
        hometown: collapseWs(compTd.next('td').text()) || null,
      });
    });
    if (!entries.length) return;

    out.push({ mrpClassId, name, raceType, entryCount: entries.length, entries });
  });

  return out;
}
