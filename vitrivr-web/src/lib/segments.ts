import {API_BASE, SCHEMA} from "./vitrivr";

/* Read the active schema from the same source SchemaSelector writes to. */
const schema = () => {
    try {
        const fromStorage = (window.localStorage.getItem("vitrivr_schema") ?? "").trim();
        if (fromStorage) return fromStorage;
    } catch {
        // localStorage may be unavailable (SSR, private mode); fall through.
    }
    return (SCHEMA ?? "").trim();
};

export type SegmentInfo = {
    segmentId: string;
    sourceId?: string | null;
    filePath?: string | null;
    startNs?: number | null;
    endNs?: number | null;
};

/**
 * Bulk display-metadata lookup for SEGMENT ids (parent video path + segment time).
 */
export async function fetchSegmentInfo(ids: string[]): Promise<Map<string, SegmentInfo>> {
    if (ids.length === 0) return new Map();
    const r = await fetch(`${API_BASE}/api/${schema()}/segments/info`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ids}),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const data = await r.json() as {segments: SegmentInfo[]};
    return new Map(data.segments.map(s => [s.segmentId, s]));
}
