import {useCallback, useEffect, useState} from "react";
import {Link} from "react-router-dom";
import {
    getClusterSegments,
    getClusterMembers,
    getCoOccurrences,
    getClusterTimeline,
    setClusterLabel,
    splitCluster,
    type ClusterGalleryItem,
    type ClusterSegmentItem,
    type ClusterMemberItem,
    type CoOccurrenceItem,
    type ClusterTimelineVideo,
} from "../../lib/clusters";
import {thumbnailUrl, sourceLabel, servedVideoUrl} from "../../lib/vitrivr";
import {useSearch} from "../../state/SearchContext";

type Props = {
    cluster: ClusterGalleryItem;
    onClose: () => void;
    onChanged: () => void;
};

type Tab = "segments" | "members" | "co" | "timeline";

/** Format a nanosecond offset as M:SS or H:MM:SS for timeline axis labels and tooltips. */
function fmtNs(ns: number): string {
    const sec = Math.max(0, Math.round(ns / 1_000_000_000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
}

export function ClusterDetail({cluster, onClose, onChanged}: Props) {
    const {schema: SCHEMA} = useSearch();
    const [tab, setTab] = useState<Tab>("segments");
    const [segments, setSegments] = useState<ClusterSegmentItem[]>([]);
    /* segmentId -> (video path, segment start): joined in from the timeline endpoint so
       segment links can hand VideoPage a playable src + start offset via router state. */
    const [segMeta, setSegMeta] = useState<Map<string, {filePath?: string | null; startNs: number}>>(new Map());
    const [members, setMembers] = useState<ClusterMemberItem[]>([]);
    const [membersTotal, setMembersTotal] = useState(0);
    const [membersLoadingMore, setMembersLoadingMore] = useState(false);
    const [partners, setPartners] = useState<CoOccurrenceItem[]>([]);
    const [timeline, setTimeline] = useState<ClusterTimelineVideo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [label, setLabelLocal] = useState(cluster.label ?? "");
    const [selectedFaces, setSelectedFaces] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            if (tab === "segments") {
                const [r, t] = await Promise.all([
                    getClusterSegments(cluster.clusterId, {limit: 60}),
                    getClusterTimeline(cluster.clusterId),
                ]);
                setSegments(r.segments);
                const meta = new Map<string, {filePath?: string | null; startNs: number}>();
                for (const v of t.videos) {
                    for (const s of v.segments) meta.set(s.segmentId, {filePath: v.filePath, startNs: s.startNs});
                }
                setSegMeta(meta);
            } else if (tab === "members") {
                const r = await getClusterMembers(cluster.clusterId, {limit: 60});
                setMembers(r.members);
                setMembersTotal(r.total);
                setSelectedFaces(new Set());
            } else if (tab === "co") {
                const r = await getCoOccurrences(cluster.clusterId, {limit: 50, minShared: 1});
                setPartners(r.partners);
            } else {
                const r = await getClusterTimeline(cluster.clusterId);
                setTimeline(r.videos);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [tab, cluster.clusterId]);

    useEffect(() => { void load(); }, [load]);

    async function onSaveLabel() {
        try {
            await setClusterLabel(cluster.clusterId, label.trim() || null);
            onChanged();
        } catch (e) {
            alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    function toggleFace(id: string) {
        setSelectedFaces(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    /* Appends further member pages (the initial load shows 60). `all` keeps paging until every
       member is in — needed to audit big clusters for stray wrong detections before labeling. */
    async function loadMoreMembers(all: boolean) {
        setMembersLoadingMore(true);
        try {
            let next = members;
            let total = membersTotal;
            do {
                const r = await getClusterMembers(cluster.clusterId, {limit: all ? 1000 : 200, offset: next.length});
                next = next.concat(r.members);
                total = r.total;
                setMembers(next);
                setMembersTotal(total);
            } while (all && next.length < total && next.length > 0);
        } catch (e) {
            alert(`Loading more faces failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setMembersLoadingMore(false);
        }
    }

    async function onSplit() {
        if (selectedFaces.size === 0) return;
        const newLabel = prompt(`Optional label for the new (split) cluster:`, "") ?? "";
        try {
            await splitCluster(cluster.clusterId, Array.from(selectedFaces), newLabel.trim() || undefined);
            setSelectedFaces(new Set());
            onChanged();
            await load();
        } catch (e) {
            alert(`Split failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return (
        <div className="pt-modal" onClick={onClose}>
            <div className="pt-modal__panel" onClick={e => e.stopPropagation()}>
                <header className="pt-modal__head">
                    <div className="pt-modal__title">
                        <input
                            className="pt-label-edit"
                            value={label}
                            placeholder="Unlabelled cluster"
                            onChange={e => setLabelLocal(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") void onSaveLabel(); }}
                        />
                        <button className="btn btn-primary" onClick={() => void onSaveLabel()}>Save</button>
                    </div>
                    <button className="btn" onClick={onClose}>Close</button>
                </header>

                <div className="pt-modal__meta">
                    <span>{cluster.memberCount} face detections</span>
                    <span>{cluster.segmentCount} segments</span>
                    <span title={cluster.clusterId}>id {cluster.clusterId.slice(0, 8)}…</span>
                </div>

                <nav className="pt-tabs">
                    <button className={tab === "segments" ? "pt-tab pt-tab--active" : "pt-tab"} onClick={() => setTab("segments")}>Segments</button>
                    <button className={tab === "members" ? "pt-tab pt-tab--active" : "pt-tab"} onClick={() => setTab("members")}>Faces</button>
                    <button className={tab === "co" ? "pt-tab pt-tab--active" : "pt-tab"} onClick={() => setTab("co")}>Co-occurrences</button>
                    <button className={tab === "timeline" ? "pt-tab pt-tab--active" : "pt-tab"} onClick={() => setTab("timeline")}>Timeline</button>
                </nav>

                {error && <div className="pt-error">{error}</div>}
                {loading && <div className="pt-loading">Loading…</div>}

                {tab === "segments" && !loading && (
                    <div className="pt-grid pt-grid--small">
                        {segments.map(s => {
                            const meta = segMeta.get(s.parentId);
                            return (
                                <Link key={s.parentId}
                                      className="pt-seg-card"
                                      to={`/video/${encodeURIComponent(s.parentId)}`}
                                      state={meta ? {
                                          src: meta.filePath ? servedVideoUrl(SCHEMA, meta.filePath) : undefined,
                                          start: meta.startNs / 1e9,
                                          name: meta.filePath ? sourceLabel(meta.filePath) : undefined,
                                          poster: thumbnailUrl(SCHEMA, s.parentId),
                                      } : undefined}
                                      title={`${s.detectionCount} detections in this segment`}
                                >
                                    <img src={thumbnailUrl(SCHEMA, s.parentId)} alt={s.parentId} loading="lazy"/>
                                    <span className="pt-seg-card__badge">{s.detectionCount}</span>
                                </Link>
                            );
                        })}
                        {segments.length === 0 && <div className="pt-empty">No segments.</div>}
                    </div>
                )}

                {tab === "members" && !loading && (
                    <>
                        <div className="pt-row" style={{justifyContent: "space-between", alignItems: "center"}}>
                            <span style={{fontSize: 12, color: "#6b7280"}}>
                                {members.length} of {membersTotal} faces
                            </span>
                            {members.length < membersTotal && (
                                <span style={{display: "flex", gap: 6}}>
                                    <button className="btn" disabled={membersLoadingMore}
                                            onClick={() => void loadMoreMembers(false)}>
                                        {membersLoadingMore ? "Loading…" : "Load 200 more"}
                                    </button>
                                    <button className="btn" disabled={membersLoadingMore}
                                            onClick={() => void loadMoreMembers(true)}>
                                        Load all
                                    </button>
                                </span>
                            )}
                        </div>
                        {selectedFaces.size > 0 && (
                            <div className="pt-row pt-selection-bar">
                                <span>{selectedFaces.size} faces selected</span>
                                <button className="btn" onClick={() => void onSplit()}>Split into new cluster</button>
                                <button className="btn" onClick={() => setSelectedFaces(new Set())}>Clear</button>
                            </div>
                        )}
                        <div className="pt-grid pt-grid--small">
                            {members.map(m => {
                                const selected = selectedFaces.has(m.faceId);
                                const bbox = m.bbox && m.bbox.length === 4 ? m.bbox : null;
                                return (
                                    <button
                                        key={m.faceId}
                                        className={`pt-seg-card${selected ? " pt-seg-card--selected" : ""}`}
                                        onClick={() => toggleFace(m.faceId)}
                                        title={m.faceId}
                                        style={{position: "relative"}}
                                    >
                                        {m.parentId
                                            ? <img src={thumbnailUrl(SCHEMA, m.parentId)} alt={m.faceId} loading="lazy"/>
                                            : <div className="pt-card__noimg">?</div>}
                                        {bbox && (
                                            <span
                                                className="pt-face-bbox"
                                                style={{
                                                    position: "absolute",
                                                    left:   `${bbox[0] * 100}%`,
                                                    top:    `${bbox[1] * 100}%`,
                                                    width:  `${Math.max(0, bbox[2] - bbox[0]) * 100}%`,
                                                    height: `${Math.max(0, bbox[3] - bbox[1]) * 100}%`,
                                                    border: "1px solid rgba(225, 29, 72, 0.75)",
                                                    pointerEvents: "none",
                                                    boxSizing: "border-box",
                                                }}
                                                aria-hidden="true"
                                            />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}

                {tab === "co" && !loading && (
                    <ul className="pt-co-list">
                        {partners.map(p => (
                            <li key={p.clusterId} className="pt-co-row">
                                <span className="pt-co-row__name">
                                    {p.label ?? `Unknown #${p.clusterId.slice(0, 6)}`}
                                </span>
                                <span className="pt-co-row__stat">{p.sharedSegments} shared segments</span>
                                <span className="pt-co-row__stat">{p.memberCount} faces total</span>
                            </li>
                        ))}
                        {partners.length === 0 && <div className="pt-empty">No co-occurring clusters.</div>}
                    </ul>
                )}

                {tab === "timeline" && !loading && (
                    <div style={{display: "flex", flexDirection: "column", gap: 14}}>
                        {timeline.map(v => {
                            /* Per-video scale: lane right edge = last appearance. Each appearance is
                               an absolutely-positioned stripe at its [startNs, endNs] proportion of
                               that scale. No source duration available */
                            const scale = Math.max(1, v.lastAppearanceNs);
                            const totalDetections = v.segments.reduce((a, s) => a + s.detectionCount, 0);
                            return (
                                <div key={v.sourceId} style={{display: "flex", flexDirection: "column", gap: 4}}>
                                    <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8}}>
                                        <span style={{fontWeight: 500, fontSize: 13, wordBreak: "break-all"}}>
                                            {sourceLabel(v.filePath) || v.sourceId.slice(0, 8) + "…"}
                                        </span>
                                        <span style={{fontSize: 11, color: "#6b7280", whiteSpace: "nowrap"}}>
                                            {v.segments.length} segment{v.segments.length === 1 ? "" : "s"} ·{" "}
                                            {totalDetections} detection{totalDetections === 1 ? "" : "s"}
                                        </span>
                                    </div>
                                    <div style={{
                                        position: "relative",
                                        height: 22,
                                        background: "#f1f5f9",
                                        borderRadius: 4,
                                        overflow: "hidden",
                                    }}>
                                        {v.segments.map(s => {
                                            const leftPct = (s.startNs / scale) * 100;
                                            /* Floor a minimum visible width so single-frame appearances
                                               don't collapse to a 0px stripe at large scales. */
                                            const widthPct = Math.max(0.4, ((s.endNs - s.startNs) / scale) * 100);
                                            return (
                                                <Link
                                                    key={s.segmentId}
                                                    to={`/video/${encodeURIComponent(s.segmentId)}`}
                                                    state={{
                                                        src: v.filePath ? servedVideoUrl(SCHEMA, v.filePath) : undefined,
                                                        start: s.startNs / 1e9,
                                                        name: v.filePath ? sourceLabel(v.filePath) : undefined,
                                                        poster: thumbnailUrl(SCHEMA, s.segmentId),
                                                    }}
                                                    title={`${fmtNs(s.startNs)} – ${fmtNs(s.endNs)} · ${s.detectionCount} detection${s.detectionCount === 1 ? "" : "s"}`}
                                                    style={{
                                                        position: "absolute",
                                                        left: `${leftPct}%`,
                                                        width: `${widthPct}%`,
                                                        top: 0, bottom: 0,
                                                        background: "rgba(34, 197, 94, 0.85)",
                                                        borderRadius: 2,
                                                        display: "block",
                                                    }}
                                                />
                                            );
                                        })}
                                    </div>
                                    <div style={{display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280"}}>
                                        <span>0:00</span>
                                        <span>last appearance {fmtNs(v.lastAppearanceNs)}</span>
                                    </div>
                                </div>
                            );
                        })}
                        {timeline.length === 0 && (
                            <div className="pt-empty">
                                No timed segments — this cluster's detections have no resolvable source + time descriptors.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
