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

export type ClusterExemplar = { faceId: string; parentId?: string | null };

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

export type ClusterMemberItem = { faceId: string; parentId?: string | null };
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
