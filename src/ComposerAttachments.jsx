import { useEffect, useRef, useState } from "react";
import { IconPhoto, IconX } from "@tabler/icons-react";
import { ImageChips } from "./TeamThread.jsx";
import { createThumbnailLoader } from "./attachment-thumbnails.mjs";

function ImageTile({ image, loader, preview, remove, busy }) {
  const element = useRef(null);
  const [source, setSource] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!loader) return;
    let disposed = false;
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      void loader.read(image.id).then((source) => { if (!disposed) setSource(source); }, () => { if (!disposed) setFailed(true); });
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { root: element.current.parentElement, rootMargin: "0px 160px" });
    observer.observe(element.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [image.id, loader]);
  return <div className="composer-image-tile" ref={element} data-attachment-id={image.id}>
    <button className="composer-image-open" type="button" disabled={busy} title={image.name}
      aria-label={"Preview " + image.name} onClick={() => preview(image)}>
      {source ? <img src={source} alt={image.name} draggable={false} />
        : <span className="composer-image-loading" role="status">
          {failed ? <IconPhoto size={22} /> : <span className="deck-spinner" aria-hidden="true" />}
          <small>{failed ? "Click to preview" : "Preparing image…"}</small>
        </span>}
    </button>
    <button className="composer-image-remove icon-button" type="button" disabled={busy} title={"Remove " + image.name}
      aria-label={"Remove " + image.name} onClick={() => remove(image.id)}><IconX size={14} /></button>
  </div>;
}

export function ComposerAttachments({ images = [], pending = [], thumbnail, preview, remove, busy }) {
  const [loader, setLoader] = useState(null);
  useEffect(() => {
    const current = createThumbnailLoader(thumbnail);
    setLoader(current);
    return () => current.dispose();
  }, [thumbnail]);
  const photos = images.filter((image) => image.kind !== "text");
  const documents = images.filter((image) => image.kind === "text");
  if (!images.length && !pending.length) return null;
  return <div className="composer-attachments" aria-label="Draft attachments">
    {(photos.length > 0 || pending.length > 0) && <div className="composer-image-row" aria-label="Image attachments">
      {photos.map((image) => <ImageTile key={image.id} image={image} loader={loader} preview={preview} remove={remove} busy={busy} />)}
      {pending.map((name, index) => <div className="composer-image-tile composer-image-pending" key={index} role="status">
        <span className="deck-spinner" aria-hidden="true" /><small>Adding {name}…</small>
      </div>)}
    </div>}
    <ImageChips images={documents} preview={preview} remove={remove} busy={busy} />
  </div>;
}
