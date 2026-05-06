import {retrieval} from "../vitirvr/api/client";
import {buildSegmentMediaUrls, type VitrivrRetrievable} from "./vitrivr";

export const FACE_SERVER_URL =
    (import.meta.env.VITE_FACE_SERVER_URL as string | undefined) ?? "http://127.0.0.1:8888";

async function fileToBase64DataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
        reader.readAsDataURL(file);
    });
}

/**
 * Send a face image to the descriptor server and return a single normalized
 * 512-d embedding. Throws if 0 or >1 face is detected.
 */
export async function extractFaceEmbedding(file: File): Promise<number[]> {
    const dataUrl = await fileToBase64DataUrl(file);
    const form = new FormData();
    form.append("data", dataUrl);

    //    const resp = await fetch(`${FACE_SERVER_URL}/extract/face_embedding`, {
    // workaround not to add CORS headers to the face server during development, see vite.config.ts
    const resp = await fetch(`/face-api/extract/face_embedding`, {
        method: "POST",
        body: form,
    });

    if (!resp.ok) throw new Error(`Face server returned HTTP ${resp.status}`);

    const embeddings = await resp.json() as number[][];
    if (!Array.isArray(embeddings))
        throw new Error("Unexpected response format from face server");
    if (embeddings.length === 0)
        throw new Error("No face detected in the image — try a clearer photo");
    if (embeddings.length > 1)
        throw new Error(`${embeddings.length} faces detected — use a photo with exactly one face`);

    return embeddings[0];
}

export function buildFaceQuery(vector: number[], limit: number) {
    return {
        inputs: {
            "face-query": {type: "FLOATVECTOR", data: vector},
        },
        operations: {
            face: {
                field: "face",
                inputs: {vec: "face-query"},
                parameters: {limit: String(limit)},
            },
            relations: {
                factory: "RelationExpander",
                inputs: {in: "face"},
                parameters: {outgoing: "partOf"},
            },
            aggregator: {
                factory: "ScoreAggregator",
                inputs: {in: "relations"},
            },
            timelookup: {
                factory: "FieldLookup",
                inputs: {in: "aggregator"},
                parameters: {field: "time", keys: "start, end"},
            },
            filelookup: {
                factory: "ObjectFieldLookup",
                inputs: {in: "timelookup"},
                parameters: {field: "file", predicates: "partOf", keys: "path"},
            },
        },
        output: "filelookup",
    } as const;
}

export type FaceResultItem = {
    retrievableId: string;
    score: number;
    startNs: number;
    endNs: number;
    raw: VitrivrRetrievable;
};

export type FaceResultMap = Map<string, FaceResultItem>;

type RawApiItem = VitrivrRetrievable & {score?: number | string};

function pickScalarDescriptor(r: VitrivrRetrievable, key: string): number {
    const v = r.descriptors?.[key];
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v) || 0;
    return 0;
}

function normalizeResponse(resp: unknown): FaceResultMap {
    const map: FaceResultMap = new Map();
    const list: unknown[] = Array.isArray(resp)
        ? resp
        : ((resp as Record<string, unknown>)?.retrievables as unknown[] ?? []);

    for (const item of list) {
        const r = item as RawApiItem;
        const id = r.id?.trim();
        if (!id) continue;

        const score = typeof r.score === "number" ? r.score
            : typeof r.score === "string" ? parseFloat(r.score) || 0
            : 0;

        map.set(id, {
            retrievableId: id,
            score,
            startNs: pickScalarDescriptor(r, "time.start"),
            endNs: pickScalarDescriptor(r, "time.end"),
            raw: r,
        });
    }
    return map;
}

export async function queryFaceVector(
    vector: number[],
    schema: string,
    limit: number,
): Promise<FaceResultMap> {
    const body = buildFaceQuery(vector, limit);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const resp = await retrieval.postExecuteQuery(schema, body);
    return normalizeResponse(resp);
}

/** Intersect N maps. Only ids present in all maps survive. Score = min. */
export function intersectMaps(maps: FaceResultMap[]): FaceResultMap {
    if (maps.length === 0) return new Map();
    if (maps.length === 1) return new Map(maps[0]);

    const [first, ...rest] = maps;
    const out: FaceResultMap = new Map();

    for (const [id, item] of first) {
        if (rest.every(m => m.has(id))) {
            const allScores = [item.score, ...rest.map(m => m.get(id)!.score)];
            out.set(id, {...item, score: Math.min(...allScores)});
        }
    }
    return out;
}

/** Remove every id present in any exclude map from base. */
export function subtractMaps(base: FaceResultMap, excludeMaps: FaceResultMap[]): FaceResultMap {
    if (excludeMaps.length === 0) return base;
    const excludeIds = new Set(excludeMaps.flatMap(m => [...m.keys()]));
    const out: FaceResultMap = new Map();
    for (const [id, item] of base) {
        if (!excludeIds.has(id)) out.set(id, item);
    }
    return out;
}


export type FaceMediaItem = {
    id: string;
    url: string;
    thumbUrl: string;
    name: string;
    start: number;
    end: number;
    score: number;
};

export function faceMapToMediaItems(schema: string, map: FaceResultMap): FaceMediaItem[] {
    const items: FaceMediaItem[] = [];

    for (const item of map.values()) {
        const {url, thumbUrl, filename} = buildSegmentMediaUrls(schema, item.raw);
        // console.log("[face] id:", item.retrievableId, "url:", url, "filePath:", item.raw.descriptors?.["file.path"], "parentPath:", item.raw.relationship?.partOf?.descriptors?.["file.path"]);
        if (!url) continue;

        items.push({
            id: item.retrievableId,
            url,
            thumbUrl,
            name: filename ?? "",
            start: item.startNs / 1_000_000_000,
            end: item.endNs / 1_000_000_000,
            score: item.score,
        });
    }

    items.sort((a, b) => b.score - a.score);
    return items;
}