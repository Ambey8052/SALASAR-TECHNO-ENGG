// Builders for the array-of-arrays shape sheet_to_json({ header: 1 }) produces. Fixtures are
// small and synthetic on purpose: the real workbooks are business-confidential and stay out of
// the repository. Each fixture reproduces the *shape* of a real incident with made-up numbers.

// Excel date serial for a calendar day (the 1899-12-30 epoch, as utils/sheetDate.js reads it).
export function serial(isoDay) {
  return (Date.parse(`${isoDay}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

export const day = (isoDay) => new Date(`${isoDay}T00:00:00.000Z`);
export const iso = (date) => date.toISOString().slice(0, 10);

// A production progress block: header (client cell + date serials, two columns per date), a
// weekday row, then one row per stage as [avg, srNo, label, monthTotal, cum, inc, cum, inc, …].
export function progressBlock(clientLabel, dates, stages) {
  const header = [null, 'SL.No', clientLabel, 'From 1st to till now '];
  const weekdays = [null, null, 'Day', null];
  dates.forEach((d) => {
    header.push(serial(d), null);
    weekdays.push('Mon', null);
  });
  const rows = [['Per day Avg. (Till Now) '], header, weekdays];
  stages.forEach(({ label, pairs }, i) => {
    const total = pairs.reduce((s, [, inc]) => s + (typeof inc === 'number' ? inc : 0), 0);
    rows.push([0, i + 1, label, total, ...pairs.flat()]);
  });
  return rows;
}

// A Daily Dispatch block: a title row, a date header, a weekday row, then project rows.
export function dispatchBlock(title, dates, projects) {
  const rows = [[null, null, null, title], ['Sr.no', 'PROJECT', 'Total Dispatch', ...dates.map(serial)], [null, null, null, ...dates.map(() => 'Mon')]];
  projects.forEach(([label, ...cells], i) => {
    const total = cells.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
    rows.push([/total/i.test(label) ? label : i + 1, /total/i.test(label) ? null : label, total, ...cells]);
  });
  return rows;
}

// A Manpower month block: date serials three columns apart (Day / Night / 12.30), the shift
// sub-header (12.30 written as a time serial, as the real sheet does), then numbered rows.
export function manpowerBlock(dates, rows) {
  const header = ['Sr. No', 'Date'];
  const shifts = [null, 'Day'];
  dates.forEach((d) => {
    header.push(serial(d), null, null);
    shifts.push('Day', 'Night', 12.5 / 24);
  });
  return [header, shifts, ...rows];
}

// A monthly Dispatch Synopsis department table.
export function synopsisTable(dayLabels, departments, grandTotal) {
  const rows = [['Sr. No', 'Department', 'Planned', ...dayLabels, 'Cumulative']];
  departments.forEach(([label, planned, ...cells], i) => {
    const cumulative = cells.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
    rows.push([i + 1, label, planned, ...cells, cumulative]);
  });
  if (grandTotal) rows.push(['Grand-Total', null, ...grandTotal]);
  return rows;
}
