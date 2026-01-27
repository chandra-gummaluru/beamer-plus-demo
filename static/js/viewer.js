import { Button } from "./button.js";
import { renderWidgets, cleanupWidgets, updateWidgetPositions } from './iframe-widget-renderer.js';
import { Canvas } from "./canvas.js";
window.addEventListener("DOMContentLoaded", () => {

    let viewerZip = null; // the loaded presentation ZIP
    let slideConfigs = {};
    let mediaCache = {}
    let viewerAnnotations = {};
    let viewerCurrentSlide = 0;
    let viewerTotalSlides = 0;
    let viewerPDFDoc = null;

    const switchPresentationContainer = document.getElementById("switch-presentation-container");
    const slide_canvas_container = document.getElementById('viewer-pdf-canvas');
    const pdfCvs = new Canvas(slide_canvas_container, false);

    const socket = io();
    const screenDisplay = document.getElementById("screen-display");
    const waitingMessage = document.getElementById("waiting-message");
    const streamInfo = document.getElementById("stream-info");
    let isScreenSharing = false;
    let frameCount = 0;
    let lastUpdateTime = Date.now();

    const viewerPanelLeft = document.getElementById("viewer-left");
    const viewerPrevBtnDiv = document.getElementById("viewer-prev-btn");
    const viewerNextBtnDiv = document.getElementById("viewer-next-btn");

    const navControls = document.createElement('div');
    navControls.style.position = 'absolute';
    navControls.style.bottom = '20px';
    navControls.style.left = '50%';
    navControls.style.transform = 'translateX(-50%)';
    navControls.style.display = 'flex';
    navControls.style.gap = '10px';
    navControls.style.zIndex = '100';
    switchPresentationContainer.appendChild(navControls);

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '◀ Prev';
    prevBtn.className = 'btn';
    // navControls.appendChild(prevBtn);
    console.log("viewer-prev-button-div: ", viewerPrevBtnDiv);
    viewerPrevBtnDiv.appendChild(prevBtn);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next ▶';
    nextBtn.className = 'btn';
    navControls.appendChild(nextBtn);
    viewerNextBtnDiv.appendChild(nextBtn);

    // viewerPanelLeft.appendChild(navControls);


    prevBtn.onclick = () => goToViewerSlide(viewerCurrentSlide - 1);
    nextBtn.onclick = () => goToViewerSlide(viewerCurrentSlide + 1);

    // note: loadSlideConfig also appears in main.js.
    // it's the same, except is uses <zipFile> rather than <viewerZip>
    async function loadSlideConfig(slideIndex) {
        if (slideConfigs[slideIndex]) {
            return slideConfigs[slideIndex];
        }
        
        const configFileName = `config/s${slideIndex}.json`;
        const configFile = viewerZip.file(configFileName);
        
        if (!configFile) {
            slideConfigs[slideIndex] = null;
            return null;
        }
        
        const configText = await configFile.async("string");
        const config = JSON.parse(configText);
        slideConfigs[slideIndex] = config;
        
        console.log(`Loaded config for slide ${slideIndex}:`, config);
        return config;
    }

    // note: loadMediaFromPath also appears in main.js.
    // it's the same, except is uses <zipFile> rather than <viewerZip>
    async function loadMediaFromPath(path) {
        if (mediaCache[path]) {
            return mediaCache[path];
        }
        
        const file = viewerZip.file(path);
        if (!file) {
            console.error(`Media file not found: ${path}`);
            return null;
        }
        
        const blob = await file.async("blob");
        const url = URL.createObjectURL(blob);
        mediaCache[path] = url;
        
        console.log(`Loaded media: ${path}`);
        return url;
    }

    //
    async function loadViewerZip(blob) {
        // update the global state
        viewerZip = await JSZip.loadAsync(blob);

        // Get slides.pdf from the ZIP
        const pdfFile = viewerZip.file("slides.pdf");
        if (!pdfFile) {
            console.error("No slides.pdf found in ZIP");
            return;
        }

        // pdfData will store pdfFile as bytes of data
        const pdfData = await pdfFile.async('arraybuffer');

        // viewerPDFDoc (the global state) is your renderable PDF document, made by the pdfjs library
        viewerPDFDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
        // update global states:
        viewerTotalSlides = viewerPDFDoc.numPages;
        viewerCurrentSlide = 0;

        console.log('Loaded PDF with', viewerTotalSlides, 'pages'); // <- debug

        // render the first slide (because viewerCurrentSlide has been initialized to zero):
        await renderViewerSlide(viewerCurrentSlide);
    }
    //
    async function renderViewerSlide(slideIndex) {

        console.log('renderViewerSlide called:', slideIndex);
        if (!viewerZip || !viewerPDFDoc || slideIndex < 0 || slideIndex >= viewerTotalSlides) {
            console.log('Error calling renderViewerSlide');
            return;
        }

        // update the global state:
        viewerCurrentSlide = slideIndex;

        const page = await viewerPDFDoc.getPage(slideIndex + 1);
        await pdfCvs.renderPDFPage(page);

        // Clear old media
        const existingMedia = slide_canvas_container.querySelectorAll('video, audio, model-viewer');
        existingMedia.forEach(el => el.remove());
        // Clear old widgets
        cleanupWidgets(slide_canvas_container);

        // get the config for this slide:
        const slideConfig = await loadSlideConfig(slideIndex);
        if (!slideConfig) {
            console.log('No config for this slide');
            return;
        }
        console.log('Videos to render:', slideConfig.videos?.length || 0);
        console.log('Models to render:', slideConfig.models?.length || 0);
        console.log('Widgets to render:', slideConfig.widgets?.length || 0);

        const containerRect = slide_canvas_container.getBoundingClientRect();


        if (slideConfig.videos) {
            for (const v of slideConfig.videos) {
                const videoURL = await loadMediaFromPath(v.path);
                if (!videoURL) continue;
                
                const video = document.createElement("video");
                video.src = videoURL;
                video.volume = v.volume || 1.0;
                video.dataset.videoId = v.id;
                
                // Store fractional positions for resize handling
                video.dataset.videoX = v.x;
                video.dataset.videoY = v.y;
                video.dataset.videoWidth = v.width;
                video.dataset.videoHeight = v.height;
                
                video.style.position = "absolute";
                video.style.left = `${v.x * containerRect.width}px`;
                video.style.top = `${v.y * containerRect.height}px`;
                video.style.width = `${v.width * containerRect.width}px`;
                video.style.height = `${v.height * containerRect.height}px`;
                video.style.objectFit = "contain";
                video.style.zIndex = v.zIndex || 5;
                
                if (v.playMode === "once") {
                    video.autoplay = true;
                    video.loop = false;
                }
                if (v.playMode === "loop") {
                    video.autoplay = true;
                    video.loop = true;
                }
                if (v.playMode === "manual") {
                    video.controls = true;
                }
                
                video.addEventListener('play', () => {
                    socket.emit('video_action', {
                        videoId: v.id,
                        slideIndex: viewerCurrentSlide,
                        action: 'play',
                        currentTime: video.currentTime
                    });
                });
                
                video.addEventListener('pause', () => {
                    socket.emit('video_action', {
                        videoId: v.id,
                        slideIndex: viewerCurrentSlide,
                        action: 'pause',
                        currentTime: video.currentTime
                    });
                });
    
                // Allow clicking the video to toggle play/pause
                video.addEventListener('click', (ev) => {
                    // Only toggle when in hand mode (clicks should pass through otherwise)
                    try {
                        if (video.paused) video.play();
                        else video.pause();
                    } catch (e) {
                        console.error('Error toggling video playback:', e);
                    }
                    ev.stopPropagation();
                });
                
                slide_canvas_container.appendChild(video);
            }
        }
        
        if (slideConfig.models) {
            for (const m of slideConfig.models) {
                const modelURL = await loadMediaFromPath(m.path);
                if (!modelURL) continue;
                
                const mv = document.createElement("model-viewer");
                mv.src = modelURL;
                mv.alt = m.alt || "3D model";
                mv.dataset.modelId = m.id;
                
                // Store fractional positions for resize handling
                mv.dataset.modelX = m.x;
                mv.dataset.modelY = m.y;
                mv.dataset.modelWidth = m.width;
                mv.dataset.modelHeight = m.height;
                
                mv.setAttribute("camera-controls", "");
                mv.setAttribute("shadow-intensity", "1");
                mv.setAttribute("auto-rotate", m.autoRotate ? "true" : "false");
                
                mv.style.position = "absolute";
                mv.style.left = `${m.x * containerRect.width}px`;
                mv.style.top = `${m.y * containerRect.height}px`;
                mv.style.width = `${m.width * containerRect.width}px`;
                mv.style.height = `${m.height * containerRect.height}px`;
                mv.style.zIndex = m.zIndex || 5;
                
                mv.addEventListener('camera-change', () => {
                    const camera = mv.getCameraOrbit();
                    const target = mv.getCameraTarget();
                    socket.emit('model_interaction', {
                        modelId: m.id,
                        slideIndex: viewerCurrentSlide,
                        camera: {
                            theta: camera.theta,
                            phi: camera.phi,
                            radius: camera.radius
                        },
                        target: {
                            x: target.x,
                            y: target.y,
                            z: target.z
                        }
                    });
                });
                
                slide_canvas_container.appendChild(mv);
            }
        }
        
        if (slideConfig.audio) {
            for (const a of slideConfig.audio) {
                const audioURL = await loadMediaFromPath(a.path);
                if (!audioURL) continue;
                
                const audio = document.createElement("audio");
                audio.src = audioURL;
                audio.volume = a.volume || 1.0;
                if (a.playMode === "auto") audio.play();
                if (a.playMode === "manual") audio.controls = true;
                
                slide_canvas_container.appendChild(audio);
            }
        }
        
        if (slideConfig.widgets) {
            renderWidgets(slideConfig, slide_canvas_container, viewerZip);
        }

    }
    //
    socket.on('slide_change', async (data) => {
        if (!viewerZip) return;

        const { slideIndex, annotations } = data;
        viewerAnnotations[slideIndex] = annotations; // store per-slide annotations
        await renderViewerSlide(slideIndex);
    });
    //
    document.addEventListener('keydown', (e) => {
        if (!switchPresentationContainer.classList.contains('hidden')) {
            if (e.key === 'ArrowLeft') goToViewerSlide(viewerCurrentSlide - 1);
            if (e.key === 'ArrowRight') goToViewerSlide(viewerCurrentSlide + 1);
        }
    });
    //
    async function goToViewerSlide(slideIndex) {
        if (!viewerPDFDoc) return;
        if (slideIndex < 0) slideIndex = 0;
        if (slideIndex >= viewerTotalSlides) slideIndex = viewerTotalSlides - 1;

        viewerCurrentSlide = slideIndex;
        await renderViewerSlide(slideIndex);
    }
    //

    // Join viewer room
    socket.emit("join_viewer");

    // Connection status
    socket.on("connect", () => {
        console.log("Connected to server");
    });

    socket.on("disconnect", () => {
        console.log("Disconnected from server");
        screenDisplay.style.display = "none";
        waitingMessage.style.display = "block";
        streamInfo.style.display = "none";
    });

    socket.on("joined", (data) => {
        console.log("Joined room:", data.room);
    });

    // Screen capture event (from html2canvas)
    socket.on("screen_capture", (data) => {
        if (data.image) {
            // Show screen, hide waiting message
            if (!isScreenSharing) {
                isScreenSharing = true;
                waitingMessage.style.display = "none";
                screenDisplay.style.display = "block";
                streamInfo.style.display = "block";
            }

            // Update the image
            screenDisplay.src = data.image;

            // Update FPS counter
            frameCount++;
            const currentTime = Date.now();
            const elapsed = currentTime - lastUpdateTime;

            if (elapsed >= 1000) {
                const fps = Math.round((frameCount / elapsed) * 1000);
                streamInfo.textContent = `${fps} FPS`;
                frameCount = 0;
                lastUpdateTime = currentTime;
            }
        }
    });

    // Fallback to legacy screen sharing events if needed
    socket.on("screen_share_start", () => {
        console.log("Screen sharing started (legacy)");
        isScreenSharing = true;
        waitingMessage.style.display = "none";
        screenDisplay.style.display = "block";
    });

    socket.on("screen_share_stop", () => {
        console.log("Screen sharing stopped (legacy)");
        isScreenSharing = false;
        screenDisplay.style.display = "none";
        waitingMessage.style.display = "block";
        streamInfo.style.display = "none";
    });

    socket.on("screen_frame", (data) => {
        if (data.frame) {
            if (!isScreenSharing) {
                isScreenSharing = true;
                waitingMessage.style.display = "none";
                screenDisplay.style.display = "block";
            }
            screenDisplay.src = data.frame;
        }
    });

    // Handle window resize
    window.addEventListener("resize", () => {
        // Image styling will handle scaling automatically
    });

    // when this is true, you show the viewer-controlled presentation.
    // when this is false, you show the screen-shared presentation.
    // important: if isScreenSharing == false then switchToPresentation must be false.
    let switchToPresentation = false;
    const viewerContainer = document.getElementById("viewer-container");
    // now switchPresentationContainer is defined near the start
    // const switchPresentationContainer = document.getElementById(
    //     "switch-presentation-container",
    // );
    // const performSwitch = () => {
    //     console.log(`screensharing: HAHA ${isScreenSharing}`);
    //     if (!isScreenSharing) {
    //         return; // do nothing if it's not screensharing.
    //     }

    //     if (switchToPresentation) {
    //         switchPresentationContainer.classList.remove("hidden");
    //         viewerContainer.classList.add("hidden");
    //     } else {
    //         switchPresentationContainer.classList.add("hidden");
    //         viewerContainer.classList.remove("hidden");
    //     }
    // };
    const performSwitch = () => {
        if (!isScreenSharing) return;

        if (switchToPresentation) {
            switchPresentationContainer.classList.remove("hidden");
            viewerContainer.classList.add("hidden");

            // render current slide
            if (viewerPDFDoc) renderViewerSlide(viewerCurrentSlide);
        } else {
            switchPresentationContainer.classList.add("hidden");
            viewerContainer.classList.remove("hidden");
        }
    };


    const switchContainer = document.getElementById("switch-container");

    const switchBtn = new Button(switchContainer, {
        label: '<i class="fa-solid fa-display"></i>',
        className: "btn",
    });

    switchBtn.onClick(() => {
        switchToPresentation = !switchToPresentation;
        performSwitch();
        console.log(
            `Performed switch. Currently switchToPresentation: ${switchToPresentation}`,
        );
    });

    async function loadPresentation() {
        const infoRes = await fetch('/api/presentation/info');
        const info = await infoRes.json();

        if (!info.loaded) {
            console.log("No presentation loaded yet.");
            // show some kind of waiting message maybe
            return;
        }
        console.log("Presentation found:", info);
        await downloadAndLoadZip();
    }

    async function downloadAndLoadZip() {
        console.log("Downloading presentation...");

        const res = await fetch('/api/presentation/current');
        const blob = await res.blob();

        console.log("ZIP downloaded:", blob);

        await loadZip(blob);
        await loadViewerZip(blob);
    }

    async function loadZip(blob) {
        const zip = await JSZip.loadAsync(blob);

        console.log("ZIP contents:", Object.keys(zip.files));

        window.viewerPresentation = zip; // store globally

        // Example: load slides/index.html if it exists
        if (zip.files["index.html"]) {
            const html = await zip.files["index.html"].async("string");
            document.getElementById("viewer-container").innerHTML = html;
        }
    }

    loadPresentation();

    socket.on("presentation_loaded", () => {
        console.log("New presentation uploaded — reloading...");
        loadPresentation();
    });


});