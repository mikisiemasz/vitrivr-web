import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import ForceGraph2D, {type ForceGraphMethods} from "react-force-graph-2d";
import {
    getCoOccurrences,
    listClusters,
    type ClusterGalleryItem,
    type ClusteringTarget,
} from "../../lib/clusters";

type NodeDatum = {
    id: string;
    name: string;
    memberCount: number;
    labelled: boolean;
};

type LinkDatum = {
    source: string;
    target: string;
    value: number;
};

type GraphData = {nodes: NodeDatum[]; links: LinkDatum[]};

type Props = {
    minMembers?: number;
    minShared?: number;
    height?: number;
    /** Restrict the network to detection-clusters or track-clusters. */
    target?: ClusteringTarget;
};

function nameOf(c: ClusterGalleryItem): string {
    return c.label?.trim() || `Cluster ${c.clusterId.slice(0, 6)}`;
}

export function CoOccurrenceNetwork({minMembers = 5, minShared = 2, height = 520, target}: Props) {
    const fgRef = useRef<ForceGraphMethods | undefined>(undefined);

    const [data, setData] = useState<GraphData>({nodes: [], links: []});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState({done: 0, total: 0});
    const [highlighted, setHighlighted] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        setProgress({done: 0, total: 0});
        try {
            const list = await listClusters({minMembers, limit: 500, target});
            const clusters = list.clusters;
            setProgress({done: 0, total: clusters.length});

            const nodes: NodeDatum[] = clusters.map(c => ({
                id: c.clusterId,
                name: nameOf(c),
                memberCount: c.memberCount,
                labelled: !!c.label?.trim(),
            }));
            const nodeIds = new Set(nodes.map(n => n.id));

            const linkMap = new Map<string, LinkDatum>();
            await Promise.all(clusters.map(async c => {
                try {
                    const r = await getCoOccurrences(c.clusterId, {limit: 200, minShared, target});
                    for (const partner of r.partners) {
                        if (partner.sharedSegments < minShared) continue;
                        if (partner.clusterId === c.clusterId) continue;
                        if (!nodeIds.has(partner.clusterId)) continue;
                        const [a, b] = [c.clusterId, partner.clusterId].sort();
                        const key = `${a}|${b}`;
                        if (linkMap.has(key)) continue;
                        linkMap.set(key, {source: a, target: b, value: partner.sharedSegments});
                    }
                } catch {
                    /* skip a single failing cluster */
                } finally {
                    setProgress(p => ({...p, done: p.done + 1}));
                }
            }));

            setData({nodes, links: [...linkMap.values()]});
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [minMembers, minShared, target]);

    useEffect(() => { void load(); }, [load]);

    const {maxLink, maxMembers} = useMemo(() => ({
        maxLink: data.links.reduce((m, l) => Math.max(m, l.value), 0),
        maxMembers: data.nodes.reduce((m, n) => Math.max(m, n.memberCount), 0),
    }), [data]);

    /* Build adjacency for ego highlighting. */
    const neighbours = useMemo(() => {
        const m = new Map<string, Set<string>>();
        for (const l of data.links) {
            if (!m.has(l.source)) m.set(l.source, new Set());
            if (!m.has(l.target)) m.set(l.target, new Set());
            m.get(l.source)!.add(l.target);
            m.get(l.target)!.add(l.source);
        }
        return m;
    }, [data.links]);

    function isDimmed(nodeId: string): boolean {
        if (!highlighted) return false;
        if (nodeId === highlighted) return false;
        return !neighbours.get(highlighted)?.has(nodeId);
    }

    return (
        <div style={{width: "100%"}}>
            <div style={{display: "flex", alignItems: "center", gap: 12, marginBottom: 8}}>
                <strong style={{fontSize: 14}}>Co-occurrence network</strong>
                {loading && (
                    <span style={{fontSize: 12, color: "#666"}}>
                        {progress.total > 0 ? `Loading ${progress.done}/${progress.total}…` : "Loading…"}
                    </span>
                )}
                {!loading && !error && (
                    <span style={{fontSize: 12, color: "#666"}}>
                        {data.nodes.length} people · {data.links.length} pairs
                    </span>
                )}
                <button
                    className="btn"
                    onClick={() => fgRef.current?.zoomToFit(400, 40)}
                    disabled={loading}
                >Fit</button>
                <button
                    className="btn"
                    onClick={() => void load()}
                    disabled={loading}
                    style={{marginLeft: "auto"}}
                >↻ Reload</button>
            </div>

            {error && <div className="pt-error">{error}</div>}

            {!loading && data.nodes.length === 0 && !error && (
                <div className="pt-empty">No clusters to show.</div>
            )}

            <div style={{
                width: "100%", height, border: "1px solid var(--line-2, #ddd)",
                borderRadius: 6, overflow: "hidden", background: "#fafafa",
            }}>
                <ForceGraph2D
                    ref={fgRef}
                    graphData={data}
                    nodeRelSize={4}
                    nodeVal={(n) => {
                        const d = n as unknown as NodeDatum;
                        return 1 + 6 * (maxMembers > 0 ? d.memberCount / maxMembers : 0);
                    }}
                    nodeLabel={(n) => {
                        const d = n as unknown as NodeDatum;
                        return `${d.name} — ${d.memberCount} faces`;
                    }}
                    linkWidth={(l) => {
                        const d = l as unknown as LinkDatum;
                        return 0.5 + 4 * (maxLink > 0 ? d.value / maxLink : 0);
                    }}
                    linkColor={(l) => {
                        const d = l as unknown as LinkDatum;
                        if (!highlighted) return "rgba(80,80,80,0.45)";
                        const touches = d.source === highlighted || d.target === highlighted
                            || (typeof d.source === "object" && (d.source as {id: string}).id === highlighted)
                            || (typeof d.target === "object" && (d.target as {id: string}).id === highlighted);
                        return touches ? "rgba(20,120,120,0.9)" : "rgba(180,180,180,0.15)";
                    }}
                    nodeCanvasObjectMode={() => "after"}
                    nodeCanvasObject={(n, ctx, scale) => {
                        const d = n as unknown as NodeDatum & {x: number; y: number};
                        const r = 4 + 4 * (maxMembers > 0 ? d.memberCount / maxMembers : 0);
                        const dim = isDimmed(d.id);

                        ctx.beginPath();
                        ctx.arc(d.x, d.y, r, 0, 2 * Math.PI);
                        ctx.fillStyle = dim
                            ? "rgba(180,180,180,0.35)"
                            : d.labelled
                                ? "#2a8f8f"
                                : "#a8c8c8";
                        ctx.fill();

                        const showLabel = scale > 1.2 || highlighted === d.id;
                        if (showLabel && d.name) {
                            ctx.font = `${Math.max(10, 12 / Math.min(scale, 2))}px sans-serif`;
                            ctx.textAlign = "center";
                            ctx.textBaseline = "top";
                            ctx.fillStyle = dim ? "#aaa" : "#222";
                            ctx.fillText(d.name, d.x, d.y + r + 2);
                        }
                    }}
                    onNodeClick={(n) => {
                        const d = n as unknown as NodeDatum;
                        setHighlighted(prev => prev === d.id ? null : d.id);
                    }}
                    onBackgroundClick={() => setHighlighted(null)}
                    cooldownTicks={120}
                    onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
                />
            </div>

            <div style={{fontSize: 12, color: "#666", marginTop: 6}}>
                Click a node to focus its co-occurrers. Click background to clear.
            </div>
        </div>
    );
}
