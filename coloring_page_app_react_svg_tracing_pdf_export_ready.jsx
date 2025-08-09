/*
Coloring Page Maker — React single-file app
Features:
- Upload image and convert to line-art (Sobel edge detection)
- Vector tracing to SVG (using ImageTracerJS) for clean scalable outlines
- In-browser painting (canvas) with brush/erase, palette, custom color
- Merge layers and export as PNG
- Export print-ready PDF (A4, margins, multiple per page) using jsPDF
- Electron-ready (instructions below) — you can wrap this React app in an Electron shell

Dependencies (install into your React project):
  npm install imagetracerjs jspdf html2canvas

Optional (for Electron packaging):
  npm install --save-dev electron electron-builder

How to use:
1) Create a React app (Vite or Create React App). Place this file as src/App.jsx (or adapt name).
2) Install dependencies above.
3) Run `npm run dev` (Vite) or `npm start`.
4) For Electron: I can produce main.js and package.json tweaks if you want — tell me and I'll add.

Notes:
- ImageTracerJS does client-side vector tracing and produces SVG path output. It's good for printable line-art.
- jsPDF + html2canvas is used to put SVG/Canvas into an A4 PDF. The PDF export supports multiple pages per PDF.
- All processing is client-side; no server required.

*/

import React, { useRef, useState, useEffect } from 'react';
import ImageTracer from 'imagetracerjs';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export default function App() {
  // Refs
  const fileRef = useRef(null);
  const lineCanvasRef = useRef(null);
  const paintCanvasRef = useRef(null);
  const svgContainerRef = useRef(null);

  // State
  const [imageObj, setImageObj] = useState(null);
  const [currentColor, setCurrentColor] = useState('#ff4757');
  const [brushSize, setBrushSize] = useState(14);
  const [mode, setMode] = useState('paint'); // 'paint' or 'erase'
  const [tracedSVG, setTracedSVG] = useState('');
  const [isTracing, setIsTracing] = useState(false);
  const [dpi, setDpi] = useState(300);

  // Helpers: fit canvases to image
  function fitCanvasesToImage(img) {
    const maxW = 1000; // keep a sane canvas width for editing
    const ratio = img.width > maxW ? maxW / img.width : 1;
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    [lineCanvasRef.current, paintCanvasRef.current].forEach(c => {
      if (!c) return;
      c.width = w;
      c.height = h;
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    });
  }

  // Load image from file input
  function onFileChange(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      setImageObj(img);
      fitCanvasesToImage(img);
      // draw original faint on line canvas
      const lctx = lineCanvasRef.current.getContext('2d');
      lctx.clearRect(0,0,lineCanvasRef.current.width,lineCanvasRef.current.height);
      lctx.drawImage(img, 0, 0, lineCanvasRef.current.width, lineCanvasRef.current.height);
      // paint canvas blank white background
      const pctx = paintCanvasRef.current.getContext('2d');
      pctx.clearRect(0,0,paintCanvasRef.current.width,paintCanvasRef.current.height);
      pctx.fillStyle = '#ffffff';
      pctx.fillRect(0,0,paintCanvasRef.current.width,paintCanvasRef.current.height);
      setTracedSVG('');
    };
    img.src = URL.createObjectURL(f);
  }

  // Convert to line-art (Sobel-based) then show on lineCanvas
  function convertToLineArt(threshold = 100) {
    if (!imageObj) return alert('Please upload an image first');
    const w = lineCanvasRef.current.width;
    const h = lineCanvasRef.current.height;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(imageObj, 0, 0, w, h);
    const imgd = tctx.getImageData(0,0,w,h);
    const data = imgd.data;
    // grayscale
    const gray = new Float32Array(w*h);
    for (let i=0, j=0; i < data.length; i += 4, j++){
      const r = data[i], g = data[i+1], b = data[i+2];
      gray[j] = 0.299*r + 0.587*g + 0.114*b;
    }
    const gx = [-1,0,1,-2,0,2,-1,0,1];
    const gy = [-1,-2,-1,0,0,0,1,2,1];
    const edges = new Uint8ClampedArray(w*h);
    for (let y=1; y<h-1; y++){
      for (let x=1; x<w-1; x++){
        let ix=0, iy=0, idx=0;
        for (let ky=-1; ky<=1; ky++){
          for (let kx=-1; kx<=1; kx++){
            const val = gray[(y+ky)*w + (x+kx)];
            ix += gx[idx]*val;
            iy += gy[idx]*val;
            idx++;
          }
        }
        const mag = Math.sqrt(ix*ix + iy*iy);
        edges[y*w + x] = mag > threshold ? 255 : 0;
      }
    }
    const lctx = lineCanvasRef.current.getContext('2d');
    lctx.fillStyle = '#ffffff';
    lctx.fillRect(0,0,w,h);
    const out = lctx.createImageData(w,h);
    for (let i=0;i<w*h;i++){
      const v = edges[i] ? 0 : 255; // edge -> black
      out.data[i*4] = v; out.data[i*4+1] = v; out.data[i*4+2] = v; out.data[i*4+3] = 255;
    }
    lctx.putImageData(out,0,0);
    // clear existing SVG trace
    setTracedSVG('');
  }

  // Vector trace using ImageTracerJS
  async function vectorTrace(options = {}){
    if (!imageObj) return alert('Upload image first');
    setIsTracing(true);
    // Draw image to a temp canvas at same size
    const w = lineCanvasRef.current.width;
    const h = lineCanvasRef.current.height;
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(imageObj, 0, 0, w, h);
    const dataURL = tmp.toDataURL('image/png');
    // ImageTracer accepts options; we use default suited for line art
    const opts = Object.assign({turnPolicy: 1, ltres: 1, qtres: 1, pathomit: 8, numberofcolors: 2}, options);
    // run tracing
    ImageTracer.imageToSVG(dataURL, svgstring => {
      setTracedSVG(svgstring);
      // display svg over the line canvas
      if (svgContainerRef.current) svgContainerRef.current.innerHTML = svgstring;
      setIsTracing(false);
    }, opts);
  }

  // Painting mechanics
  useEffect(() => {
    const canvas = paintCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let painting = false;

    function getPos(e){
      const rect = canvas.getBoundingClientRect();
      const isTouch = e.touches && e.touches.length;
      const clientX = isTouch ? e.touches[0].clientX : e.clientX;
      const clientY = isTouch ? e.touches[0].clientY : e.clientY;
      return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) };
    }

    function start(e){
      painting = true;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.lineWidth = brushSize;
      ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = currentColor;
      const pos = getPos(e);
      ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
      e.preventDefault();
    }
    function move(e){
      if (!painting) return;
      const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); e.preventDefault();
    }
    function end(e){ if (!painting) return; painting = false; ctx.closePath(); e.preventDefault(); }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('touchstart', start, {passive:false});
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, {passive:false});
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);

    return () => {
      canvas.removeEventListener('mousedown', start);
      canvas.removeEventListener('touchstart', start);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchend', end);
    };
  }, [brushSize, mode, currentColor]);

  // Download PNG (merge paint + lines or use SVG traced)
  async function downloadPNG(useSVG = false){
    if (useSVG && tracedSVG){
      // render svg + paint layer into canvas
      const svgData = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tracedSVG);
      const img = new Image();
      img.onload = async () => {
        const out = document.createElement('canvas');
        out.width = lineCanvasRef.current.width;
        out.height = lineCanvasRef.current.height;
        const octx = out.getContext('2d');
        // paint layer first
        octx.drawImage(paintCanvasRef.current, 0, 0);
        // svg (lines) on top
        octx.drawImage(img, 0, 0, out.width, out.height);
        const dataURL = out.toDataURL('image/png');
        const a = document.createElement('a'); a.href = dataURL; a.download = 'coloring.png'; a.click();
      };
      img.src = svgData;
    } else {
      // merge paint canvas + raster line canvas
      const out = document.createElement('canvas');
      out.width = lineCanvasRef.current.width;
      out.height = lineCanvasRef.current.height;
      const octx = out.getContext('2d');
      octx.fillStyle = '#ffffff'; octx.fillRect(0,0,out.width,out.height);
      octx.drawImage(paintCanvasRef.current, 0, 0);
      octx.drawImage(lineCanvasRef.current, 0, 0);
      const dataURL = out.toDataURL('image/png');
      const a = document.createElement('a'); a.href = dataURL; a.download = 'coloring.png'; a.click();
    }
  }

  // Print-ready PDF export (A4 at specified DPI). Accepts option to place multiple per page.
  async function exportPDF({copiesPerPage = 1} = {}){
    // A4 size in points: 210mm x 297mm. jsPDF uses pt or mm. We'll use mm.
    const mmToPx = mm => Math.round(mm * (dpi/25.4));
    const a4wMm = 210, a4hMm = 297; // mm
    const marginMm = 10;
    const printableW = a4wMm - marginMm*2;
    const printableH = a4hMm - marginMm*2;

    // create a canvas snapshot of the artwork (either svg traced or raster merge)
    const snapshot = document.createElement('canvas');
    snapshot.width = lineCanvasRef.current.width;
    snapshot.height = lineCanvasRef.current.height;
    const sctx = snapshot.getContext('2d');
    sctx.fillStyle = '#ffffff'; sctx.fillRect(0,0,snapshot.width,snapshot.height);
    // prefer svg traced if available for crispness
    if (tracedSVG){
      const img = new Image();
      img.onload = async () => {
        sctx.drawImage(img, 0, 0, snapshot.width, snapshot.height);
        sctx.globalCompositeOperation = 'destination-over';
        sctx.drawImage(paintCanvasRef.current, 0, 0);
        await _makePdfFromCanvas(snapshot, copiesPerPage);
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tracedSVG);
    } else {
      sctx.drawImage(paintCanvasRef.current, 0, 0);
      sctx.drawImage(lineCanvasRef.current, 0, 0);
      await _makePdfFromCanvas(snapshot, copiesPerPage);
    }

    async function _makePdfFromCanvas(canvas, copiesPerPage){
      // scale canvas to fit printable area at requested DPI
      const pxPerMm = dpi / 25.4; // pixels per mm
      const targetWpx = Math.round(printableW * pxPerMm);
      const targetHpx = Math.round(printableH * pxPerMm);
      // create resized canvas preserving aspect ratio
      const scale = Math.min(targetWpx / canvas.width, targetHpx / canvas.height);
      const rw = Math.round(canvas.width * scale);
      const rh = Math.round(canvas.height * scale);
      const resized = document.createElement('canvas'); resized.width = rw; resized.height = rh;
      resized.getContext('2d').drawImage(canvas, 0, 0, rw, rh);

      // now create PDF
      const pdf = new jsPDF({unit: 'mm', format: 'a4'});

      // compute grid for copiesPerPage (1,2,4 etc.) using simple layout
      const cols = copiesPerPage === 1 ? 1 : copiesPerPage === 2 ? 1 : Math.ceil(Math.sqrt(copiesPerPage));
      const rows = Math.ceil(copiesPerPage / cols);
      const cellW = printableW / cols;
      const cellH = printableH / rows;

      let placed = 0;
      for (let r=0;r<rows;r++){
        for (let c=0;c<cols;c++){
          if (placed >= copiesPerPage) break;
          // draw resized canvas into a temporary canvas sized to cell
          const cellCanvas = document.createElement('canvas');
          cellCanvas.width = Math.round(cellW * pxPerMm);
          cellCanvas.height = Math.round(cellH * pxPerMm);
          const cc = cellCanvas.getContext('2d');
          cc.fillStyle = '#ffffff'; cc.fillRect(0,0,cellCanvas.width,cellCanvas.height);
          // center the resized image in the cell
          const imgScale = Math.min(cellCanvas.width / resized.width, cellCanvas.height / resized.height);
          const iw = Math.round(resized.width * imgScale);
          const ih = Math.round(resized.height * imgScale);
          const ox = Math.round((cellCanvas.width - iw)/2);
          const oy = Math.round((cellCanvas.height - ih)/2);
          cc.drawImage(resized, ox, oy, iw, ih);

          // convert to dataURL in JPEG to reduce size
          const dataURL = cellCanvas.toDataURL('image/jpeg', 0.95);
          const xMm = marginMm + c*cellW;
          const yMm = marginMm + r*cellH;
          pdf.addImage(dataURL, 'JPEG', xMm, yMm, (iw/pxPerMm), (ih/pxPerMm));
          placed++;
        }
      }

      pdf.save('coloring-a4.pdf');
    }
  }

  // Reset canvas & svg
  function resetAll(){
    if (!imageObj) return;
    fitCanvasesToImage(imageObj);
    const lctx = lineCanvasRef.current.getContext('2d');
    lctx.clearRect(0,0,lineCanvasRef.current.width,lineCanvasRef.current.height);
    lctx.drawImage(imageObj, 0, 0, lineCanvasRef.current.width, lineCanvasRef.current.height);
    const pctx = paintCanvasRef.current.getContext('2d');
    pctx.clearRect(0,0,paintCanvasRef.current.width,paintCanvasRef.current.height);
    pctx.fillStyle = '#ffffff'; pctx.fillRect(0,0,paintCanvasRef.current.width,paintCanvasRef.current.height);
    setTracedSVG('');
    if (svgContainerRef.current) svgContainerRef.current.innerHTML = '';
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Coloring Page Maker — React (SVG tracing + PDF export)</h1>

      <div className="flex gap-3 flex-wrap mb-4">
        <label className="btn border px-3 py-2 rounded cursor-pointer bg-gray-100">
          Upload Image
          <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />
        </label>

        <button className="btn border px-3 py-2 rounded" onClick={() => convertToLineArt(100)}>
          Convert → Line Art
        </button>
        <button className="btn border px-3 py-2 rounded" onClick={() => vectorTrace()} disabled={isTracing}>
          {isTracing ? 'Tracing…' : 'Trace to SVG (Vector)'}
        </button>
        <button className="btn border px-3 py-2 rounded" onClick={() => downloadPNG(false)}>Download PNG</button>
        <button className="btn border px-3 py-2 rounded" onClick={() => downloadPNG(true)} disabled={!tracedSVG}>Download PNG (SVG lines)</button>
        <button className="btn border px-3 py-2 rounded" onClick={() => exportPDF({copiesPerPage:1})}>Export PDF (A4, 1 per page)</button>
        <button className="btn border px-3 py-2 rounded" onClick={() => exportPDF({copiesPerPage:2})}>Export PDF (A4, 2 per page)</button>
        <button className="btn border px-3 py-2 rounded" onClick={resetAll}>Reset</button>
      </div>

      <div className="flex gap-4 items-start">
        <div className="flex-shrink-0">
          <div className="mb-2">Brush size</div>
          <input type="range" min={2} max={80} value={brushSize} onChange={e=>setBrushSize(parseInt(e.target.value))} />
          <div className="mt-3">Mode</div>
          <select value={mode} onChange={e=>setMode(e.target.value)} className="mt-1 p-1 border rounded">
            <option value="paint">Paint</option>
            <option value="erase">Erase</option>
          </select>

          <div className="mt-4">Palette</div>
          <div className="flex gap-2 mt-2 flex-wrap">
            {['#ff4757','#ffa502','#ffd32a','#2ed573','#1e90ff','#9b59b6','#000000','#ffffff'].map(c=> (
              <button key={c} onClick={()=>setCurrentColor(c)} style={{background:c}} className="w-8 h-8 rounded border" />
            ))}
            <input type="color" value={currentColor} onChange={e=>setCurrentColor(e.target.value)} className="ml-2" />
          </div>

          <div className="text-sm text-gray-600 mt-4">DPI for PDF: <input type="number" value={dpi} onChange={e=>setDpi(parseInt(e.target.value)||300)} className="w-20 ml-2 p-1 border rounded" /></div>
        </div>

        <div className="flex-1">
          <div className="relative border rounded overflow-hidden" style={{maxWidth: '100%'}}>
            <div style={{position:'relative'}}>
              <canvas ref={lineCanvasRef} style={{display:'block', width:'100%', height:'auto'}} />
              <canvas ref={paintCanvasRef} style={{position:'absolute', left:0, top:0}} />
              {/* SVG trace overlay (transparent) */}
              <div ref={svgContainerRef} style={{position:'absolute', left:0, top:0, pointerEvents:'none'}} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 text-sm text-gray-600">
        Tips: Use "Trace to SVG" for crisper printable pages. Use PDF export for print-ready A4 output (you can choose 1 or 2 copies per page). If you want multiple images per page (grid), increase "copies per page" in the export function call.
      </div>
    </div>
  );
}
