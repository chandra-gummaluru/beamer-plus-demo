// the current mode of the pointer
let pointer_mode = PointerMode.DRAW

/* Timer */

// the current timer value (in seconds)
let timer_value   = 0;
let timer_interval  = null;
// whether the timer is running or not
let timer_running   = false;

const timer_display = document.getElementById('timer_display');

function update_timer_display() {
  const minutes = Math.floor(timer_value / 60);
  const seconds = timer_value % 60;
  timer_display.textContent = String(minutes).padStart(2,'0') + ':' + String(seconds).padStart(2,'0');
}

function tick() {
  timer_value++;
  update_timer_display();
}
 
timer_display.addEventListener('click', () => {
  if (!timer_running) {
    // set timer_tick to trigger every 1000 milliseconds
    timer_interval = setInterval(tick, 1000);
    timer_running  = true;
    timer_display.classList.add('timer_running');
  } else {
    // set timer_tick to no longer trigger
    clearInterval(timer_interval);
    timer_running  = false;
    timer_display.classList.remove('timer_running');
  }
});

addHoldListener(
  timer_display,
  () => {
    clearInterval(timer_interval);
    timer_value  = 0;
    timer_running  = false;
    update_timer_display();
    timer_display.classList.remove('timer_running');
  },
  800,  // require an 800ms hold
  () => {
    // optional release callback
    timer_display.click();
  }
);


update_timer_display();


function initialize() {
  pointer_mode = PointerMode.PAN
}

/* Controls */

/* Next and Previous Slide Buttons */
document.getElementById('prev-slide').onclick =
  () => updateSlide(-1);
document.getElementById('next-slide').onclick =
  () => updateSlide(1);

function updateSlide(direction){
  strokesMap[slide_idx] = strokes.slice();
  const new_slide_idx = slide_idx + direction;
  
  if(new_slide_idx < 0 || new_slide_idx >= config.slides.length) return;

  slide_idx = new_slide_idx;
  showSlide();

  // broadcast that the slide was updated
  // with the new slide index
  data = {index: slide_idx}
  socket.emit('update_slide', data);
}

/* Pointer Tools */
document.getElementById('pen-tool').onclick =
  () => { set_pointer(PointerMode.DRAW);  };
document.getElementById('highlight-tool').onclick =
  () => { set_pointer(PointerMode.HIGHLIGHT); };
document.getElementById('eraser-tool').onclick =
  () => { set_pointer(PointerMode.ERASE); };
document.getElementById('clear-annotations').onclick =
  () => clear_annotations();
document.getElementById('brush_size_increase').onclick =
  () => update_brush_size(+1);
document.getElementById('brush_size_decrease').onclick =
  () => update_brush_size(-1);

function set_pointer(new_pointer_mode) {
  pointer_mode = new_pointer_mode;

  const pen_tool = document.getElementById('pen-tool');
  const eraser_tool = document.getElementById('eraser-tool');
  const highlight_tool = document.getElementById('highlight-tool');

  if (pointer_mode === PointerMode.DRAW) {
    pen_tool.className = 'control_panel_btn_selected';
    eraser_tool.className = 'control_panel_btn';
    highlight_tool.className = 'control_panel_btn';
  }

  if (pointer_mode === PointerMode.HIGHLIGHT) {
    highlight_tool.className = 'control_panel_btn_selected';
    eraser_tool.className = 'control_panel_btn';
    pen_tool.className = 'control_panel_btn';
  }

  if (pointer_mode === PointerMode.ERASE) {
    eraser_tool.className = 'control_panel_btn_selected';
    highlight_tool.className = 'control_panel_btn';
    pen_tool.className = 'control_panel_btn';
  }
}

  
function update_brush_size(dir) {
  brush_size = brush_size + dir;
  if (brush_size < 1) {
    brush_size = 1;
  }
  if (brush_size > 9) {
    brush_size = 9;
  }
  const brush_size_scroll = document.getElementById('brush_size_scroll')
  brush_size_scroll.textContent = brush_size;
}

function clear_annotations(){
  strokesMap[slide_idx] = [];
  strokes = [];
  redrawAllStrokes();

  // broadcast that the slide annotations were cleared
  // with the slide index
  data = {index: slide_idx}
  socket.emit('clear_annotations', data);
}

// uploads and sharing
document.getElementById('upload-zip').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('zipfile', file);
  const res = await fetch('/upload', { method:'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  // re-init from the new files
  await loadConfigAndPDF();
  resizeCanvas();
  loadSlideStrokes();
  showSlide();
});

/*
Listeners:
*/

