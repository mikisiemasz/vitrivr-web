"use client";
import {useRef, useState} from "react";
import {useSearch} from "../state/SearchContext.tsx";
import {
    extractFaceEmbedding,
    faceMapToMediaItems,
    intersectMaps,
    queryFaceVector,
    subtractMaps,
    type FaceMediaItem,
} from "../lib/faceSearch.ts";
import ResultItem from "./Results/ResultItem.tsx";
import Flash from "./QueryBuilderComponents/Flash.tsx";
import "./FaceSearch.css";

const FACE_LIMIT = 500;
const PAGE_SIZE = 100;

export function FaceSearch() {
const {schema, faceGallery: rawGallery, setFaceGallery, setItems} = useSearch();    const faceGallery = rawGallery ?? {};

    const [included, setIncluded] = useState<Set<string>>(new Set());
    const [excluded, setExcluded] = useState<Set<string>>(new Set());

    const [regName, setRegName] = useState("");
    const [regFile, setRegFile] = useState<File | null>(null);
    const [registering, setRegistering] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<FaceMediaItem[]>([]);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [flash, setFlash] = useState<{ show: boolean; message: string; kind: "error" | "info" | "success" }>({
        show: false, message: "", kind: "info",
    });

    const galleryNames = Object.keys(faceGallery ?? {}).sort();

    function showFlash(message: string, kind: "error" | "info" | "success" = "error") {
        setFlash({show: true, message, kind});
    }

    function toggleInclude(name: string) {
        setIncluded(prev => {
            const next = new Set(prev);
            next.has(name) ? next.delete(name) : next.add(name);
            return next;
        });
        setExcluded(prev => { const next = new Set(prev); next.delete(name); return next; });
    }

    function toggleExclude(name: string) {
        setExcluded(prev => {
            const next = new Set(prev);
            next.has(name) ? next.delete(name) : next.add(name);
            return next;
        });
        setIncluded(prev => { const next = new Set(prev); next.delete(name); return next; });
    }

    function removePerson(name: string) {
        setFaceGallery(prev => { const next = {...prev}; delete next[name]; return next; });
        setIncluded(prev => { const next = new Set(prev); next.delete(name); return next; });
        setExcluded(prev => { const next = new Set(prev); next.delete(name); return next; });
    }

    async function onRegister() {
        const name = regName.trim();
        if (!name) { showFlash("Please enter a name."); return; }
        if (!regFile) { showFlash("Please choose a face image."); return; }
        if (faceGallery[name]) { showFlash(`'${name}' already exists — remove it first or choose a different name.`); return; }

        setRegistering(true);
        setFlash({show: false, message: "", kind: "info"});
        try {
            const emb = await extractFaceEmbedding(regFile);
            setFaceGallery(prev => ({...prev, [name]: emb}));
            setRegName("");
            setRegFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
            showFlash(`'${name}' added to gallery.`, "success");
        } catch (err) {
            showFlash(err instanceof Error ? err.message : String(err));
        } finally {
            setRegistering(false);
        }
    }

    async function onSearch() {
        if (included.size === 0) { showFlash("Select at least one person to include."); return; }

        setLoading(true);
        setResults([]);
        setVisibleCount(PAGE_SIZE);
        setFlash({show: false, message: "", kind: "info"});

        try {
            const includeNames = [...included];
            const excludeNames = [...excluded];

            const [includeMaps, excludeMaps] = await Promise.all([
                Promise.all(includeNames.map(n => queryFaceVector(faceGallery[n], schema, FACE_LIMIT))),
                Promise.all(excludeNames.map(n => queryFaceVector(faceGallery[n], schema, FACE_LIMIT))),
            ]);

            const intersected = intersectMaps(includeMaps);
            const final = subtractMaps(intersected, excludeMaps);
            const items = faceMapToMediaItems(schema, final);

            if (items.length === 0) showFlash("No results found.", "info");
            setResults(items);
        } catch (err) {
            showFlash(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fs-container">
            <section className="panel">
                <div className="panel__head row-between">
                    <div className="stack-xs">
                        <h3 className="panel__title">Face Search</h3>
                        <p className="panel__subtitle">
                            {galleryNames.length} person{galleryNames.length === 1 ? "" : "s"} in gallery
                        </p>
                    </div>
                </div>

                <div className="panel__body stack">
                    {/* Person chips */}
                    {galleryNames.length > 0 && (
                        <div className="stack-xs">
                            <p className="panel__subtitle">+ include &nbsp;·&nbsp; − exclude &nbsp;·&nbsp; ✕ remove</p>
                            <div className="fs-chips">
                                {galleryNames.map(name => {
                                    const inc = included.has(name);
                                    const exc = excluded.has(name);
                                    return (
                                        <div key={name} className={`fs-chip${inc ? " fs-chip--include" : ""}${exc ? " fs-chip--exclude" : ""}`}>
                                            <span className="fs-chip__label">{name}</span>
                                            <button className="fs-chip__btn" title="Include" onClick={() => toggleInclude(name)}>+</button>
                                            <button className="fs-chip__btn" title="Exclude" onClick={() => toggleExclude(name)}>−</button>
                                            <button className="fs-chip__btn fs-chip__btn--remove" title="Remove from gallery" onClick={() => removePerson(name)}>✕</button>
                                        </div>
                                    );
                                })}
                            </div>
                            {(included.size > 0 || excluded.size > 0) && (
                                <p className="panel__subtitle">
                                    {included.size > 0 && <><strong>Include:</strong> {[...included].join(", ")}</>}
                                    {included.size > 0 && excluded.size > 0 && " · "}
                                    {excluded.size > 0 && <><strong>Exclude:</strong> {[...excluded].join(", ")}</>}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Register new face */}
                    <div className="fs-register">
                        <p className="panel__subtitle" style={{marginBottom: 6}}>Register new face</p>
                        <div className="row" style={{flexWrap: "wrap"}}>
                            <input
                                className="fs-input"
                                type="text"
                                placeholder="Name"
                                value={regName}
                                onChange={e => setRegName(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") void onRegister(); }}
                            />
                            <label className="btn fs-file-label">
                                {regFile ? regFile.name : "Choose image…"}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    style={{display: "none"}}
                                    onChange={e => setRegFile(e.target.files?.[0] ?? null)}
                                />
                            </label>
                            <button
                                className="btn"
                                onClick={() => void onRegister()}
                                disabled={registering || !regFile || !regName.trim()}
                            >
                                {registering ? "Extracting…" : "Add to gallery"}
                            </button>
                        </div>
                    </div>

                    <Flash
                        show={flash.show}
                        kind={flash.kind}
                        onClose={() => setFlash(prev => ({...prev, show: false}))}
                    >
                        {flash.message}
                    </Flash>

                    <div className="row-between">
                        <button
                            className="btn btn-primary"
                            disabled={loading || included.size === 0}
                            onClick={() => void onSearch()}
                        >
                            {loading ? "Searching…" : "Search Faces"}
                        </button>
                        {results.length > 0 && (
                            <span className="muted" style={{fontSize: 12}}>
                                {results.length} result{results.length === 1 ? "" : "s"}
                            </span>
                        )}
                    </div>
                </div>
            </section>

            {results.length > 0 && (
                <section className="panel">
                    <div className="panel__head">
                        <h3 className="panel__title">Face Results</h3>
                    </div>
                    <div className="panel__body stack">
                        <div className="results-grid sc-resultsGrid">
                            {results.slice(0, visibleCount).map(item => (
                            <ResultItem
                                key={item.id}
                                id={item.id}
                                kind="video"
                                start={item.start}
                                end={item.end}
                                preload="none"
                                controls={false}
                                mediaClassName="ri-media"
                                getPosterSrc={() => item.thumbUrl}
                                getVideoSrc={() => item.url}
                                caption={item.name}
                                onBeforeOpen={() => {
                                    setItems(prev =>
                                        prev.some(x => x.id === item.id) ? prev : [...prev, {
                                            id: item.id,
                                            kind: "video" as const,
                                            url: item.url,
                                            thumbUrl: item.thumbUrl,
                                            name: item.name,
                                            start: item.start,
                                            end: item.end,
                                        }]
                                    );
                                }}
                            />
                            ))}
                        </div>
                        {results.length > visibleCount && (
                            <div className="row" style={{justifyContent: "center"}}>
                                <button className="btn" onClick={() => setVisibleCount(v => v + PAGE_SIZE)}>
                                    Show more
                                </button>
                            </div>
                        )}
                    </div>
                </section>
            )}
        </div>
    );
}