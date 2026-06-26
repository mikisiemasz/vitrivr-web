import {useCallback, useEffect, useMemo, useState} from "react";
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
import {
    getCoOccurrences,
    listClusters,
    type ClusterGalleryItem,
    type ClusteringTarget,
} from "../../lib/clusters";

type PairItem = {
    key: string;
    nameA: string;
    nameB: string;
    pairLabel: string;
    sharedSegments: number;
};

type Props = {
    /** How many top pairs to render. */
    topN?: number;
    /** Ignore very-tiny clusters when seeding the request set. */
    minMembers?: number;
    /** Drop pairs with fewer than this many shared segments. */
    minShared?: number;
    /** Restrict the pairs analysis to one kind of cluster ("detections" or "tracks"). When undefined the
     *  server defaults apply (same-as-queried-cluster for co-occurrences). */
    target?: ClusteringTarget;
};

function nameOf(c: ClusterGalleryItem): string {
    return c.label?.trim() || `Cluster ${c.clusterId.slice(0, 6)}`;
}

function intensityColor(value: number, max: number): string {
    const t = max > 0 ? value / max : 0;
    const lightness = 70 - Math.round(t * 40);
    return `hsl(180 50% ${lightness}%)`;
}

function PairTooltip({active, payload}: TooltipContentProps<number, string>) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as PairItem;
    return (
        <div style={{
            background: "white", border: "1px solid #ccc", borderRadius: 4,
            padding: "6px 10px", fontSize: 12, color: "#222",
        }}>
            <div style={{fontWeight: 600}}>{row.nameA} ↔ {row.nameB}</div>
            <div>{row.sharedSegments} shared segments</div>
        </div>
    );
}

export function CoOccurrencePairsChart({topN = 20, minMembers = 5, minShared = 2, target}: Props) {
    const [loaded, setLoaded] = useState(false);
    const [pairs, setPairs] = useState<PairItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState({done: 0, total: 0});

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        setProgress({done: 0, total: 0});
        try {
            const list = await listClusters({minMembers, limit: 500, target});
            const clusters = list.clusters;
            setProgress({done: 0, total: clusters.length});

            const nameById = new Map(clusters.map(c => [c.clusterId, nameOf(c)]));
            const pairMap = new Map<string, PairItem>();

            await Promise.all(clusters.map(async c => {
                try {
                    const r = await getCoOccurrences(c.clusterId, {limit: 200, minShared, target});
                    for (const partner of r.partners) {
                        if (partner.sharedSegments < minShared) continue;
                        if (partner.clusterId === c.clusterId) continue;
                        const [a, b] = [c.clusterId, partner.clusterId].sort();
                        const key = `${a}|${b}`;
                        if (pairMap.has(key)) continue;
                        const nameA = nameById.get(a) ?? `Cluster ${a.slice(0, 6)}`;
                        const nameB = nameById.get(b)
                            ?? partner.label?.trim()
                            ?? `Cluster ${b.slice(0, 6)}`;
                        pairMap.set(key, {
                            key,
                            nameA,
                            nameB,
                            pairLabel: `${nameA} ↔ ${nameB}`,
                            sharedSegments: partner.sharedSegments,
                        });
                    }
                } catch {
                    /* skip a single failing cluster's co-occurrences; report none */
                } finally {
                    setProgress(p => ({...p, done: p.done + 1}));
                }
            }));

            const sorted = [...pairMap.values()]
                .sort((a, b) => b.sharedSegments - a.sharedSegments);
            setPairs(sorted);
            setLoaded(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [minMembers, minShared, target]);

    /* Initial fetch when mounted. */
    useEffect(() => { void load(); }, [load]);

    const data = useMemo(() => pairs.slice(0, topN), [pairs, topN]);
    const max = data[0]?.sharedSegments ?? 0;
    const height = Math.max(200, data.length * 32 + 60);

    return (
        <div style={{width: "100%"}}>
            <div style={{display: "flex", alignItems: "center", gap: 12, marginBottom: 8}}>
                <strong style={{fontSize: 14}}>Most-frequent pairs</strong>
                {loading && (
                    <span style={{fontSize: 12, color: "#666"}}>
                        {progress.total > 0
                            ? `Loading ${progress.done}/${progress.total}…`
                            : "Loading…"}
                    </span>
                )}
                {!loading && loaded && (
                    <span style={{fontSize: 12, color: "#666"}}>
                        {pairs.length} pairs · showing top {Math.min(topN, pairs.length)}
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

            {loaded && data.length === 0 && (
                <div className="pt-empty">
                    No co-occurring pairs found at min-shared {minShared}.
                </div>
            )}

            {data.length > 0 && (
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
                                dataKey="pairLabel"
                                tick={{fontSize: 12}}
                                width={220}
                                interval={0}
                            />
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            <Tooltip content={(p: any) => <PairTooltip {...p}/>}/>
                            <Bar dataKey="sharedSegments">
                                {data.map(d => (
                                    <Cell key={d.key} fill={intensityColor(d.sharedSegments, max)}/>
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
