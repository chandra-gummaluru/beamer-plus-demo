// immediately hide control panel
document.getElementById('control-panel').style.display='none';

// viewer socket handlers
socket.on('slide_update', data => {
  slide_idx = data.index;
  showSlide();
});

socket.on('clear_slide', data => {
  strokesMap[data.index]=[];
  if(data.index===slide_idx){
    strokes=[]; redrawAllStrokes();
  }
});

socket.on('stroke_update', data=>{
  strokesMap[data.slide]=data.strokes;
  if(data.slide===slide_idx){
    strokes=data.strokes.slice(); redrawAllStrokes();
  }
});

socket.on('stroke_stream', data=>{
  if(data.slide===slide_idx) drawSingleStroke(data.stroke);
});

// video control
socket.on('video_control', ({slide,vidIndex,action})=>{
  if(slide!==slide_idx) return;
  const vids=document.querySelectorAll('.slide-video');
  const vid=vids[vidIndex];
  if(!vid) return;
  action==='play'?vid.play():vid.pause();
});

window.addEventListener('load', async () => {
    await loadConfigAndPDF();
    resizeCanvas();
    loadSlideStrokes();
    showSlide();
  });
  
window.addEventListener('resize', resizeCanvas);

socket.on('lan_status', data => {
if (!data.enabled) {
    // LAN was turned off → force a reload
    // the next GET /viewer will 404
    window.location.reload();
}
});