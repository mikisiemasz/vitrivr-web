import {useCallback, useEffect, useMemo, useState} from "react";
import {
    listClusters,
    listClusterRuns,
    deleteClusterRun,
    triggerClustering,
    setClusterLabel,
    mergeClusters,
    getClusterCentroid,
    type ClusterGalleryItem,
    type ClusterRunSummary,
    type ListClustersParams,
    type TriggerClusteringParams,
} from "../../lib/clusters";
import {thumbnailUrl} from "../../lib/vitrivr";
import {useSearch} from "../../state/SearchContext";
import SchemaSelector from "../SchemaSelector";
import {ClusterDetail} from "./ClusterDetail";
import {ClusterIdentifyPanel} from "./ClusterIdentifyPanel";
import {CoOccurrencePairsChart} from "./CoOccurrencePairsChart";
import {CoOccurrenceNetwork} from "./CoOccurrenceNetwork";
import {GroupSizeHistogram} from "./GroupSizeHistogram";
import "./PeopleTab.css";

type RelationshipView = "pairs" | "network" | "histogram";

type SortOpt = NonNullable<ListClustersParams["sort"]>;

export function PeopleTab() {
    const {schema, setSchema, setFaceGallery} = useSearch();
    const [items, setItems] = useState<ClusterGalleryItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [minMembers, setMinMembers] = useState(5);
    const [sort, setSort] = useState<SortOpt>("members");
    const [labelFilter, setLabelFilter] = useState<"all" | "labelled" | "unlabelled">("all");
    const [search, setSearch] = useState("");

    const [openCluster, setOpenCluster] = useState<ClusterGalleryItem | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    /* clustering controls */
    const [showControls, setShowControls] = useState(false);
    const [showRelationships, setShowRelationships] = useState(false);
    const [showIdentify, setShowIdentify] = useState(false);
    const [showRuns, setShowRuns] = useState(false);
    const [clusterRuns, setClusterRuns] = useState<ClusterRunSummary[]>([]);
    const [runsLoading, setRunsLoading] = useState(false);
    const [relationshipView, setRelationshipView] = useState<RelationshipView>("pairs");
    const [minClusterSize, setMinClusterSize] = useState(5);
    const [minSamples, setMinSamples] = useState(3);
    const [exemplarCount, setExemplarCount] = useState(5);
    const [labelCarryThreshold, setLabelCarryThreshold] = useState(0.6);
    const [running, setRunning] = useState(false);
    const [runMessage, setRunMessage] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await listClusters({
                minMembers,
                sort,
                limit: 200,
                onlyLabelled: labelFilter === "labelled" || undefined,
                onlyUnlabelled: labelFilter === "unlabelled" || undefined,
            });
            setItems(r.clusters);
            setTotal(r.totalClusters);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [minMembers, sort, labelFilter]);

    useEffect(() => { void reload(); }, [reload]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return items;
        return items.filter(c => (c.label ?? "").toLowerCase().includes(q));
    }, [items, search]);

    function toggle(clusterId: string) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(clusterId)) next.delete(clusterId);
            else next.add(clusterId);
            return next;
        });
    }

    async function onRename(c: ClusterGalleryItem) {
        const next = prompt(`Name for this cluster (clear to remove):`, c.label ?? "");
        if (next === null) return;
        try {
            await setClusterLabel(c.clusterId, next.trim() || null);
            await reload();
        } catch (e) {
            alert(`Rename failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async function onAddToGallery(c: ClusterGalleryItem) {
        try {
            const {embedding} = await getClusterCentroid(c.clusterId);
            const name = (c.label?.trim() || `Cluster ${c.clusterId.slice(0, 6)}`);
            /* Carry the clusterId so SearchCard can take the fast /clusters/match path. */
            setFaceGallery(prev => ({...prev, [name]: {embedding, clusterId: c.clusterId}}));
            alert(`Added "${name}" to face gallery. Use it from the Query Builder face modality.`);
        } catch (e) {
            alert(`Add to gallery failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async function onMergeSelected() {
        if (selected.size < 2) return;
        const label = prompt(`Optional label for merged cluster (leave blank to inherit):`, "") ?? "";
        try {
            await mergeClusters(Array.from(selected), label.trim() || undefined);
            setSelected(new Set());
            await reload();
        } catch (e) {
            alert(`Merge failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /* Reload the cluster-run list. Used after delete and when the user opens the Runs panel. */
    const [runsError, setRunsError] = useState<string | null>(null);
    const reloadRuns = useCallback(async () => {
        setRunsLoading(true);
        setRunsError(null);
        try {
            setClusterRuns(await listClusterRuns());
        } catch (e) {
            setClusterRuns([]);
            setRunsError(`Failed to load cluster runs: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setRunsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (showRuns) void reloadRuns();
    }, [showRuns, reloadRuns]);

    async function onDeleteClusterRun(runId: string) {
        if (!confirm(`Delete cluster run ${runId.slice(0, 8)}? Member detections are preserved.`)) return;
        try {
            await deleteClusterRun(runId);
            await Promise.all([reloadRuns(), reload()]);
        } catch (e) {
            alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async function onRunClustering() {
        setRunning(true);
        setRunMessage(null);
        try {
            const params: TriggerClusteringParams = {
                minClusterSize, minSamples, exemplarCount, labelCarryThreshold,
            };
            const r = await triggerClustering(params);
            setRunMessage(
                `Run ${r.runId.slice(0, 8)}: ${r.numClusters} clusters, ` +
                `${r.numAssignedFaces}/${r.numInputFaces} faces assigned, ${r.numLabelsCarried} labels carried.`
            );
            await reload();
        } catch (e) {
            setRunMessage(`Clustering failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setRunning(false);
        }
    }

    return (
        <div className="pt-page">
            <header className="pt-header">
                <h2 className="pt-title">People</h2>
                <div style={{display: "flex", alignItems: "center", gap: 12}}>
                    <SchemaSelector value={schema} onChange={setSchema}/>
                    <p className="pt-subtitle" style={{margin: 0}}>
                        {loading ? "Loading…" : `${filtered.length} of ${total} clusters`}
                    </p>
                </div>
            </header>

            <section className="pt-controls">
                <div className="pt-row">
                    <label className="pt-label">
                        Sort
                        <select value={sort} onChange={e => setSort(e.target.value as SortOpt)}>
                            <option value="members">most detections</option>
                            <option value="segments">most segments</option>
                            <option value="label">label</option>
                        </select>
                    </label>

                    <label className="pt-label">
                        Min members
                        <input
                            type="number" min={1} value={minMembers}
                            onChange={e => setMinMembers(Math.max(1, Number(e.target.value) || 1))}
                            style={{width: 72}}
                        />
                    </label>

                    <label className="pt-label">
                        Show
                        <select value={labelFilter} onChange={e => setLabelFilter(e.target.value as typeof labelFilter)}>
                            <option value="all">all</option>
                            <option value="labelled">labelled only</option>
                            <option value="unlabelled">unlabelled only</option>
                        </select>
                    </label>

                    <label className="pt-label" style={{flex: 1}}>
                        Search label
                        <input
                            type="text" placeholder="e.g. Cathal"
                            value={search} onChange={e => setSearch(e.target.value)}
                        />
                    </label>

                    <button className="btn" onClick={() => void reload()} disabled={loading}>↻ Refresh</button>
                    <button className="btn" onClick={() => setShowIdentify(s => !s)}>
                        {showIdentify ? "Hide identify" : "Identify…"}
                    </button>
                    <button className="btn" onClick={() => setShowRelationships(s => !s)}>
                        {showRelationships ? "Hide relationships" : "Relationships"}
                    </button>
                    <button className="btn" onClick={() => setShowControls(s => !s)}>
                        {showControls ? "Hide" : "Re-cluster…"}
                    </button>
                    <button className="btn" onClick={() => setShowRuns(s => !s)}>
                        {showRuns ? "Hide runs" : "Manage runs"}
                    </button>
                </div>

                {showRuns && (
                    <div className="pt-cluster-controls">
                        <div className="pt-row" style={{flexDirection: "column", alignItems: "stretch", gap: 16}}>
                            {runsError && <div className="pt-error">{runsError}</div>}
                            <div>
                                <div style={{fontWeight: 600, marginBottom: 4}}>
                                    Cluster runs {runsLoading ? "(loading…)" : `(${clusterRuns.length})`}
                                </div>
                                {clusterRuns.length === 0 && !runsLoading && (
                                    <div style={{color: "#888", fontSize: 12}}>No cluster runs yet.</div>
                                )}
                                {clusterRuns.map((r, i) => {
                                    const isLatest = i === clusterRuns.length - 1;
                                    return (
                                        <div key={r.runId} style={{display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 13}}>
                                            <code style={{fontFamily: "monospace"}}>{r.runId.slice(0, 8)}</code>
                                            <span style={{color: "#666"}}>· {r.embeddingField}</span>
                                            {isLatest && (
                                                <span style={{
                                                    background: "#dcfce7", color: "#166534", borderRadius: 3,
                                                    padding: "1px 6px", fontSize: 11, fontWeight: 600,
                                                }}>latest</span>
                                            )}
                                            <button className="btn" style={{marginLeft: "auto"}}
                                                    onClick={() => void onDeleteClusterRun(r.runId)}>
                                                Delete
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{color: "#888", fontSize: 11, fontStyle: "italic"}}>
                                Runs are listed in DB insertion order — last item is the most recent.
                                Deleting a cluster run drops its FACE_CLUSTERs but keeps the underlying detections.
                            </div>
                        </div>
                    </div>
                )}

                {showControls && (
                    <div className="pt-cluster-controls">
                        <div className="pt-row">
                            <label className="pt-label">
                                min_cluster_size
                                <input
                                    type="number" min={2} value={minClusterSize}
                                    onChange={e => setMinClusterSize(Math.max(2, Number(e.target.value) || 5))}
                                    style={{width: 80}}
                                />
                            </label>
                            <label className="pt-label">
                                min_samples
                                <input
                                    type="number" min={1} value={minSamples}
                                    onChange={e => setMinSamples(Math.max(1, Number(e.target.value) || 3))}
                                    style={{width: 80}}
                                />
                            </label>
                            <label className="pt-label">
                                exemplars
                                <input
                                    type="number" min={1} max={20} value={exemplarCount}
                                    onChange={e => setExemplarCount(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
                                    style={{width: 80}}
                                />
                            </label>
                            <label className="pt-label" title="Cosine similarity above which labels carry across runs">
                                label-carry τ
                                <input
                                    type="number" min={0} max={1} step={0.05} value={labelCarryThreshold}
                                    onChange={e => setLabelCarryThreshold(Math.max(0, Math.min(1, Number(e.target.value) || 0.6)))}
                                    style={{width: 80}}
                                />
                            </label>
                            <button className="btn btn-primary" onClick={() => void onRunClustering()} disabled={running}>
                                {running ? "Running…" : "Run clustering"}
                            </button>
                        </div>
                        {runMessage && <p className="pt-run-message">{runMessage}</p>}
                    </div>
                )}

                {selected.size > 0 && (
                    <div className="pt-row pt-selection-bar">
                        <span>{selected.size} selected</span>
                        <button className="btn" disabled={selected.size < 2} onClick={() => void onMergeSelected()}>
                            Merge {selected.size}
                        </button>
                        <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
                    </div>
                )}
            </section>

            {showIdentify && (
                <ClusterIdentifyPanel/>
            )}

            {showRelationships && (
                <section className="pt-cluster-controls">
                    <div className="pt-row" style={{marginBottom: 8}}>
                        <button
                            className={relationshipView === "pairs" ? "btn btn-primary" : "btn"}
                            onClick={() => setRelationshipView("pairs")}
                        >Top pairs</button>
                        <button
                            className={relationshipView === "network" ? "btn btn-primary" : "btn"}
                            onClick={() => setRelationshipView("network")}
                        >Network</button>
                        <button
                            className={relationshipView === "histogram" ? "btn btn-primary" : "btn"}
                            onClick={() => setRelationshipView("histogram")}
                        >Group sizes</button>
                    </div>
                    {relationshipView === "pairs" && (
                        <CoOccurrencePairsChart
                            topN={20}
                            minMembers={minMembers}
                            minShared={2}
                        />
                    )}
                    {relationshipView === "network" && (
                        <CoOccurrenceNetwork
                            minMembers={minMembers}
                            minShared={2}
                        />
                    )}
                    {relationshipView === "histogram" && (
                        <GroupSizeHistogram/>
                    )}
                </section>
            )}

            {error && <div className="pt-error">{error}</div>}

            <div className="pt-grid">
                {filtered.map(c => {
                    const firstExemplar = c.exemplars[0];
                    const thumb = firstExemplar?.parentId
                        ? thumbnailUrl(schema, firstExemplar.parentId)
                        : "";
                    const isSelected = selected.has(c.clusterId);
                    return (
                        <div
                            key={c.clusterId}
                            className={`pt-card${isSelected ? " pt-card--selected" : ""}`}
                            onClick={() => setOpenCluster(c)}
                        >
                            <input
                                type="checkbox"
                                className="pt-card__check"
                                checked={isSelected}
                                onClick={e => e.stopPropagation()}
                                onChange={() => toggle(c.clusterId)}
                            />
                            <div className="pt-card__thumb">
                                {thumb
                                    ? <img src={thumb} alt={c.label ?? c.clusterId} loading="lazy"/>
                                    : <div className="pt-card__noimg">no thumbnail</div>}
                            </div>
                            <div className="pt-card__body">
                                <div className="pt-card__name" title={c.clusterId}>
                                    {c.label ?? <span className="pt-card__unknown">Unknown #{c.clusterId.slice(0, 6)}</span>}
                                </div>
                                <div className="pt-card__stats">
                                    {c.memberCount} faces · {c.segmentCount} segments
                                </div>
                                <div style={{display: "flex", gap: 4, flexWrap: "wrap"}}>
                                    <button
                                        className="pt-card__rename"
                                        onClick={e => { e.stopPropagation(); void onRename(c); }}
                                    >
                                        {c.label ? "Rename" : "Label"}
                                    </button>
                                    <button
                                        className="pt-card__rename"
                                        title="Add this cluster's centroid to the face gallery so it appears in the Query Builder."
                                        onClick={e => { e.stopPropagation(); void onAddToGallery(c); }}
                                    >
                                        + Gallery
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
                {!loading && filtered.length === 0 && (
                    <div className="pt-empty">
                        No clusters match these filters. Try lowering "min members" or running clustering above.
                    </div>
                )}
            </div>

            {openCluster && (
                <ClusterDetail
                    cluster={openCluster}
                    onClose={() => setOpenCluster(null)}
                    onChanged={() => void reload()}
                />
            )}
        </div>
    );
}
