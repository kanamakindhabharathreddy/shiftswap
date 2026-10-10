import { weekOf, weeklyWorkload, filterRows, filterHistory } from './view-model.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const date = value => new Date(value + ':00Z');
const format = (value, options) => date(value).toLocaleString('en-GB', { ...options, timeZone: 'UTC' });
const hours = shift => (date(shift.end) - date(shift.start)) / 3600000;
const number = value => Number(value.toFixed(2));
const defaultFilters = () => ({ query: '', week: '', eligible: false, sort: 'date' });
const icon = name => {
  const paths = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-12 4h.01M15 15h.01"/>',
    swap: '<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.calendar}</svg>`;
};

let state;
let actorId;
try { actorId = localStorage.getItem('shiftswap.actor'); } catch { /* Selection works without browser storage. */ }
let tab = 'overview';
let busy = false;
let loading = false;
let loadVersion = 0;
let renderedActor;
let calendarWeek;
let dialogShift;
let dialogActor;
const filters = {
  overview: defaultFilters(),
  market: defaultFilters(),
  history: { query: '', person: '', outcome: '' }
};

const person = id => state?.staff.find(item => item.id === id);
const nameOf = id => person(id)?.name || '';
const badge = value => `<span class="badge ${esc(value.toLowerCase())}">${esc(value.replaceAll('_', ' '))}</span>`;

function reasonList(items) {
  return `<div class="reasons"><ul>${items.map(reason => `<li>${reason.rule ? `<b>Rule ${reason.rule}:</b> ` : ''}${esc(reason.message)}</li>`).join('')}</ul></div>`;
}

function action(label, verb, target, variant = '') {
  return `<button class="button ${variant}" data-action="${verb}" data-target="${esc(target)}" ${busy || loading ? 'disabled' : ''}>${label}</button>`;
}

function showNotice(html, error = false) {
  $('notice').innerHTML = `<div>${html}</div><button class="notice-close" data-dismiss-notice aria-label="Dismiss notification">×</button>`;
  $('notice').className = `notice ${error ? 'error' : ''}`;
  $('notice').hidden = false;
}

function setControls() {
  $('actor').disabled = busy || loading;
  $('refresh').disabled = busy || loading;
  $('refresh').innerHTML = `${icon('refresh')}${loading ? 'Loading…' : 'Refresh'}`;
  $('content').setAttribute('aria-busy', String(busy || loading));
  document.querySelectorAll('[data-action], [data-details]').forEach(button => { button.disabled = busy || loading; });
}

function connection(connected) {
  $('connection-dot').classList.toggle('offline', !connected);
  $('connection-text').textContent = connected ? 'Roster connected' : 'Connection interrupted';
  $('sync-text').textContent = connected ? 'Updates every 10s while this tab is visible' : 'Showing last saved view · Try Refresh';
}

