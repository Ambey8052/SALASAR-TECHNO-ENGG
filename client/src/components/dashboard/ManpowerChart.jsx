import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer, BarChart, Bar, Cell, LabelList } from 'recharts';
import { format } from 'date-fns';
import { ChartModal, ExpandHint } from './ChartModal';

const fmt = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
const insideLabelStyle = { fill: '#ffffff', fontSize: 11, fontWeight: 600 };

const CATEGORY_LABELS = {
  fabrication: 'Fabrication',
  painting: 'Painting',
  civil: 'Civil',
  shed: 'Shed',
  office: 'Office',
};

const CATEGORY_COLORS = {
  fabrication: 'var(--series-1)',
  painting: 'var(--series-2)',
  civil: 'var(--series-3)',
  shed: 'var(--series-4)',
  office: 'var(--series-7)',
};

function ChartCard({ title, subtitle, onClick, children }) {
  return (
    <div
      className={onClick ? 'group relative rounded-2xl border p-5 transition-shadow hover:shadow-md' : 'rounded-2xl border p-5'}
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
    </div>
  );
}

const PX_PER_POINT = 42;

function ManpowerLineChart({ data, categoryKeys, expanded }) {
  const chart = (
    <LineChart data={data} margin={{ top: 20, right: 8, left: expanded ? 0 : -16, bottom: 0 }}>
      <CartesianGrid stroke="var(--gridline)" vertical={false} />
      <XAxis
        dataKey="date"
        interval={expanded ? 0 : undefined}
        tickFormatter={(d) => format(new Date(d), 'd MMM')}
        tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
        axisLine={{ stroke: 'var(--baseline)' }}
        tickLine={false}
        angle={expanded ? -35 : 0}
        textAnchor={expanded ? 'end' : 'middle'}
        height={expanded ? 50 : 30}
      />
      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
      <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => CATEGORY_LABELS[v] || v} />
      {categoryKeys.map((key, i) => {
        const color = CATEGORY_COLORS[key] || 'var(--series-1)';
        return (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={key}
            stroke={color}
            strokeWidth={2.5}
            dot={{ r: 3, fill: color, strokeWidth: 0 }}
            connectNulls
          >
            <LabelList dataKey={key} position={i % 2 === 0 ? 'top' : 'bottom'} formatter={fmt} style={{ fill: color, fontSize: 10, fontWeight: 600 }} />
          </Line>
        );
      })}
    </LineChart>
  );

  if (!expanded) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        {chart}
      </ResponsiveContainer>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: Math.max(data.length * PX_PER_POINT, 600) }}>
        <ResponsiveContainer width="100%" height={440}>
          {chart}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Preferred display order — HSD only ever has the first two, so its chart naturally shows
// just those; Bhilai (BU) also has civil/shed (and sometimes office), which slot in here too.
const CATEGORY_ORDER = ['fabrication', 'painting', 'civil', 'shed', 'office'];

export function ManpowerTrendChart({ trendByCategory }) {
  const [expanded, setExpanded] = useState(false);
  const categoryKeys = CATEGORY_ORDER.filter((key) => trendByCategory.some((t) => key in t));
  const data = trendByCategory.map((t) => {
    const row = { date: t.date };
    categoryKeys.forEach((key) => {
      row[key] = t[key] ?? 0;
    });
    return row;
  });
  const empty = data.length === 0;
  const categoryList = categoryKeys.map((k) => CATEGORY_LABELS[k]).join(' vs ');

  return (
    <>
      <ChartCard
        title="Manpower on site"
        subtitle={`${categoryList}, per day, in the selected range`}
        onClick={empty ? undefined : () => setExpanded(true)}
      >
        {empty ? (
          <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No manpower data synced for this range yet
          </div>
        ) : (
          <ManpowerLineChart data={data} categoryKeys={categoryKeys} expanded={false} />
        )}
      </ChartCard>
      <ChartModal
        title="Manpower on site"
        subtitle={`${categoryList} — every day in the selected range`}
        isOpen={expanded}
        onClose={() => setExpanded(false)}
      >
        <ManpowerLineChart data={data} categoryKeys={categoryKeys} expanded />
      </ChartModal>
    </>
  );
}

export function ManpowerCategoryChart({ byCategory }) {
  const data = byCategory.map((c) => ({ category: CATEGORY_LABELS[c.category] || c.category, total: c.total, key: c.category }));

  return (
    <ChartCard title="Manpower by category" subtitle="Average headcount per day, by category, in the selected range">
      {data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No manpower data synced for this range yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="category"
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={22}>
              {data.map((d) => (
                <Cell key={d.key} fill={CATEGORY_COLORS[d.key] || 'var(--series-1)'} />
              ))}
              <LabelList dataKey="total" position="center" formatter={fmt} style={insideLabelStyle} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
