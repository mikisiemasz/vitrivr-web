"use client";
import {useEffect, useMemo, useRef, useState} from "react";
import {extractAveragedFaceEmbedding} from "../../lib/faceSearch.ts";
import {
    identifyCluster,
    identifyClusterBatch,
    setClusterLabel,
    deleteCluster,
    listClusters,
    mergeClusters,
    type ClusterIdentifyMatch,
    type ClusterIdentifyAssignment,
    type UnmatchedClusterRow,
    type ClusterGalleryItem,
} from "../../lib/clusters";
import {thumbnailUrl} from "../../lib/vitrivr";
import {useSearch} from "../../state/SearchContext.tsx";
import Flash from "../QueryBuilderComponents/Flash.tsx";

/* Cosine bands for cluster-to-candidate similarity:
   - green (≥ 0.3): same identity is the standard call.
   - yellow (≥ 0.1, < 0.3): plausible but worth eyeballing — could be a pose/lighting edge case
     or the wrong person at a glancing similarity.
   - below 0.1: not a real match; goes to the "Unmatched" bucket for deletion. */
const STRONG_THRESHOLD = 0.3;
const WEAK_THRESHOLD = 0.1;

/** Visual style applied to a matched row based on its similarity band. */
function bandStyle(sim: number): React.CSSProperties {
    if (sim >= STRONG_THRESHOLD) {
        return {borderLeft: "3px solid #22c55e", background: "#f0fdf4"};
    }
    return {borderLeft: "3px solid #eab308", background: "#fefce8"};
}

/* Width of the inline exemplar thumbnail in pixels. Height follows the image's aspect ratio
   so the bbox overlay aligns exactly. Matches the Faces tab card size for visual consistency. */
const THUMB_PX = 120;

type Mode = "single" | "folder";
type FlashKind = "error" | "info" | "success";
type FolderGroup = {name: string; files: File[]};
type Decision = "pending" | "accepted" | "skipped";

/** Splits a list of files by their immediate parent directory (uses webkitRelativePath). */
function groupFilesByFolder(files: File[]): FolderGroup[] {
    const byFolder = new Map<string, File[]>();
    for (const f of files) {
        const rel = (f as File & {webkitRelativePath?: string}).webkitRelativePath ?? "";
        const parts = rel.split("/");
        const folder = parts.length >= 2 ? parts[parts.length - 2] : "(root)";
        if (!folder) continue;
        const arr = byFolder.get(folder);
        if (arr) arr.push(f);
        else byFolder.set(folder, [f]);
    }
    return Array.from(byFolder.entries()).map(([name, files]) => ({name, files}));
}

type GroupedAssignments = Map<string, ClusterIdentifyAssignment[]>;
function groupAssignments(rows: ClusterIdentifyAssignment[]): GroupedAssignments {
    const map = new Map<string, ClusterIdentifyAssignment[]>();
    for (const r of rows) {
        const arr = map.get(r.bestName);
        if (arr) arr.push(r);
        else map.set(r.bestName, [r]);
    }
    return map;
}

/* thumbnail with bbox overlay */

/** Renders the cluster's first exemplar as a thumbnail with a face-bbox overlay if present.
    Mirrors the style used in ClusterDetail's Faces tab. The container shrink-wraps the image
    (fixed width, auto height) so the bbox-as-percent maps 1:1 to image pixels regardless of
    the source frame's aspect ratio — `objectFit: cover` would crop the image and misalign it. */
