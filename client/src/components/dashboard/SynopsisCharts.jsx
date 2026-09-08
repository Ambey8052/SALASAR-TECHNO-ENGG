import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from 'recharts';
import { format } from 'date-fns';
import { ChartModal, ExpandHint } from './ChartModal';
import {
  ACHIEVEMENT_BANDS,
  ACTUAL_COLOR,
  PLANNED_COLOR,
  achievementColor,
  barLabel,
  categoryColor,
  formatCount,
  formatMt,
  formatMtWhole,
  formatPct,
  heatColor,
  heatTextColor,
  modeColor,
  orderCategories,
} from './synopsisPalette';

const axisTick = { fill: 'var(--text-muted)', fontSize: 11 };
const labelStyle = { fill: 'var(--text-secondary)', fontSize: 10 };
const segmentLabelStyle = { fill: '#ffffff', fontSize: 9, fontWeight: 600 };
const legendStyle = { fontSize: 12 };

export function ChartCard({ title, subtitle, onClick, footer, className, children }) {
  return (
    <div
      className={`${onClick ? 'group relative ' : ''}rounded-2xl border p-5${onClick ? ' transition-shadow hover:shadow-md' : ''}${className ? ` ${className}` : ''}`}
      style={{ background: 'var(--surface-1)', cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      {onClick && <ExpandHint />}
      <div className="mb-4">
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </div>
        {subtitle && (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </div>
        )}
      </div>
      {children}
      {footer && (
        <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {footer}
        </div>
      )}
    </div>
  );
}

function EmptyState({ height = 220, children }) {
  return (
    <div className="flex items-center justify-center text-sm" style={{ height, color: 'var(--text-muted)' }}>
      {children}
    </div>
  );
}

// One tooltip for every chart here. Recharts' default is a white box with inline styles that
// ignores the theme entirely, so it is replaced rather than restyled.
function SeriesTooltip({ active, payload, label, labelFormatter, valueFormatter = formatMt, unit = 'MT', hideZero = false }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((row) => !hideZero || Math.abs(row.value ?? 0) >= 0.05);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + (row.value || 0), 0);

  return (
    <div
      className="rounded-xl border px-3 py-2 shadow-lg"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--baseline)' }}
    >
      <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
        {labelFormatter ? labelFormatter(label) : label}
      </div>
      {rows.map((row) => (
        <div key={row.dataKey ?? row.name} className="flex items-center gap-2 text-xs leading-5">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: row.color ?? row.payload?.fill }} />
          <span className="mr-auto" style={{ color: 'var(--text-secondary)' }}>
            {row.name}
          </span>
          <span className="tabular-nums font-medium" style={{ color: 'var(--text-primary)' }}>
            {valueFormatter(row.value)} {unit}
          </span>
        </div>
      ))}
      {rows.length > 1 && (
        <div
          className="mt-1 flex items-center gap-2 border-t pt-1 text-xs"
          style={{ borderColor: 'var(--baseline)' }}
        >
          <span className="mr-auto font-medium" style={{ color: 'var(--text-secondary)' }}>
            Total
          </span>
          <span className="tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
            {valueFormatter(total)} {unit}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ month level ---- */

// Plan and actual are the same measure in the same unit, so they belong on one scale as
// paired bars. Achievement % is a different unit and gets its own chart below rather than a
// second y-axis over these bars.
export function MonthlyPlanChart({ monthlyTrend }) {
  const data = monthlyTrend.map((m) => ({ ...m, name: m.shortLabel }));

  return (
    <ChartCard
      title="Planned vs dispatched, month by month"
      subtitle="Tonnage each monthly report planned against what it recorded"
      footer={
        data.some((m) => m.partial)
          ? `${data.filter((m) => m.partial).map((m) => m.label).join(' and ')} ${data.filter((m) => m.partial).length > 1 ? 'are' : 'is'} a part-month report — the plan is the full month's, the dispatch only to the last day recorded.`
          : null
      }
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 24, right: 8, left: -12, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke="var(--gridline)" vertical={false} />
          <XAxis dataKey="name" tick={axisTick} axisLine={{ stroke: 'var(--baseline)' }} tickLine={false} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            cursor={{ fill: 'var(--gridline)', opacity: 0.35 }}
            content={<SeriesTooltip labelFormatter={(l) => data.find((m) => m.name === l)?.label ?? l} />}
          />
          <Legend wrapperStyle={legendStyle} />
          <Bar dataKey="planned" name="Planned" fill={PLANNED_COLOR} maxBarSize={26} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="planned" position="top" formatter={formatMtWhole} style={labelStyle} />
          </Bar>
          <Bar dataKey="dispatched" name="Dispatched" fill={ACTUAL_COLOR} maxBarSize={26} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="dispatched" position="top" formatter={formatMtWhole} style={labelStyle} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function MonthlyAchievementChart({ monthlyTrend }) {
  const data = monthlyTrend.map((m) => ({ ...m, name: m.shortLabel, achievedPct: m.achievedPct ?? 0 }));

  return (
    <ChartCard
      title="Plan achieved, month by month"
      subtitle="Dispatched as a share of that month's plan"
      footer={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {ACHIEVEMENT_BANDS.map((band) => (
            <span key={band.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: band.color }} />
              {band.label}
            </span>
          ))}
        </span>
      }
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 24, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--gridline)" vertical={false} />
          <XAxis dataKey="name" tick={axisTick} axisLine={{ stroke: 'var(--baseline)' }} tickLine={false} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} unit="%" />
          <Tooltip
            cursor={{ fill: 'var(--gridline)', opacity: 0.35 }}
            content={<SeriesTooltip unit="" valueFormatter={formatPct} labelFormatter={(l) => data.find((m) => m.name === l)?.label ?? l} />}
          />
          <ReferenceLine y={100} stroke="var(--baseline)" strokeDasharray="4 4" />
          <Bar dataKey="achievedPct" name="Achieved" maxBarSize={40} radius={[4, 4, 0, 0]}>
            {data.map((m) => (
              <Cell key={m.month} fill={achievementColor(m.achievedPct)} />
            ))}
            <LabelList dataKey="achievedPct" position="top" formatter={formatPct} style={labelStyle} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* -------------------------------------------------------------------- day level ---- */

const PX_PER_DAY = 46;

function DailyStackedChart({ data, categoryKeys, expanded }) {
  const chart = (
    <BarChart data={data} margin={{ top: 24, right: 8, left: expanded ? 0 : -16, bottom: 0 }}>
      <CartesianGrid stroke="var(--gridline)" vertical={false} />
      <XAxis
        dataKey="date"
        interval={expanded ? 0 : 'preserveStartEnd'}
        tickFormatter={(d) => format(new Date(d), 'd MMM')}
        tick={axisTick}
        axisLine={{ stroke: 'var(--baseline)' }}
        tickLine={false}
        angle={expanded ? -35 : 0}
        textAnchor={expanded ? 'end' : 'middle'}
        height={expanded ? 54 : 30}
      />
      <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} />
      <Tooltip
        cursor={{ fill: 'var(--gridline)', opacity: 0.35 }}
        content={<SeriesTooltip hideZero labelFormatter={(d) => format(new Date(d), 'EEEE d MMMM yyyy')} />}
      />
      <Legend wrapperStyle={legendStyle} />
      {categoryKeys.map((key, i) => (
        <Bar
          key={key}
          dataKey={key}
          name={key}
          stackId="synopsis"
          fill={categoryColor(key)}
          maxBarSize={expanded ? 40 : 30}
          radius={i === categoryKeys.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
        >
          {expanded && (
            <LabelList dataKey={key} position="center" angle={-90} formatter={barLabel} style={segmentLabelStyle} />
          )}
          {i === categoryKeys.length - 1 && (
            <LabelList dataKey="total" position="top" formatter={expanded ? barLabel : () => ''} style={labelStyle} />
          )}
        </Bar>
      ))}
    </BarChart>
  );

  if (!expanded) {
    return (
      <ResponsiveContainer width="100%" height={300}>
        {chart}
      </ResponsiveContainer>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: Math.max(data.length * PX_PER_DAY, 640) }}>
        <ResponsiveContainer width="100%" height={480}>
          {chart}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DailyDispatchChart({ daily, categoryKeys, scopeLabel }) {
  const [expanded, setExpanded] = useState(false);
  const keys = orderCategories(categoryKeys);
  const empty = daily.length === 0;

  return (
    <>
      <ChartCard
        title="Dispatch, day by day"
        subtitle={`Every recorded day in ${scopeLabel}, split by department group`}
        onClick={empty ? undefined : () => setExpanded(true)}
        className="lg:col-span-2"
      >
        {empty ? <EmptyState height={300}>No dispatches recorded in this period</EmptyState> : <DailyStackedChart data={daily} categoryKeys={keys} expanded={false} />}
      </ChartCard>
      <ChartModal
        title="Dispatch, day by day"
        subtitle={`Every recorded day in ${scopeLabel}, split by department group`}
        isOpen={expanded}
        onClose={() => setExpanded(false)}
      >
        <DailyStackedChart data={daily} categoryKeys={keys} expanded />
      </ChartModal>
    </>
  );
}

// Both lines are cumulative tonnage, so they share one scale honestly. The plan line is the
// even pace the month's target implies across the days actually reported — the gap between
// the two lines is the shortfall to date, read directly off the chart.
export function CumulativePaceChart({ cumulative, scopeLabel }) {
  const empty = cumulative.length === 0;
  const last = cumulative[cumulative.length - 1];

  return (
    <ChartCard
      title="Cumulative dispatch against plan pace"
      subtitle={`Running total through ${scopeLabel}, against the plan spread evenly over reported days`}
      footer={
        last
          ? `Ended ${formatMt(Math.abs(last.plan - last.actual))} MT ${last.actual >= last.plan ? 'ahead of' : 'behind'} pace.`
          : null
      }
      className="lg:col-span-2"
    >
      {empty ? (
        <EmptyState height={280}>No dispatches recorded in this period</EmptyState>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={cumulative} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => format(new Date(d), 'd MMM')}
              tick={axisTick}
              axisLine={{ stroke: 'var(--baseline)' }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} width={52} />
            <Tooltip
              cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }}
              content={<SeriesTooltip labelFormatter={(d) => format(new Date(d), 'EEEE d MMMM yyyy')} />}
            />
            <Legend wrapperStyle={legendStyle} />
            <Line
              type="monotone"
              dataKey="plan"
              name="Plan pace"
              stroke={PLANNED_COLOR}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={false}
            />
            <Line type="monotone" dataKey="actual" name="Dispatched" stroke={ACTUAL_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------- share of ---- */

const RADIAN = Math.PI / 180;

// Percentages sit just outside the ring in ordinary text ink rather than inside the wedge in
// white. Three of the eight group colours are light enough that white on them fails contrast,
// so an inside label would be unreadable on exactly those slices.
function renderPercentLabel({ cx, cy, midAngle, outerRadius, percent }) {
  // A wedge under ~4% is too narrow to own a label without colliding with its neighbours.
  // Those groups still carry their exact share in the legend and on hover.
  if (percent < 0.04) return null;

  const radius = outerRadius + 14;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      style={{ fontSize: 11, fontWeight: 600, fill: 'var(--text-secondary)' }}
    >
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
}

function DonutChart({ data, colorOf, nameKey, valueKey, height = 260, showPercent = false }) {
  const total = data.reduce((sum, d) => sum + (d[valueKey] || 0), 0);

  // With the shares shown, the ring sits left and the legend becomes a column down the right.
  // Eight groups make a bottom legend wrap into three cramped rows, and the ring then has no
  // margin left for its outside labels.
  const sideLegend = showPercent;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart margin={showPercent ? { top: 8, right: 8, bottom: 8, left: 8 } : undefined}>
        <Tooltip content={<SeriesTooltip />} />
        <Legend
          wrapperStyle={sideLegend ? { ...legendStyle, lineHeight: '22px', paddingLeft: 8 } : legendStyle}
          layout={sideLegend ? 'vertical' : 'horizontal'}
          align={sideLegend ? 'right' : 'center'}
          verticalAlign={sideLegend ? 'middle' : 'bottom'}
          // Every group gets its share here, including the small ones the ring cannot label.
          formatter={
            showPercent
              ? (value, entry) => {
                  const share = total > 0 ? ((entry?.payload?.[valueKey] || 0) / total) * 100 : 0;
                  return `${value} · ${share.toFixed(1)}%`;
                }
              : undefined
          }
        />
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx={sideLegend ? '32%' : '50%'}
          innerRadius={showPercent ? '46%' : '52%'}
          outerRadius={showPercent ? '68%' : '80%'}
          paddingAngle={2}
          // A surface-coloured ring keeps neighbouring wedges from reading as one shape.
          stroke="var(--surface-1)"
          strokeWidth={2}
          label={showPercent ? renderPercentLabel : undefined}
          labelLine={false}
          isAnimationActive={false}
        >
          {data.map((entry) => (
            <Cell key={entry[nameKey]} fill={colorOf(entry[nameKey])} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CategoryShareChart({ byCategory }) {
  const data = byCategory.map((c) => ({ ...c, name: c.category }));
  const top = [...data].sort((a, b) => b.dispatched - a.dispatched)[0];

  return (
    <ChartCard
      title="Share of tonnage by department group"
      subtitle="How the dispatched tonnage divides across the plant's groups"
      className="lg:col-span-2"
      footer={top ? `${top.category} is the largest at ${formatPct(top.share)} of everything dispatched.` : null}
    >
      {data.length === 0 ? (
        <EmptyState height={300}>Nothing dispatched in this period</EmptyState>
      ) : (
        <DonutChart data={data} colorOf={categoryColor} nameKey="category" valueKey="dispatched" height={300} showPercent />
      )}
    </ChartCard>
  );
}

export function ModeShareChart({ byMode }) {
  const data = byMode.map((m) => ({ ...m, name: m.mode }));

  return (
    <ChartCard
      title="In-house, job work and buyout"
      subtitle="Dispatched tonnage by how the work was produced"
      footer={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {data.map((m) => (
            <span key={m.mode}>
              {m.mode}: <span className="tabular-nums font-medium" style={{ color: 'var(--text-secondary)' }}>{formatMt(m.dispatched)} MT</span>
              {m.achievedPct !== null && ` (${formatPct(m.achievedPct)} of plan)`}
            </span>
          ))}
        </span>
      }
    >
      {data.length === 0 ? (
        <EmptyState height={260}>Nothing dispatched in this period</EmptyState>
      ) : (
        <DonutChart data={data} colorOf={modeColor} nameKey="mode" valueKey="dispatched" />
      )}
    </ChartCard>
  );
}

/* -------------------------------------------------------------- department level ---- */

export function DepartmentPlanChart({ byDepartment }) {
  const data = [...byDepartment].sort((a, b) => b.dispatched - a.dispatched);
  const height = Math.max(data.length * 34 + 60, 260);

  return (
    <ChartCard
      title="Planned vs dispatched, by department"
      subtitle="Every department in the period, largest dispatch first"
      className="lg:col-span-2"
    >
      {data.length === 0 ? (
        <EmptyState height={260}>No departments in this period</EmptyState>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke="var(--gridline)" horizontal={false} />
            <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="department"
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={150}
            />
            <Tooltip cursor={{ fill: 'var(--gridline)', opacity: 0.35 }} content={<SeriesTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Bar dataKey="planned" name="Planned" fill={PLANNED_COLOR} maxBarSize={11} radius={[0, 3, 3, 0]} />
            <Bar dataKey="dispatched" name="Dispatched" fill={ACTUAL_COLOR} maxBarSize={11} radius={[0, 3, 3, 0]}>
              <LabelList dataKey="dispatched" position="right" formatter={formatMtWhole} style={labelStyle} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function DepartmentAchievementChart({ byDepartment }) {
  const data = byDepartment
    .filter((d) => d.achievedPct !== null)
    .map((d) => ({ ...d, achievedPct: d.achievedPct }))
    .sort((a, b) => b.achievedPct - a.achievedPct);
  const height = Math.max(data.length * 30 + 50, 260);

  return (
    <ChartCard
      title="Plan achieved, by department"
      subtitle="Where the plan was met and where it was missed"
      className="lg:col-span-2"
      footer={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {ACHIEVEMENT_BANDS.map((band) => (
            <span key={band.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: band.color }} />
              {band.label}
            </span>
          ))}
          <span>Dashed line marks 100% of plan.</span>
        </span>
      }
    >
      {data.length === 0 ? (
        <EmptyState height={260}>No department had a plan in this period</EmptyState>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" horizontal={false} />
            <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} unit="%" />
            <YAxis
              type="category"
              dataKey="department"
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={150}
            />
            <Tooltip
              cursor={{ fill: 'var(--gridline)', opacity: 0.35 }}
              content={<SeriesTooltip unit="" valueFormatter={formatPct} />}
            />
            <ReferenceLine x={100} stroke="var(--baseline)" strokeDasharray="4 4" />
            <Bar dataKey="achievedPct" name="Achieved" maxBarSize={16} radius={[0, 3, 3, 0]}>
              {data.map((d) => (
                <Cell key={d.department} fill={achievementColor(d.achievedPct)} />
              ))}
              <LabelList dataKey="achievedPct" position="right" formatter={formatPct} style={labelStyle} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

// A grid rather than a chart: 13 departments across 5 months is 65 values, which as bars
// would be unreadable but as a shaded matrix shows at a glance which lines run every month
// and which stopped.
export function DepartmentMatrix({ departmentMatrix }) {
  const { months, rows } = departmentMatrix;
  const max = Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => c.dispatched ?? 0)));

  if (rows.length === 0) return null;

  return (
    <ChartCard
      title="Department by month"
      subtitle="Tonnage dispatched in each month — darker is more"
      className="lg:col-span-2"
      footer="A blank cell means the department was not listed in that month's report at all, which is not the same as a listed department that dispatched nothing (shown as 0.0)."
    >
      <div className="overflow-x-auto">
        <table className="w-full border-separate text-xs" style={{ borderSpacing: '2px', minWidth: 560 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 px-2 py-1 text-left font-medium" style={{ color: 'var(--text-muted)', background: 'var(--surface-1)' }}>
                Department
              </th>
              {months.map((m) => (
                <th key={m.month} className="px-2 py-1 text-center font-medium" style={{ color: 'var(--text-muted)' }}>
                  {m.label.split(' ')[0].slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.department}>
                <th
                  className="sticky left-0 z-10 whitespace-nowrap px-2 py-1 text-left font-normal"
                  style={{ color: 'var(--text-secondary)', background: 'var(--surface-1)' }}
                >
                  {row.department}
                </th>
                {row.cells.map((cell) => (
                  <td
                    key={cell.month}
                    title={`${row.department} — ${months.find((m) => m.month === cell.month)?.label}: ${cell.dispatched === null ? 'not in this report' : `${formatMt(cell.dispatched)} MT`}`}
                    className="rounded-md px-2 py-1.5 text-center tabular-nums"
                    style={{
                      background: heatColor(cell.dispatched, max),
                      color: heatTextColor(cell.dispatched, max),
                      border: cell.dispatched === null ? '1px dashed var(--gridline)' : '1px solid transparent',
                    }}
                  >
                    {cell.dispatched === null ? '' : formatMt(cell.dispatched)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------------ towers ---- */

export function TowerChart({ towers, towersByMonth, totals }) {
  const data = towers.filter((t) => t.towerNos > 0).map((t) => ({ ...t, name: t.heightM ? `${t.model} ${t.heightM} m` : t.model }));

  return (
    <ChartCard
      title="Towers and poles dispatched"
      subtitle="Physical counts from each monthly report's tower synopsis"
      footer={`${formatCount(totals.towerNos)} towers and poles and ${formatCount(totals.cipNos)} CIP across the period. These are counts, not tonnage, and are added up from the per-month figures each report lists.`}
    >
      {data.length === 0 ? (
        <EmptyState height={240}>No tower counts recorded in this period</EmptyState>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(data.length * 34 + 40, 240)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" horizontal={false} />
            <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={130}
            />
            <Tooltip
              cursor={{ fill: 'var(--gridline)', opacity: 0.35 }}
              content={<SeriesTooltip unit="nos" valueFormatter={formatCount} />}
            />
            <Bar dataKey="towerNos" name="Towers / poles" fill="var(--series-7)" maxBarSize={18} radius={[0, 3, 3, 0]}>
              <LabelList dataKey="towerNos" position="right" formatter={formatCount} style={labelStyle} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {towersByMonth.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-xs" style={{ borderColor: 'var(--gridline)', color: 'var(--text-muted)' }}>
          {towersByMonth.map((m) => (
            <span key={m.month}>
              {m.shortLabel}:{' '}
              <span className="tabular-nums font-medium" style={{ color: 'var(--text-secondary)' }}>
                {formatCount(m.towerNos)}
              </span>
            </span>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------- table view ---- */

// The palette check flags three of the eight hues as under 3:1 against the light surface,
// which obliges a non-colour route to the same numbers. Every figure the charts above encode
// is also readable here.
export function DepartmentTable({ byDepartment }) {
  const [open, setOpen] = useState(false);
  const data = [...byDepartment].sort((a, b) => b.dispatched - a.dispatched);
  const totals = data.reduce(
    (acc, d) => ({ planned: acc.planned + d.planned, dispatched: acc.dispatched + d.dispatched }),
    { planned: 0, dispatched: 0 },
  );

  return (
    <div className="rounded-2xl border" style={{ background: 'var(--surface-1)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            All figures as a table
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {data.length} departments — every number behind the charts above
          </div>
        </div>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t px-5 py-4" style={{ borderColor: 'var(--gridline)' }}>
          <table className="w-full text-sm" style={{ minWidth: 520 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="py-2 pr-3 text-left text-xs font-medium">Department</th>
                <th className="py-2 pr-3 text-left text-xs font-medium">Group</th>
                <th className="py-2 pr-3 text-right text-xs font-medium">Planned (MT)</th>
                <th className="py-2 pr-3 text-right text-xs font-medium">Dispatched (MT)</th>
                <th className="py-2 pr-3 text-right text-xs font-medium">Balance (MT)</th>
                <th className="py-2 text-right text-xs font-medium">Achieved</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.department} className="border-t" style={{ borderColor: 'var(--gridline)' }}>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-primary)' }}>
                    {d.department}
                  </td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: categoryColor(d.category) }} />
                    {d.category}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {formatMt(d.planned)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-medium" style={{ color: 'var(--text-primary)' }}>
                    {formatMt(d.dispatched)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {formatMt(d.balance)}
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium" style={{ color: achievementColor(d.achievedPct) }}>
                    {formatPct(d.achievedPct)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2" style={{ borderColor: 'var(--baseline)' }}>
                <td className="py-2 pr-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Total
                </td>
                <td />
                <td className="py-2 pr-3 text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {formatMt(totals.planned)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {formatMt(totals.dispatched)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {formatMt(totals.planned - totals.dispatched)}
                </td>
                <td className="py-2 text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {formatPct(totals.planned > 0 ? (totals.dispatched / totals.planned) * 100 : null)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