// keyboard shortcuts
document.addEventListener('keydown', e=>{
  if(['INPUT','TEXTAREA'].includes(e.target.tagName)) return;

  const m = {
    '+': ()=>{
      const b=document.getElementById('brush-size');b.stepUp();
      b.dispatchEvent(new Event('input'));
    },
    '-': ()=>{
      const b=document.getElementById('brush-size');
      b.stepDown();b.dispatchEvent(new Event('input'));
    },
    'c': ()=>document.getElementById('clear-annotations').click(),
    'd': ()=>document.getElementById('pen-tool').click(),
    'p': ()=>document.getElementById('pointer-tool').click(),
    'h': ()=>document.getElementById('highlight-tool').click(),
    'e': ()=>document.getElementById('eraser-tool').click(),
    'u': ()=>document.getElementById('upload-zip').click(),
    'ArrowLeft': ()=>document.getElementById('prev-slide').click(),
    'ArrowRight': ()=>document.getElementById('next-slide').click(),
  };
  if(m[e.key]) m[e.key]();
  if(e.key.match(/^[1-6]$/)){
    const sw=document.querySelectorAll('.color-swatch')[+e.key-1];
    sw && sw.click();
  }
});


// drawing events
['mousedown','touchstart'].forEach(
  evt=>annotationCanvas.addEventListener(evt,startDraw));
['mousemove','touchmove'].forEach(evt=>annotationCanvas.addEventListener(evt,draw));
['mouseup','mouseout','touchend'].forEach(evt=>annotationCanvas.addEventListener(evt,stopDraw));

function startDraw(e){
  // no drawing for multi-finger touches
  if (e.touches) {
    if (e.touches.length > 1) {
      return;
    }
  }
  drawing=true;
  const p=getPos(e);
  currentStroke={ type: pointer_mode,
                  width: pointer_mode === PointerMode.DRAW ? brush_size*2 : brush_size*10,
                  color:currentColor, points:[p] };
  e.preventDefault();
}

function draw(e){
  // no drawing for multi-finger touches
  if (e.touches) {
    if (e.touches.length > 1) {
      return;
    }
  }
  if(!drawing) return;
  currentStroke.points.push(getPos(e));
  redrawAllStrokes();
  socket.emit('stroke_stream',{slide:slide_idx,stroke:currentStroke});
  e.preventDefault();
}

function stopDraw(){
  if(!drawing) return;
  drawing=false;
  strokes.push(currentStroke);
  currentStroke=null;
  annotationCtx.closePath();
  strokesMap[slide_idx]=strokes.slice();
  socket.emit('stroke_update',{slide:slide_idx,strokes:strokesMap[slide_idx]});
}

// video controls (main only)
document.addEventListener('click',e=>{
  // delegate: if click hits a .slide-video element, toggle it
  if(e.target.matches('.slide-video')){
    const vid=e.target;
    vid.paused?vid.play():vid.pause();
    socket.emit('video_control',{
      slide:slide_idx,
      vidIndex: Array.from(document.querySelectorAll('.slide-video')).indexOf(vid),
      action: vid.paused?'pause':'play'
    });
  }
});

window.addEventListener('load', async () => {
  await loadConfigAndPDF();
  resizeCanvas();
  loadSlideStrokes();
  showSlide();
});

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('pdf-container');
  // Observe its first size change
  const ro = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect;
    // Freeze it in px
    container.style.width  = Math.round(width)  + 'px';
    container.style.height = Math.round(height) + 'px';
    // stop observing—now it’s locked
    ro.disconnect();
  });
  ro.observe(container);
});

window.addEventListener('DOMContentLoaded', () => {
  // find all swatches
  const swatches = document.querySelectorAll('.color-swatch');

  // bind click on each one
  swatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      // deselect all, then select this
      swatches.forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');

      // update the drawing color
      currentColor = swatch.dataset.color;
    });
  });

  // mark the initial swatch based on currentColor
  const initial = document.querySelector(`.color-swatch[data-color="${currentColor}"]`);
  if (initial) initial.classList.add('selected');
});


let isLanOn     = false;

document.getElementById('show-lan-url').addEventListener('click', async () => {
  const btn     = document.getElementById('show-lan-url');
  const display = document.getElementById('lan-url');

  isLanOn = !isLanOn;
  btn.disabled = true;

  // call the appropriate endpoint
  const url  = isLanOn ? '/enable_lan' : '/disable_lan';
  try {
    await fetch(url, { method: 'POST' });
    // if you still want to display the LAN URL, fetch it now:
    if (isLanOn) {
      const res = await fetch('/local_ip');
      const { ip } = await res.json();
      display.innerHTML = `<a href="http://${ip}:5000/viewer" style="color:white">${ip}:5000/viewer</a>`;
    } else {
      display.textContent = '';
    }
  } catch (err) {
    console.error('toggle LAN failed', err);
  } finally {
    btn.disabled = false;
  }
});

