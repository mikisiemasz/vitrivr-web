/**
 * VideoPage
 *
 * A detail page for viewing a selected video segment, submitting results to DRES,
 * and exploring visually similar neighbor segments.
 *
 * Features:
 * - Plays the selected video segment
 * - Restores the segment start time when metadata is loaded
 * - Supports DRES submission for text and item tasks
 * - Loads nearest-neighbor video results from the current clip vector
 * - Lets the user open neighbor results as new video pages
 * - Integrates with search, auth, and evaluation state
 *
 * Behavior:
 * - Reads the selected video `id` from the route
 * - Looks up the current item from search state
 * - Detects the active DRES submission mode (`text`, `item`, etc.)
 * - For text tasks, submits the entered text answer
 * - For item tasks, submits the current playback timestamp
 * - If a clip vector is available, runs a vector search to load nearest neighbors
 * - Stores discovered neighbor vectors back into shared state for later navigation
 *
 * Main helpers:
 * @param pickNumber - Reads numeric descriptor values safely
 * @param nsToSecondsMaybe - Converts nanoseconds to seconds
 * @param basenameFromPath - Extracts the filename from a path
 * @param toServedVideoUrl - Builds a playable served video URL
 * @param pickFloatArray - Reads numeric vector descriptors safely
 * @param videoNameFromUrl - Derives a display name from a video URL
 * @param mapNeighbors - Maps retrieval results into video neighbor items
 *
 * Example route:
 * /video/:id
 *
 * Notes:
 * - Neighbor search depends on `vectorsById[id]` being available
 * - Only video-type neighbors are shown
 * - If no clip vector exists, neighbor loading is skipped with an error message
 * - The component expects surrounding providers such as `SearchContext` and `AuthContext`
 */


"use client";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {thumbnailUrl, buildVectorQuery, servedVideoUrl, sourceLabel} from "../lib/vitrivr";
import {useSearch} from "../state/SearchContext";
import {useEffect, useMemo, useRef, useState} from "react";
import {useAuth} from "../state/AuthContext";
import {submitVideo, submitText} from "../dres/generated/api/dresSubmit";
import {getCurrentSubmissionKind} from "../dres/generated/api/taskTypeHelper";
import ResultItem from "../components/Results/ResultItem";
import {retrieval} from "../vitirvr/api/client";

type MediaKind = "image" | "video" | "custom";

type MediaItem = {
    id: string;
    kind: MediaKind;
    url: string;
    name: string;
    thumbUrl?: string;
    start: number;
    end: number;
    rawType?: string;
    clipVector?: number[];
};

/** Fallback playback info carried on the router Link (see ResultItem / ClusterDetail).
    Lets this page work for segments that never went through a search (People tab links),
    where the SearchContext has no item and no clip vector. */
type VideoLinkState = {
    src?: string;
    poster?: string;
    start?: number;
    end?: number;
    name?: string;
} | null;

type RetrievablesResponse = {
    retrievables?: Array<{
        id?: string;
        type?: string;
        score?: number;
        relationship?: {
            partOf?: {
                descriptors?: Record<string, unknown>;
            };
        };
        descriptors?: Record<string, unknown>;
    }>;
};

