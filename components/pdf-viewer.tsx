import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Download, Minus, Plus, X} from 'lucide-react';

// In-app PDF viewer: on iPhone a PDF opened from the home-screen app has no way back.
export function PdfViewer({url, onClose}:{url:string; onClose:()=>void}) {
  const pages = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = import.meta.env.BASE_URL;
        const pdfjs = await import(/* @vite-ignore */ base + 'vendor/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = base + 'vendor/pdf.worker.mjs';
        const data = await (await fetch(url)).arrayBuffer();
        const doc = await pdfjs.getDocument({data, isEvalSupported:false}).promise;
        const box = pages.current!; box.replaceChildren();
        const width = box.clientWidth;
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          const page = await doc.getPage(n), base1 = page.getViewport({scale:1});
          // Rendered sharp enough for 3× zoom on a retina screen.
          const scale = Math.min(4, width/base1.width*Math.min(3, devicePixelRatio)*1.6);
          const view = page.getViewport({scale});
          const canvas = document.createElement('canvas'); canvas.width = view.width; canvas.height = view.height;
          canvas.setAttribute('aria-label', `Страница ${n}`);
          box.appendChild(canvas);
          await page.render({canvasContext:canvas.getContext('2d')!, viewport:view}).promise;
          setLoading(false);
        }
      } catch { if (!cancelled) setError('Не удалось открыть PDF. Попробуй обновить расписание при интернете.'); }
    })();
    const onKey = (e:KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => { cancelled = true; removeEventListener('keydown', onKey); };
  }, [url, onClose]);
  // Rendered into <body> so no page styles can move it.
  return createPortal(<div className="pdf-viewer" role="dialog" aria-label="PDF расписания">
    <div className="pdf-bar">
      <button className="pdf-close" onClick={onClose}><X size={18}/>Закрыть</button>
      <div className="pdf-actions">
        <button aria-label="Уменьшить" onClick={()=>setZoom(z=>Math.max(1, z-0.5))}><Minus size={17}/></button>
        <button aria-label="Увеличить" onClick={()=>setZoom(z=>Math.min(3, z+0.5))}><Plus size={17}/></button>
        <a aria-label="Скачать PDF" href={url} download="raspisanie-vmk.pdf"><Download size={17}/></a>
      </div>
    </div>
    <div className="pdf-scroll">
      {loading && !error && <p className="pdf-status">Открываем PDF…</p>}
      {error && <p className="pdf-status">{error}</p>}
      <div className="pdf-pages" ref={pages} style={{width:`${zoom*100}%`}}/>
    </div>
  </div>, document.body);
}