//scaling

const container = document.getElementById('pdf-container');
const viewer    = document.getElementById('viewer-wrapper');

let scale      = 1;
let translateX = 0;
let translateY = 0;
const minScale = 1;     // never below 1×
const maxScale = 10;    // clamp max zoom

// State for pinch gestures:
let pointers     = new Map();
let startDist    = 0;
let startScale   = 1;
let startCenter  = { x: 0, y: 0 };

// Helper to compute distance & center between two points
function getPinchInfo(p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  return {
    dist: Math.hypot(dx, dy),
    center: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
  };
}

// Apply the combined translate/scale transform
function updateTransform() {
  // clamp pan so no blank edges
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const vw = viewer.clientWidth  * scale;
  const vh = viewer.clientHeight * scale;
  translateX = Math.min(0, Math.max(translateX, cw - vw));
  translateY = Math.min(0, Math.max(translateY, ch - vh));

  viewer.style.transform = 
    `translate(${translateX}px, ${translateY}px) scale(${scale})`;
}

/* ----- SHIFT + MOUSEWHEEL ZOOM ----- */
container.addEventListener('wheel', e => {
  if (!e.shiftKey) return;
  e.preventDefault();

  // 1) compute new scale
  const delta    = -e.deltaY * 0.001;
  const newScale = Math.min(Math.max(scale + delta, minScale), maxScale);

  // 2) mouse pos relative to container
  const rect = container.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const my   = e.clientY - rect.top;

  // 3) adjust pan to lock the point under cursor
  const ratio = newScale / scale;
  translateX -= (mx - translateX) * (ratio - 1);
  translateY -= (my - translateY) * (ratio - 1);
  scale = newScale;

  updateTransform();
}, { passive: false });


// —————————————————————————————
// TOUCH-ONLY PINCH/ZOOM (two fingers only)
// —————————————————————————————
let touchStartDist   = 0;
let touchStartCenter = { x: 0, y: 0 };
let touchStartScale  = 1;

container.addEventListener('touchstart', onTouchStart,   { passive: false });
container.addEventListener('touchmove',  onTouchMove,    { passive: false });
container.addEventListener('touchend',   onTouchEnd,     { passive: false });
container.addEventListener('touchcancel',onTouchEnd,     { passive: false });

function onTouchStart(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const p1 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    const p2 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
    const info = getPinchInfo(p1, p2);

    touchStartDist   = info.dist;
    touchStartCenter = info.center;
    touchStartScale  = scale;
  }
}

function onTouchMove(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const p1 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    const p2 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
    const { dist, center } = getPinchInfo(p1, p2);

    let newScale = touchStartScale * (dist / touchStartDist);
    newScale = Math.min(Math.max(newScale, minScale), maxScale);

    const rect = container.getBoundingClientRect();
    const cx   = center.x - rect.left;
    const cy   = center.y - rect.top;
    const ratio= newScale / scale;

    translateX -= (cx - translateX) * (ratio - 1);
    translateY -= (cy - translateY) * (ratio - 1);
    scale       = newScale;
    updateTransform();
  }
  // if only 1 touch, do nothing here—let your pen/draw logic handle it
}

function onTouchEnd(e) {
  // when fewer than two fingers remain, reset pinch tracking
  if (e.touches.length < 2) {
    touchStartDist = 0;
  }
}


function fit4by3(el) {
  const panel = document.getElementById('control-panel');
  const panelh = panel.getBoundingClientRect().height;

  const vw = window.innerWidth;
  const vh = window.innerHeight - panelh;

  const screenRatio = vw / vh;
  let w, h;

  if (screenRatio > 4/3) {
    // viewport is “wider” than 4∶3 → fill height
    h = vh;
    w = vh * (4/3);
  } else {
    // viewport is “taller” → fill width
    w = vw;
    h = vw * (3/4);
  }

  el.style.width  = `${w}px`;
  el.style.height = `${h}px`;
}

class Modal {
  /**
   * @param {object} opts
   * @param {string} opts.title       — header text (plain text)
   * @param {string} opts.htmlContent — body content (HTML string)
   */
  constructor({ title = 'Notice', htmlContent = '' } = {}) {
    // 1) Create backdrop
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal';

    // 2) Create modal box
    const box = document.createElement('div');
    box.className = 'modal-box';

    // 3) Close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '&times;';

    // 4) Title
    const header = document.createElement('h2');
    header.textContent = title;

    // 5) Body (HTML content)
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.innerHTML = htmlContent;

    // 6) Assemble
    box.append(closeBtn, header, body);
    this.backdrop.append(box);
    document.body.append(this.backdrop);

    // 7) Event wiring
    closeBtn.addEventListener('click', () => this.hide());
    this.backdrop.addEventListener('click', e => {
      if (e.target === this.backdrop) {
        this.hide();
      }
    });
  }

