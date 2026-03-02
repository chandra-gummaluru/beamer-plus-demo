import { Timer } from "./timer.js";
import { Label } from "./label.js";
import { Button } from "./button.js";
import { Selector } from "./selector.js";
import { Toggle } from "./toggle.js";
import { Canvas } from "./canvas.js";
import {
    renderWidgets,
    cleanupWidgets,
    updateWidgetPositions,
} from "./iframe-widget-renderer.js";
import { Modal } from "./beamer_modal.js";
import {
    setControlsEnabledAfterUpload,
    disableControlButtons,
} from "./beamer_ui.js";

const socket = io();
socket.emit("join_presenter");

// Available AI models (loaded from presentation ZIP)
let availableModels = [];

window.addEventListener("DOMContentLoaded", () => {
    const timerContainer = document.getElementById("timer-container");
    const timer = new Timer(timerContainer);

    const toolContainer = document.getElementById("tool-container");

    const hand = new Button(toolContainer, {
        label: '<i class="fa-solid fa-hand-pointer"></i>',
        className: "btn",
    });

    const pen = new Button(toolContainer, {
        label: '<i class="fa-solid fa-pen"></i>',
        className: "btn",
    });

    const highlighter = new Button(toolContainer, {
        label: '<i class="fa-solid fa-highlighter"></i>',
        className: "btn",
    });

    const eraser = new Button(toolContainer, {
        label: '<i class="fa-solid fa-eraser"></i>',
        className: "btn",
    });

    const toolSelector = new Selector(
        [hand, pen, highlighter, eraser],
        "btn_selected",
    );
    toolSelector.select(hand);

    const colors = [
        "#eeeeee",
        "#e74c3c",
        "#f1c40f",
        "#2ecc71",
        "#3498db",
        "#9b59b6",
        "#333333",
    ];
    const colorContainer = document.getElementById("color-picker");

    const colorBtns = colors.map((color) => {
        const btn = new Button(colorContainer, {
            className: "color-swatch",
        });
        btn.el.style.background = color;
        return btn;
    });

    const colorSelector = new Selector(colorBtns, "color-selected");
    colorSelector.select(colorBtns[6]);

    const navContainer = document.getElementById("nav-container");

    const prevBtn = new Button(navContainer, {
        label: '<i class="fa-solid fa-arrow-left"></i>',
        className: "btn",
    });

    const nextBtn = new Button(navContainer, {
        label: '<i class="fa-solid fa-arrow-right"></i>',
        className: "btn",
    });

    const brushContainer = document.getElementById("brush-controls");

    const brushMinusBtn = new Button(brushContainer, {
        label: '<i class="fa-solid fa-minus"></i>',
        className: "btn",
    });

    const brushSizeLbl = new Label(brushContainer, {
        id: "brush_size_scroll",
        className: "brush_size_scroll",
        initial: "2",
    });

    const brushPlusBtn = new Button(brushContainer, {
        label: '<i class="fa-solid fa-plus"></i>',
        className: "btn",
    });

    const otherControlsContainer = document.getElementById("other-controls");

    const undoBtn = new Button(otherControlsContainer, {
        className: "btn",
        label: '<i class="fa-solid fa-rotate-left"></i>',
    });

    undoBtn.el.id = "undo-btn";
    undoBtn.el.style.marginLeft = "15px";
    undoBtn.el.style.marginRight = "5px";

    const redoBtn = new Button(otherControlsContainer, {
        className: "btn",
        label: '<i class="fa-solid fa-rotate-right"></i>',
    });

    redoBtn.el.id = "redo-btn";
    redoBtn.el.style.marginRight = "5px";

    const clearBtn = new Button(otherControlsContainer, {
        className: "btn",
        label: '<i class="fa-solid fa-broom"></i>',
    });

    clearBtn.el.id = "clear-btn";
    clearBtn.el.style.marginRight = "20px";

    const surveyBtn = new Button(otherControlsContainer, {
        className: "btn",
        label: '<i class="fa-solid fa-clipboard-list"></i>',
    });

    surveyBtn.el.style.marginRight = "10px";

    const surveyResultsBtn = new Button(otherControlsContainer, {
        className: "btn",
        label: '<i class="fa-solid fa-chart-simple"></i>',
    });

    const splitViewBtn = new Button(otherControlsContainer, {
        className: "btn",
        label: '<i class="fa-solid fa-compress"></i>'
    })

    splitViewBtn.onClick(async () => {
        isSplitView = !isSplitView;
        const pdfContainer = document.getElementById("pdf-container");

        if (isSplitView) {
            pdfContainer.classList.add("split-view");
            splitViewBtn.el.innerHTML = '<i class="fa-solid fa-expand"></i>';
            if (zipFile) {
                await renderSlideIntoSlots(currentSlide);
            }
        } else {
            pdfContainer.classList.remove("split-view");
            splitViewBtn.el.innerHTML = '<i class="fa-solid fa-compress"></i>';
            cleanupWidgets(slotPdfContainer1);
            cleanupWidgets(slotPdfContainer2);
            // Re-render the current slide back into the main canvas
            if (zipFile) {
                await renderSlide(currentSlide);
            }
        }
    });

    // Initially disable results button
    surveyResultsBtn.el.disabled = true;
    surveyResultsBtn.el.style.opacity = "0.5";
    surveyResultsBtn.el.style.cursor = "not-allowed";

    const displayControls = document.getElementById("display-controls");

    const uploadBtn = new Button(displayControls, {
        className: "btn",
        label: '<i class="fa-solid fa-folder-open"></i>',
    });

    const screenShareContainer = document.getElementById(
        "screen-share-container",
    );

    const screenShareBtn = new Button(screenShareContainer, {
        className: "btn",
        label: '<i class="fa-solid fa-desktop"></i>',
    });

    // Initially disabled until presentation is loaded
    screenShareBtn.el.disabled = true;
    screenShareBtn.el.style.opacity = "0.5";
    screenShareBtn.el.style.cursor = "not-allowed";

    // Create recording button
    const recordContainer = document.getElementById("record-container");

    const recordBtn = new Button(recordContainer, {
        className: "btn",
        label: '<i class="fa-solid fa-circle"></i>',
    });

    // Initially disabled until presentation is loaded
    recordBtn.el.disabled = true;
    recordBtn.el.style.opacity = "0.5";
    recordBtn.el.style.cursor = "not-allowed";

    // Create floating annotation panel toggle button for mobile
    const annotationToggleBtn = document.createElement("button");
    annotationToggleBtn.id = "annotation-panel-toggle";
    annotationToggleBtn.className = "btn";
    annotationToggleBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    annotationToggleBtn.title = "Annotation Tools";

    // Insert after nav-container instead of in display-controls
    const navContainerElement = document.getElementById("nav-container");
    const controlsLeft = document.querySelector(".controls-left");
    if (navContainerElement && navContainerElement.nextSibling) {
        controlsLeft.insertBefore(
            annotationToggleBtn,
            navContainerElement.nextSibling,
        );
    } else if (navContainerElement) {
        navContainerElement.parentNode.insertBefore(
            annotationToggleBtn,
            navContainerElement.nextSibling,
        );
    } else {
        controlsLeft.appendChild(annotationToggleBtn);
    }

    // Create floating annotation panel
    const floatingPanel = document.createElement("div");
    floatingPanel.id = "floating-annotation-panel";
    document.body.appendChild(floatingPanel);

    // Function to populate floating panel on mobile
    function updateFloatingPanel() {
        const toolContainer = document.getElementById("tool-container");
        const colorPicker = document.getElementById("color-picker");
        const brushControls = document.getElementById("brush-controls");
        const otherControls = document.getElementById("other-controls");
        const controlsRight = document.querySelector(".controls-right");

        if (window.innerWidth <= 1300) {
            // Move elements to floating panel on mobile
            floatingPanel.innerHTML = "";

            // Tools section
            const toolsSection = document.createElement("div");
            toolsSection.className = "panel-section";
            if (toolContainer) toolsSection.appendChild(toolContainer);
            floatingPanel.appendChild(toolsSection);

            // Colors section
            const colorsSection = document.createElement("div");
            colorsSection.className = "panel-section";
            if (colorPicker) colorsSection.appendChild(colorPicker);
            floatingPanel.appendChild(colorsSection);

            // Brush controls section
            const brushSection = document.createElement("div");
            brushSection.className = "panel-section";
            if (brushControls) brushSection.appendChild(brushControls);
            floatingPanel.appendChild(brushSection);

            // Undo/Redo/Clear section - move individual buttons from other-controls
            const actionSection = document.createElement("div");
            actionSection.className = "panel-section";
            const undoBtnEl = document.getElementById("undo-btn");
            const redoBtnEl = document.getElementById("redo-btn");
            const clearBtnEl = document.getElementById("clear-btn");
            if (undoBtnEl) actionSection.appendChild(undoBtnEl);
            if (redoBtnEl) actionSection.appendChild(redoBtnEl);
            if (clearBtnEl) actionSection.appendChild(clearBtnEl);
            if (actionSection.children.length > 0)
                floatingPanel.appendChild(actionSection);

            // Show toggle button on mobile
            annotationToggleBtn.style.display = "inline-flex";
        } else {
            // Move elements back to controls-right on desktop

            // Move undo/redo/clear back to other-controls in the correct order
            const undoBtnEl = document.getElementById("undo-btn");
            const redoBtnEl = document.getElementById("redo-btn");
            const clearBtnEl = document.getElementById("clear-btn");

            // Insert in correct order at the beginning of other-controls
            if (
                undoBtnEl &&
                otherControls &&
                !otherControls.contains(undoBtnEl)
            ) {
                otherControls.insertBefore(undoBtnEl, otherControls.firstChild);
            }
            if (
                redoBtnEl &&
                otherControls &&
                !otherControls.contains(redoBtnEl)
            ) {
                otherControls.insertBefore(
                    redoBtnEl,
                    undoBtnEl
                        ? undoBtnEl.nextSibling
                        : otherControls.firstChild,
                );
            }
            if (
                clearBtnEl &&
                otherControls &&
                !otherControls.contains(clearBtnEl)
            ) {
                otherControls.insertBefore(
                    clearBtnEl,
                    redoBtnEl
                        ? redoBtnEl.nextSibling
                        : otherControls.firstChild,
                );
            }

            // Insert elements back in correct order
            if (toolContainer && !controlsRight.contains(toolContainer)) {
                controlsRight.insertBefore(
                    toolContainer,
                    otherControls || controlsRight.firstChild,
                );
            }
            if (colorPicker && !controlsRight.contains(colorPicker)) {
                controlsRight.insertBefore(
                    colorPicker,
                    otherControls || controlsRight.firstChild,
                );
            }
            if (brushControls && !controlsRight.contains(brushControls)) {
                controlsRight.insertBefore(
                    brushControls,
                    otherControls || controlsRight.firstChild,
                );
            }

            // Clear floating panel after moving elements
            floatingPanel.innerHTML = "";

            // Hide toggle button and floating panel on desktop
            annotationToggleBtn.style.display = "none";
            floatingPanel.classList.remove("visible");
        }
    }

    // Initialize and listen for resize
    updateFloatingPanel();
    window.addEventListener("resize", updateFloatingPanel);

    // Make floating panel draggable
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    floatingPanel.addEventListener("mousedown", dragStart);
    floatingPanel.addEventListener("touchstart", dragStart);
    document.addEventListener("mousemove", drag);
    document.addEventListener("touchmove", drag);
    document.addEventListener("mouseup", dragEnd);
    document.addEventListener("touchend", dragEnd);

    function dragStart(e) {
        // Only start drag if clicking on the panel background, not on buttons
        if (
            e.target === floatingPanel ||
            e.target.classList.contains("panel-section")
        ) {
            if (e.type === "touchstart") {
                initialX = e.touches[0].clientX - xOffset;
                initialY = e.touches[0].clientY - yOffset;
            } else {
                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;
            }
            isDragging = true;
            floatingPanel.style.cursor = "grabbing";
        }
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();

            if (e.type === "touchmove") {
                currentX = e.touches[0].clientX - initialX;
                currentY = e.touches[0].clientY - initialY;
            } else {
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
            }

            xOffset = currentX;
            yOffset = currentY;

            setTranslate(currentX, currentY, floatingPanel);
        }
    }

    function dragEnd() {
        if (isDragging) {
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
            floatingPanel.style.cursor = "grab";
        }
    }

    function setTranslate(xPos, yPos, el) {
        el.style.transform = `translate(${xPos}px, ${yPos}px)`;
    }

    // Set initial cursor
    floatingPanel.style.cursor = "grab";

    // Toggle panel visibility
    annotationToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        floatingPanel.classList.toggle("visible");
    });

    // Close panel when clicking outside
    document.addEventListener("click", (e) => {
        if (
            !floatingPanel.contains(e.target) &&
            e.target !== annotationToggleBtn &&
            !annotationToggleBtn.contains(e.target)
        ) {
            floatingPanel.classList.remove("visible");
        }
    });

    // Keep list of controls for enabling/disabling (upload button remains enabled)
    const __beamer_controls = [
        hand,
        pen,
        highlighter,
        eraser,
        ...colorBtns,
        brushMinusBtn,
        brushPlusBtn,
        prevBtn,
        nextBtn,
        undoBtn,
        redoBtn,
        clearBtn,
        surveyBtn,
    ];
    // QUESTION: Why aren't screenShareBtn and recordBtn in this array?^

    // Disable at startup
    setControlsEnabledAfterUpload(false, __beamer_controls);

    // Full set used for temporary disabling (includes upload button)
    const __beamer_all_buttons = [...__beamer_controls, uploadBtn];

    const ann_canvas_container = document.getElementById("ann-canvas");
    const annCvs = new Canvas(ann_canvas_container);
    const slide_canvas_container = document.getElementById("pdf-canvas");
    const pdfCvs = new Canvas(slide_canvas_container, false);

    const slotPdfContainer1 = document.getElementById("slot-pdf-canvas-1");
    const slotAnnContainer1 = document.getElementById("slot-ann-canvas-1");
    const slotPdfContainer2 = document.getElementById("slot-pdf-canvas-2");
    const slotAnnContainer2 = document.getElementById("slot-ann-canvas-2");

    const slotPdfCvs1 = new Canvas(slotPdfContainer1, false);
    const slotAnnCvs1 = new Canvas(slotAnnContainer1, false);
    const slotPdfCvs2 = new Canvas(slotPdfContainer2, false);
    const slotAnnCvs2 = new Canvas(slotAnnContainer2, false);

    let isSplitView = false;

    const updateHistoryButtons = () => {
        undoBtn.el.disabled = !annCvs.canUndo();
        redoBtn.el.disabled = !annCvs.canRedo();
    };
    annCvs.setHistoryChangeHandler(updateHistoryButtons);
    updateHistoryButtons();

    hand.onClick(() => annCvs.setPointerMode("hand"));
    pen.onClick(() => annCvs.setPointerMode("draw"));
    highlighter.onClick(() => annCvs.setPointerMode("highlight"));
    eraser.onClick(() => annCvs.setPointerMode("erase"));

    function onToolSelected(selected) {
        if (selected === pen) annCvs.setPointerMode("draw");
        else if (selected === highlighter) annCvs.setPointerMode("highlight");
        else if (selected === eraser) annCvs.setPointerMode("erase");
    }

    toolSelector.buttons.forEach((item) => {
        item.el.addEventListener("click", () => onToolSelected(item));
    });

    colorBtns.forEach((btn) => {
        btn.onClick(() => {
            annCvs.setStrokeColor(getComputedStyle(btn.el).backgroundColor);
        });
    });

    brushMinusBtn.onClick(() => {
        let val = parseInt(brushSizeLbl.get());
        if (val > 1) val--;
        brushSizeLbl.set(String(val));
        annCvs.setStrokeWidth(val);
    });

    brushPlusBtn.onClick(() => {
        let val = parseInt(brushSizeLbl.get());
        if (val < 9) val++;
        brushSizeLbl.set(String(val));
        annCvs.setStrokeWidth(val);
    });

    clearBtn.onClick(() => {
        annCvs.clearAndCommit();
        // Clear current slide annotations locally and notify server
        annotations[currentSlide] = null;
        socket.emit("clear_annotations");
    });

    undoBtn.onClick(async () => {
        await annCvs.undo();
        syncAnnotations();
    });

    redoBtn.onClick(async () => {
        await annCvs.redo();
        syncAnnotations();
    });

    const zipInput = document.getElementById("upload-zip");
    const folderInput = document.getElementById("upload-folder");

    uploadBtn.onClick(() => {
        showUploadModal();
    });

    function showUploadModal() {
        const existingModal = document.querySelector(".upload-modal-overlay");
        if (existingModal) existingModal.remove();

        const overlay = document.createElement("div");
        overlay.className = "custom-modal-overlay";

        const modal = document.createElement("div");
        modal.className = "custom-modal-content";
        modal.style.maxWidth = "500px";

        modal.innerHTML = `
        <div class="custom-modal-icon">
            <i class="fa-solid fa-upload"></i>
        </div>
        <h2 class="custom-modal-title">Upload Presentation</h2>
        <p class="custom-modal-message">
            Choose how you want to upload your presentation
        </p>
        <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 1rem;">
            <button class="custom-modal-btn upload-option-btn" data-type="zip" style="
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                padding: 0.75em 1em;
                font-size: 1rem;
            ">
                <i class="fa-solid fa-file-zipper"></i>
                <span>Upload ZIP File</span>
            </button>
            <button class="custom-modal-btn upload-option-btn" data-type="folder" style="
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                padding: 0.75em 1em;
                font-size: 1rem;
            ">
                <i class="fa-solid fa-folder-open"></i>
                <span>Select Folder</span>
            </button>
        </div>
        <div class="custom-modal-buttons">
            <button class="custom-modal-btn custom-modal-btn-cancel">Cancel</button>
        </div>
    `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Handle button clicks
        modal.querySelector('[data-type="zip"]').onclick = () => {
            overlay.remove();
            zipInput.click();
        };

        modal.querySelector('[data-type="folder"]').onclick = () => {
            overlay.remove();
            folderInput.click();
        };

        const cancelBtn = modal.querySelector(".custom-modal-btn-cancel");
        cancelBtn.onclick = () => {
            overlay.remove();
        };

        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.remove();
        };

        // ESC key handler
        const escHandler = (e) => {
            if (e.key === "Escape") {
                overlay.remove();
                document.removeEventListener("keydown", escHandler);
            }
        };
        document.addEventListener("keydown", escHandler);
    }

    // SLIDE NAVIGATOR STARTS ////////////////////////////////////////
    const slideNavigator = document.getElementById("slide-navigator");

    function populateSlideNavigator() {
        slideNavigator.innerHTML = "";
        const slideNavigator2 = document.getElementById("slide-navigator-2");
        slideNavigator2.innerHTML = "";

        for (let i = 0; i < totalSlides; i++) {
            // Left navigator item (controls View 1 / main view)
            const item = document.createElement("div");
            item.className = "slide-nav-item";
            item.textContent = i + 1;
            item.dataset.slideIndex = i;
            item.onclick = () => goToSlide(i);
            slideNavigator.appendChild(item);

            // Right navigator item (controls View 2 only)
            const item2 = document.createElement("div");
            item2.className = "slide-nav-item";
            item2.textContent = i + 1;
            item2.dataset.slideIndex = i;
            item2.onclick = () => goToSlide2(i);
            slideNavigator2.appendChild(item2);
        }

        updateSlideNavigator();
        updateSlideNavigator2();
    }

    function updateSlideNavigator() {
        const items = document.querySelectorAll(".slide-nav-item");
        items.forEach((item, index) => {
            if (index === currentSlide) {
                item.classList.add("active");
                // Scroll into view
                item.scrollIntoView({ behavior: "smooth", block: "nearest" });
            } else {
                item.classList.remove("active");
            }
        });
    }

    function updateSlideNavigator2() {
        const items = document.querySelectorAll("#slide-navigator-2 .slide-nav-item");
        items.forEach((item, index) => {
            if (index === currentSlide2) {
                item.classList.add("active");
                item.scrollIntoView({ behavior: "smooth", block: "nearest" });
            } else {
                item.classList.remove("active");
            }
        });
    }
    // SLIDE NAVIGATOR ENDS ////////////////////////////////////////


    let zipFile = null;
    let slideConfigs = {};
    let mediaCache = {};
    let annotations = {};
    let currentSlide = 0;
    let totalSlides = 0;
    let currentSlide2 = 0;

    async function loadSlideConfig(slideIndex) {
        if (slideConfigs[slideIndex]) {
            return slideConfigs[slideIndex];
        }

        const configFileName = `config/s${slideIndex}.json`;
        const configFile = zipFile.file(configFileName);

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

    async function loadMediaFromPath(path) {
        if (mediaCache[path]) {
            return mediaCache[path];
        }

        const file = zipFile.file(path);
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

    let annotationSyncTimeout = null;
    annCvs.canvas.addEventListener("mouseup", () => syncAnnotations());
    annCvs.canvas.addEventListener("touchend", () => syncAnnotations());

    function syncAnnotations() {
        clearTimeout(annotationSyncTimeout);
        annotationSyncTimeout = setTimeout(() => {
            const annData = annCvs.canvas.toDataURL("image/png");
            // Save annotations locally per-slide and emit to server
            annotations[currentSlide] = annData;
            socket.emit("annotation_update", {
                annotations: annData,
                slideIndex: currentSlide,
            });
            if (isSplitView) {
                slotAnnCvs1.clear();
                slotAnnCvs2.clear();
                if (annotations[currentSlide]) {
                    slotAnnCvs1.loadAnnotations(annotations[currentSlide]);
                    slotAnnCvs2.loadAnnotations(annotations[currentSlide]);
                }
            }
        }, 100);
    }

    // Helper function to update all media element positions after resize
    function updateMediaPositions() {
        // Get the container's actual size on screen
        const rect = slide_canvas_container.getBoundingClientRect();

        // Update videos using stored fractional positions
        const videos = slide_canvas_container.querySelectorAll("video");
        videos.forEach((video) => {
            const x = parseFloat(video.dataset.videoX);
            const y = parseFloat(video.dataset.videoY);
            const width = parseFloat(video.dataset.videoWidth);
            const height = parseFloat(video.dataset.videoHeight);

            if (!isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height)) {
                video.style.left = `${x * rect.width}px`;
                video.style.top = `${y * rect.height}px`;
                video.style.width = `${width * rect.width}px`;
                video.style.height = `${height * rect.height}px`;
            }
        });

        // Update 3D models using stored fractional positions
        const models = slide_canvas_container.querySelectorAll("model-viewer");
        models.forEach((mv) => {
            const x = parseFloat(mv.dataset.modelX);
            const y = parseFloat(mv.dataset.modelY);
            const width = parseFloat(mv.dataset.modelWidth);
            const height = parseFloat(mv.dataset.modelHeight);

            if (!isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height)) {
                mv.style.left = `${x * rect.width}px`;
                mv.style.top = `${y * rect.height}px`;
                mv.style.width = `${width * rect.width}px`;
                mv.style.height = `${height * rect.height}px`;
            }
        });

        // Update widgets
        updateWidgetPositions(slide_canvas_container);
    }

    prevBtn.onClick(() => goToSlide(currentSlide - 1));
    nextBtn.onClick(() => goToSlide(currentSlide + 1));

    document.addEventListener("keydown", (e) => {
        if (surveyOverlayVisible || resultsOverlayVisible) return;
        if (e.key === "ArrowLeft") goToSlide(currentSlide - 1);
        if (e.key === "ArrowRight") goToSlide(currentSlide + 1);
    });

    async function goToSlide(slideIndex) {
        if (slideIndex < 0 || slideIndex >= totalSlides) return;

        currentSlide = slideIndex;
        await renderSlide(currentSlide);
        updateSlideNavigator();

        const annData = annCvs.canvas.toDataURL("image/png");
        socket.emit("slide_change", {
            slideIndex: currentSlide,
            annotations: annData,
        });

        if (isSplitView) {
            await renderSlideIntoSlots(currentSlide);
        }
    }

    async function goToSlide2(slideIndex) {
        if (slideIndex < 0 || slideIndex >= totalSlides) return;
        currentSlide2 = slideIndex;
        await renderSlot2(currentSlide2);
        updateSlideNavigator2();
    }

    // Helper: render a PDF page + media into one slot container
    async function renderIntoSlot(slideIndex, slotPdfCvs, slotAnnCvs, container) {
        if (!zipFile) return;

        const pdfFile = zipFile.file("slides.pdf");
        if (!pdfFile) return;

        const pdfData = await pdfFile.async("arraybuffer");
        const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
        const page = await pdfDoc.getPage(slideIndex + 1);

        await slotPdfCvs.renderPDFPage(page);

        // Mirror annotations
        slotAnnCvs.clear();
        if (annotations[slideIndex]) {
            await slotAnnCvs.loadAnnotations(annotations[slideIndex]);
        }

        // Always clear old media + widgets before rendering new ones
        const existingMedia = container.querySelectorAll("video, audio, model-viewer");
        existingMedia.forEach((el) => el.remove());
        cleanupWidgets(container);

        const slideConfig = await loadSlideConfig(slideIndex);
        if (!slideConfig) return;

        const containerRect = container.getBoundingClientRect();

        if (slideConfig.videos) {
            for (const v of slideConfig.videos) {
                const videoURL = await loadMediaFromPath(v.path);
                if (!videoURL) continue;

                const video = document.createElement("video");
                video.src = videoURL;
                video.volume = v.volume || 1.0;
                video.dataset.videoId = v.id;
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

                if (v.playMode === "once") { video.autoplay = true; video.loop = false; }
                if (v.playMode === "loop") { video.autoplay = true; video.loop = true; }
                if (v.playMode === "manual") { video.controls = true; }

                video.addEventListener("click", (ev) => {
                    try {
                        if (video.paused) video.play();
                        else video.pause();
                    } catch (e) {
                        console.error("Error toggling slot video:", e);
                    }
                    ev.stopPropagation();
                });

                container.appendChild(video);
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

                container.appendChild(mv);
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

                container.appendChild(audio);
            }
        }

        if (slideConfig.widgets) {
            renderWidgets(slideConfig, container, zipFile);
        }
    }

    async function renderSlot1(slideIndex) {
        await renderIntoSlot(slideIndex, slotPdfCvs1, slotAnnCvs1, slotPdfContainer1);
    }

    async function renderSlot2(slideIndex) {
        await renderIntoSlot(slideIndex, slotPdfCvs2, slotAnnCvs2, slotPdfContainer2);
    }

    // Kept for backward-compat with resize/fullscreen handlers
    async function renderSlideIntoSlots(slideIndex) {
        await renderSlot1(slideIndex);
        await renderSlot2(currentSlide2);
    }

    async function renderSlide(slideIndex) {
        console.log("renderSlide called:", slideIndex);

        if (!zipFile) {
            console.log("No ZIP file loaded");
            return;
        }

        const pdfFile = zipFile.file("slides.pdf");
        if (!pdfFile) {
            console.error("No slides.pdf found in ZIP");
            return;
        }

        const pdfData = await pdfFile.async("arraybuffer");
        const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
        const page = await pdfDoc.getPage(slideIndex + 1);

        await pdfCvs.renderPDFPage(page);

        // Load per-slide annotations (clear then draw saved image if present)
        try {
            annCvs.clear();
            if (annotations[slideIndex]) {
                await annCvs.loadAnnotations(annotations[slideIndex]);
            } else {
                annCvs.resetHistory();
            }
        } catch (e) {
            console.warn("Error loading annotations for slide", slideIndex, e);
        }

        // Clear old media
        const existingMedia = slide_canvas_container.querySelectorAll(
            "video, audio, model-viewer",
        );
        existingMedia.forEach((el) => el.remove());
        // Clear old widgets
        cleanupWidgets(slide_canvas_container);

        const slideConfig = await loadSlideConfig(slideIndex);

        if (!slideConfig) {
            console.log("No config for this slide");
            return;
        }

        console.log("Videos to render:", slideConfig.videos?.length || 0);
        console.log("Models to render:", slideConfig.models?.length || 0);
        console.log("Widgets to render:", slideConfig.widgets?.length || 0);

        // Get container's actual size for positioning all media elements
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

                video.addEventListener("play", () => {
                    socket.emit("video_action", {
                        videoId: v.id,
                        slideIndex: currentSlide,
                        action: "play",
                        currentTime: video.currentTime,
                    });
                });

                video.addEventListener("pause", () => {
                    socket.emit("video_action", {
                        videoId: v.id,
                        slideIndex: currentSlide,
                        action: "pause",
                        currentTime: video.currentTime,
                    });
                });

                // Allow clicking the video to toggle play/pause
                video.addEventListener("click", (ev) => {
                    // Only toggle when in hand mode (clicks should pass through otherwise)
                    try {
                        if (video.paused) video.play();
                        else video.pause();
                    } catch (e) {
                        console.error("Error toggling video playback:", e);
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

                mv.addEventListener("camera-change", () => {
                    const camera = mv.getCameraOrbit();
                    const target = mv.getCameraTarget();
                    socket.emit("model_interaction", {
                        modelId: m.id,
                        slideIndex: currentSlide,
                        camera: {
                            theta: camera.theta,
                            phi: camera.phi,
                            radius: camera.radius,
                        },
                        target: {
                            x: target.x,
                            y: target.y,
                            z: target.z,
                        },
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
            renderWidgets(slideConfig, slide_canvas_container, zipFile);
        }
    }

    folderInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files);
        if (!files || files.length === 0) return;
        console.log("Folder selected with", files.length, "files");

        const uploadModal = Modal.loading(
            "Uploading Presentation",
            "Please wait while your presentation is uploaded...",
        );

        // Create a ZIP file from the selected folder
        const zip = new JSZip();
        // we can use JSZip because we have an HTML script for it (Cloudflare)

        // Add all files to the ZIP, preserving folder structure
        for (const file of files) {
            // Get the relative path from the file's webkitRelativePath
            const relativePath = file.webkitRelativePath;
            // Remove the first folder name to get the path relative to the selected folder
            const pathParts = relativePath.split("/");
            const zipPath = pathParts.slice(1).join("/");

            if (zipPath) {
                const fileData = await file.arrayBuffer();
                zip.file(zipPath, fileData);
            }
        }

        console.log("Creating ZIP from folder...");
        const zipBlob = await zip.generateAsync({ type: "blob" });

        const formData = new FormData();
        formData.append("file", zipBlob, "presentation.zip");

        try {
            const response = await fetch("/api/presentation/upload", {
                method: "POST",
                body: formData,
            });

            const data = await response.json();
            console.log("Upload response:", data);

            if (data.success) {
                await loadAvailableModels();

                console.log(
                    `Presentation uploaded with ${data.models_found} Summarizer Script`,
                );
                if (data.models && data.models.length > 0) {
                    console.log("Available AI models:", data.models);
                }
            }
        } catch (error) {
            console.error("Error uploading presentation:", error);
            uploadModal.close();
            Modal.error(
                "Upload Failed",
                "Failed to upload presentation. Please try again.",
            );
            return;
        }

        // Load the ZIP we just created into memory for frontend use
        zipFile = zip;
        console.log("ZIP loaded into memory");

        const pdfFile = zipFile.file("slides.pdf");
        if (!pdfFile) {
            console.error(
                "The uploaded package is not a valid Beamer+ presentation (no slides.pdf found).",
            );
            uploadModal.close();
            Modal.error(
                "Invalid Presentation",
                "The uploaded package is not a valid Beamer+ presentation.",
            );
            return;
        }

        const pdfData = await pdfFile.async("arraybuffer");
        const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
        totalSlides = pdfDoc.numPages;

        console.log(`Total slides: ${totalSlides}`);

        currentSlide = 0;
        slideConfigs = {};
        mediaCache = {};

        await renderSlide(0);

        // Populate slide navigator
        populateSlideNavigator();

        socket.emit("presentation_loaded", {
            totalSlides: totalSlides,
        });
        // Enable controls now that a presentation is loaded
        uploadModal.close();
        setControlsEnabledAfterUpload(true, __beamer_controls);

        // Enable screen share button
        screenShareBtn.el.disabled = false;
        screenShareBtn.el.style.opacity = "1";
        screenShareBtn.el.style.cursor = "pointer";

        // Enable record button
        recordBtn.el.disabled = false;
        recordBtn.el.style.opacity = "1";
        recordBtn.el.style.cursor = "pointer";

        updateHistoryButtons();
    });

    zipInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        console.log("ZIP file selected:", file.name);

        const uploadModal = Modal.loading(
            "Uploading Presentation",
            "Please wait while your presentation is uploaded...",
        );

        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch("/api/presentation/upload", {
                method: "POST",
                body: formData,
            });

            const data = await response.json();
            console.log("Upload response:", data);

            if (data.success) {
                await loadAvailableModels();

                console.log(
                    `Presentation uploaded with ${data.models_found} Summarizer Script`,
                );
                if (data.models && data.models.length > 0) {
                    console.log("Available AI models:", data.models);
                }
            }
        } catch (error) {
            console.error("Error uploading presentation:", error);
            uploadModal.close();
            Modal.error(
                "Upload Failed",
                "Failed to upload presentation. Please try again.",
            );
            return;
        }

        // Load the ZIP into memory for frontend use
        const reader = new FileReader();
        reader.onload = async (event) => {
            zipFile = await JSZip.loadAsync(event.target.result);
            console.log("ZIP loaded into memory");

            const pdfFile = zipFile.file("slides.pdf");
            if (!pdfFile) {
                console.error(
                    "The uploaded package is not a valid Beamer+ presentation (no slides.pdf found).",
                );
                uploadModal.close();
                Modal.error(
                    "Invalid Presentation",
                    "The uploaded package is not a valid Beamer+ presentation.",
                );
                return;
            }

            const pdfData = await pdfFile.async("arraybuffer");
            const pdfDoc = await pdfjsLib.getDocument({ data: pdfData })
                .promise;
            totalSlides = pdfDoc.numPages;

            console.log(`Total slides: ${totalSlides}`);

            currentSlide = 0;
            slideConfigs = {};
            mediaCache = {};

            await renderSlide(0);

            // Populate slide navigator
            populateSlideNavigator();

            socket.emit("presentation_loaded", {
                totalSlides: totalSlides,
            });
            // Enable controls now that a presentation is loaded
            uploadModal.close();
            setControlsEnabledAfterUpload(true, __beamer_controls);

            // Enable screen share button
            screenShareBtn.el.disabled = false;
            screenShareBtn.el.style.opacity = "1";
            screenShareBtn.el.style.cursor = "pointer";

            // Enable record button
            recordBtn.el.disabled = false;
            recordBtn.el.style.opacity = "1";
            recordBtn.el.style.cursor = "pointer";

            updateHistoryButtons();
        };
        reader.readAsArrayBuffer(file);
    });

    async function loadAvailableModels() {
        try {
            const response = await fetch("/api/models");
            const data = await response.json();
            availableModels = data.models || [];
            console.log("Available AI models:", availableModels);
        } catch (error) {
            console.error("Error loading models:", error);
            availableModels = [];
        }
    }

    // Survey functionality
    let currentSurveyResults = null;
    let currentSurveyData = null;
    let resultsOverlayVisible = false;
    let surveyOverlayVisible = false;

    // Survey Button - Opens creation modal
    surveyBtn.onClick(() => {
        if (availableModels.length === 0) {
            Modal.warning(
                "No Presentation Loaded",
                "Please upload a presentation.",
            );
            return;
        }

        const modal = document.createElement("div");
        modal.className = "modal-overlay";
        modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <h2 style="margin-bottom: 1.5rem; font-family: 'Computer Modern Sans', sans-serif; color: #333;">Survey</h2>
            
            <div style="margin-bottom: 1.5rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; font-family: 'Computer Modern Sans', sans-serif; color: #555;">Question (optional):</label>
                <input 
                    type="text" 
                    id="survey-question"
                    placeholder="What do you think about...?"
                    style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; font-family: 'Computer Modern Sans', sans-serif; box-sizing: border-box;"
                />
                <div style="margin-top: 0.5rem; font-size: 0.85rem; color: #666; font-family: 'Computer Modern Sans', sans-serif;">
                    Leave blank for generic survey
                </div>
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; font-family: 'Computer Modern Sans', sans-serif; color: #555;">Summarizer Script:</label>
                <select 
                    id="survey-model"
                    style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; background: white; font-family: 'Computer Modern Sans', sans-serif; box-sizing: border-box;"
                >
                </select>
                <div style="margin-top: 0.5rem; font-size: 0.85rem; color: #666; font-family: 'Computer Modern Sans', sans-serif;">
                    This script will be used to summarize survey responses
                </div>
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; font-family: 'Computer Modern Sans', sans-serif; color: #555;">Number of Summaries:</label>
                <input 
                    type="number" 
                    id="survey-num-summaries" 
                    min="1" 
                    max="10" 
                    value="3"
                    style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; font-family: 'Computer Modern Sans', sans-serif; box-sizing: border-box;"
                />
                <div style="margin-top: 0.5rem; font-size: 0.85rem; color: #666; font-family: 'Computer Modern Sans', sans-serif;">
                    Generate 1-10 different summary variations
                </div>
            </div>
            
            <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                <button 
                    id="cancel-survey-modal" 
                    class="btn"
                    style="font-family: 'Computer Modern Sans', sans-serif;"
                >
                    <i class="fa-solid fa-xmark"></i>
                </button>
                <button 
                    id="create-survey-btn" 
                    class="btn"
                    style=" font-family: 'Computer Modern Sans', sans-serif;"
                >
                    <i class="fa-solid fa-share-from-square"></i>
                </button>
            </div>
        </div>
    `;
        document.body.appendChild(modal);

        // Populate model dropdown
        const modelSelect = document.getElementById("survey-model");
        availableModels.forEach((model) => {
            const option = document.createElement("option");
            option.value = model;
            option.textContent = model
                .replace(/_/g, " ")
                .replace(/\b\w/g, (l) => l.toUpperCase());
            modelSelect.appendChild(option);
        });

        if (availableModels.length > 0) {
            modelSelect.value = availableModels[0];
        }

        document.getElementById("survey-question").focus();

        document.getElementById("cancel-survey-modal").onclick = () => {
            document.body.removeChild(modal);
        };

        document.getElementById("create-survey-btn").onclick = async () => {
            const question =
                document.getElementById("survey-question").value.trim() ||
                "Survey";
            const model = document.getElementById("survey-model").value;
            const numSummaries = parseInt(
                document.getElementById("survey-num-summaries").value,
            );

            if (!model) {
                Modal.warning(
                    "No Model Selected",
                    "Please select an AI model.",
                );
                return;
            }

            if (isNaN(numSummaries) || numSummaries < 1 || numSummaries > 10) {
                Modal.warning(
                    "Invalid Number",
                    "Number of summaries must be between 1 and 10.",
                );
                return;
            }

            try {
                const response = await fetch("/api/survey/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        question,
                        model,
                        num_summaries: numSummaries,
                    }),
                });

                const data = await response.json();

                if (!response.ok) {
                    Modal.error(
                        "Survey Creation Failed",
                        data.error || "Failed to create survey",
                    );
                    return;
                }

                document.body.removeChild(modal);

                currentSurveyData = {
                    ...data,
                    model,
                    num_summaries: numSummaries,
                    question,
                };

                // Reset results when creating new survey
                currentSurveyResults = null;

                // Disable results button until we have results
                surveyResultsBtn.el.disabled = true;
                surveyResultsBtn.el.style.opacity = "0.5";
                surveyResultsBtn.el.style.cursor = "not-allowed";

                socket.emit("survey_show", data);
                showSurveyOverlay();
            } catch (error) {
                console.error("Error creating survey:", error);
                Modal.error(
                    "Survey Creation Failed",
                    "Failed to create survey. Please try again.",
                );
            }
        };

        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        };
    });

    function updateSurveyOverlayPosition() {
        const overlay = document.getElementById("survey-overlay");
        if (!overlay) return;

        const pdfContainer = document.getElementById("pdf-canvas");
        const containerRect = pdfContainer.getBoundingClientRect();

        overlay.style.top = `${containerRect.top}px`;
        overlay.style.left = `${containerRect.left}px`;
        overlay.style.width = `${containerRect.width}px`;
        overlay.style.height = `${containerRect.height}px`;
    }

    function showSurveyOverlay() {
        if (!currentSurveyData) return;

        surveyOverlayVisible = true;
        disableControlButtons(true, __beamer_all_buttons, surveyResultsBtn);

        const pdfContainer = document.getElementById("pdf-canvas");
        const containerRect = pdfContainer.getBoundingClientRect();

        const surveyUrl = `${window.location.origin}${currentSurveyData.url}`;

        const overlay = document.createElement("div");
        overlay.id = "survey-overlay";
        overlay.style.position = "fixed";
        overlay.style.top = `${containerRect.top}px`;
        overlay.style.left = `${containerRect.left}px`;
        overlay.style.width = `${containerRect.width}px`;
        overlay.style.height = `${containerRect.height}px`;
        overlay.style.backgroundColor = "#ffffff";
        overlay.style.zIndex = "1000";
        overlay.style.display = "flex";
        overlay.style.flexDirection = "column";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.padding = "2rem";
        overlay.style.boxSizing = "border-box";
        overlay.style.overflow = "auto";
        overlay.style.fontFamily = "'Computer Modern Sans', sans-serif";

        overlay.innerHTML = `
        <div style="max-width: 600px; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 2rem;">
            <h2 style="font-family: 'Computer Modern Sans', sans-serif; color: #333; font-size: 2rem; margin: 0; text-align: center; font-weight: 300;">
                ${currentSurveyData.question || "Survey"}
                <br>
                <span style="font-size: 0.9rem; color: #666; font-weight: normal;">(scan the QR code below or navigate to the URL to respond)</span>
            </h2>
            
            <div style="background: #f8f9fa; padding: 2rem; border-radius: 8px; display: flex; flex-direction: column; align-items: center; gap: 1.5rem; width: 100%;">
                <div id="qrcode" style="padding: 1rem; background: white; border-radius: 4px;"></div>
                
                <div style="width: 100%;">
                    <input 
                        type="text" 
                        readonly 
                        value="${surveyUrl}" 
                        onclick="this.select()"
                        style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; font-family: 'Computer Modern Sans', sans-serif; text-align: center; background: white; font-size: 0.9rem; box-sizing: border-box;"
                    />
                </div>
            </div>
            
            <div style="font-family: 'Computer Modern Sans', sans-serif; color: #666; font-size: 1rem; border: 2px solid #e0e0e0; padding: 0.75rem 1.5rem; background: white;">
                <span style="font-weight: 500; color: #333;">Responses:</span> <span id="response-count" style="font-weight: 600; color: #333;">0</span>
            </div>
            

        </div>
    `;

        document.body.appendChild(overlay);

        new QRCode(document.getElementById("qrcode"), {
            text: surveyUrl,
            width: 200,
            height: 200,
            colorDark: "#333333",
            colorLight: "#ffffff",
        });

        socket.on("survey_response", (data) => {
            if (data.survey_id === currentSurveyData.survey_id) {
                document.getElementById("response-count").textContent =
                    data.total;
            }
        });
    }

    function hideSurveyOverlay() {
        surveyOverlayVisible = false;
        disableControlButtons(false, __beamer_all_buttons, surveyResultsBtn);

        const overlay = document.getElementById("survey-overlay");
        if (overlay) {
            document.body.removeChild(overlay);
        }
    }

    // Results Button - Toggle between show/hide results
    surveyResultsBtn.onClick(async () => {
        // If results are already showing, just hide them
        if (resultsOverlayVisible) {
            hideSurveyResultsOverlay();
            return;
        }

        // Check if we have a survey
        if (!currentSurveyData) {
            Modal.info("No Survey", "Please create a survey first.");
            return;
        }

        // If we already have results, just show them
        if (currentSurveyResults) {
            showSurveyResultsOverlay();
            return;
        }

        // Close the survey if it's still open
        if (surveyOverlayVisible) {
            await fetch(`/api/survey/${currentSurveyData.survey_id}/close`, {
                method: "POST",
            });
            socket.emit("survey_close", {
                survey_id: currentSurveyData.survey_id,
            });
            hideSurveyOverlay();
        }

        // Show loading modal
        const loadingModal = Modal.loading(
            "Generating Summaries",
            "Please wait while the responses are analyzed...",
        );

        try {
            const response = await fetch(
                `/api/survey/${currentSurveyData.survey_id}/responses`,
            );
            const data = await response.json();

            if (data.responses.length === 0) {
                loadingModal.close();
                // No responses — survey already closed above; do nothing further.
                return;
            }

            const analyzeResponse = await fetch(
                `/api/survey/${currentSurveyData.survey_id}/analyze`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                },
            );

            if (!analyzeResponse.ok) {
                const errorData = await analyzeResponse.json();
                throw new Error(errorData.error || "Analysis failed");
            }

            const analysisData = await analyzeResponse.json();

            currentSurveyResults = {
                summaries: analysisData.summaries,
                model: analysisData.model,
                num_responses: analysisData.num_responses,
            };

            console.log("Analysis complete:", currentSurveyResults);

            // Close loading modal
            loadingModal.close();

            // Enable the results button for future clicks
            surveyResultsBtn.el.disabled = false;
            surveyResultsBtn.el.style.opacity = "1";
            surveyResultsBtn.el.style.cursor = "pointer";

            // Show results overlay
            showSurveyResultsOverlay();
        } catch (error) {
            console.error("Error processing responses:", error);
            loadingModal.close();
            Modal.error(
                "Analysis Failed",
                "There was an error summarizing the responses.",
            );
        }
    });

    let currentResultIndex = 0;

    // Use UI helper `disableControlButtons` from beamer_ui.js

    function updateSurveyResultsOverlayPosition() {
        const overlay = document.getElementById("survey-results-overlay");
        if (!overlay) return;

        const pdfContainer = document.getElementById("pdf-canvas");
        const containerRect = pdfContainer.getBoundingClientRect();

        overlay.style.top = `${containerRect.top}px`;
        overlay.style.left = `${containerRect.left}px`;
        overlay.style.width = `${containerRect.width}px`;
        overlay.style.height = `${containerRect.height}px`;
    }

    function showSurveyResultsOverlay() {
        if (
            !currentSurveyResults ||
            !currentSurveyResults.summaries ||
            currentSurveyResults.summaries.length === 0
        ) {
            Modal.info("No Results", "No survey results available.");
            return;
        }

        // Set this BEFORE disabling buttons to prevent flash
        resultsOverlayVisible = true;
        currentResultIndex = 0;

        disableControlButtons(true, __beamer_all_buttons, surveyResultsBtn);

        const pdfContainer = document.getElementById("pdf-canvas");
        const containerRect = pdfContainer.getBoundingClientRect();

        const overlay = document.createElement("div");
        overlay.id = "survey-results-overlay";
        overlay.style.position = "fixed";
        overlay.style.top = `${containerRect.top}px`;
        overlay.style.left = `${containerRect.left}px`;
        overlay.style.width = `${containerRect.width}px`;
        overlay.style.height = `${containerRect.height}px`;
        overlay.style.backgroundColor = "#ffffff";
        overlay.style.zIndex = "1000";
        overlay.style.display = "flex";
        overlay.style.flexDirection = "column";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.padding = "2rem";
        overlay.style.boxSizing = "border-box";
        overlay.style.overflow = "auto";
        overlay.style.fontFamily = "'Computer Modern Sans', sans-serif";

        const numSummaries = currentSurveyResults.summaries.length;

        overlay.innerHTML = `
        <div style="max-width: 800px; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 2rem;">
            <div id="result-content" style="text-align: center; min-height: 300px; display: flex; flex-direction: column; justify-content: center; gap: 1rem; width: 100%;">
                <!-- Content will be inserted here -->
            </div>
            
            <div style="display: flex; gap: 1rem; align-items: center;">
                <button id="prev-result" class="btn">
                    <i class="fa-solid fa-arrow-left"></i>
                </button>
                <span id="result-counter" style="font-family: 'Computer Modern Sans', sans-serif; color: #666; font-size: 1rem;">
                    1 / ${numSummaries}
                </span>
                <button id="next-result" class="btn">
                    <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(overlay);

        document.getElementById("prev-result").addEventListener("click", () => {
            if (currentResultIndex > 0) {
                currentResultIndex--;
                updateResultDisplay();
            }
        });

        document.getElementById("next-result").addEventListener("click", () => {
            if (
                currentResultIndex <
                currentSurveyResults.summaries.length - 1
            ) {
                currentResultIndex++;
                updateResultDisplay();
            }
        });

        updateResultDisplay();
    }

    function hideSurveyResultsOverlay() {
        resultsOverlayVisible = false;

        disableControlButtons(false, __beamer_all_buttons, surveyResultsBtn);

        const overlay = document.getElementById("survey-results-overlay");
        if (overlay) {
            document.body.removeChild(overlay);
        }
    }

    function updateResultDisplay() {
        const contentDiv = document.getElementById("result-content");
        const counterSpan = document.getElementById("result-counter");
        const prevBtn = document.getElementById("prev-result");
        const nextBtn = document.getElementById("next-result");

        if (
            !contentDiv ||
            !currentSurveyResults ||
            !currentSurveyResults.summaries
        )
            return;

        const summaryData = currentSurveyResults.summaries[currentResultIndex];
        const totalSummaries = currentSurveyResults.summaries.length;

        contentDiv.innerHTML = `
        <h2 style="font-family: 'Computer Modern Sans', sans-serif; color: #333; font-size: 2rem; margin: 0; font-weight: 300;">
            ${currentSurveyData.question || "Survey Response Summaries"}
            <br>
            <span style="font-size: 0.9rem; color: #666; font-weight: normal;">(based on ${summaryData.num_respondents} response${summaryData.num_respondents !== 1 ? "s" : ""})</span>
        </h2>
        <div style="font-family: 'Computer Modern Sans', sans-serif; color: #333; font-size: 1.1rem; line-height: 1.8; margin: 1.5rem 0; text-align: center; max-width: 700px; padding: 2rem; background: #f8f9fa; border: 2px solid #666; border-radius: 4px;">
            ${summaryData.summary}
        </div>
    `;

        counterSpan.textContent = `${currentResultIndex + 1} / ${totalSummaries}`;

        prevBtn.disabled = currentResultIndex === 0;
        nextBtn.disabled = currentResultIndex === totalSummaries - 1;

        prevBtn.style.opacity = prevBtn.disabled ? "0.5" : "1";
        nextBtn.style.opacity = nextBtn.disabled ? "0.5" : "1";
        prevBtn.style.cursor = prevBtn.disabled ? "not-allowed" : "pointer";
        nextBtn.style.cursor = nextBtn.disabled ? "not-allowed" : "pointer";
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && resultsOverlayVisible) {
            hideSurveyResultsOverlay();
        }
    });

    // Add resize listener to update overlay positions
    window.addEventListener("resize", () => {
        if (surveyOverlayVisible) {
            updateSurveyOverlayPosition();
        }
        if (resultsOverlayVisible) {
            updateSurveyResultsOverlayPosition();
        }

        // Resize annotation canvas to maintain proper mouse coordinate mapping
        if (annCvs) {
            annCvs.resize();
        }

        if (isSplitView) {
            slotAnnCvs1.resize();
            slotAnnCvs2.resize();
            if (zipFile) renderSlideIntoSlots(currentSlide);
        }

        // Update positions of all media elements (videos, models, widgets)
        if (zipFile && slideConfigs[currentSlide]) {
            updateMediaPositions();
        }
    });

    // Add fullscreen change listener to handle fullscreen transitions
    document.addEventListener("fullscreenchange", () => {
        // Need a small delay for the browser to finish the fullscreen transition
        setTimeout(() => {
            if (surveyOverlayVisible) {
                updateSurveyOverlayPosition();
            }
            if (resultsOverlayVisible) {
                updateSurveyResultsOverlayPosition();
            }

            if (annCvs) {
                annCvs.resize();
            }

            if (isSplitView) {
                slotAnnCvs1.resize();
                slotAnnCvs2.resize();
                if (zipFile) renderSlideIntoSlots(currentSlide);
            }

            if (zipFile && slideConfigs[currentSlide]) {
                updateMediaPositions();
            }
        }, 100);
    });

    // ==================== SCREEN SHARING ====================
    let screenStream = null;
    let isScreenSharing = false;

    // ==================== RECORDING ====================
    let isRecording = false;
    let mediaRecorder = null;
    let recordedChunks = [];
    let recordingCanvas = null;
    let recordingStream = null;
    let audioStream = null;
    let micStream = null;

    recordBtn.onClick(async () => {
        if (isRecording) {
            stopRecording();
        } else {
            await startRecording();
        }
    });

    async function startRecording() {
        if (!isScreenSharing) {
            Modal.error(
                "Recording Error",
                "Please start screen sharing before recording.",
            );
            return;
        }

        try {
            // Get the canvas that's being used for screen sharing
            const pdfContainer = document.getElementById("pdf-canvas");

            // Create a new canvas for recording
            recordingCanvas = document.createElement("canvas");
            recordingCanvas.width = pdfContainer.getBoundingClientRect().width;
            recordingCanvas.height =
                pdfContainer.getBoundingClientRect().height;

            // Create a stream from the canvas at 30 FPS
            recordingStream = recordingCanvas.captureStream(30);

            // Request microphone audio
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                });
                micStream
                    .getAudioTracks()
                    .forEach((track) => recordingStream.addTrack(track));
            } catch (error) {
                console.warn("Microphone not captured:", error);
            }

            // Request system audio (will prompt user)
            try {
                audioStream = await navigator.mediaDevices.getDisplayMedia({
                    video: false,
                    audio: true,
                });
                audioStream
                    .getAudioTracks()
                    .forEach((track) => recordingStream.addTrack(track));
            } catch (audioError) {
                console.warn("System audio not captured:", audioError);
            }

            // Create MediaRecorder to record in real-time
            recordedChunks = [];
            mediaRecorder = new MediaRecorder(recordingStream, {
                mimeType: "video/webm;codecs=vp9",
                videoBitsPerSecond: 2500000,
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };

            mediaRecorder.start(100); // Collect data every 100ms

            isRecording = true;

            // Update button appearance
            recordBtn.el.innerHTML = '<i class="fa-solid fa-stop"></i>';
            recordBtn.el.style.backgroundColor = "#e74c3c";

            console.log("Recording started");
        } catch (error) {
            console.error("Error starting recording:", error);
            Modal.error(
                "Recording Error",
                "Could not start recording: " + error.message,
            );
        }
    }

    async function stopRecording() {
        if (!isRecording || !mediaRecorder) return;

        isRecording = false;

        // Reset button appearance
        recordBtn.el.innerHTML = '<i class="fa-solid fa-circle"></i>';
        recordBtn.el.style.backgroundColor = "";

        console.log("Recording stopped. Processing video...");

        // Show processing modal with loading animation
        const processingModal = Modal.loading(
            "Processing Video",
            "Please wait while your recording is being processed and downloaded...",
        );

        return new Promise((resolve, reject) => {
            mediaRecorder.onstop = () => {
                try {
                    const blob = new Blob(recordedChunks, {
                        type: "video/webm",
                    });
                    const url = URL.createObjectURL(blob);

                    // Download the video
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `beamer-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    // Clean up
                    recordedChunks = [];
                    if (micStream) {
                        micStream.getTracks().forEach((track) => track.stop());
                        micStream = null;
                    }
                    if (audioStream) {
                        audioStream
                            .getTracks()
                            .forEach((track) => track.stop());
                        audioStream = null;
                    }
                    if (recordingStream) {
                        recordingStream
                            .getTracks()
                            .forEach((track) => track.stop());
                        recordingStream = null;
                    }
                    recordingCanvas = null;

                    processingModal.close();
                    Modal.success(
                        "Recording Complete",
                        "Your video has been downloaded successfully!",
                    );
                    resolve();
                } catch (error) {
                    console.error("Error processing video:", error);
                    processingModal.close();
                    Modal.error(
                        "Recording Error",
                        "Failed to process video: " + error.message,
                    );
                    reject(error);
                }
            };

            mediaRecorder.stop();
        });
    }

    screenShareBtn.onClick(async () => {
        if (isScreenSharing) {
            stopScreenShare();
        } else {
            await startScreenShare();
        }
    });

    async function startScreenShare() {
        try {
            // Request screen capture - restrict to current tab only
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: "always", // always show cursor (other options: 'moving', 'never')
                    displaySurface: "browser", // this determines which displaySurface
                    //  (tab/window/monitor) the picker defaults to. 'browser' means 'tab'.
                },
                audio: false,
                selfBrowserSurface: "include",
                surfaceSwitching: "exclude",
                systemAudio: "exclude",
            });

            // Check if the user selected the correct surface type
            const videoTrack = stream.getVideoTracks()[0];
            const settings = videoTrack.getSettings();

            // check by regex if the user is on Safari:
            const isSafari = /^((?!chrome|android).)*safari/i.test(
                navigator.userAgent,
            );
            console.log(`isSafari: ${isSafari}`);

            if (!isSafari) {
                // Verify that a browser tab was selected (not window or monitor)
                if (
                    settings.displaySurface &&
                    settings.displaySurface !== "browser"
                ) {
                    // Stop the stream immediately
                    stream.getTracks().forEach((track) => track.stop());

                    Modal.error(
                        "Wrong Source Selected",
                        'Please select the Beamer+ browser tab (not a window or entire screen). Click the screen share button again and choose "This Tab" or the Beamer+ tab from the list.',
                    );
                    isScreenSharing = false;
                    return;
                }
            }
            // We don't do the above check for Safari, because 'browser' screensharing
            // (i.e. tab screensharing) is not possible on Safari.

            screenStream = stream; // assign the global "state" variable <screenStream>
            isScreenSharing = true; // assign the global "state" variable <isScreenSharing>

            // Update button appearance
            screenShareBtn.el.innerHTML =
                '<i class="fa-solid fa-eye-slash"></i>';

            // Create a hidden video element to capture the stream
            const video = document.createElement("video");
            video.style.display = "none"; // -> not displayed. invisible.
            video.srcObject = stream;
            video.play();

            document.body.appendChild(video);

            // Create canvas for cropping
            const cropCanvas = document.createElement("canvas");
            const cropCtx = cropCanvas.getContext("2d");

            // the <video> var captures the whole tab/window/monitor (whatever wass selected)
            // the <cropCanvas> will hold the, well, just the slide

            // Get the canvas container dimensions
            const pdfContainer = document.getElementById("pdf-canvas");

            let lastFrameTime = 0;
            const frameInterval = 100; // Reduced to 10 FPS to prevent flashing

            // Start capturing and cropping frames
            const captureFrame = (currentTime) => {
                if (!isScreenSharing) return;

                // Throttle frame rate:
                // if (not enough time has passed) {exit}
                if (currentTime - lastFrameTime < frameInterval) {
                    requestAnimationFrame(captureFrame);
                    return;
                }
                lastFrameTime = currentTime;

                const containerRect = pdfContainer.getBoundingClientRect();

                // Set canvas size to match the container
                cropCanvas.width = containerRect.width;
                cropCanvas.height = containerRect.height;

                // Calculate the position and size to crop from the video
                // This assumes the video is capturing the full screen
                const scaleX = video.videoWidth / window.innerWidth;
                const scaleY = video.videoHeight / window.innerHeight;

                const sourceX = containerRect.left * scaleX;
                const sourceY = containerRect.top * scaleY;
                const sourceWidth = containerRect.width * scaleX;
                const sourceHeight = containerRect.height * scaleY;

                // Draw the cropped region onto the canvas
                cropCtx.drawImage(
                    video,
                    sourceX,
                    sourceY,
                    sourceWidth,
                    sourceHeight,
                    0,
                    0,
                    cropCanvas.width,
                    cropCanvas.height,
                );

                // If recording, draw to recording canvas in real-time
                if (isRecording && recordingCanvas) {
                    const recordingCtx = recordingCanvas.getContext("2d");
                    // Update canvas size if needed
                    if (
                        recordingCanvas.width !== cropCanvas.width ||
                        recordingCanvas.height !== cropCanvas.height
                    ) {
                        recordingCanvas.width = cropCanvas.width;
                        recordingCanvas.height = cropCanvas.height;
                    }
                    // Draw the current frame to the recording canvas
                    recordingCtx.drawImage(cropCanvas, 0, 0);
                }

                // Convert canvas to blob and emit to server
                cropCanvas.toBlob(
                    (blob) => {
                        if (blob && isScreenSharing) {
                            // Convert blob to base64
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                const base64data = reader.result;
                                socket.emit("screen_frame", {
                                    frame: base64data,
                                    width: cropCanvas.width,
                                    height: cropCanvas.height,
                                });
                            };
                            reader.readAsDataURL(blob);
                        }
                    },
                    "image/jpeg",
                    0.75,
                ); // Reduced quality to 75% for less bandwidth

                // Request next frame
                if (isScreenSharing) {
                    requestAnimationFrame(captureFrame);
                }
            };

            // Wait for video to be ready
            video.onloadedmetadata = () => {
                requestAnimationFrame(captureFrame);
            };

            // Handle stream end (user clicks "Stop sharing" in browser)
            stream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };

            // Notify viewers that screen sharing has started
            socket.emit("screen_share_start");

            // Show a helper message
            console.log("Screen sharing started. Sharing Beamer+ tab.");
        } catch (error) {
            console.error("Error starting screen share:", error);

            let errorMessage = "Could not start screen sharing.";
            if (error.name === "NotAllowedError") {
                errorMessage =
                    'Screen sharing permission was denied. Please allow screen sharing and select the Beamer+ tab (choose "This Tab" option).';
            } else if (error.name === "NotFoundError") {
                errorMessage =
                    "No screen sharing source was selected. Please click the button again and select the Beamer+ tab.";
            } else if (error.name === "NotSupportedError") {
                errorMessage =
                    "Screen sharing is not supported in this browser. Please use Chrome, Firefox, or Edge.";
            }

            Modal.error("Screen Share Error", errorMessage);
            isScreenSharing = false;
        }
    }

    function stopScreenShare() {
        if (screenStream) {
            screenStream.getTracks().forEach((track) => track.stop());
            screenStream = null;
        }

        isScreenSharing = false;

        // If recording is active, stop it
        if (isRecording) {
            stopRecording();
        }

        // Reset button appearance
        screenShareBtn.el.innerHTML = '<i class="fa-solid fa-desktop"></i>';
        screenShareBtn.el.style.backgroundColor = "";

        // Remove the hidden video element
        const videos = document.querySelectorAll(
            'video[style*="display: none"]',
        );
        videos.forEach((v) => v.remove());

        // Notify viewers that screen sharing has stopped
        socket.emit("screen_share_stop");
    }
});
