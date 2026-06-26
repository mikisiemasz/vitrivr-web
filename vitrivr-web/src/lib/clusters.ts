import {API_BASE, SCHEMA} from "./vitrivr";

/* Read the active schema from the same source SchemaSelector writes to,
   so switching the selector immediately reroutes cluster API calls. */
const schema = () => {
    try {
        const fromStorage = (window.localStorage.getItem("vitrivr_schema") ?? "").trim();
        if (fromStorage) return fromStorage;
    } catch {
        // localStorage may be unavailable (SSR, private mode); fall through.
    }
    return (SCHEMA ?? "").trim();
};
const base = () => `${API_BASE}/api/${schema()}/clusters`;

/**
 * `target` distinguishes per-frame ("detections") from per-shot identity ("tracks") clustering runs.
 * `memberType` on the resulting clusters mirrors this choice: FACE_DETECTION vs FACE_TRACK.
 */
export type ClusteringTarget = "detections" | "tracks";

export type ClusterRunSummary = {
    runId: string;
    algorithm: string;
    target: ClusteringTarget;
    embeddingField: string;
    minClusterSize: number;
    minSamples: number;
    numInputFaces: number;
    numAssignedFaces: number;
    numNoiseFaces: number;
    numClusters: number;
    numLabelsCarried: number;
    startedAt: string;
    completedAt: string;
    status: string;
};

export type ClusterExemplar = {
    /** For track-cluster exemplars this is the *representative* face id (renderable). For detection
     *  clusters this is the exemplar face id directly. */
    faceId: string;
    parentId?: string | null;
    bbox?: number[] | null;
    /** Originating FACE_TRACK id if the cluster's members are tracks; null for detection clusters. */
    trackId?: string | null;
};

/** Track-clustered runs produce members of type FACE_TRACK; classic detection runs produce FACE_DETECTION. */
export type ClusterMemberType = "FACE_DETECTION" | "FACE_TRACK";

export type ClusterGalleryItem = {
    clusterId: string;
    memberCount: number;
    /** Defaults to FACE_DETECTION when the server omits the field (older runs). */
    memberType?: ClusterMemberType;
    exemplars: ClusterExemplar[];
    label?: string | null;
    segmentCount: number;
};

export type ClusterGalleryResponse = {
    runId: string;
    schema: string;
    totalClusters: number;
    limit: number;
    offset: number;
    clusters: ClusterGalleryItem[];
};

export type ClusterSegmentItem = { parentId: string; detectionCount: number };
export type ClusterSegmentPage = {
    clusterId: string;
    total: number;
    limit: number;
    offset: number;
    segments: ClusterSegmentItem[];
};

export type ClusterMemberItem = {
    faceId: string;
    parentId?: string | null;
    /** Normalized [x1, y1, x2, y2] in [0,1]^4 against the source frame. */
    bbox?: number[] | null;
};
export type ClusterMemberPage = {
    clusterId: string;
    total: number;
    limit: number;
    offset: number;
    members: ClusterMemberItem[];
};

export type CoOccurrenceItem = {
    clusterId: string;
    label?: string | null;
    memberCount: number;
    sharedSegments: number;
};
export type CoOccurrenceResponse = {
    clusterId: string;
    total: number;
    partners: CoOccurrenceItem[];
};

export type ClusterMutationResult = {
    newClusterId: string;
    movedMembers: number;
    message?: string | null;
};

export type ListClustersParams = {
    runId?: string;
    /** Limit the gallery to detection-clusters, track-clusters, or "all" (server default). */
    target?: ClusteringTarget | "all";
    limit?: number;
    offset?: number;
    minMembers?: number;
    sort?: "members" | "segments" | "label";
    onlyLabelled?: boolean;
    onlyUnlabelled?: boolean;
};

function qs(params: Record<string, string | number | boolean | undefined>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
    if (entries.length === 0) return "";
    return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r.json() as Promise<T>;
}

export async function listClusters(params: ListClustersParams = {}): Promise<ClusterGalleryResponse> {
    return jsonOrThrow(await fetch(`${base()}${qs(params as Record<string, string | number | boolean | undefined>)}`));
}

export async function listClusterRuns(): Promise<ClusterRunSummary[]> {
    return jsonOrThrow(await fetch(`${base()}/runs`));
}

