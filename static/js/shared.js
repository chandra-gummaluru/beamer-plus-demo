const PointerMode = Object.freeze({
  DRAW: 'DRAW',
  HIGHLIGHT: 'HIGHLIGHT',
  ERASE: 'ERASE'
});

// whether this script is running on a viewer or not
const isViewer = location.pathname.includes('viewer');

// the socket for communication between the presenter and viewer
const socket = io();

let config;

// the PDF file and the current page number
let pdf_url, pdf_file, slide_idx = 0;

// fetch config & PDF
async function loadConfigAndPDF(){
    // fetch the configuration file
    const res = await fetch('/config');
    config  = await res.json();

    for (const key in config.videos) {
      const page_num = parseInt(key);
      let video_items_for_page = config.videos[page_num];

      // convert to array if not already
      if (!Array.isArray(video_items_for_page)) video_items_for_page = [ video_items_for_page ];

      console.log(video_items_for_page)
      video_items[page_num] = video_items_for_page;
    }
    
    // get the PDF URL from the configuration file
    pdf_url  = '/pdf/' + config.pdf;

    // load the PDF using pdfjsLib
    pdf_file = await pdfjsLib.getDocument(pdf_url).promise;
}

video_items = {}

let isErasing=false, isHighlighting=false, brush_size=5, drawing=false;
const strokesMap = {}, annotationCanvas = document.getElementById('annotationCanvas');
let strokes = [], currentStroke = null;
const pdfCanvas = document.getElementById('pdfCanvas'),
      pdfCtx    = pdfCanvas.getContext('2d');
const annotationCtx = annotationCanvas.getContext('2d');
annotationCtx.lineCap  = 'round';
annotationCtx.lineJoin = 'round';
let currentColor = '#34495e';

// resize canvases & DPI
function resizeCanvas(){
  fit4by3(document.getElementById('pdf-container'));
  fit4by3(document.getElementById('viewer-wrapper'));
  const rect=annotationCanvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  [pdfCanvas,annotationCanvas].forEach(c=>{
    c.width=rect.width*dpr; c.height=rect.height*dpr;
    c.style.width=rect.width+'px'; c.style.height=rect.height+'px';
    c.getContext('2d').scale(dpr,dpr);
  });
}

// load strokes for current slide
function loadSlideStrokes(){
  strokes = (strokesMap[slide_idx]||[]).slice();
  currentStroke = null;
}

// drawing helpers
function getPos(e){
  const r=annotationCanvas.getBoundingClientRect();
  const x=(e.touches?e.touches[0].clientX:e.clientX)-r.left;
  const y=(e.touches?e.touches[0].clientY:e.clientY)-r.top;
  return { x:x*(annotationCanvas.width/r.width), y:y*(annotationCanvas.height/r.height) };
}
function redrawAllStrokes(){
  annotationCtx.clearRect(0,0,annotationCanvas.width,annotationCanvas.height);
  const all = currentStroke? strokes.concat(currentStroke) : strokes;
  all.forEach(stroke=>{
    annotationCtx.beginPath();
    stroke.points.forEach((pt,i)=>{
      i? annotationCtx.lineTo(pt.x,pt.y)
        : annotationCtx.moveTo(pt.x,pt.y);
    });
    annotationCtx.lineWidth = stroke.width;
    if(stroke.type===PointerMode.ERASE){
      annotationCtx.globalCompositeOperation='destination-out';
      annotationCtx.globalAlpha=1;
    } else {
      annotationCtx.globalCompositeOperation='source-over';
      annotationCtx.globalAlpha = stroke.type===PointerMode.HIGHLIGHT?0.4:1;
      annotationCtx.strokeStyle = stroke.color;
    }
    annotationCtx.stroke();
  });
  annotationCtx.globalCompositeOperation='source-over';
  annotationCtx.globalAlpha=1;
}
// replay one streamed stroke
function drawSingleStroke(stroke){
  const prevOp=annotationCtx.globalCompositeOperation,
        prevA =annotationCtx.globalAlpha,
        prevS =annotationCtx.strokeStyle,
        prevW =annotationCtx.lineWidth;
  annotationCtx.beginPath();
  stroke.points.forEach((pt,i)=>{
    i? annotationCtx.lineTo(pt.x,pt.y)
      : annotationCtx.moveTo(pt.x,pt.y);
  });
  annotationCtx.lineWidth = stroke.width;
  if(stroke.type==='erase'){
    annotationCtx.globalCompositeOperation='destination-out';
    annotationCtx.globalAlpha=1;
  } else {
    annotationCtx.globalCompositeOperation='source-over';
    annotationCtx.globalAlpha = stroke.type==='highlight'?0.4:1;
    annotationCtx.strokeStyle = stroke.color;
  }
  annotationCtx.stroke();
  annotationCtx.globalCompositeOperation=prevOp;
  annotationCtx.globalAlpha=prevA;
  annotationCtx.strokeStyle=prevS;
  annotationCtx.lineWidth=prevW;
}

