import { Button } from "./button.js";

window.addEventListener("DOMContentLoaded", () => {

const socket = io();
const screenDisplay = document.getElementById("screen-display");
const waitingMessage = document.getElementById("waiting-message");
const streamInfo = document.getElementById("stream-info");
let isScreenSharing = false;
let frameCount = 0;
let lastUpdateTime = Date.now();

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
const switchPresentationContainer = document.getElementById(
    "switch-presentation-container",
);
const performSwitch = () => {
    console.log(`screensharing: HAHA ${isScreenSharing}`);
    if (!isScreenSharing) {
        return; // do nothing if it's not screensharing.
    }

    if (switchToPresentation) {
        switchPresentationContainer.classList.remove("hidden");
        viewerContainer.classList.add("hidden");
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

});