/** Drops a FACE_CLUSTER_RUN and all FACE_CLUSTERs it produced. Members (detections/tracks) are preserved. */
export async function deleteClusterRun(runId: string): Promise<void> {
    const r = await fetch(`${base()}/runs/${encodeURIComponent(runId)}`, {method: "DELETE"});
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
}

/* ── Tracking runs ─────────────────────────────────────────────────────────────────────────── */

const tracksBase = () => `${API_BASE}/api/${schema()}/tracks`;

export type TrackRunListItem = {
    runId: string;
    numTracks: number;
};

/** Returns track runs in insertion order — last item is the most recent. */
export async function listTrackRuns(): Promise<TrackRunListItem[]> {
    return jsonOrThrow(await fetch(`${tracksBase()}/runs`));
}

/**
 * Drops a FACE_TRACK_RUN, every FACE_TRACK it produced, and the partOfTrack edges that linked face detections
 * to those tracks. FACE_DETECTIONs themselves are preserved. Use this before running fresh tracking to keep
 * the input set clean (see also: re-running track clustering with stale tracks from prior runs produces noisy
 * input).
 */
export async function deleteTrackRun(runId: string): Promise<void> {
    const r = await fetch(`${tracksBase()}/runs/${encodeURIComponent(runId)}`, {method: "DELETE"});
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
}

export type TriggerClusteringParams = {
    /** "detections" (default, classic per-frame clustering) or "tracks" (cluster on track centroids). */
    target?: ClusteringTarget;
    minClusterSize?: number;
    minSamples?: number;
    exemplarCount?: number;
    labelCarryThreshold?: number;
    pythonServer?: string;
};

export async function triggerClustering(p: TriggerClusteringParams = {}): Promise<ClusterRunSummary> {
    return jsonOrThrow(await fetch(`${base()}/run${qs(p)}`, {method: "POST"}));
}

export async function getClusterSegments(
    clusterId: string,
    p: {limit?: number; offset?: number} = {},
): Promise<ClusterSegmentPage> {
    return jsonOrThrow(await fetch(`${base()}/${encodeURIComponent(clusterId)}/segments${qs(p)}`));
}

export async function getClusterMembers(
    clusterId: string,
    p: {limit?: number; offset?: number} = {},
): Promise<ClusterMemberPage> {
    return jsonOrThrow(await fetch(`${base()}/${encodeURIComponent(clusterId)}/members${qs(p)}`));
}

export type ClusterCentroidResponse = { clusterId: string; embedding: number[] };

export async function getClusterCentroid(clusterId: string): Promise<ClusterCentroidResponse> {
    return jsonOrThrow(await fetch(`${base()}/${encodeURIComponent(clusterId)}/centroid`));
}

export type GroupSizeBin = { k: number; segmentCount: number };
export type GroupSizeHistogramResponse = {
    totalSegments: number;
    bins: GroupSizeBin[];
};

export async function getGroupSizeHistogram(target?: ClusteringTarget): Promise<GroupSizeHistogramResponse> {
    const q = target ? `?target=${encodeURIComponent(target)}` : "";
    return jsonOrThrow(await fetch(`${base()}/stats/group-sizes${q}`));
}

/**
 * Server-side AND-intersection of cluster memberships, with optional spatial ordering.
 * Replaces the multi-query intersection the frontend used to do for face blocks where
 * every chip carries a clusterId.
 */
export type ClusterMatchRequest = {
    include?: string[];
    exclude?: string[];
    spatialOrder?: string[];
    axis?: "x" | "y";
    limit?: number;
};

export type ClusterMatchHit = {
    segmentId: string;
    score: number;
    sourceId?: string | null;
    filePath?: string | null;
    startNs?: number | null;
    endNs?: number | null;
};

export type ClusterMatchResponse = {
    total: number;
    limit: number;
    results: ClusterMatchHit[];
};

export async function matchClusters(req: ClusterMatchRequest): Promise<ClusterMatchResponse> {
    const r = await fetch(`${base()}/match`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(req),
    });
    return jsonOrThrow(r);
}

