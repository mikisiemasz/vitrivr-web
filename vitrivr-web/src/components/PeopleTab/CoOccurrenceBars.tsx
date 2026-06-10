import {useMemo} from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    type TooltipProps,
    XAxis,
    YAxis,
} from "recharts";
import type {CoOccurrenceItem} from "../../lib/clusters";

type Props = {
    partners: CoOccurrenceItem[];
    onSelect?: (clusterId: string) => void;
    topN?: number;
};

/** Color a bar by an "intensity" — more shared segments = stronger teal. */
function intensityColor(share: number, max: number): string {
    const t = max > 0 ? share / max : 0;
    /* Interpolate between a pale and a saturated teal. */
    const lightness = 70 - Math.round(t * 40); // 70% → 30%
    return `hsl(180 50% ${lightness}%)`;
}

function partnerName(p: CoOccurrenceItem): string {
    return p.label?.trim() || `Cluster ${p.clusterId.slice(0, 6)}`;
}

function CoOccurrenceTooltip({active, payload}: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as CoOccurrenceItem & {name: string};
    return (
        <div style={{
            background: "white",
            border: "1px solid #ccc",
            borderRadius: 4,
            padding: "6px 10px",
            fontSize: 12,
            color: "#222",
        }}>
            <div style={{fontWeight: 600}}>{row.name}</div>
            <div>{row.sharedSegments} shared segments</div>
            <div style={{color: "#666"}}>{row.memberCount} faces total</div>
        </div>
    );
}

export function CoOccurrenceBars({partners, onSelect, topN = 15}: Props) {
    const data = useMemo(() => {
        return [...partners]
            .sort((a, b) => b.sharedSegments - a.sharedSegments)
            .slice(0, topN)
            .map(p => ({...p, name: partnerName(p)}));
    }, [partners, topN]);

    if (data.length === 0) {
        return <div className="pt-empty">No co-occurring clusters.</div>;
    }

    const max = data[0].sharedSegments;
    /* Roughly 28px per bar + axis + margin = decent default height. */
    const height = Math.max(160, data.length * 32 + 40);

    return (
        <div style={{width: "100%", height}}>
            <ResponsiveContainer>
                <BarChart
                    data={data}
                    layout="vertical"
                    margin={{top: 8, right: 24, bottom: 8, left: 16}}
                >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false}/>
                    <XAxis type="number" allowDecimals={false} tick={{fontSize: 12}}/>
                    <YAxis
                        type="category"
                        dataKey="name"
                        tick={{fontSize: 12}}
                        width={140}
                        interval={0}
                    />
                    <Tooltip content={<CoOccurrenceTooltip/>}/>
                    <Bar
                        dataKey="sharedSegments"
                        cursor={onSelect ? "pointer" : "default"}
                        onClick={(d: unknown) => {
                            const row = d as CoOccurrenceItem;
                            if (onSelect && row?.clusterId) onSelect(row.clusterId);
                        }}
                    >
                        {data.map(d => (
                            <Cell key={d.clusterId} fill={intensityColor(d.sharedSegments, max)}/>
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
