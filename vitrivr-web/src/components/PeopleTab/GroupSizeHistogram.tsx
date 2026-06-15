import {useCallback, useEffect, useState} from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    type TooltipContentProps,
    XAxis,
    YAxis,
} from "recharts";
import {getGroupSizeHistogram, type GroupSizeBin} from "../../lib/clusters";

function intensityColor(value: number, max: number): string {
    const t = max > 0 ? value / max : 0;
    const lightness = 70 - Math.round(t * 40);
    return `hsl(180 50% ${lightness}%)`;
}

function HistTooltip({active, payload, total}: TooltipContentProps<number, string> & {total: number}) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as GroupSizeBin;
    const pct = total > 0 ? ((row.segmentCount / total) * 100).toFixed(1) : "0.0";
    return (
        <div style={{
            background: "white", border: "1px solid #ccc", borderRadius: 4,
            padding: "6px 10px", fontSize: 12, color: "#222",
        }}>
            <div style={{fontWeight: 600}}>
                {row.k === 1 ? "Solo shots" : `Groups of ${row.k}`}
            </div>
            <div>{row.segmentCount.toLocaleString()} segments ({pct}%)</div>
        </div>
    );
}

export function GroupSizeHistogram() {
    const [bins, setBins] = useState<GroupSizeBin[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await getGroupSizeHistogram();
            setBins(r.bins);
            setTotal(r.totalSegments);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const max = bins.reduce((m, b) => Math.max(m, b.segmentCount), 0);
    const height = 320;

    return (
        <div style={{width: "100%"}}>
            <div style={{display: "flex", alignItems: "center", gap: 12, marginBottom: 8}}>
                <strong style={{fontSize: 14}}>How many people share a segment?</strong>
                {loading && <span style={{fontSize: 12, color: "#666"}}>Loading…</span>}
                {!loading && !error && (
                    <span style={{fontSize: 12, color: "#666"}}>
                        {total.toLocaleString()} segments analysed · {bins.length} bins
                    </span>
                )}
                <button
                    className="btn"
                    onClick={() => void load()}
                    disabled={loading}
                    style={{marginLeft: "auto"}}
                >↻ Reload</button>
            </div>

            {error && <div className="pt-error">{error}</div>}

            {!loading && bins.length === 0 && !error && (
                <div className="pt-empty">
                    No clustered segments yet — run clustering first.
                </div>
            )}

            {bins.length > 0 && (
                <div style={{width: "100%", height}}>
                    <ResponsiveContainer>
                        <BarChart
                            data={bins}
                            margin={{top: 8, right: 16, bottom: 24, left: 16}}
                        >
                            <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                            <XAxis
                                dataKey="k"
                                tick={{fontSize: 12}}
                                label={{
                                    value: "distinct people in segment",
                                    position: "insideBottom",
                                    offset: -8,
                                    style: {fontSize: 12, fill: "#666"},
                                }}
                            />
                            <YAxis
                                allowDecimals={false}
                                tick={{fontSize: 12}}
                                label={{
                                    value: "segments",
                                    angle: -90,
                                    position: "insideLeft",
                                    style: {fontSize: 12, fill: "#666"},
                                }}
                            />
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            <Tooltip content={(p: any) => <HistTooltip {...p} total={total}/>}/>
                            <Bar dataKey="segmentCount">
                                {bins.map(b => (
                                    <Cell key={b.k} fill={intensityColor(b.segmentCount, max)}/>
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
