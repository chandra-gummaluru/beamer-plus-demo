import { Button } from "./button.js";


let viewerZip = null; // the loaded presentation ZIP
let viewerCurrentSlide = 0;
let viewerTotalSlides = 0;
let viewerAnnotations = {};
let viewerPDFDoc = null;

window.addEventListener("DOMContentLoaded", () => {

const socket = io();
const screenDisplay = document.getElementById("screen-display");
const waitingMessage = document.getElementById("waiting-message");
const streamInfo = document.getElementById("stream-info");
let isScreenSharing = false;
let frameCount = 0;
let lastUpdateTime = Date.now();

//
const switchPresentationContainer = document.getElementById(
    "switch-presentation-container",
);
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
navControls.appendChild(prevBtn);

const nextBtn = document.createElement('button');
nextBtn.textContent = 'Next ▶';
nextBtn.className = 'btn';
navControls.appendChild(nextBtn);

prevBtn.onclick = () => goToViewerSlide(viewerCurrentSlide - 1);
nextBtn.onclick = () => goToViewerSlide(viewerCurrentSlide + 1);
//
async function loadViewerZip(blob) {
    const zip = await JSZip.loadAsync(blob);
    viewerZip = zip;

    // Load PDF
    const pdfFile = zip.files['slides.pdf'];
    if (!pdfFile) {
        console.error('No slides.pdf found in ZIP');
        return;
    }

    const pdfData = await pdfFile.async('arraybuffer');
    viewerPDFDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    viewerTotalSlides = viewerPDFDoc.numPages;
    viewerCurrentSlide = 0;

    console.log('Loaded PDF with', viewerTotalSlides, 'pages'); // <- debug

    await renderViewerSlide(viewerCurrentSlide);
}
//
async function renderViewerSlide(slideIndex) {
    if (!viewerPDFDoc || slideIndex < 0 || slideIndex >= viewerTotalSlides) return;

    viewerCurrentSlide = slideIndex;

    let canvas = document.getElementById('viewer-slide-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'viewer-slide-canvas';
        canvas.style.position = 'relative';      // relative positioning
        canvas.style.display = 'block';          // remove inline block issues
        canvas.style.margin = '0 auto';          // center horizontally
        canvas.style.width = 'auto';             // don't stretch width
        canvas.style.height = 'auto';            // don't stretch height
        canvas.style.maxWidth = '100%';          // scale down if container is smaller
        canvas.style.maxHeight = '100%';         // scale down vertically if needed
        canvas.style.zIndex = '1';               // keep behind nav buttons
        switchPresentationContainer.appendChild(canvas);
    }


    const ctx = canvas.getContext('2d');
    const page = await viewerPDFDoc.getPage(slideIndex + 1);
    const viewport = page.getViewport({ scale: 1.5 });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Draw annotations if any
    if (viewerAnnotations[slideIndex]) {
        const img = new Image();
        img.src = viewerAnnotations[slideIndex];
        img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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