/**
 * Photo → cluster identification: turns a manually uploaded face into a *label* on an existing
 * cluster, so the resulting gallery entry can take the fast `/clusters/match` path instead of
 * the per-face ANN fallback.
 *
 * The frontend extracts the embedding via the same face model used during ingestion, then asks
 * the engine which clusters have the most similar centroid. Cosine similarity; both vectors are
 * assumed L2-normalized but the server renormalizes the query defensively.
 */
export type ClusterIdentifyRequest = {
    embedding: number[];
    /** Min cosine similarity. Defaults server-side to 0.5. */
    threshold?: number;
    /** Max matches to return after thresholding. Defaults server-side to 5. */
    topK?: number;
};

export type ClusterIdentifyMatch = {
    clusterId: string;
    similarity: number;
    label?: string | null;
};

export type ClusterIdentifyResponse = {
    totalClusters: number;
    matches: ClusterIdentifyMatch[];
};

export async function identifyCluster(
    req: ClusterIdentifyRequest,
    target?: ClusteringTarget,
): Promise<ClusterIdentifyResponse> {
    const q = target ? `?target=${encodeURIComponent(target)}` : "";
    const r = await fetch(`${base()}/identify${q}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(req),
    });
    return jsonOrThrow(r);
}

export type ClusterIdentifyCandidate = {
    name: string;
    embedding: number[];
};

export type ClusterIdentifyBatchRequest = {
    candidates: ClusterIdentifyCandidate[];
    threshold?: number;
};

export type ClusterIdentifyAssignment = {
    clusterId: string;
    bestName: string;
    similarity: number;
    existingLabel?: string | null;
};

export type UnmatchedClusterRow = {
    clusterId: string;
    label?: string | null;
};

export type ClusterIdentifyBatchResponse = {
    totalClusters: number;
    assignments: ClusterIdentifyAssignment[];
    unmatched: UnmatchedClusterRow[];
};

/** Batch counterpart of [identifyCluster]: assigns each cluster to its best-matching candidate. */
export async function identifyClusterBatch(
    req: ClusterIdentifyBatchRequest,
    target?: ClusteringTarget,
): Promise<ClusterIdentifyBatchResponse> {
    const q = target ? `?target=${encodeURIComponent(target)}` : "";
    const r = await fetch(`${base()}/identify-batch${q}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(req),
    });
    return jsonOrThrow(r);
}

/** Hard delete: detaches members/exemplars and drops the cluster retrievable. */
export async function deleteCluster(clusterId: string): Promise<void> {
    const r = await fetch(`${base()}/${encodeURIComponent(clusterId)}`, {method: "DELETE"});
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
}

export async function getCoOccurrences(
    clusterId: string,
    p: {limit?: number; minShared?: number; target?: ClusteringTarget} = {},
): Promise<CoOccurrenceResponse> {
    return jsonOrThrow(await fetch(`${base()}/${encodeURIComponent(clusterId)}/co-occurrences${qs(p)}`));
}

export type ClusterTimelineSegment = {
    segmentId: string;
    startNs: number;
    endNs: number;
    detectionCount: number;
};

export type ClusterTimelineVideo = {
    sourceId: string;
    filePath?: string | null;
    /** Max endNs across this video's segments; used as the lane's right-edge scale. TODO: change to video end time instead */
    lastAppearanceNs: number;
    segments: ClusterTimelineSegment[];
};

export type ClusterTimelineResponse = {
    clusterId: string;
    videos: ClusterTimelineVideo[];
};

export async function getClusterTimeline(clusterId: string): Promise<ClusterTimelineResponse> {
    return jsonOrThrow(await fetch(`${base()}/${encodeURIComponent(clusterId)}/timeline`));
}

export async function setClusterLabel(clusterId: string, label: string | null): Promise<void> {
    const r = await fetch(`${base()}/${encodeURIComponent(clusterId)}/label`, {
        method: "PATCH",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({label}),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
}

export async function mergeClusters(clusterIds: string[], label?: string): Promise<ClusterMutationResult> {
    const r = await fetch(`${base()}/merge`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({clusterIds, label}),
    });
    return jsonOrThrow(r);
}

export async function splitCluster(
    clusterId: string,
    faceIds: string[],
    newLabel?: string,
): Promise<ClusterMutationResult> {
    const r = await fetch(`${base()}/${encodeURIComponent(clusterId)}/split`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({faceIds, newLabel}),
    });
    return jsonOrThrow(r);
}
