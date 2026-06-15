import {useCallback, useEffect, useState} from "react";
import {Link} from "react-router-dom";
import {
    getClusterSegments,
    getClusterMembers,
    getCoOccurrences,
    setClusterLabel,
    splitCluster,
    type ClusterGalleryItem,
    type ClusterSegmentItem,
    type ClusterMemberItem,
    type CoOccurrenceItem,
} from "../../lib/clusters";
import {thumbnailUrl} from "../../lib/vitrivr";
import {useSearch} from "../../state/SearchContext";

type Props = {
    cluster: ClusterGalleryItem;
    onClose: () => void;
    onChanged: () => void;
};

type Tab = "segments" | "members" | "co";

export function ClusterDetail({cluster, onClose, onChanged}: Props) {
    const {schema: SCHEMA} = useSearch();
    const [tab, setTab] = useState<Tab>("segments");
    const [segments, setSegments] = useState<ClusterSegmentItem[]>([]);
    const [members, setMembers] = useState<ClusterMemberItem[]>([]);
    const [partners, setPartners] = useState<CoOccurrenceItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [label, setLabelLocal] = useState(cluster.label ?? "");
    const [selectedFaces, setSelectedFaces] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            if (tab === "segments") {
                const r = await getClusterSegments(cluster.clusterId, {limit: 60});
                setSegments(r.segments);
            } else if (tab === "members") {
                const r = await getClusterMembers(cluster.clusterId, {limit: 60});
                setMembers(r.members);
                setSelectedFaces(new Set());
            } else {
                const r = await getCoOccurrences(cluster.clusterId, {limit: 50, minShared: 1});
                setPartners(r.partners);
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
                </nav>

                {error && <div className="pt-error">{error}</div>}
                {loading && <div className="pt-loading">Loading…</div>}

                {tab === "segments" && !loading && (
                    <div className="pt-grid pt-grid--small">
                        {segments.map(s => (
                            <Link key={s.parentId}
                                  className="pt-seg-card"
                                  to={`/video/${encodeURIComponent(s.parentId)}`}
                                  title={`${s.detectionCount} detections in this segment`}
                            >
                                <img src={thumbnailUrl(SCHEMA, s.parentId)} alt={s.parentId} loading="lazy"/>
                                <span className="pt-seg-card__badge">{s.detectionCount}</span>
                            </Link>
                        ))}
                        {segments.length === 0 && <div className="pt-empty">No segments.</div>}
                    </div>
                )}

                {tab === "members" && !loading && (
                    <>
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
                                                    boxShadow: "none",
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
            </div>
        </div>
    );
}