function ClusterThumb({schema, item}: {schema: string; item?: ClusterGalleryItem}) {
    const exemplar = item?.exemplars?.[0];
    const bbox = exemplar?.bbox && exemplar.bbox.length === 4 ? exemplar.bbox : null;
    if (!exemplar?.parentId) {
        return (
            <div style={{
                width: THUMB_PX, height: THUMB_PX,
                background: "#f1f5f9", borderRadius: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, color: "#94a3b8",
                flexShrink: 0,
            }}>?</div>
        );
    }
    return (
        <div style={{
            position: "relative",
            display: "inline-block",
            width: THUMB_PX,
            flexShrink: 0,
            borderRadius: 6,
            overflow: "hidden",
            background: "#f1f5f9",
            lineHeight: 0,
        }}>
            <img
                src={thumbnailUrl(schema, exemplar.parentId)}
                alt=""
                loading="lazy"
                style={{display: "block", width: "100%", height: "auto"}}
            />
            {bbox && (
                <span
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
        </div>
    );
}

/* panel */

export function ClusterIdentifyPanel() {
    const {schema, setFaceGallery} = useSearch();
    const [mode, setMode] = useState<Mode>("single");

    /* Single-photo mode */
    const [name, setName] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [working, setWorking] = useState(false);
    const [singleEmbedding, setSingleEmbedding] = useState<number[] | null>(null);
    const [singleMatches, setSingleMatches] = useState<ClusterIdentifyMatch[] | null>(null);
    const singleInputRef = useRef<HTMLInputElement>(null);

    /* Folder-upload mode */
    const [folderFiles, setFolderFiles] = useState<File[]>([]);
    const [batchAssignments, setBatchAssignments] = useState<ClusterIdentifyAssignment[] | null>(null);
    const [batchUnmatched, setBatchUnmatched] = useState<UnmatchedClusterRow[] | null>(null);
    const [batchDecisions, setBatchDecisions] = useState<Record<string, Decision>>({});
    const [batchEmbeddings, setBatchEmbeddings] = useState<Map<string, number[]>>(new Map());
    const [deleteSelection, setDeleteSelection] = useState<Set<string>>(new Set());
    const folderInputRef = useRef<HTMLInputElement>(null);

    /* Cluster catalog: a clusterId → ClusterGalleryItem map kept in sync so any row can render
       its exemplar thumbnail + bbox without paying for a per-row fetch. Loaded lazily once,
       and refreshed after any operation that could change cluster state (label, delete). */
    const [catalog, setCatalog] = useState<Map<string, ClusterGalleryItem>>(new Map());

    const [flash, setFlash] = useState<{show: boolean; message: string; kind: FlashKind}>({
        show: false, message: "", kind: "info",
    });
    function showFlash(message: string, kind: FlashKind = "error") {
        setFlash({show: true, message, kind});
    }

    /* Pull the catalog once when the panel first mounts so single-mode results have thumbs too.
       Reload on schema change. Cheap — one ~5k-cap query. */
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const r = await listClusters({limit: 5000, minMembers: 1});
                if (cancelled) return;
                setCatalog(new Map(r.clusters.map(c => [c.clusterId, c])));
            } catch {
                /* Non-fatal — rows will render the placeholder thumb. */
            }
        })();
        return () => { cancelled = true; };
    }, [schema]);

    async function refreshCatalog() {
        try {
            const r = await listClusters({limit: 5000, minMembers: 1});
            setCatalog(new Map(r.clusters.map(c => [c.clusterId, c])));
        } catch { /* ignore */ }
    }

    /* single-photo flow */

    async function runSingleIdentify() {
        const n = name.trim();
        if (!n) { showFlash("Please enter a name."); return; }
        if (files.length === 0) { showFlash("Please choose at least one face image."); return; }
        setWorking(true);
        setFlash({show: false, message: "", kind: "info"});
        try {
            const emb = await extractAveragedFaceEmbedding(files);
            const r = await identifyCluster({embedding: emb, threshold: WEAK_THRESHOLD, topK: 5});
            setSingleEmbedding(emb);
            setSingleMatches(r.matches);
            if (r.matches.length === 0) {
                showFlash(`No cluster centroid within ${(WEAK_THRESHOLD * 100).toFixed(0)}% of this face.`, "info");
            }
        } catch (err) {
            showFlash(err instanceof Error ? err.message : String(err));
        } finally {
            setWorking(false);
        }
    }

    async function acceptSingle(m: ClusterIdentifyMatch) {
        if (!singleEmbedding) return;
        const n = name.trim();
        setWorking(true);
        try {
            await setClusterLabel(m.clusterId, n);
            setFaceGallery(prev => ({...prev, [n]: {embedding: singleEmbedding, clusterId: m.clusterId}}));
            resetSingle();
            showFlash(
                `'${n}' linked to cluster ${m.clusterId.slice(0, 8)} (${(m.similarity * 100).toFixed(1)}%).`,
                "success",
            );
            void refreshCatalog();
        } catch (err) {
            showFlash(err instanceof Error ? err.message : String(err));
        } finally {
            setWorking(false);
        }
    }

    function resetSingle() {
        setName("");
        setFiles([]);
        setSingleEmbedding(null);
        setSingleMatches(null);
        if (singleInputRef.current) singleInputRef.current.value = "";
    }

    /* folder-upload flow */

    const folderGroups = useMemo(() => groupFilesByFolder(folderFiles), [folderFiles]);

    async function runBatchIdentify() {
        if (folderGroups.length === 0) { showFlash("Pick at least one folder of face images."); return; }
        setWorking(true);
        setFlash({show: false, message: "", kind: "info"});
        try {
            const embeddings = new Map<string, number[]>();
            for (const g of folderGroups) {
                const emb = await extractAveragedFaceEmbedding(g.files);
                embeddings.set(g.name, emb);
            }
            const candidates = Array.from(embeddings.entries()).map(([name, embedding]) => ({name, embedding}));
            const r = await identifyClusterBatch({candidates, threshold: WEAK_THRESHOLD});

            setBatchEmbeddings(embeddings);
            setBatchAssignments(r.assignments);
            setBatchUnmatched(r.unmatched);
            const init: Record<string, Decision> = {};
            for (const a of r.assignments) init[a.clusterId] = "pending";
            setBatchDecisions(init);
            setDeleteSelection(new Set());

            showFlash(
                `${r.assignments.length}/${r.totalClusters} clusters matched; ${r.unmatched.length} unmatched.`,
                "info",
            );
        } catch (err) {
            showFlash(err instanceof Error ? err.message : String(err));
        } finally {
            setWorking(false);
        }
    }

    function toggleDecision(clusterId: string, next: Decision) {
        setBatchDecisions(prev => ({...prev, [clusterId]: next}));
    }

    async function acceptAllPending() {
        if (!batchAssignments) return;
        setWorking(true);
        try {
            const pending = batchAssignments.filter(a => batchDecisions[a.clusterId] === "pending");
            for (const a of pending) {
                await setClusterLabel(a.clusterId, a.bestName);
                const emb = batchEmbeddings.get(a.bestName);
                if (emb) {
                    setFaceGallery(prev => ({...prev, [a.bestName]: {embedding: emb, clusterId: a.clusterId}}));
                }
                toggleDecision(a.clusterId, "accepted");
            }
            showFlash(`Accepted ${pending.length} assignment${pending.length === 1 ? "" : "s"}.`, "success");
            void refreshCatalog();
        } catch (err) {
            showFlash(err instanceof Error ? err.message : String(err));
        } finally {
            setWorking(false);
        }
    }

    /* Accept everything still pending, then merge any name with ≥2 non-skipped clusters into
       one. The merge endpoint creates a brand-new cluster id, so we also rewrite the matching
       gallery entry to point at the survivor — otherwise the fast `/clusters/match` path would
       still hit the now-detached old clusters. Skipped assignments are excluded from merging. */
    async function acceptAllPendingAndMerge() {
        if (!batchAssignments) return;
        setWorking(true);
        try {
            const pending = batchAssignments.filter(a => batchDecisions[a.clusterId] === "pending");
            for (const a of pending) {
                await setClusterLabel(a.clusterId, a.bestName);
                const emb = batchEmbeddings.get(a.bestName);
                if (emb) {
                    setFaceGallery(prev => ({...prev, [a.bestName]: {embedding: emb, clusterId: a.clusterId}}));
                }
                toggleDecision(a.clusterId, "accepted");
            }

            /* Group non-skipped (= accepted + just-accepted) assignments by name; merge groups of ≥2. */
            const pendingIds = new Set(pending.map(p => p.clusterId));
            const candidatesForMerge = batchAssignments.filter(a =>
                batchDecisions[a.clusterId] === "accepted" || pendingIds.has(a.clusterId)
            );
            const byName = new Map<string, ClusterIdentifyAssignment[]>();
            for (const a of candidatesForMerge) {
                const arr = byName.get(a.bestName);
                if (arr) arr.push(a);
                else byName.set(a.bestName, [a]);
            }

            let mergedGroups = 0;
            let mergedClusters = 0;
            for (const [personName, group] of byName) {
                if (group.length < 2) continue;
                const ids = group.map(c => c.clusterId);
                const result = await mergeClusters(ids, personName);
                mergedGroups++;
                mergedClusters += group.length;
                /* Rewrite the gallery entry to point at the new survivor cluster. */
                const emb = batchEmbeddings.get(personName);
                if (emb) {
                    setFaceGallery(prev => ({
                        ...prev,
                        [personName]: {embedding: emb, clusterId: result.newClusterId},
                    }));
                }
            }

            const acceptMsg = `Accepted ${pending.length}`;
            const mergeMsg = mergedGroups > 0
                ? ` and merged ${mergedClusters} clusters into ${mergedGroups} group${mergedGroups === 1 ? "" : "s"}`
                : "; no merging needed (no name had ≥2 clusters)";
            showFlash(`${acceptMsg}${mergeMsg}.`, "success");
            void refreshCatalog();
        } catch (err) {
            showFlash(err instanceof Error ? err.message : String(err));
        } finally {
            setWorking(false);
        }
    }

    async function acceptOne(a: ClusterIdentifyAssignment) {
        setWorking(true);
        try {
            await setClusterLabel(a.clusterId, a.bestName);
            const emb = batchEmbeddings.get(a.bestName);
            if (emb) {
                setFaceGallery(prev => ({...prev, [a.bestName]: {embedding: emb, clusterId: a.clusterId}}));
            }
            toggleDecision(a.clusterId, "accepted");
            void refreshCatalog();
        } catch (err) {
            showFlash(err instanceof Error ? err.message : String(err));
        } finally {
            setWorking(false);
        }
    }

    function toggleDelete(clusterId: string) {
        setDeleteSelection(prev => {
            const next = new Set(prev);
            if (next.has(clusterId)) next.delete(clusterId);
            else next.add(clusterId);
            return next;
        });
    }

    async function deleteSelected() {
        if (deleteSelection.size === 0) return;
        const n = deleteSelection.size;
        if (!confirm(
            `Delete ${n} cluster${n === 1 ? "" : "s"}? This detaches their face detections (kept in DB) ` +
            `and removes the clusters from listings and identify results. Not reversible.`,
        )) return;
        setWorking(true);
        try {
            for (const id of deleteSelection) {
                await deleteCluster(id);
            }
            setBatchUnmatched(prev => prev?.filter(u => !deleteSelection.has(u.clusterId)) ?? null);
            setDeleteSelection(new Set());
            showFlash(`Deleted ${n} cluster${n === 1 ? "" : "s"}.`, "success");
            void refreshCatalog();
        } catch (err) {
            showFlash(err instanceof Error ? err.message : String(err));
        } finally {
            setWorking(false);
        }
    }

    function resetBatch() {
        setFolderFiles([]);
        setBatchAssignments(null);
        setBatchUnmatched(null);
        setBatchDecisions({});
        setBatchEmbeddings(new Map());
        setDeleteSelection(new Set());
        if (folderInputRef.current) folderInputRef.current.value = "";
    }

    const grouped = batchAssignments ? groupAssignments(batchAssignments) : null;

    return (
        <section className="panel">
            <div className="panel__head row-between">
                <div className="stack-xs">
                    <h3 className="panel__title">Identify clusters from photos</h3>
                    <p className="panel__subtitle">
                        Match uploaded faces against existing clusters and label them in bulk.
                    </p>
                </div>
                <div className="row">
                    <button
                        className={mode === "single" ? "btn btn-primary" : "btn"}
                        onClick={() => setMode("single")}
                    >Single photo</button>
                    <button
                        className={mode === "folder" ? "btn btn-primary" : "btn"}
                        onClick={() => setMode("folder")}
                    >Folder upload</button>
                </div>
            </div>

            <div className="panel__body stack">

                {mode === "single" && (
                    <div className="stack">
                        <div className="row" style={{flexWrap: "wrap"}}>
                            <input
                                className="fs-input"
                                type="text"
                                placeholder="Name"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                disabled={working}
                            />
                            <label className="btn fs-file-label">
                                {files.length === 0
                                    ? "Choose image(s)…"
                                    : files.length === 1 ? files[0].name : `${files.length} images selected`}
                                <input
                                    ref={singleInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    style={{display: "none"}}
                                    onChange={e => setFiles(e.target.files ? Array.from(e.target.files) : [])}
                                    disabled={working}
                                />
                            </label>
                            <button
                                className="btn btn-primary"
                                onClick={() => void runSingleIdentify()}
                                disabled={working || files.length === 0 || !name.trim()}
                            >
                                {working ? "Identifying…" : "Identify"}
                            </button>
                            {singleMatches && (
                                <button className="btn btn-ghost" onClick={resetSingle} disabled={working}>Cancel</button>
                            )}
                        </div>

                        {singleMatches && singleMatches.length > 0 && (
                            <ul style={{listStyle: "none", padding: 0, margin: 0}}>
                                {singleMatches.map((m, i) => (
                                    <li key={m.clusterId} style={{
                                        display: "flex", alignItems: "center", gap: 12,
                                        padding: "6px 8px",
                                        marginTop: i === 0 ? 0 : 4,
                                        borderRadius: 6,
                                        ...bandStyle(m.similarity),
                                    }}>
                                        <ClusterThumb schema={schema} item={catalog.get(m.clusterId)}/>
                                        <div style={{flex: 1}}>
                                            <div style={{fontWeight: 500}}>
                                                {m.label ?? <em>Unlabelled</em>} ·{" "}
                                                <span style={{color: "#6b7280"}}>{m.clusterId.slice(0, 8)}…</span>
                                            </div>
                                            <div style={{fontSize: 12, color: "#6b7280"}}>
                                                {(m.similarity * 100).toFixed(1)}% similarity
                                                {m.label && m.label !== name.trim() && (
                                                    <> · relabelling will overwrite <em>{m.label}</em></>
                                                )}
                                            </div>
                                        </div>
                                        <button className="btn" onClick={() => void acceptSingle(m)} disabled={working}>
                                            Use this
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {mode === "folder" && (
                    <div className="stack">
                        <div className="row" style={{flexWrap: "wrap"}}>
                            <label className="btn fs-file-label">
                                {folderFiles.length === 0
                                    ? "Choose folder…"
                                    : `${folderFiles.length} files in ${folderGroups.length} folder(s)`}
                                <input
                                    ref={folderInputRef}
                                    type="file"
                                    // @ts-expect-error: nonstandard but widely supported attribute
                                    webkitdirectory=""
                                    directory=""
                                    multiple
                                    style={{display: "none"}}
                                    onChange={e => setFolderFiles(e.target.files ? Array.from(e.target.files).filter(f => f.type.startsWith("image/")) : [])}
                                    disabled={working}
                                />
                            </label>
                            <button
                                className="btn btn-primary"
                                onClick={() => void runBatchIdentify()}
                                disabled={working || folderFiles.length === 0}
                            >
                                {working ? "Working…" : "Match folders to clusters"}
                            </button>
                            {(batchAssignments || batchUnmatched) && (
                                <button className="btn btn-ghost" onClick={resetBatch} disabled={working}>Reset</button>
                            )}
                        </div>

                        <p style={{fontSize: 12, color: "#6b7280", margin: 0}}>
                            Pick a parent directory whose subfolders are named after the people inside them
                            (e.g. <code>people/Alice/…</code>, <code>people/Bob/…</code>). One averaged embedding
                            per folder is computed and matched against every cluster centroid.
                            For <em>Accept all + Merge</em>: same-name folders are treated as the same person, so give
                            two different people called "Alice" distinct folder names (<code>Alice Smith/</code>,
                            <code>Alice Jones/</code>) before uploading.
                        </p>

                        {grouped && (
                            <div className="stack">
                                <div className="row-between" style={{alignItems: "center"}}>
                                    <p className="panel__subtitle" style={{margin: 0}}>
                                        Matched clusters by person
                                    </p>
                                    <div className="row" style={{gap: 8}}>
                                        <button
                                            className="btn"
                                            onClick={() => void acceptAllPending()}
                                            disabled={working || batchAssignments!.every(a => batchDecisions[a.clusterId] !== "pending")}
                                        >Accept all pending</button>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => void acceptAllPendingAndMerge()}
                                            disabled={
                                                working ||
                                                /* Disable when there's nothing to do: no pending AND no name
                                                   that already has ≥2 non-skipped clusters waiting to merge. */
                                                (batchAssignments!.every(a => batchDecisions[a.clusterId] !== "pending") &&
                                                 Array.from(groupAssignments(batchAssignments!.filter(a => batchDecisions[a.clusterId] !== "skipped")).values()).every(g => g.length < 2))
                                            }
                                            title="Accept everything still pending, then fuse any name that ended up across ≥2 clusters into a single cluster."
                                        >Accept all + Merge same-name</button>
                                    </div>
                                </div>
                                {Array.from(grouped.entries()).map(([personName, rows]) => (
                                    <div key={personName} style={{border: "1px solid #e5e7eb", borderRadius: 8, padding: 8}}>
                                        <div style={{fontWeight: 600, marginBottom: 4}}>{personName}</div>
                                        <ul style={{listStyle: "none", padding: 0, margin: 0}}>
                                            {rows.map((a, i) => {
                                                const d = batchDecisions[a.clusterId] ?? "pending";
                                                return (
                                                    <li key={a.clusterId} style={{
                                                        display: "flex", alignItems: "center", gap: 12,
                                                        padding: "6px 8px",
                                                        marginTop: i === 0 ? 0 : 4,
                                                        borderRadius: 6,
                                                        ...bandStyle(a.similarity),
                                                    }}>
                                                        <ClusterThumb schema={schema} item={catalog.get(a.clusterId)}/>
                                                        <div style={{flex: 1, fontSize: 13}}>
                                                            <span style={{color: "#6b7280"}}>{a.clusterId.slice(0, 8)}…</span>
                                                            {" · "}{(a.similarity * 100).toFixed(1)}%
                                                            {a.existingLabel && a.existingLabel !== personName && (
                                                                <span style={{color: "#b45309"}}> · overwrites <em>{a.existingLabel}</em></span>
                                                            )}
                                                            {d === "accepted" && <span style={{color: "#15803d"}}> · accepted</span>}
                                                            {d === "skipped"  && <span style={{color: "#6b7280"}}> · skipped</span>}
                                                        </div>
                                                        {d === "pending" && (
                                                            <>
                                                                <button className="btn" disabled={working} onClick={() => void acceptOne(a)}>Accept</button>
                                                                <button className="btn btn-ghost" disabled={working} onClick={() => toggleDecision(a.clusterId, "skipped")}>Skip</button>
                                                            </>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        )}

                        {batchUnmatched && batchUnmatched.length > 0 && (
                            <div className="stack-xs">
                                <div className="row-between" style={{alignItems: "center"}}>
                                    <p className="panel__subtitle" style={{margin: 0}}>
                                        Unmatched clusters ({batchUnmatched.length})
                                    </p>
                                    <button
                                        className="btn"
                                        style={{backgroundColor: "#fee2e2", borderColor: "#fca5a5", color: "#991b1b"}}
                                        onClick={() => void deleteSelected()}
                                        disabled={working || deleteSelection.size === 0}
                                    >Delete selected ({deleteSelection.size})</button>
                                </div>
                                <p style={{fontSize: 12, color: "#6b7280", margin: 0}}>
                                    These clusters' centroids did not resemble any uploaded folder above {(WEAK_THRESHOLD * 100).toFixed(0)}%.
                                    Tick the ones you want to drop and press Delete. The underlying face detections stay in the DB.
                                </p>
                                <ul style={{listStyle: "none", padding: 0, margin: 0,
                                            maxHeight: 320, overflowY: "auto",
                                            border: "1px solid #e5e7eb", borderRadius: 8}}>
                                    {batchUnmatched.map(u => (
                                        <li key={u.clusterId} style={{
                                            display: "flex", alignItems: "center", gap: 10,
                                            padding: "6px 8px",
                                            borderBottom: "1px solid #f1f5f9",
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={deleteSelection.has(u.clusterId)}
                                                onChange={() => toggleDelete(u.clusterId)}
                                                disabled={working}
                                            />
                                            <ClusterThumb schema={schema} item={catalog.get(u.clusterId)}/>
                                            <span style={{flex: 1, fontSize: 13}}>
                                                {u.label ?? <em style={{color: "#6b7280"}}>Unlabelled</em>}
                                                {" "}<span style={{color: "#6b7280"}}>· {u.clusterId.slice(0, 8)}…</span>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                <Flash
                    show={flash.show}
                    kind={flash.kind}
                    onClose={() => setFlash(prev => ({...prev, show: false}))}
                >
                    {flash.message}
                </Flash>
            </div>
        </section>
    );
}
