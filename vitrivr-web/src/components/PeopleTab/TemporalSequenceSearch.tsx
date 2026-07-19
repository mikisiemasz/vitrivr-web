import {useEffect, useMemo, useState} from "react";
import {
    getClusterTimeline,
    listClusters,
    type ClusterGalleryItem,
} from "../../lib/clusters";
import {findSequenceMatches, type SequenceMatch} from "../../lib/temporalSearch";
import {thumbnailUrl, sourceLabel} from "../../lib/vitrivr";
import {useSearch} from "../../state/SearchContext";

/** Format a nanosecond offset as M:SS or H:MM:SS. */
function fmtNs(ns: number): string {
    const totalS = Math.max(0, Math.round(ns / 1e9));
    const h = Math.floor(totalS / 3600);
    const m = Math.floor((totalS % 3600) / 60);
    const s = totalS % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${m}:${String(s).padStart(2, "0")}`;
}

function nameOf(c: ClusterGalleryItem): string {
    return c.label?.trim() || `Cluster ${c.clusterId.slice(0, 6)}`;
}

function fileNameOf(path: string | null | undefined, sourceId: string): string {
    return sourceLabel(path) || `video ${sourceId.slice(0, 6)}`;
}

/**
 * "X appears, then Y appears within N seconds" — evaluated frontend-only by joining the
 * two clusters' timelines (see lib/temporalSearch.ts). Same-video matches only.
 */
export function TemporalSequenceSearch() {
    const {schema} = useSearch();

    const [clusters, setClusters] = useState<ClusterGalleryItem[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [xId, setXId] = useState("");
    const [yId, setYId] = useState("");
    const [windowS, setWindowS] = useState(20);
    const [gapS, setGapS] = useState(2);
    const [anchor, setAnchor] = useState<"start" | "end">("start");

    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [matches, setMatches] = useState<SequenceMatch[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const r = await listClusters({limit: 500, minMembers: 2, sort: "members"});
                if (cancelled) return;
                /* Labelled clusters first — they're the ones that read as people. */
                const sorted = [...r.clusters].sort((a, b) => {
                    const la = a.label?.trim() ? 0 : 1;
                    const lb = b.label?.trim() ? 0 : 1;
                    return la !== lb ? la - lb : b.memberCount - a.memberCount;
                });
                setClusters(sorted);
            } catch (e) {
                if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
            }
        })();
        return () => { cancelled = true; };
    }, [schema]);

    const nameById = useMemo(
        () => new Map(clusters.map(c => [c.clusterId, nameOf(c)])),
        [clusters],
    );
    const xName = nameById.get(xId) ?? "X";
    const yName = nameById.get(yId) ?? "Y";

    async function onSearch() {
        if (!xId || !yId) return;
        setSearching(true);
        setSearchError(null);
        setMatches(null);
        try {
            const [xt, yt] = await Promise.all([
                getClusterTimeline(xId),
                getClusterTimeline(yId),
            ]);
            setMatches(findSequenceMatches(xt.videos, yt.videos, {
                windowNs: Math.max(1, windowS) * 1e9,
                maxGapNs: Math.max(0, gapS) * 1e9,
                anchor,
            }));
        } catch (e) {
            setSearchError(e instanceof Error ? e.message : String(e));
        } finally {
            setSearching(false);
        }
    }

    /* Group matches per video for rendering. */
    const grouped = useMemo(() => {
        if (!matches) return [];
        const m = new Map<string, {label: string; items: SequenceMatch[]}>();
        for (const match of matches) {
            const entry = m.get(match.sourceId)
                ?? {label: fileNameOf(match.filePath, match.sourceId), items: []};
            entry.items.push(match);
            m.set(match.sourceId, entry);
        }
        return [...m.values()];
    }, [matches]);

    const clusterOption = (c: ClusterGalleryItem) => (
        <option key={c.clusterId} value={c.clusterId}>
            {nameOf(c)} ({c.memberCount})
        </option>
    );

    return (
        <section className="pt-cluster-controls">
            <div className="pt-row" style={{alignItems: "flex-end", flexWrap: "wrap"}}>
                <label className="pt-label">
                    Person X (first)
                    <select value={xId} onChange={e => setXId(e.target.value)}>
                        <option value="">— select —</option>
                        {clusters.map(clusterOption)}
                    </select>
                </label>
                <label className="pt-label">
                    Person Y (follows)
                    <select value={yId} onChange={e => setYId(e.target.value)}>
                        <option value="">— select —</option>
                        {clusters.map(clusterOption)}
                    </select>
                </label>
                <label className="pt-label">
                    within (s)
                    <input
                        type="number" min={1} value={windowS}
                        onChange={e => setWindowS(Math.max(1, Number(e.target.value) || 20))}
                        style={{width: 72}}
                    />
                </label>
                <label className="pt-label" title="Whether the window counts from the moment X first appears or the moment X disappears.">
                    counting from
                    <select value={anchor} onChange={e => setAnchor(e.target.value as "start" | "end")}>
                        <option value="start">X appears</option>
                        <option value="end">X disappears</option>
                    </select>
                </label>
                <label className="pt-label" title="Appearances separated by gaps up to this size are treated as one continuous appearance.">
                    merge gaps ≤ (s)
                    <input
                        type="number" min={0} value={gapS}
                        onChange={e => setGapS(Math.max(0, Number(e.target.value) || 0))}
                        style={{width: 64}}
                    />
                </label>
                <button
                    className="btn btn-primary"
                    onClick={() => void onSearch()}
                    disabled={searching || !xId || !yId}
                >
                    {searching ? "Searching…" : "Find sequences"}
                </button>
            </div>

            {loadError && <div className="pt-error">{loadError}</div>}
            {searchError && <div className="pt-error">{searchError}</div>}

            {matches !== null && matches.length === 0 && !searchError && (
                <div className="pt-empty">
                    No places where {yName} appears within {windowS}s after {xName}
                    {anchor === "end" ? " disappears" : " appears"}.
                </div>
            )}

            {grouped.map(group => (
                <div key={group.label} style={{marginTop: 12}}>
                    <div style={{fontWeight: 600, fontSize: 13, marginBottom: 6}}>
                        {group.label} — {group.items.length} match{group.items.length === 1 ? "" : "es"}
                    </div>
                    {group.items.map((m, i) => (
                        <div
                            key={`${m.x.segmentIds[0]}-${m.y.segmentIds[0]}-${i}`}
                            style={{display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13}}
                        >
                            <img
                                src={thumbnailUrl(schema, m.x.segmentIds[0])}
                                alt={xName} loading="lazy"
                                style={{width: 72, height: 44, objectFit: "cover", borderRadius: 4}}
                            />
                            <span>
                                <strong>{xName}</strong> {fmtNs(m.x.startNs)}–{fmtNs(m.x.endNs)}
                            </span>
                            <span style={{color: "#666"}}>→ +{(m.lagNs / 1e9).toFixed(1)}s →</span>
                            <img
                                src={thumbnailUrl(schema, m.y.segmentIds[0])}
                                alt={yName} loading="lazy"
                                style={{width: 72, height: 44, objectFit: "cover", borderRadius: 4}}
                            />
                            <span>
                                <strong>{yName}</strong> {fmtNs(m.y.startNs)}–{fmtNs(m.y.endNs)}
                            </span>
                        </div>
                    ))}
                </div>
            ))}
        </section>
    );
}