function pickNumber(r: { descriptors?: Record<string, unknown> }, key: string): number | undefined {
    const v = r.descriptors?.[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
        const n = Number(v.trim());
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

function nsToSecondsMaybe(x: number): number {
    return x / 1_000_000_000;
}

function basenameFromPath(p: string): string {
    const unixy = p.replace(/\\/g, "/");
    const parts = unixy.split("/");
    return parts[parts.length - 1] ?? "";
}

function toServedVideoUrl(schema: string, filePath: string): string {
    const origin = import.meta.env.VITE_MEDIA_ORIGIN || "";
    if (!origin) return "";
    const filename = basenameFromPath(filePath);
    if (!filename) return "";
    return servedVideoUrl(schema, filePath);
}

function pickFloatArray(
    r: { descriptors?: Record<string, unknown> },
    key: string
): number[] | undefined {
    const v = r.descriptors?.[key];

    if (!Array.isArray(v)) return undefined;

    const out: number[] = [];
    for (const x of v) {
        if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
        out.push(x);
    }
    return out;
}

function videoNameFromUrl(url: string): string {
    try {
        const u = new URL(url);
        const base = u.pathname.split("/").pop() ?? "";
        return base.replace(/\.[^.]+$/, "");
    } catch {
        const base = (url ?? "").split("?")[0].split("#")[0].split("/").pop() ?? "";
        return base.replace(/\.[^.]+$/, "");
    }
}

/** "day1 / Allie / 08.mp4" from a served video URL (the path contains the day/camera folders). */
function labelFromUrl(url: string): string {
    try {
        const u = new URL(url, window.location.origin);
        return sourceLabel(decodeURIComponent(u.pathname)) || videoNameFromUrl(url);
    } catch {
        return videoNameFromUrl(url);
    }
}

function formatTimestamp(seconds: number): string {
    const totalMs = Math.max(0, Math.round(seconds * 1000));
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const secs = Math.floor((totalMs % 60_000) / 1000);
    const ms = totalMs % 1000;

    return [
        String(hours).padStart(2, "0"),
        String(minutes).padStart(2, "0"),
        `${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`,
    ].join(":");
}


function mapNeighbors(schema: string, resp: RetrievablesResponse): MediaItem[] {
    const list = resp.retrievables ?? [];
    const out: MediaItem[] = [];

    for (const r of list) {
        const id = r.id?.trim();
        const clipVector = pickFloatArray(r, "clip.vector");
        if (!id) continue;

        const kind: MediaKind = r.type === "SEGMENT" ? "video" : "custom";
        if (kind !== "video") continue;

        const filePath =
            (r.descriptors?.["file.path"] as string | undefined) ||
            (r.relationship?.partOf?.descriptors?.["file.path"] as string | undefined);

        if (!filePath) continue;

        const startNs = pickNumber(r, "time.start") ?? 0;
        const endNs = pickNumber(r, "time.end") ?? 0;

        const start = nsToSecondsMaybe(startNs);
        const end = nsToSecondsMaybe(endNs);


        const url = toServedVideoUrl(schema, filePath);
        if (!url) continue;

        out.push({
            id,
            kind: "video",
            url,
            name: videoNameFromUrl(url),
            thumbUrl: thumbnailUrl(schema, id),
            start,
            end,
            rawType: r.type,
            clipVector
        });
    }

    return out;
}

export default function VideoPage() {
    const navigate = useNavigate();
    const {id} = useParams<{ id: string }>();
    const linkState = (useLocation().state ?? null) as VideoLinkState;
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const {items, schema, setVectorsById, vectorsById, setItems} = useSearch();
    const item = items.find((it) => it.id === id);

    const {session, openLogin} = useAuth();
    const {evaluationId} = useAuth();

    const [submitting, setSubmitting] = useState(false);
    const [kind, setKind] = useState<"text" | "item" | "temporal" | "unknown">("unknown");
    const [textAnswer, setTextAnswer] = useState("");

    const [neighbors, setNeighbors] = useState<MediaItem[]>([]);
    const [neighborsLoading, setNeighborsLoading] = useState(false);
    const [neighborsError, setNeighborsError] = useState<string | null>(null);

    const poster = (id ? thumbnailUrl(schema, id) : "") || linkState?.poster || "";

    /* Context item first (search flow), then the router link state (People tab / cluster flow). */
    const src = item?.url || linkState?.src || "";
    const start = item?.start ?? linkState?.start ?? 0;
    // const end = item?.end ?? 0; // TODO remove
    const name = item?.name || linkState?.name || (src ? labelFromUrl(src) : id ?? "");
    const formattedStart = formatTimestamp(start);

    const currentVector = useMemo(() => {
        if (!id) return undefined;
        return vectorsById?.[id];
    }, [id, vectorsById]);


    const openNeighbor = (n: MediaItem) => {
        if (n.clipVector && n.clipVector.length > 0) {
            setVectorsById((prev) => ({...prev, [n.id]: n.clipVector!}));
        }

        setItems((prev) => {
            if (prev.some((x) => x.id === n.id)) return prev;
            return [...prev, n];
        });

        navigate(`/video/${encodeURIComponent(n.id)}`);
    };


    useEffect(() => {
        let cancelled = false;

        async function loadKind() {
            if (!session || !evaluationId) {
                setKind("unknown");
                return;
            }
            try {
                const k = await getCurrentSubmissionKind({session, evaluationId});
                if (!cancelled) setKind(k);
            } catch {
                if (!cancelled) setKind("unknown");
            }
        }

        loadKind();
        return () => {
            cancelled = true;
        };
    }, [session, evaluationId]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const onLoaded = () => {
            video.currentTime = Math.min(start, video.duration || start);
        };

        video.addEventListener("loadedmetadata", onLoaded);
        if (video.readyState >= 1) {
            onLoaded();
    }
        return () => video.removeEventListener("loadedmetadata", onLoaded);
    }, [start]);

    useEffect(() => {
        window.scrollTo({top: 0, left: 0, behavior: "instant" as ScrollBehavior});
    }, [id]);


    useEffect(() => {
        let cancelled = false;

        async function loadNeighbors() {
            if (!id) return;
            if (!currentVector || currentVector.length === 0) {
                /* Expected whenever the segment didn't come from a CLIP search (People tab links)
                   or the schema is CLIP-free, no neighbor search available. */
                setNeighbors([]);
                setNeighborsError(null);
                return;
            }

            setNeighborsLoading(true);
            setNeighborsError(null);

            try {
                const body = buildVectorQuery(currentVector, 1000);
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                const resp = await retrieval.postExecuteQuery(schema, body);

                if (cancelled) return;

                const mapped = mapNeighbors(schema, resp as RetrievablesResponse)
                    .filter((m) => m.id !== id);

                setVectorsById((prev) => {
                    const next = {...prev};
                    for (const m of mapped) {
                        if (m.clipVector && m.clipVector.length > 0) {
                            next[m.id] = m.clipVector;
                        }
                    }
                    return next;
                });

                setNeighbors(mapped);
            } catch (e: any) {
                if (!cancelled) setNeighborsError(e?.message ?? String(e));
            } finally {
                if (!cancelled) setNeighborsLoading(false);
            }
        }

        loadNeighbors();
        return () => {
            cancelled = true;
        };
    }, [id, schema, currentVector]);

    const onSubmit = async () => {
        if (!session) {
            openLogin();
            return;
        }
        if (!evaluationId) {
            openLogin();
            return;
        }

        const k = await getCurrentSubmissionKind({session, evaluationId});

        if (k === "text") {
            const text = textAnswer.trim();
            if (!text) {
                alert("Please enter a text answer.");
                return;
            }
            setSubmitting(true);
            try {
                const res = await submitText({session, evaluationId, text});
                console.log("Submitted text", text)
                alert("Submitted! " + JSON.stringify(res.data.submission));
                console.log("DRES submitText response:", res.data.submission);
                setTextAnswer("");
            } catch (err: any) {
                alert(err?.response?.data?.description ?? err?.message ?? "Submit failed.");
            } finally {
                setSubmitting(false);
            }
            return;
        }

        if (k === "item") {
            const video = videoRef.current;
            const tSec = video?.currentTime ?? start;
            const tMs = Number.isFinite(tSec) ? Math.round(tSec * 1000) : undefined;
            const splitLen = src.split("/").length;
            const videoName = src.split("/")[splitLen - 1].split(".")[0];
            setSubmitting(true);
            try {
                const res = await submitVideo({
                    session,
                    mediaItemName: videoName,
                    evaluationId,
                    start: tMs,
                    end: tMs,
                });
                console.log("Submission", videoName, tMs, tMs)
                alert("Submitted! " + JSON.stringify(res.data.submission));
                setTextAnswer("");
            } catch (err: any) {
                alert(err?.response?.data?.description ?? err?.message ?? "Submit failed.");
            } finally {
                setSubmitting(false);
            }
        }

    };

    if (!id) {
        return (
            <div style={{padding: 16}}>
                <button onClick={() => navigate(-1)} aria-label="Back">
                    ← Back
                </button>
                <p>Missing video id.</p>
            </div>
        );
    }

    return (
        <div style={{padding: 16, display: "grid", gap: 16}}>
            <header style={{display: "flex", alignItems: "center", gap: 12}}>
                <button
                    onClick={() => navigate(-1)}
                    style={{
                        border: "1px solid #ddd",
                        borderRadius: 8,
                        background: "#fff",
                        padding: "6px 10px",
                        cursor: "pointer",
                    }}
                >
                    ← Back
                </button>

                <button
                    onClick={() => navigate("/")}
                    style={{
                        border: "1px solid #ddd",
                        borderRadius: 8,
                        background: "#fff",
                        padding: "6px 10px",
                        cursor: "pointer",
                    }}
                    title="Go to search"
                >
                    🏠 Home
                </button>

                <h2 style={{margin: 0, fontSize: 18, fontWeight: 600}}>Video: {name}</h2>

                <div style={{marginLeft: "auto", display: "flex", gap: 10, alignItems: "center"}}>
                    {kind === "text" && (
                        <input
                            value={textAnswer}
                            onChange={(e) => setTextAnswer(e.target.value)}
                            placeholder="Type answer (DRES)…"
                            style={{
                                width: 260,
                                maxWidth: "50vw",
                                border: "1px solid #ddd",
                                borderRadius: 10,
                                padding: "8px 10px",
                                background: "#fff",
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") onSubmit();
                            }}
                        />
                    )}

                    <button
                        type="button"
                        onClick={onSubmit}
                        disabled={submitting}
                        style={{
                            border: "1px solid #ddd",
                            borderRadius: 10,
                            padding: "8px 12px",
                            background: "#FF00FF",
                            cursor: "pointer",
                        }}
                    >
                        {submitting ? "Submitting…" : "Submit"}
                    </button>
                </div>
            </header>

            {src ? (
                <video
                    key={id}
                    ref={videoRef}
                    src={src}
                    poster={poster}
                    controls
                    preload="metadata"
                    style={{width: "100%", maxWidth: 960, borderRadius: 12, background: "#000"}}
                />
            ) : (
                <div style={{
                    width: "100%", maxWidth: 960, borderRadius: 12, border: "1px solid #ddd",
                    background: "#fafafa", padding: 24, display: "grid", gap: 8,
                    justifyItems: "center",
                }}>
                    {poster && <img src={poster} alt={name} style={{maxWidth: "100%", borderRadius: 8}}/>}
                    <span style={{opacity: 0.7, fontSize: 13}}>
                        No playable source for this segment — its origin view didn't provide a video path.
                    </span>
                </div>
            )}
            <div
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    border: "1px solid #ddd",
                    borderRadius: 10,
                    background: "#fafafa",
                    width: "fit-content",
                }}
            >
                <strong>Starts at</strong>
                <span>{formattedStart}</span>
                <span style={{opacity: 0.65}}>({start.toFixed(3)} s)</span>
            </div>

            <section style={{display: "grid", gap: 10}}>
                <h3 style={{margin: 0, fontSize: 14, fontWeight: 600}}>Nearest neighbors</h3>

                {neighborsLoading && <div style={{opacity: 0.8}}>Loading neighbors…</div>}
                {neighborsError && <div style={{color: "#b00020"}}>{neighborsError}</div>}

                {!neighborsLoading && !neighborsError && (!currentVector || currentVector.length === 0) && (
                    <div style={{opacity: 0.7}}>
                        Neighbor search needs a CLIP vector from a search result — not available for this
                        segment (face-only schemas have no CLIP data).
                    </div>
                )}
                {!neighborsLoading && !neighborsError && currentVector && currentVector.length > 0
                    && neighbors.length === 0 && (
                    <div style={{opacity: 0.7}}>No neighbors found.</div>
                )}

                {neighbors.length > 0 && (
                    <div className="results-grid">
                        {neighbors.map((n) => (
                            <ResultItem
                                key={n.id}
                                id={n.id}
                                kind="video"
                                start={n.start}
                                end={n.end}
                                preload="none"
                                controls={false}
                                mediaClassName="ri-media"
                                getPosterSrc={() => n.thumbUrl ?? ""}
                                getVideoSrc={() => n.url}
                                caption={n.name}
                                onBeforeOpen={() => openNeighbor(n)}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}