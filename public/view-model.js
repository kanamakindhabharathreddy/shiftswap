// Pure frontend helpers. Filters never affect the server's validation rules.
export function weekOf(value) {
  const date = new Date(value + ':00Z');
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

// Count overnight shifts and their full duration on the day/week they start,
// matching the scheduling rules. Include quiet weeks from the clinic roster.
export function weeklyWorkload(shifts, weeks) {
  return [...new Set(weeks)].sort().map(week => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(week + 'T00:00:00Z');
      day.setUTCDate(day.getUTCDate() + index);
      const key = day.toISOString().slice(0, 10);
      const assigned = shifts.filter(shift => shift.start.slice(0, 10) === key);
      const minutes = assigned.reduce((total, shift) => total + (new Date(shift.end + ':00Z') - new Date(shift.start + ':00Z')) / 60000, 0);
      return { date: key, count: assigned.length, minutes };
    });
    return { week, days, minutes: days.reduce((total, day) => total + day.minutes, 0), count: days.reduce((total, day) => total + day.count, 0) };
  });
}

export function filterRows(rows, filters, nameOf) {
  const query = filters.query.trim().toLowerCase();
  return rows.filter(({ shift, listing, reasons = [] }) => {
    const text = [shift.id, shift.start, shift.end, shift.required_certification || 'general care', nameOf(shift.assigned_to), nameOf(listing?.claimer_id)].join(' ').toLowerCase();
    return (!query || text.includes(query))
      && (!filters.week || weekOf(shift.start) === filters.week)
      && (!filters.eligible || reasons.length === 0);
  }).sort((a, b) => {
    if (filters.sort === 'duration') {
      const duration = row => new Date(row.shift.end + ':00Z') - new Date(row.shift.start + ':00Z');
      return duration(b) - duration(a) || a.shift.start.localeCompare(b.shift.start) || a.shift.id.localeCompare(b.shift.id);
    }
    return a.shift.start.localeCompare(b.shift.start) || a.shift.id.localeCompare(b.shift.id);
  });
}

export function filterHistory(events, filters) {
  const query = filters.query.trim().toLowerCase();
  return events.filter(event => (!filters.person || event.actor_id === filters.person)
    && (!filters.outcome || event.outcome === filters.outcome)
    && (!query || [event.action, event.shift_id, event.target_id, ...event.reasons.map(r => r.message)].join(' ').toLowerCase().includes(query)))
    .sort((a, b) => b.id - a.id);
}
