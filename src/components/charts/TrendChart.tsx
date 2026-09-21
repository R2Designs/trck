import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Table2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDate, formatNumber } from '@/lib/format';
import { useTheme } from '@/app/theme';

/**
 * Time-series charts for the organisation dashboard.
 *
 * Two deliberate decisions:
 *
 * **Every chart is single-series.** The obvious alternative — stacking
 * anomalies by severity — was rejected: the brand's red/amber status pair
 * measures ΔE 4.8 under deuteranopia and 11.2 under normal vision on a white
 * surface, so a stacked bar would be unreadable for a red-green colour-blind
 * viewer and marginal for everyone else. Severity lives in the alert list,
 * where it carries an icon and a word. These charts answer "is this trending
 * the wrong way?"; the list answers "what do I look at?".
 *
 * **No dual axes, ever.** Distance and efficiency are different scales, so
 * they are different charts.
 *
 * Marks follow the house rules: 2 px lines, no dot per point, a 4 px rounded
 * top on bars, a recessive grid with no vertical rules, and a crosshair
 * tooltip. Every chart also offers a table view, so the data is never
 * available only as pixels.
 */

export interface TrendPoint {
  date: string;
  value: number | null;
}

export function TrendChart({
  title,
  data,
  kind = 'line',
  unitSuffix,
  decimals = 0,
  emptyLabel,
}: {
  title: string;
  data: readonly TrendPoint[];
  kind?: 'line' | 'bar';
  unitSuffix?: string;
  decimals?: number;
  emptyLabel?: string;
}) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  // One hue, stepped per mode. Dark mode is chosen for the dark surface rather
  // than being an automatic lightening of the light value.
  const series = resolved === 'dark' ? '#31b98c' : '#135340';
  const grid = resolved === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const axisText = resolved === 'dark' ? '#9fb0b6' : '#5a6b70';

  const points = data.map((point) => ({
    ...point,
    label: formatDate(point.date),
    value: point.value ?? 0,
  }));

  const total = points.reduce((sum, point) => sum + point.value, 0);
  const isEmpty = points.length === 0 || total === 0;

  const formatValue = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: decimals })}${unitSuffix ? ` ${unitSuffix}` : ''}`;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{title}</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTable((value) => !value)}
          aria-expanded={showTable}
          aria-controls={tableId}
        >
          <Table2 className="size-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">{t('actions.viewDetails')}</span>
        </Button>
      </CardHeader>

      <CardContent>
        {isEmpty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {emptyLabel ?? t('empty.generic')}
          </p>
        ) : (
          <>
            <figure
              role="img"
              aria-label={t('a11y.chartDescription', {
                title,
                summary: formatValue(total),
              })}
            >
              <ResponsiveContainer width="100%" height={200}>
                {kind === 'bar' ? (
                  <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke={grid} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: axisText, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={28}
                    />
                    <YAxis
                      tick={{ fill: axisText, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                    />
                    <Tooltip
                      cursor={{ fill: grid }}
                      content={<ChartTooltip formatValue={formatValue} />}
                    />
                    {/* 4 px rounded data-end, anchored to the baseline. */}
                    <Bar dataKey="value" fill={series} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                ) : (
                  <AreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id={`fill-${tableId}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={series} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={series} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={grid} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: axisText, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={28}
                    />
                    <YAxis
                      tick={{ fill: axisText, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                    />
                    <Tooltip
                      cursor={{ stroke: axisText, strokeWidth: 1 }}
                      content={<ChartTooltip formatValue={formatValue} />}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={series}
                      strokeWidth={2}
                      fill={`url(#fill-${tableId})`}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2 }}
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </figure>

            {showTable && (
              <div
                id={tableId}
                className="mt-3 max-h-56 overflow-auto rounded-lg border border-border"
              >
                <table className="w-full text-sm">
                  <caption className="sr-only">{title}</caption>
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        {t('audit.when')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        {title}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {points.map((point) => (
                      <tr key={point.date}>
                        <td className="px-3 py-1.5">{point.label}</td>
                        <td className="tabular px-3 py-1.5 text-right">
                          {formatValue(point.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface TooltipPayload {
  payload?: Array<{ payload: { label: string; value: number } }>;
  active?: boolean;
}

function ChartTooltip({
  active,
  payload,
  formatValue,
}: TooltipPayload & { formatValue: (value: number) => string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-lg">
      <p className="text-xs text-muted-foreground">{point.label}</p>
      {/* Value in ink, not in the series colour — the mark carries identity. */}
      <p className="tabular mt-0.5 font-semibold text-popover-foreground">
        {formatValue(point.value)}
      </p>
    </div>
  );
}