async function load({ foreground = true, force = false, requestedActor = actorId } = {}) {
  const version = ++loadVersion;
  if (foreground) { loading = true; setControls(); }
  try {
    const response = await fetch(`/api/state?actor=${encodeURIComponent(requestedActor || '')}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Unable to load roster. Try Refresh.');
    const data = await response.json();
    if (version !== loadVersion) return;
    if (!data.staff.some(item => item.id === requestedActor)) {
      const fallback = data.staff.find(item => item.role === 'STAFF')?.id || data.staff[0]?.id;
      if (!fallback) throw new Error('The seed contains no people.');
      return await load({ foreground, force: true, requestedActor: fallback });
    }
    // Commit identity and its eligibility snapshot together. Navigation can render
    // while this request is pending, but must keep using the last loaded person.
    if (actorId !== requestedActor && $('shift-dialog').open) $('shift-dialog').close();
    actorId = requestedActor;
    rememberActor();
    connection(true);
    const changed = force || !state || renderedActor !== actorId || JSON.stringify(data) !== JSON.stringify(state);
    state = data;
    if (changed) render();
  } catch (error) {
    if (version === loadVersion) connection(false);
    throw error;
  } finally {
    if (version === loadVersion) { loading = false; setControls(); }
  }
}

function rememberActor() {
  try { localStorage.setItem('shiftswap.actor', actorId); } catch { /* Browser storage is optional. */ }
}

function empty(title, text, link = '') {
  return `<div class="empty"><span class="empty-icon" aria-hidden="true">✓</span><div><h3>${title}</h3><p>${text}</p>${link}</div></div>`;
}

function section(title, subtitle, body, count) {
  return `<div class="card"><div class="section-title"><div><h2>${title}</h2><p>${subtitle}</p></div>${count === undefined ? '' : `<span class="badge">${count}</span>`}</div>${body}</div>`;
}

function hoursImpact(impact) {
  if (!impact) return '';
  const over = impact.projected_minutes > impact.limit_minutes;
  const current = number(impact.assigned_minutes / 60);
  const projected = number(impact.projected_minutes / 60);
  const percent = Math.min(100, Math.round(impact.projected_minutes / impact.limit_minutes * 100));
  return `<div class="hours-impact ${over ? 'over-limit' : ''}"><div><span>Week of ${format(impact.week_start + 'T00:00', { day: 'numeric', month: 'short' })}</span><b>${current}h → ${projected} / 40h</b></div><progress max="100" value="${percent}" aria-label="Projected weekly hours">${percent}%</progress><small>${over ? 'Exceeds the weekly limit' : `${number((impact.limit_minutes - impact.projected_minutes) / 60)}h available after approval`}</small></div>`;
}

function shiftCard(shift, listing, buttons = '', extra = '') {
  const crosses = shift.start.slice(0, 10) !== shift.end.slice(0, 10);
  const handover = listing?.claimer_id
    ? `<div class="handover"><span><small>Currently assigned</small><b>${esc(nameOf(shift.assigned_to))}</b></span><span class="handover-arrow" aria-label="to">→</span><span><small>Requested by</small><b>${esc(nameOf(listing.claimer_id))}</b></span></div>`
    : `<div class="owner">Assigned to <b>${esc(nameOf(shift.assigned_to))}</b></div>`;
  return `<article class="shift-card ${extra ? 'with-review' : ''}">
    <div class="date-tile"><small>${format(shift.start, { month: 'short' })}</small><strong>${format(shift.start, { day: '2-digit' })}</strong><small>${format(shift.start, { weekday: 'short' })}</small></div>
    <div class="shift-details">
      <div class="shift-head"><h3>${format(shift.start, { hour: '2-digit', minute: '2-digit' })}<span class="time-divider">–</span>${format(shift.end, { hour: '2-digit', minute: '2-digit' })}${crosses ? ' <span class="badge">OVERNIGHT</span>' : ''}</h3>${badge(listing?.status || 'ASSIGNED')}</div>
      <div class="shift-meta"><span>${esc(shift.id)}</span><span>${number(hours(shift))} hours</span><span>${shift.required_certification != null ? `${esc(shift.required_certification)} certification` : 'General care'}</span><span>${format(shift.start, { year: 'numeric' })}</span></div>
      ${crosses ? `<div class="overnight-end">Ends ${format(shift.end, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>` : ''}
      ${extra ? `<div class="review-owner">${handover}</div><div class="review-details">${extra}</div>` : ''}
      <div class="shift-bottom">${extra ? '<span class="review-note">Assignment changes on approval</span>' : handover}<div class="actions" aria-label="Actions for ${esc(shift.id)}">${buttons}</div></div>
    </div>
  </article>`;
}

function filterSelect(id, label, key, options, selected) {
  return `<label class="filter-field" for="${id}"><span>${label}</span><select id="${id}" data-filter="${key}">${options.map(([value, text]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
}

function toolbar(rows, { eligibility = false, history = false } = {}) {
  const current = filters[tab];
  const search = `<label class="filter-field search-field" for="filter-search"><span>Search ${history ? 'activity' : 'shifts'}</span><input id="filter-search" type="search" data-filter="query" value="${esc(current.query)}" placeholder="${history ? 'Action, shift or reason…' : 'Shift ID, person or certification…'}"></label>`;
  const controls = history
    ? filterSelect('filter-person', 'Person', 'person', [['', 'Everyone'], ...state.staff.map(item => [item.id, item.name])], current.person)
      + filterSelect('filter-outcome', 'Outcome', 'outcome', [['', 'All outcomes'], ['SUCCESS', 'Successful'], ['REFUSED', 'Refused']], current.outcome)
    : filterSelect('filter-week', 'Week', 'week', [['', 'All weeks'], ...[...new Set(state.shifts.map(shift => weekOf(shift.start)))].sort().map(week => [week, `Week of ${format(week + 'T00:00', { day: 'numeric', month: 'short' })}`])], current.week)
      + filterSelect('filter-sort', 'Sort', 'sort', [['date', 'Earliest first'], ['duration', 'Longest first']], current.sort);
  return `<div class="filter-toolbar">${search}${controls}${eligibility ? `<label class="eligibility-toggle"><input type="checkbox" id="filter-eligible" data-filter="eligible" ${current.eligible ? 'checked' : ''}> ${person(actorId).role === 'MANAGER' ? 'Ready to approve' : 'Eligible only'}</label>` : ''}<button class="reset-filters" data-reset-filters>Clear filters</button></div>`;
}

function filteredList(rows, card, options = {}) {
  const visible = filterRows(rows, filters[tab], nameOf);
  let body;
  if (options.groupDates && filters[tab].sort === 'date') {
    const groups = Map.groupBy(visible, row => row.shift.start.slice(0, 10));
    body = [...groups].map(([day, group]) => `<div class="day-group"><div class="day-heading"><h3>${format(day + 'T00:00', { weekday: 'long', day: 'numeric', month: 'long' })}</h3><span>${group.length} ${group.length === 1 ? 'shift' : 'shifts'}</span></div><div class="shift-list">${group.map(card).join('')}</div></div>`).join('');
  } else body = `<div class="shift-list ${options.grid ? 'listing-grid' : ''}">${visible.map(card).join('')}</div>`;
  if (!visible.length) body = empty(rows.length ? 'No matching shifts' : options.emptyTitle || 'No shifts here yet', rows.length ? 'Try another week or clear your filters.' : options.emptyText || 'New shifts will appear here.', rows.length ? '<button class="text-button" data-reset-filters>Clear filters →</button>' : '');
  return toolbar(rows, options) + `<div class="result-count" role="status">${visible.length} of ${rows.length} shifts${filters[tab].week ? ' · Selected week' : ' · All weeks'}</div>` + body;
}

function historyView() {
  const events = filterHistory(state.history, filters.history);
  const body = toolbar([], { history: true }) + `<div class="result-count">Showing ${events.length} of ${state.history.length} actions</div>` + (events.length
    ? `<div class="table-wrap"><table><thead><tr><th>Event / person</th><th>Action / shift</th><th>Change</th><th>Outcome</th></tr></thead><tbody>${events.map(event => {
      const transition = event.resulting_status === undefined ? 'Earlier event · See outcome'
        : event.resulting_status && event.previous_status !== event.resulting_status ? `${event.previous_status || 'NEW'} → ${event.resulting_status}` : 'No status change';
      const handover = event.assigned_from && event.assigned_to && event.assigned_from !== event.assigned_to ? `<small>${esc(nameOf(event.assigned_from))} → ${esc(nameOf(event.assigned_to))}</small>` : '';
      return `<tr><td><b>#${event.id}</b><small>${esc(nameOf(event.actor_id) || event.actor_id)}</small></td><td>${esc(event.action)}<small>${esc(event.shift_id || event.target_id)}</small></td><td>${esc(transition)}${handover}</td><td>${badge(event.outcome)}${event.reasons.map(reason => `<small>${reason.rule ? `Rule ${reason.rule}: ` : ''}${esc(reason.message)}</small>`).join('')}</td></tr>`;
    }).join('')}</tbody></table></div>`
    : empty(state.history.length ? 'No matching activity' : 'No activity yet', state.history.length ? 'Clear the filters to see all actions.' : 'Post a shift or make a claim to get started.'));
  return section('Activity log', 'Latest first. Successes and refusals are saved with their reasons.', body, state.history.length);
}

function managerView(pending, open) {
  if (tab === 'market') {
    const rows = open.map(listing => ({ listing, shift: state.shifts.find(shift => shift.id === listing.shift_id) }));
    return section('Open listings', 'These shifts are waiting for a staff member to claim them.', filteredList(rows, ({ shift, listing }) => shiftCard(shift, listing), {
      grid: true, emptyTitle: 'No open listings', emptyText: 'New listings appear when staff post a shift for swap.'
    }), open.length);
  }
  const rows = pending.map(listing => ({ listing, shift: state.shifts.find(shift => shift.id === listing.shift_id), reasons: listing.approval_reasons || [] }));
  return section('Pending approvals', 'Review the handover, scheduling checks and hours before deciding.', filteredList(rows, ({ shift, listing, reasons }) => shiftCard(
    shift, listing,
    action('Reject claim', 'reject', listing.id, 'secondary') + action(reasons.length ? 'Recheck & approve' : 'Approve swap', 'approve', listing.id),
    (reasons.length ? `<div class="approval-label blocked">${reasons.length} scheduling ${reasons.length === 1 ? 'issue' : 'issues'} · Approval currently blocked</div>${reasonList(reasons)}` : '<div class="eligibility">✓ Ready for approval · All scheduling rules pass</div>') + hoursImpact(listing.hours_impact)
  ), { eligibility: true, grid: true, emptyTitle: 'You’re all caught up', emptyText: 'When a colleague claims a shift, you can review the handover here.' }), pending.length);
}

function calendarView(own) {
  const weeks = [...new Set(state.shifts.map(shift => weekOf(shift.start)))].sort();
  if (!weeks.length) return empty('No roster weeks yet', 'Assigned shifts will appear here when the clinic roster is available.');
  if (!weeks.includes(calendarWeek)) calendarWeek = weeks[0];
  const week = weeklyWorkload(own, [calendarWeek])[0];
  if (!week) return '';
  const position = weeks.indexOf(calendarWeek);
  const end = week.days[6].date;
  const assignedHours = number(week.minutes / 60);
  const calendar = `<div class="calendar-panel"><div class="calendar-heading"><div><div class="eyebrow">YOUR ASSIGNED SHIFTS</div><h2 id="calendar-title" tabindex="-1">${format(calendarWeek + 'T00:00', { day: 'numeric', month: 'short' })} – ${format(end + 'T00:00', { day: 'numeric', month: 'short', year: 'numeric' })}</h2></div><div class="calendar-controls"><span>${assignedHours}<small> / 40 hours</small></span><div class="week-navigation"><button data-calendar-week="${weeks[position - 1] || ''}" aria-label="Previous week" ${position === 0 ? 'disabled' : ''}>‹</button><button data-calendar-week="${weeks[position + 1] || ''}" aria-label="Next week" ${position === weeks.length - 1 ? 'disabled' : ''}>›</button></div></div></div><div class="calendar-grid">${week.days.map(day => {
    const shifts = own.filter(shift => shift.start.slice(0, 10) === day.date);
    return `<div class="calendar-day ${shifts.length ? 'has-shift' : ''}"><div class="calendar-day-label"><span>${format(day.date + 'T00:00', { weekday: 'short' })}</span><b>${format(day.date + 'T00:00', { day: '2-digit' })}</b></div><div class="calendar-events">${shifts.length ? shifts.map(shift => {
      const listing = state.listings.find(item => item.shift_id === shift.id && ['OPEN', 'CLAIMED'].includes(item.status));
      const cert = shift.required_certification || 'General care';
      return `<button class="calendar-event ${shift.required_certification === 'ICU' ? 'event-icu' : shift.required_certification === 'PEDS' ? 'event-peds' : 'event-general'}" data-details="${esc(shift.id)}" aria-label="View shift ${esc(shift.id)}, ${format(shift.start, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}, ends ${format(shift.end, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}"><span class="event-cert">${esc(cert)}</span><strong>${format(shift.start, { hour: '2-digit', minute: '2-digit' })}</strong><span class="event-end">${format(shift.end, { hour: '2-digit', minute: '2-digit' })}${shift.start.slice(0,10) !== shift.end.slice(0,10) ? ' +1d' : ''}</span><span class="event-id">${esc(shift.id)}<span>${number(hours(shift))}h</span></span>${listing ? `<span class="event-status">${listing.status === 'OPEN' ? 'On swap board' : 'Claim pending'}</span>` : ''}</button>`;
    }).join('') : '<span class="day-off">No starts<span aria-hidden="true">—</span></span>'}</div></div>`;
  }).join('')}</div><div class="calendar-footer"><div class="calendar-legend"><span><i class="legend-icu"></i> ICU</span><span><i class="legend-peds"></i> PEDS</span><span><i class="legend-general"></i> General care</span></div><span>Shifts and hours appear on their start day · Click for details</span></div></div>`;
  const claims = state.listings.filter(item => item.status === 'CLAIMED' && item.claimer_id === actorId);
  const posted = state.listings.filter(item => ['OPEN','CLAIMED'].includes(item.status) && item.poster_id === actorId);
  return `<div class="schedule-layout">${calendar}<aside class="schedule-aside"><div class="balance-card"><div class="balance-top"><span>Room to breathe</span>${icon('clock')}</div><div class="balance-number">${number((2400 - week.minutes) / 60)}<span>hours</span></div><p>Available before the weekly limit.<br>Every claim still needs a rule check.</p><progress max="40" value="${assignedHours}" aria-label="Assigned weekly hours">${assignedHours} of 40 hours</progress><div class="balance-bottom"><b>${assignedHours}h assigned</b><span>40h limit</span></div></div><div class="attention-card"><h3>Your swap activity</h3><div><span>Posted for coverage</span><b>${posted.length}</b></div><div><span>Awaiting approval</span><b>${claims.length}</b></div><button class="text-button" data-tab="market">Explore open shifts ${icon('arrow')}</button></div></aside></div>`;
}

function showShiftDetails(id, { refresh = false } = {}) {
  if (!refresh && (busy || loading)) return;
  const shift = state.shifts.find(item => item.id === id && item.assigned_to === actorId);
  if (!shift) return;
  const listing = state.listings.find(item => item.shift_id === id && ['OPEN','CLAIMED'].includes(item.status));
  const buttons = listing?.status === 'OPEN' ? action('Withdraw listing', 'withdraw', listing.id, 'secondary')
    : listing ? '<span class="pending-note">Waiting for manager approval</span>' : action('Post for swap', 'post', id);
  const focused = document.activeElement;
  const focusedAction = focused?.dataset.action;
  const focusedClose = focused?.hasAttribute('data-close-dialog');
  dialogShift = id;
  dialogActor = actorId;
  $('shift-dialog-content').innerHTML = `<div class="dialog-top"><span class="eyebrow">SHIFT DETAILS</span><button class="dialog-close" data-close-dialog aria-label="Close shift details">×</button></div><h2 id="shift-dialog-title">${format(shift.start, { weekday: 'long', day: 'numeric', month: 'long' })}</h2><p class="dialog-subtitle">${esc(id)} · ${number(hours(shift))} hours · Clinic-local time</p>${shiftCard(shift, listing)}<div class="dialog-info">${icon('check')}<p>You remain assigned to this shift until a manager approves a colleague’s claim.</p></div><div class="dialog-actions"><button class="button secondary" data-close-dialog>Close</button>${buttons}</div>`;
  if (!$('shift-dialog').open) $('shift-dialog').showModal();
  else if (focusedAction) $('shift-dialog').querySelector(`[data-action="${focusedAction}"]`)?.focus({ preventScroll: true });
  else if (focusedClose) $('shift-dialog').querySelector('[data-close-dialog]')?.focus({ preventScroll: true });
}

function overviewView(own, pending) {
  const claims = pending.filter(listing => listing.claimer_id === actorId);
  let html = calendarView(own);
  if (claims.length) html += `<div class="block-gap">${section('Your pending claims', 'Waiting for manager approval. You can release a claim at any time.', `<div class="shift-list listing-grid">${claims.map(listing => shiftCard(state.shifts.find(shift => shift.id === listing.shift_id), listing, action('Unclaim', 'unclaim', listing.id, 'secondary'), (listing.approval_reasons?.length ? `<div class="approval-label blocked">Current assignments now prevent approval</div>${reasonList(listing.approval_reasons)}` : '<div class="eligibility">✓ Scheduling rules currently pass</div>') + hoursImpact(listing.hours_impact))).join('')}</div>`, claims.length)}</div>`;
  const rows = own.map(shift => ({ shift, listing: state.listings.find(listing => listing.shift_id === shift.id && ['OPEN', 'CLAIMED'].includes(listing.status)) }));
  html += `<div class="block-gap roster-section">${section('Your roster', 'Post a shift for a colleague to cover. You stay assigned until approval.', filteredList(rows, ({ shift, listing }) => {
    const buttons = listing?.status === 'OPEN' ? action('Withdraw', 'withdraw', listing.id, 'secondary')
      : listing ? '<span class="pending-note">Awaiting approval</span>' : action('Post for swap', 'post', shift.id, 'secondary');
    return shiftCard(shift, listing, buttons);
  }, { groupDates: true, emptyTitle: 'No assigned shifts', emptyText: 'Visit the swap board to find a shift.' }), own.length)}</div>`;
  if (!claims.length) html += `<div class="claims-hint"><span>No pending claims. Find a shift that fits your schedule.</span><button class="text-button" data-tab="market">Explore swap board →</button></div>`;
  return html;
}

function marketView(open) {
  const rows = open.map(listing => ({ listing, shift: state.shifts.find(shift => shift.id === listing.shift_id), reasons: listing.reasons }));
  return section('Open swap board', 'All reasons are shown. Eligibility follows your current assignments.', filteredList(rows, ({ shift, listing, reasons }) => shiftCard(
    shift, listing,
    reasons.length ? '<button class="button secondary" disabled>Not eligible</button>' : action('Claim shift', 'claim', listing.id),
    (reasons.length ? reasonList(reasons) : '<div class="eligibility">✓ You meet every scheduling rule</div>') + hoursImpact(listing.hours_impact)
  ), { eligibility: true, grid: true, emptyTitle: 'No open shifts right now', emptyText: 'When a colleague posts a shift, you’ll see its eligibility and hours here.' }), open.length);
}

function render() {
  const active = document.activeElement;
  const focusedFilter = active?.dataset.filter ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const focusedShift = active?.dataset.details;
  const actor = person(actorId);
  const manager = actor.role === 'MANAGER';
  if (!$('actor').options.length) {
    $('actor').innerHTML = ['STAFF', 'MANAGER'].map(role => `<optgroup label="${role === 'STAFF' ? 'Staff' : 'Managers'}">${state.staff.filter(item => item.role === role).map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</optgroup>`).join('');
  }
  $('actor').value = actorId;
  $('role').textContent = manager ? 'MANAGER' : 'STAFF';
  const own = state.shifts.filter(shift => shift.assigned_to === actorId).sort((a, b) => a.start.localeCompare(b.start));
  const open = state.listings.filter(listing => listing.status === 'OPEN' && listing.poster_id !== actorId);
  const pending = state.listings.filter(listing => listing.status === 'CLAIMED');
  const eligible = open.filter(listing => !listing.reasons.length);
  $('board-count').textContent = open.length;
  $('pending-count').textContent = pending.length;
  $('pending-count').hidden = !manager || !pending.length;
  $('overview-label').textContent = manager ? 'Approvals' : 'My schedule';
  $('market-label').textContent = manager ? 'Open board' : 'Swap board';
  $('profile').innerHTML = `<div class="profile-person"><div class="avatar">${esc(actor.name.slice(0, 1))}</div><div><h3>${esc(actor.name)}</h3><p>${manager ? 'Clinic manager' : 'Clinic staff'}</p></div></div><div class="certs">${actor.certifications.length ? actor.certifications.map(badge).join('') : badge(manager ? 'APPROVAL ACCESS' : 'GENERAL CARE')}</div>`;
  $('eyebrow').textContent = { overview: manager ? 'TEAM COVERAGE' : 'YOUR WORKSPACE', market: 'A LITTLE FLEXIBILITY', history: 'THE FULL PICTURE' }[tab];
  $('heading').textContent = { overview: manager ? `Let’s keep the team covered, ${actor.name}.` : `Let’s plan your week, ${actor.name}.`, market: manager ? 'Coverage starts here.' : 'Find your next shift.', history: 'Every handover has a story.' }[tab];
  $('breadcrumb').textContent = { overview: manager ? 'Approvals' : 'My schedule', market: manager ? 'Open board' : 'Swap board', history: 'Activity log' }[tab];
  $('subheading').textContent = tab === 'history' ? 'A shared record of actions, decisions and assignment changes.'
    : tab === 'market' ? manager ? 'See which shifts still need a colleague to step in.' : 'See what fits your schedule, with every eligibility check explained.'
    : manager ? 'A clear view of pending swaps, scheduling checks and your next decision.' : 'A clear schedule. A balanced week. A little room for flexibility.';
  $('primary-navigation').dataset.tab = tab === 'overview' ? 'market' : 'overview';
  $('primary-navigation').innerHTML = `${tab === 'overview' ? manager ? 'View open shifts' : 'Find a swap' : manager ? 'Review approvals' : 'My schedule'} ${icon('arrow')}`;
  const stats = manager
    ? [[pending.length, 'Awaiting approval', `${pending.filter(listing => !listing.approval_reasons?.length).length} ready · ${pending.filter(listing => listing.approval_reasons?.length).length} currently blocked`], [state.listings.filter(listing => listing.status === 'APPROVED').length, 'Approved swaps', 'Assignments successfully updated'], [state.shifts.length, 'Roster shifts', 'Across all clinic staff']]
    : [[own.length, 'Your shifts', `${number(own.reduce((sum, shift) => sum + hours(shift), 0))} hours across the roster`], [eligible.length, 'Eligible swaps', `${open.length} open listings from colleagues`], [pending.filter(listing => listing.claimer_id === actorId).length, 'Pending claims', 'Awaiting manager approval']];
  $('stats').innerHTML = stats.map(([value, label, description], index) => `<button class="stat ${index === 1 ? 'stat-highlight' : ''}" data-tab="${manager ? index === 1 ? 'history' : 'overview' : index === 1 ? 'market' : 'overview'}"><span class="stat-icon">${icon(index === 1 ? 'swap' : index === 2 ? 'clock' : 'calendar')}</span><span class="stat-copy"><span class="stat-top">${label}</span><span class="stat-value">${value}</span><small>${description}</small></span><span class="stat-arrow" aria-hidden="true">↗</span></button>`).join('');
  document.querySelectorAll('.nav-item[data-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('content').innerHTML = tab === 'history' ? historyView() : manager ? managerView(pending, open) : tab === 'overview' ? overviewView(own, pending) : marketView(open);
  renderedActor = actorId;
  setControls();
  if (focusedFilter && $(focusedFilter.id)) {
    const field = $(focusedFilter.id);
    field.focus({ preventScroll: true });
    if (field.type === 'search' && focusedFilter.start !== null) field.setSelectionRange(focusedFilter.start, focusedFilter.end);
  }
  if (focusedShift) document.querySelector(`[data-details="${CSS.escape(focusedShift)}"]`)?.focus({ preventScroll: true });
  if ($('shift-dialog').open) {
    if (dialogActor !== actorId || !state.shifts.some(shift => shift.id === dialogShift && shift.assigned_to === actorId)) $('shift-dialog').close();
    else showShiftDetails(dialogShift, { refresh: true });
  }
}

const messages = {
  post: 'Shift posted to the swap board.',
  withdraw: 'Listing withdrawn.',
  claim: 'Shift claimed. A manager must approve the change.',
  unclaim: 'Claim released. The listing is open again.',
  approve: 'Swap approved. The assignment has been updated.',
  reject: 'Claim rejected. The listing is open again.'
};

document.addEventListener('click', async event => {
  if (event.target.closest('[data-dismiss-notice]')) { $('notice').hidden = true; return; }
  if (event.target.closest('[data-close-dialog]') || event.target === $('shift-dialog')) { $('shift-dialog').close(); return; }
  const details = event.target.closest('[data-details]');
  if (details && state) { showShiftDetails(details.dataset.details); return; }
  const calendarNavigation = event.target.closest('[data-calendar-week]');
  if (calendarNavigation && calendarNavigation.dataset.calendarWeek) {
    calendarWeek = calendarNavigation.dataset.calendarWeek;
    filters.overview.week = calendarWeek;
    render();
    $('calendar-title')?.focus({ preventScroll: true });
    return;
  }
  const navigation = event.target.closest('[data-tab]');
  if (navigation) { tab = navigation.dataset.tab; if (state) render(); if (navigation.classList.contains('stat')) $('heading').focus({ preventScroll: true }); return; }
  if (event.target.closest('[data-reset-filters]')) {
    filters[tab] = tab === 'history' ? { query: '', person: '', outcome: '' } : defaultFilters();
    render();
    $('filter-search')?.focus({ preventScroll: true });
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button || busy || loading) return;
  const request = { actor_id: actorId, action: button.dataset.action, target_id: button.dataset.target };
  const sourceShift = $('shift-dialog').open ? dialogShift : null;
  if ($('shift-dialog').open) $('shift-dialog').close();
  busy = true;
  ++loadVersion;
  setControls();
  try {
    const response = await fetch('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (result.ok) showNotice(`✓ ${esc(messages[request.action])}`);
    else showNotice(`<b>Request refused</b>${reasonList(result.reasons || [{ message: result.error || 'Please try again.' }])}`, true);
    try { await load({ force: true }); }
    catch { showNotice(result.ok ? 'Your action was saved, but the latest roster could not be loaded. Try Refresh.' : 'The request was refused. The latest roster could not be loaded; try Refresh.', true); }
  } catch {
    connection(false);
    showNotice('Could not confirm the request. Refresh the roster before retrying.', true);
  } finally {
    busy = false;
    setControls();
    if (sourceShift) {
      const trigger = document.querySelector(`[data-details="${CSS.escape(sourceShift)}"]`);
      (trigger && !trigger.disabled ? trigger : $('heading')).focus({ preventScroll: true });
    }
  }
});

function updateFilter(event) {
  const field = event.target.closest('[data-filter]');
  if (!field || !state) return;
  filters[tab][field.dataset.filter] = field.type === 'checkbox' ? field.checked : field.value;
  if (tab === 'overview' && field.dataset.filter === 'week' && field.value) calendarWeek = field.value;
  render();
}
document.addEventListener('input', event => { if (event.target.type === 'search') updateFilter(event); });
document.addEventListener('change', event => { if (event.target.type !== 'search') updateFilter(event); });
$('actor').addEventListener('change', async () => {
  if ($('shift-dialog').open) $('shift-dialog').close();
  const requestedActor = $('actor').value;
  $('notice').hidden = true;
  try { await load({ force: true, requestedActor }); }
  catch (error) {
    if (state) render();
    showNotice(esc(error.message), true);
  }
});
$('shift-dialog').addEventListener('close', () => {
  const trigger = dialogActor === actorId ? document.querySelector(`[data-details="${CSS.escape(dialogShift || '')}"]`) : null;
  (trigger && !trigger.disabled ? trigger : $('heading')).focus({ preventScroll: true });
});
$('refresh').addEventListener('click', () => load({ force: true }).catch(error => showNotice(esc(error.message), true)));
function refreshInBackground() {
  if (!document.hidden && !loading && !busy && state) load({ foreground: false }).catch(() => {});
}
setInterval(refreshInBackground, 10000);
document.addEventListener('visibilitychange', refreshInBackground);
load().catch(error => showNotice(esc(error.message), true));
