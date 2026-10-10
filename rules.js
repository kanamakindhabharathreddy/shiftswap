// Parse clinic-local timestamps as arithmetic coordinates, never as real UTC time.
export function minutes(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Invalid local timestamp');
  const [y, m, d, h, min] = value.match(/\d+/g).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d); date.setUTCHours(h, min, 0, 0);
  if (date.toISOString().slice(0, 16) !== value) throw new Error('Invalid local timestamp');
  return date.getTime() / 60000;
}
export function weekStart(value) {
  const date = new Date(minutes(value) * 60000);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.getTime() / 60000;
}
export function weeklyImpact(person, shift, assignments) {
  const week = weekStart(shift.start);
  const assignedMinutes = assignments
    .filter(s => s.assigned_to === person.id && s.id !== shift.id && weekStart(s.start) === week)
    .reduce((sum, s) => sum + minutes(s.end) - minutes(s.start), 0);
  const shiftMinutes = minutes(shift.end) - minutes(shift.start);
  return {
    week_start: new Date(week * 60000).toISOString().slice(0, 10),
    assigned_minutes: assignedMinutes,
    shift_minutes: shiftMinutes,
    projected_minutes: assignedMinutes + shiftMinutes,
    limit_minutes: 2400
  };
}
export function eligibility(person, shift, assignments, { approval = false } = {}) {
  if (!approval && person.id === shift.assigned_to) return [{rule: 1, message: 'You cannot claim your own shift.'}];
  const reasons = [];
  if (shift.required_certification !== null && !person.certifications.includes(shift.required_certification))
    reasons.push({rule: 2, message: `Requires ${shift.required_certification} certification.`});
  const start = minutes(shift.start), end = minutes(shift.end);
  for (const other of assignments.filter(s => s.assigned_to === person.id && s.id !== shift.id)) {
    const a = minutes(other.start), b = minutes(other.end);
    if (start < b && a < end) reasons.push({rule: 3, shift_id: other.id, message: `Overlaps shift ${other.id} (${other.start} to ${other.end}).`});
    else {
      const gap = start >= b ? start - b : a - end;
      if (gap < 660) reasons.push({rule: 4, shift_id: other.id, message: `Only ${Number((gap / 60).toFixed(2))} hours rest from shift ${other.id}; 11 hours required.`});
    }
  }
  const total = weeklyImpact(person, shift, assignments).projected_minutes;
  if (total > 2400) reasons.push({rule: 5, message: `Weekly hours would be ${Number((total / 60).toFixed(2))}; maximum is 40.`});
  return reasons;
}
