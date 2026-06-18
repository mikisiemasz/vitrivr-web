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

export type ClusterRunSummary = {
    runId: string;
    algorithm: string;
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
    faceId: string;
    parentId?: string | null;
    bbox?: number[] | null;
};

export type ClusterGalleryItem = {
    clusterId: string;
    memberCount: number;
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

export type TriggerClusteringParams = {
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

export async function getGroupSizeHistogram(): Promise<GroupSizeHistogramResponse> {
    return jsonOrThrow(await fetch(`${base()}/stats/group-sizes`));
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

export async function identifyCluster(req: ClusterIdentifyRequest): Promise<ClusterIdentifyResponse> {
    const r = await fetch(`${base()}/identify`, {
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
export async function identifyClusterBatch(req: ClusterIdentifyBatchRequest): Promise<ClusterIdentifyBatchResponse> {
    const r = await fetch(`${base()}/identify-batch`, {
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
    p: {limit?: number; minShared?: number} = {},
): Promise<CoOccurrenceResponse> {
    return jsonOrThrow(await fetch(`${base()}/${encodeURIComponent(clusterId)}/co-occurrences${qs(p)}`));
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