// slide render
function renderPage(n){
  pdf_file.getPage(n).then(page=>{
    const vp=page.getViewport({scale:config.scale||1});
    pdfCanvas.width=vp.width; pdfCanvas.height=vp.height;
    annotationCanvas.width=vp.width; annotationCanvas.height=vp.height;
    page.render({canvasContext:pdfCtx,viewport:vp}).promise.then(()=>{
      redrawAllStrokes();
      addVideoOverlays();
    });
  });
}
function showSlide(){
  // load & clear
  strokes = (strokesMap[slide_idx]||[]).slice();
  annotationCtx.clearRect(0,0,annotationCanvas.width,annotationCanvas.height);
  // remove old videos
  document.querySelectorAll('.slide-video').forEach(v=>v.remove());
  // render
  renderPage(config.slides[slide_idx]);
}

function addVideoOverlays(){
    // get the page number
    const page_num = config.slides[slide_idx];
    
    // get the video URLs
    let video_items = config.videos[page_num] || [];
    if (!Array.isArray(video_items)) video_items = [video_items]; // wrap in array if not already


    // get the video wrapper and clear all previous videos
    const wrap = document.getElementById('viewer-wrapper');
    wrap.querySelectorAll('.slide-video').forEach(video => video.remove());
    
    // for each new video, create a video element
    video_items.forEach((video_value, video_index) => {
        // create the video element
        const video = document.createElement('video');
        video.className = 'slide-video';
        console.log(video_value.path)
        video.src = '/videos/' + video_value.path;

        // set the style
        video.disablePictureInPicture = true;
        video.controlsList = 'nodownload nofullscreen noremoteplayback nopicture-in-picture';
        ['left','top','width','height'].forEach(prop => {
        video.style[prop] = video_value[prop] || { left:'0%', top:'0%', width:'100%', height:'100%' }[prop];
        });

        // add the video to the wrapper
        wrap.appendChild(video);

        if (!isViewer) {
        // only the presenter page allows control
        const mode = video_value.mode || 'once';
        video.muted = true;
        if (mode === 'once') {
            video.autoplay = true;
            video.loop     = false;
            video.play().catch(() => {});
        }
        else if (mode === 'loop') {
            video.autoplay = true;
            video.loop     = true;
            video.play().catch(() => {});
        }
        // click‐to‐toggle on main
        video.style.pointerEvents = 'auto';
        video.addEventListener('click', () => {
            if (video.paused) video.play();
            else            video.pause();
        });

        // emit play/pause for syncing
        video.addEventListener('play',  () => socket.emit('video_control',{slide:slide_idx,vidIndex: video_index,action:'play'}));
        video.addEventListener('pause', () => socket.emit('video_control',{slide:slide_idx,vidIndex: video_index,action:'pause'}));
        }
        else {
        // viewer: completely block pointer events
        video.style.pointerEvents = 'none';
        }
        });
  }
  
