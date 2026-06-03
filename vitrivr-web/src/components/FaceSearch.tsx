"use client";
import {useRef, useState} from "react";
import {useSearch} from "../state/SearchContext.tsx";
import {extractAveragedFaceEmbedding} from "../lib/faceSearch.ts";
import Flash from "./QueryBuilderComponents/Flash.tsx";
import "./FaceSearch.css";

export function FaceSearch() {
    const {faceGallery: rawGallery, setFaceGallery} = useSearch();
    const faceGallery = rawGallery ?? {};

    const [regName, setRegName] = useState("");
    const [regFiles, setRegFiles] = useState<File[]>([]);
    const [registering, setRegistering] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [flash, setFlash] = useState<{ show: boolean; message: string; kind: "error" | "info" | "success" }>({
        show: false, message: "", kind: "info",
    });

    const galleryNames = Object.keys(faceGallery).sort();

    function showFlash(message: string, kind: "error" | "info" | "success" = "error") {
        setFlash({show: true, message, kind});
    }

    function removePerson(name: string) {
        setFaceGallery(prev => { const next = {...prev}; delete next[name]; return next; });
    }

    async function onRegister() {
        const name = regName.trim();
        if (!name) { showFlash("Please enter a name."); return; }
        if (regFiles.length === 0) { showFlash("Please choose at least one face image."); return; }
        if (faceGallery[name]) { showFlash(`'${name}' already exists — remove it first or choose a different name.`); return; }

        setRegistering(true);
        setFlash({show: false, message: "", kind: "info"});
        try {
            const emb = await extractAveragedFaceEmbedding(regFiles);
            setFaceGallery(prev => ({...prev, [name]: emb}));
            setRegName("");
            setRegFiles([]);
            if (fileInputRef.current) fileInputRef.current.value = "";
            showFlash(`'${name}' added to gallery.`, "success");
        } catch (err) {
            showFlash(err instanceof Error ? err.message : String(err));
        } finally {
            setRegistering(false);
        }
    }

    return (
        <div className="fs-container">
            <section className="panel">
                <div className="panel__head row-between">
                    <div className="stack-xs">
                        <h3 className="panel__title">Face Gallery</h3>
                        <p className="panel__subtitle">
                            {galleryNames.length} person{galleryNames.length === 1 ? "" : "s"} in gallery
                        </p>
                    </div>
                </div>

                <div className="panel__body stack">
                    {galleryNames.length > 0 && (
                        <div className="stack-xs">
                            <p className="panel__subtitle">✕ remove</p>
                            <div className="fs-chips">
                                {galleryNames.map(name => (
                                    <div key={name} className="fs-chip">
                                        <span className="fs-chip__label">{name}</span>
                                        <button className="fs-chip__btn fs-chip__btn--remove" title="Remove from gallery" onClick={() => removePerson(name)}>✕</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

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
                                {regFiles.length === 0
                                    ? "Choose image(s)…"
                                    : regFiles.length === 1
                                        ? regFiles[0].name
                                        : `${regFiles.length} images selected`}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    style={{display: "none"}}
                                    onChange={e => setRegFiles(e.target.files ? Array.from(e.target.files) : [])}
                                />
                            </label>
                            <button
                                className="btn"
                                onClick={() => void onRegister()}
                                disabled={registering || regFiles.length === 0 || !regName.trim()}
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
                </div>
            </section>
        </div>
    );
}