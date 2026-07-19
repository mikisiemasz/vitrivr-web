import React, {useEffect, useRef, useState} from "react";
import {Link} from "react-router-dom";
import {thumbnailUrl} from "../../lib/vitrivr";
import {useSearch} from "../../state/SearchContext.tsx";
import {submitText, submitVideo} from "../../dres/generated/api/dresSubmit.ts";
import {useAuth} from "../../state/AuthContext.tsx";
import {getCurrentSubmissionKind, type SubmissionKind} from "../../dres/generated/api/taskTypeHelper.ts";

type BaseProps = {
    id: string,
    caption?: React.ReactNode,
    className?: string,
    captionClassName?: string,
    onBeforeOpen?: () => void,
    getVideoSrc?: () => string | undefined
};
type ImageProps = {
    kind?: "image";
    getImageSrc?: (id: string) => string;
    alt?: string;
    mediaClassName?: string;
};
type VideoProps = {
    kind: "video";
    start: number;
    end: number;
    getVideoSrc: (id: string) => string;
    getPosterSrc?: (id: string) => string;
    controls?: boolean;
    autoPlay?: boolean;
    loop?: boolean;
    muted?: boolean;
    preload?: "none" | "metadata" | "auto";
    mediaClassName?: string;
};
type CustomProps = { kind: "custom"; renderMedia: (id: string) => React.ReactNode };
type ResultItemProps = BaseProps & (ImageProps | VideoProps | CustomProps);

export default function ResultItem(props: ResultItemProps) {
    const {schema} = useSearch();
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const {
        id,
        caption = id,
        className = "sb__card",
        captionClassName = "sb__caption",
    } = props;
    const [submitting, setSubmitting] = useState(false);
    const {session, openLogin} = useAuth();
    const {evaluationId} = useAuth();
    const [kind, setKind] = useState<SubmissionKind>("unknown");
    const [textAnswer, setTextAnswer] = useState("");
    const [hovered, setHovered] = useState(false);
    let media: React.ReactNode;

    if (props.kind === "video") {
        const {
            start,
            getVideoSrc,
            getPosterSrc,
            controls = true,
            autoPlay = false,
            loop = false,
            muted = false,
            preload = "metadata",
            mediaClassName = "sb__video",
        } = props;

        const src = getVideoSrc(id);
        const poster = (getPosterSrc ?? thumbnailUrl)(schema, id);

        const handleLoadedMetadata = () => {
            if (videoRef.current && start != null) {
                videoRef.current.currentTime = start;
            }
        };


        media = (
            <video
                ref={videoRef}
                className={mediaClassName}
                src={src}
                poster={poster}
                controls={controls}
                autoPlay={autoPlay}
                loop={loop}
                muted={muted}
                preload={preload}
                onLoadedMetadata={handleLoadedMetadata}
            />
        );
    } else if (props.kind === "custom") {
        media = props.renderMedia(id);
    } else {
        const {getImageSrc, alt = `Image for ${id}`, mediaClassName = "sb__image"} = props;
        const src = (getImageSrc ?? thumbnailUrl)(schema, id);
        media = <img className={mediaClassName} src={src} alt={alt}/>;
    }

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

    const onSubmit = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!session) {
            openLogin();
            return;
        }

        if (!evaluationId) {
            openLogin();
            return;
        }

        if (props.kind !== "video") return;

        const kind = await getCurrentSubmissionKind({session, evaluationId});
        console.log("kind" + kind)

        if (kind === "text") {
            const text = textAnswer.trim();
            if (!text) {
                alert("Please enter a text answer.");
                return;
            }

            setSubmitting(true);
            try {
                const res = await submitText({
                    session,
                    evaluationId,
                    text,
                });
                alert("Submitted! " + JSON.stringify(res.data.submission));
                console.log("Submitted text", text)
                console.log("DRES submitText response:", res);
                setTextAnswer("");
            } catch (err: any) {
                alert(err?.response?.data?.description ?? err?.message ?? "Submit failed.");
            } finally {
                setSubmitting(false);
            }
            return;
        }

        if (kind === "item") {
            setSubmitting(true);
            const start = Math.max(0, Math.round(props.start * 1000));
            const end = Math.max(0, Math.round(props.end * 1000));
            const splitLen = props.getVideoSrc(props.id).split("/").length
            const videoName = props.getVideoSrc(id).split("/")[splitLen - 1].split(".")[0]
            console.log("Submission", videoName, end, start)
            setSubmitting(true);
            try {
                const res = await submitVideo({
                    session,
                    mediaItemName: videoName,
                    evaluationId,
                    start: start > 0 ? Math.round(start) : undefined,
                    end: end > 0 ? Math.round(end) : undefined,
                });
                alert("Submitted! " + JSON.stringify(res.data.submission));
                console.log("DRES submitText response:", res);
            } catch (err: any) {
                alert(err?.response?.data?.description ?? err?.message ?? "Submit failed.");
            } finally {
                setSubmitting(false);
            }
        }
    }

    const linkState =
        props.kind === "video"
            ? {
                src: (props as any).getVideoSrc?.(id),
                poster: thumbnailUrl(schema, id),
                start: (props as any).start,
                end: (props as any).end,
                name: typeof caption === "string" ? caption : undefined,
            }
            : undefined;

    return (
        <div
            className="ri-wrap"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {props.kind === "video" && hovered && kind === "text" && (
                <div
                    className="ri-floatText"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                >
                    <input
                        value={textAnswer}
                        onChange={(e) => setTextAnswer(e.target.value)}
                        placeholder="Type answer (DRES)…"
                        className="ri-textInput"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") onSubmit(e as any);
                        }}
                    />
                </div>
            )}

            <figure className={className} style={{position: "relative"}}>
                <Link
                    to={`/video/${encodeURIComponent(id)}`}
                    state={linkState}
                    onClick={() => props.onBeforeOpen?.()}
                    style={{textDecoration: "none", color: "inherit", display: "block"}}
                >
                    {media}
                    <figcaption className={captionClassName}>{caption}</figcaption>
                </Link>

                {props.kind === "video" && (
                    <button
                        type="button"
                        onClick={onSubmit}
                        disabled={submitting}
                        className="ri-submitBtn"
                    >
                        {submitting ? "Submitting…" : "Submit"}
                    </button>
                )}
            </figure>
        </div>
    );
}