  /** Show the modal (fade-in via CSS) */
  show() {
    this.backdrop.classList.add('show');
  }

  /** Hide the modal (fade-out via CSS) */
  hide() {
    this.backdrop.classList.remove('show');
  }

  /** Completely remove the modal from the DOM */
  destroy() {
    this.backdrop.remove();
  }
}


const usageHTML = `
<hr>
<h3>Setup</h3>
<ul>
<li style="margin-bottom: 10px;">Upload a compatible <code>.zip</code> file using <button class="control_panel_btn_view_only"><i class="fa-solid fa-upload"></i></button> or <b>U</b>.</li>
<li style="margin-bottom: 10px;">Toggle the visiblity for viewers using <button class="control_panel_btn_view_only"><i class="fa-solid fa-eye-slash"></i></button> / <button class="control_panel_btn_view_only"><i class="fa-solid fa-eye"></i></button> or <b>V</b>.</li>
</ul>
<h3>Navigation</h3>
<ul>
<li style="margin-bottom: 10px;">Change slides using <button class="control_panel_btn_view_only"><i class="fa-solid fa-arrow-left"></i></button> and <button class="control_panel_btn_view_only"><i class="fa-solid fa-arrow-right"></i></button> or <i class="fa-solid fa-caret-left"></i> / <i class="fa-solid fa-caret-right"></i>.</li>
<li> Zoom into a slide using <code>SHIFT + </code><i class="fa-solid fa-arrows-up-down"></i> or two fingers (on touch devices)
</ul>
<h3>Annotation</h3>
<ul>
<li style="margin-bottom: 10px;">Draw on slides using &nbsp; <i class="fa-solid fa-arrow-pointer"></i> &nbsp; or one finger (on touch devices).</li>
<li style="margin-bottom: 10px;"><p style="margin-bottom: 3px;">Select the pen tool using <button class="control_panel_btn_view_only"><i class="fa-solid fa-pen"></i></button> or <b>P</b>, the highlighter tool using <button class="control_panel_btn_view_only"><i class="fa-solid fa-highlighter"></i></button> or <b>H</b>, and<br></p>
the eraser tool using <button class="control_panel_btn_view_only"><i class="fa-solid fa-eraser"></i></button> or <b>E</b>.</li>
<li> Choose a size using &nbsp; <label for="brush-size"><i class="fa-solid fa-minus"></i></label>
    <input type="range" id="brush_size_scroll" min="1" max="30" value="10">
    <label for="brush-size"><i class="fa-solid fa-plus"></i></label> &nbsp; and color using <span class="color_picker_view_only"><span class="color_swatch_view_only" data-color="#ffffff" style="background:#eeeeee"></span>
      <span class="color_swatch_view_only" style="background:#e74c3c"></span>
      <span class="color_swatch_view_only" style="background:#f1c40f"></span>
      <span class="color_swatch_view_only" style="background:#2ecc71"></span>
      <span class="color_swatch_view_only" style="background:#3498db"></span>
      <span class="color_swatch_view_only" style="background:#9b59b6"></span>
      <span class="color_swatch_view_only" style="background:#333333"></span>
    </span>
</li>
<li> Clear all annotations on the current slide using <button class="control_panel_btn_view_only"><i class="fa-solid fa-broom"></i></button> or <b>C</b>.</li>
</ul>
<br>
`;

const infoModal = new Modal({
  title: 'Usage Instructions',
  htmlContent: usageHTML
});

const uploadErrorModal = new Modal({
  title: 'Error',
  htmlContent: "Could not upload files"
});

document.getElementById('errBtn1')
      .addEventListener('click', () => infoModal.show());

document.getElementById('errBtn2')
      .addEventListener('click', () => modalB.show());

      function addHoldListener(el, onHold, holdTime = 500, onEnd) {
        let timerId = null;
        let held = false;
    
        const start = (e) => {
          // Prevent context menu on long-press
          if (e.type === 'touchstart') e.preventDefault();
          held = false;
          timerId = setTimeout(() => {
            held = true;
            onHold(e);
          }, holdTime);
        };
    
        const end = (e) => {
          clearTimeout(timerId);
          if (held && typeof onEnd === 'function') {
            onEnd(e);
          }
        };
    
        // Mouse events
        el.addEventListener('mousedown', start);
        el.addEventListener('mouseup', end);
        el.addEventListener('mouseleave', end);
    
        // Touch events
        el.addEventListener('touchstart', start);
        el.addEventListener('touchend', end);
        el.addEventListener('touchcancel', end);
      }