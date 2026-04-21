import { Timer } from './timer.js';
import { Label } from './label.js';
import { Button } from './button.js';
import { Selector } from './selector.js';
import { Toggle } from './toggle.js';
import { Canvas } from './canvas.js';
import { renderWidgets, cleanupWidgets, updateWidgetPositions } from './iframe-widget-renderer.js';
import { Modal } from './beamer_modal.js';
import { setControlsEnabledAfterUpload, disableControlButtons } from './beamer_ui.js';
import { addHoldListener } from './events.js';

const socket = io();
socket.emit('join_presenter');

// Available AI models (loaded from presentation ZIP)
let availableModels = [];

window.addEventListener("DOMContentLoaded", () => {

const timerContainer = document.getElementById("timer-container");
const timer = new Timer(timerContainer);

const toolContainer = document.getElementById('tool-container');

let splitViewEnabled = false; // initialize
let rightSlideIndex = 0; // track which slide is shown on the right

const hand = new Button(toolContainer, {
    label: '<i class="fa-solid fa-hand-pointer"></i>',
    className: 'btn'
});

const pen = new Button(toolContainer, {
    label: '<i class="fa-solid fa-pen"></i>',
    className: 'btn'
});

const highlighter = new Button(toolContainer, {
    label: '<i class="fa-solid fa-highlighter"></i>',
    className: 'btn'
});

const eraser = new Button(toolContainer, {
    label: '<i class="fa-solid fa-eraser"></i>',
    className: 'btn'
});

const toolSelector = new Selector([hand, pen, highlighter, eraser], 'btn_selected');
toolSelector.select(hand);

const shapeSidebar = document.getElementById('shape-sidebar');

const lineShapeBtn = new Button(shapeSidebar, {
    label: '<i class="fa-solid fa-minus"></i>',
    className: 'btn'
});

const rectShapeBtn = new Button(shapeSidebar, {
    label: '<i class="fa-regular fa-square"></i>',
    className: 'btn'
});

const circleShapeBtn = new Button(shapeSidebar, {
    label: '<i class="fa-regular fa-circle"></i>',
    className: 'btn'
});

const triangleShapeBtn = new Button(shapeSidebar, {
    label: `
    <svg viewBox="0 0 24 24" width="18" height="18"
         fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
        <polygon points="6,4 20,12 6,20"></polygon>
    </svg>
    `,
    className: 'btn'
});

const shapeSelector = new Selector(
    [lineShapeBtn, rectShapeBtn, circleShapeBtn, triangleShapeBtn],
    'btn_selected'
);

function clearShapeSelection() {
    shapeSelector.buttons.forEach(btn => btn.el.classList.remove('btn_selected'));
}

function setShapeSidebarVisible(isVisible) {
    shapeSidebar.style.display = isVisible ? 'flex' : 'none';
    document.body.classList.toggle('shape-tools-visible', isVisible);
    updateFloatingPanel();
}

const colors = ['#eeeeee', '#e74c3c', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#333333'];
const colorContainer = document.getElementById('color-picker');

const colorBtns = colors.map(color => {
    const btn = new Button(colorContainer, {
        className: 'color-swatch',
    });
    btn.el.style.background = color;
    return btn;
});

const colorSelector = new Selector(colorBtns, 'color-selected');
colorSelector.select(colorBtns[6]);

const navContainer = document.getElementById('nav-container');

const prevBtn = new Button(navContainer, {
    label: '<i class="fa-solid fa-arrow-left"></i>',
    className: 'btn'
});

const nextBtn = new Button(navContainer, {
    label: '<i class="fa-solid fa-arrow-right"></i>',
    className: 'btn'
});

const addBlankBtn = new Button(navContainer, {
    label: '<i class="fa-solid fa-file-circle-plus"></i>',
    className: 'btn'
});
addBlankBtn.el.title = "Add Blank Page";
addBlankBtn.el.style.marginLeft = '10px';
addBlankBtn.onClick(() => {
    insertBlankAfterCurrent();
});

const deleteBlankBtn = new Button(navContainer, {
    label: '<i class="fa-solid fa-trash"></i>',
    className: 'btn'
});
deleteBlankBtn.el.title = "Delete Blank Page";
deleteBlankBtn.el.style.marginLeft = '10px';
deleteBlankBtn.onClick(() => {
    deleteCurrentBlank();
});

const splitViewButtonContainer = document.getElementById('split-view-button-container');

const splitViewBtn = new Button(splitViewButtonContainer, {
    label: '<i class="fa-solid fa-columns"></i>',
    className: 'btn'
});

splitViewBtn.onClick(() => {
    splitViewEnabled = !splitViewEnabled;
    document.body.classList.toggle('split-view-active', splitViewEnabled);

    if (splitViewEnabled) {
        // Update button icon to show it's active
        splitViewBtn.el.innerHTML = '<i class="fa-solid fa-xmark"></i>';

        // Initialize second canvases now that container is visible
        setTimeout(() => {
            initializeSecondCanvases();

            // Set right slide to an adjacent logical slide on each open
            rightSlideIndex = (currentSlide + 1 < slideStructure.length)
                ? currentSlide + 1
                : Math.max(0, currentSlide - 1);

            // Populate right navigator
            populateSlideNavigator();
            populateSlideNavigatorRight();

            // Resize all canvases after layout settles
            setTimeout(async () => {
                saveCurrentAnnotations();
                annCvs.resizeOnly();
                pdfCvs.resizeOnly();
                if (annCvs2) annCvs2.resizeOnly();
                if (pdfCvs2) pdfCvs2.resizeOnly();

                // Re-render slides at new sizes
                if (zipFile) {
                    await renderLogicalSlide(currentSlide);
                    await renderLogicalSlideRight(rightSlideIndex);
                }

                // Restore the current pointer mode on both canvases
                setPointerModeAll(annCvs.pointer_mode);
            }, 100);
        }, 50);
    } else {
        // Reset button icon
        splitViewBtn.el.innerHTML = '<i class="fa-solid fa-columns"></i>';

        // Resize canvases back to full size
        setTimeout(async () => {
            saveCurrentAnnotations();
            annCvs.resizeOnly();
            pdfCvs.resizeOnly();

            // Re-render main slide at full size
            if (zipFile) {
                await renderLogicalSlide(currentSlide);
            }

            // Refresh navigator after leaving split view
            populateSlideNavigator();
            updateBlankSlideButtons();
        }, 100);
    }
});

const brushContainer = document.getElementById('brush-controls');

const brushMinusBtn = new Button(brushContainer, {
    label: '<i class="fa-solid fa-minus"></i>',
    className: 'btn'
});

const brushSizeLbl = new Label(brushContainer, {
    id: 'brush_size_scroll',
    className: 'brush_size_scroll',
    initial: '2'
});

const brushPlusBtn = new Button(brushContainer, {
    label: '<i class="fa-solid fa-plus"></i>',
    className: 'btn'
});

const otherControlsContainer = document.getElementById('other-controls');

const undoBtn = new Button(otherControlsContainer, {
    className: 'btn',
    label: '<i class="fa-solid fa-rotate-left"></i>'
});

undoBtn.el.id = 'undo-btn';
undoBtn.el.style.marginLeft = '15px';
undoBtn.el.style.marginRight = '5px';

const redoBtn = new Button(otherControlsContainer, {
    className: 'btn',
    label: '<i class="fa-solid fa-rotate-right"></i>'
});

redoBtn.el.id = 'redo-btn';
redoBtn.el.style.marginRight = '5px';

const clearBtn = new Button(otherControlsContainer, {
    className: 'btn',
    label: '<i class="fa-solid fa-broom"></i>'
});

clearBtn.el.id = 'clear-btn';
clearBtn.el.style.marginRight = '20px';

const displayControls = document.getElementById('display-controls');

const uploadBtn = new Button(displayControls, {
    className: 'btn',
    label: '<i class="fa-solid fa-folder-open"></i>',
});

const screenShareContainer = document.getElementById('screen-share-container');

const screenShareBtn = new Button(screenShareContainer, {
    className: 'btn',
    label: '<i class="fa-solid fa-desktop"></i>',
});

// Initially disabled until presentation is loaded
screenShareBtn.el.disabled = true;
screenShareBtn.el.style.opacity = '0.5';
screenShareBtn.el.style.cursor = 'not-allowed';

// Create recording button
const recordContainer = document.getElementById('record-container');

const recordBtn = new Button(recordContainer, {
    className: 'btn',
    label: '<i class="fa-solid fa-circle"></i>',
});

// Initially disabled until presentation is loaded
recordBtn.el.disabled = true;
recordBtn.el.style.opacity = '0.5';
recordBtn.el.style.cursor = 'not-allowed';

// Create floating annotation panel toggle button for mobile
const annotationToggleBtn = document.createElement('button');
annotationToggleBtn.id = 'annotation-panel-toggle';
annotationToggleBtn.className = 'btn';
annotationToggleBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
annotationToggleBtn.title = 'Annotation Tools';

// Insert after nav-container instead of in display-controls
const navContainerElement = document.getElementById('nav-container');
const controlsLeft = document.querySelector('.controls-left');
if (navContainerElement && navContainerElement.nextSibling) {
    controlsLeft.insertBefore(annotationToggleBtn, navContainerElement.nextSibling);
} else if (navContainerElement) {
    navContainerElement.parentNode.insertBefore(annotationToggleBtn, navContainerElement.nextSibling);
} else {
    controlsLeft.appendChild(annotationToggleBtn);
}

// Create floating annotation panel
const floatingPanel = document.createElement('div');
floatingPanel.id = 'floating-annotation-panel';
document.body.appendChild(floatingPanel);

// Function to populate floating panel on mobile
function updateFloatingPanel() {
    const toolContainer = document.getElementById('tool-container');
    const shapeSidebar = document.getElementById('shape-sidebar');
    const colorPicker = document.getElementById('color-picker');
    const brushControls = document.getElementById('brush-controls');
    const otherControls = document.getElementById('other-controls');
    const controlsRight = document.querySelector('.controls-right');

    const undoBtnEl = document.getElementById('undo-btn');
    const redoBtnEl = document.getElementById('redo-btn');
    const clearBtnEl = document.getElementById('clear-btn');

    if (window.innerWidth <= 1300) {
        // Move elements to floating panel on mobile
        floatingPanel.replaceChildren();

        // Tools section
        const toolsSection = document.createElement('div');
        toolsSection.className = 'panel-section';
        if (toolContainer) toolsSection.appendChild(toolContainer);
        floatingPanel.appendChild(toolsSection);

        // Shape tools section
        // always append the section if shapeSidebar exists,
        // otherwise the sidebar can get detached from the DOM and "disappear".
        const shapeSection = document.createElement('div');
        shapeSection.className = 'panel-section';
        if (shapeSidebar) {
            shapeSection.appendChild(shapeSidebar);
            floatingPanel.appendChild(shapeSection);
        }

        // Colors section
        const colorsSection = document.createElement('div');
        colorsSection.className = 'panel-section';
        if (colorPicker) colorsSection.appendChild(colorPicker);
        floatingPanel.appendChild(colorsSection);
        
        // Brush controls section
        const brushSection = document.createElement('div');
        brushSection.className = 'panel-section';
        if (brushControls) brushSection.appendChild(brushControls);
        floatingPanel.appendChild(brushSection);
        
        // Undo/Redo/Clear section - move individual buttons from other-controls
        const actionSection = document.createElement('div');
        actionSection.className = 'panel-section';
        const undoBtnEl = document.getElementById('undo-btn');
        const redoBtnEl = document.getElementById('redo-btn');
        const clearBtnEl = document.getElementById('clear-btn');
        if (undoBtnEl) actionSection.appendChild(undoBtnEl);
        if (redoBtnEl) actionSection.appendChild(redoBtnEl);
        if (clearBtnEl) actionSection.appendChild(clearBtnEl);
        if (actionSection.children.length > 0) floatingPanel.appendChild(actionSection);

        // Show toggle button on mobile
        annotationToggleBtn.style.display = 'inline-flex';
    } else {
        // Move elements back to controls-right on desktop

        // Move undo/redo/clear back to other-controls in the correct order
        if (otherControls) {
            const undoBtnEl = document.getElementById('undo-btn');
            const redoBtnEl = document.getElementById('redo-btn');
            const clearBtnEl = document.getElementById('clear-btn');
        }

        // Insert in correct order at the beginning of other-controls
        if (undoBtnEl && otherControls && !otherControls.contains(undoBtnEl)) {
            otherControls.insertBefore(undoBtnEl, otherControls.firstChild);
        }
        if (redoBtnEl && otherControls && !otherControls.contains(redoBtnEl)) {
            otherControls.insertBefore(
                redoBtnEl,
                undoBtnEl ? undoBtnEl.nextSibling : otherControls.firstChild
            );
        }
        if (clearBtnEl && otherControls && !otherControls.contains(clearBtnEl)) {
            otherControls.insertBefore(
                clearBtnEl,
                redoBtnEl ? redoBtnEl.nextSibling : otherControls.firstChild
            );
        }

        // Insert elements back in correct order
        if (toolContainer && !controlsRight.contains(toolContainer)) {
            controlsRight.insertBefore(toolContainer, otherControls || controlsRight.firstChild);
        }

        if (shapeSidebar && !controlsRight.contains(shapeSidebar)) {
            if (toolContainer && toolContainer.parentNode === controlsRight) {
                controlsRight.insertBefore(shapeSidebar, toolContainer.nextSibling);
            } else {
                controlsRight.insertBefore(
                    shapeSidebar,
                    colorPicker || otherControls || controlsRight.firstChild
                );
            }
        }

        if (colorPicker && !controlsRight.contains(colorPicker)) {
            controlsRight.insertBefore(colorPicker, otherControls || controlsRight.firstChild);
        }
        if (brushControls && !controlsRight.contains(brushControls)) {
            controlsRight.insertBefore(brushControls, otherControls || controlsRight.firstChild);
        }

        // Clear floating panel after moving elements
        floatingPanel.replaceChildren();

        // Hide toggle button and floating panel on desktop
        annotationToggleBtn.style.display = 'none';
        floatingPanel.classList.remove('visible');
    }
    updateFloatingPanelSize();
}

function updateFloatingPanelSize() {
    if (!floatingPanel) return;

    const isSmallScreen = window.innerWidth <= 1300;
    if (!isSmallScreen) {
        floatingPanel.style.width = '';
        floatingPanel.style.maxWidth = '';
        return;
    }

    const mode = annCvs?.pointer_mode;

    // Hand mode: compact toolbar
    if (mode === 'hand') {
        floatingPanel.style.width = '840px';
        floatingPanel.style.maxWidth = '92vw';
        return;
    }

    // Drawing-related modes: slightly longer toolbar to fit shape tools nicely
    floatingPanel.style.width = '1220px';
    floatingPanel.style.maxWidth = '102vw';
}

// Initialize and listen for resize
updateFloatingPanel();
window.addEventListener('resize', updateFloatingPanel);

// Make floating panel draggable
let isDragging = false;
let currentX;
let currentY;
let initialX;
let initialY;
let xOffset = 0;
let yOffset = 0;

floatingPanel.addEventListener('mousedown', dragStart);
floatingPanel.addEventListener('touchstart', dragStart);
document.addEventListener('mousemove', drag);
document.addEventListener('touchmove', drag);
document.addEventListener('mouseup', dragEnd);
document.addEventListener('touchend', dragEnd);

function dragStart(e) {
    // Only start drag if clicking on the panel background, not on buttons
    if (e.target === floatingPanel || e.target.classList.contains('panel-section')) {
        if (e.type === 'touchstart') {
            initialX = e.touches[0].clientX - xOffset;
            initialY = e.touches[0].clientY - yOffset;
        } else {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
        }
        isDragging = true;
        floatingPanel.style.cursor = 'grabbing';
    }
}

function drag(e) {
    if (isDragging) {
        e.preventDefault();

        if (e.type === 'touchmove') {
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
        floatingPanel.style.cursor = 'grab';
    }
}

function setTranslate(xPos, yPos, el) {
    el.style.transform = `translate(${xPos}px, ${yPos}px)`;
}

// Set initial cursor
floatingPanel.style.cursor = 'grab';

// Toggle panel visibility
annotationToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    floatingPanel.classList.toggle('visible');
});

// Close panel when clicking outside
document.addEventListener('click', (e) => {
    const isMobileLayout = window.innerWidth <= 1300;

    // Keep panel open on small screens while annotating
    if (isMobileLayout && annCvs.pointer_mode !== 'hand') return;

    if (
        !floatingPanel.contains(e.target) &&
        e.target !== annotationToggleBtn &&
        !annotationToggleBtn.contains(e.target)
    ) {
        floatingPanel.classList.remove('visible');
    }
});

// Keep list of controls for enabling/disabling (upload button remains enabled)
const __beamer_controls = [
    hand, pen, highlighter, eraser,
    lineShapeBtn, rectShapeBtn, circleShapeBtn, triangleShapeBtn,
    ...colorBtns,
    brushMinusBtn, brushPlusBtn,
    prevBtn, nextBtn,
    addBlankBtn, deleteBlankBtn,
    splitViewBtn,
    undoBtn, redoBtn,
    clearBtn
];

// Disable at startup
setControlsEnabledAfterUpload(false, __beamer_controls);

// Full set used for temporary disabling (includes upload button)
const __beamer_all_buttons = [...__beamer_controls, uploadBtn];

const ann_canvas_container = document.getElementById('ann-canvas');
const annCvs = new Canvas(ann_canvas_container);
const slide_canvas_container = document.getElementById('pdf-canvas');
const pdfCvs = new Canvas(slide_canvas_container, false);

const ann_canvas_container2 = document.getElementById('ann-canvas-2');
let annCvs2 = null;  // Lazily initialized when split view is activated
const slide_canvas_container2 = document.getElementById('pdf-canvas-2');
let pdfCvs2 = null;  // Lazily initialized when split view is activated

// Initialize the second set of canvases (called when split view is first activated)
function initializeSecondCanvases() {
    if (!annCvs2) {
        annCvs2 = new Canvas(ann_canvas_container2);
        annCvs2.setHistoryChangeHandler(updateHistoryButtons);
        annCvs2.setPointerMode('hand'); // right side is always view-only
    }
    if (!pdfCvs2) {
        pdfCvs2 = new Canvas(slide_canvas_container2, false);
    }
}

const updateHistoryButtons = () => {
    undoBtn.el.disabled = !annCvs.canUndo();
    redoBtn.el.disabled = !annCvs.canRedo();
};

function updateBlankSlideButtons() {
    const currentObj = slideStructure[currentSlide];
    const isBlankSlide = currentObj?.type === 'blank';

    deleteBlankBtn.el.disabled = !isBlankSlide;
    deleteBlankBtn.el.style.opacity = isBlankSlide ? '1' : '0.5';
    deleteBlankBtn.el.style.cursor = isBlankSlide ? 'pointer' : 'not-allowed';
}

annCvs.setHistoryChangeHandler(updateHistoryButtons);
updateHistoryButtons();

// Set pointer mode on left canvas only — right is always hand (view-only)
function setPointerModeAll(mode) {
    annCvs.setPointerMode(mode);
    if (annCvs2) annCvs2.setPointerMode('hand');
}

function setShapeToolAll(shape) {
    annCvs.setShapeTool(shape);
}

function setShapeModeAll(mode) {
    annCvs.setShapeMode(mode);
}

hand.onClick(() => setPointerModeAll('hand'));
pen.onClick(() => setPointerModeAll('draw'));
highlighter.onClick(() => setPointerModeAll('highlight'));
eraser.onClick(() => setPointerModeAll('erase'));

lineShapeBtn.onClick(() => {
    setShapeToolAll('line');
    setPointerModeAll('shape');
    shapeSelector.select(lineShapeBtn);
    setShapeSidebarVisible(true);
    updateFloatingPanelSize();
});

rectShapeBtn.onClick(() => {
    setShapeToolAll('rectangle');
    setPointerModeAll('shape');
    shapeSelector.select(rectShapeBtn);
    setShapeSidebarVisible(true);
    updateFloatingPanelSize();
});

circleShapeBtn.onClick(() => {
    setShapeToolAll('circle');
    setPointerModeAll('shape');
    shapeSelector.select(circleShapeBtn);
    setShapeSidebarVisible(true);
    updateFloatingPanelSize();
});

triangleShapeBtn.onClick(() => {
    setShapeToolAll('triangle');
    setPointerModeAll('shape');
    shapeSelector.select(triangleShapeBtn);
    setShapeSidebarVisible(true);
    updateFloatingPanelSize();
});

function onToolSelected(selected) {
    if (selected === pen) setPointerModeAll('draw');
    else if (selected === highlighter) setPointerModeAll('highlight');
    else if (selected === eraser) setPointerModeAll('erase');

    clearShapeSelection();
    setShapeToolAll(null);

    if (selected === hand) {
        setPointerModeAll('hand');
        setShapeSidebarVisible(false);
    } else if (selected === pen) {
        setPointerModeAll('draw');
        setShapeModeAll('draw');
        setShapeSidebarVisible(true);
    } else if (selected === highlighter) {
        setPointerModeAll('highlight');
        setShapeModeAll('highlight');
        setShapeSidebarVisible(true);
    } else if (selected === eraser) {
        setPointerModeAll('erase');
        setShapeModeAll('erase');
        setShapeSidebarVisible(true);
    }
    updateFloatingPanelSize();
}

toolSelector.buttons.forEach(item => {
    item.el.addEventListener('click', () => onToolSelected(item));
});

colorBtns.forEach(btn => {
  btn.onClick(() => {
    const color = getComputedStyle(btn.el).backgroundColor;
    annCvs.setStrokeColor(color);
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
    socket.emit('clear_annotations');
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
const pdfInput = document.getElementById("upload-pdf");

uploadBtn.onClick(() => {
    showUploadModal();
});

function showUploadModal() {
    const existingModal = document.querySelector('.upload-modal-overlay');
    if (existingModal) existingModal.remove();

    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'custom-modal-content';
    modal.style.maxWidth = '500px';

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
            <button class="custom-modal-btn upload-option-btn" data-type="pdf" style="
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                padding: 0.75em 1em;
                font-size: 1rem;
            ">
                <i class="fa-solid fa-file-pdf"></i>
                <span>Upload PDF</span>
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

    modal.querySelector('[data-type="pdf"]').onclick = () => {
        overlay.remove();
        pdfInput.click();
    };

    const cancelBtn = modal.querySelector('.custom-modal-btn-cancel');
    cancelBtn.onclick = () => {
        overlay.remove();
    };
    
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
    
    // ESC key handler
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// ── Bookmark system ───────────────────────────────

const bookmarkTooltip = document.createElement('div');
bookmarkTooltip.id = 'bookmark-tooltip';
document.body.appendChild(bookmarkTooltip);

function attachTooltip(item, slideIndex) {
    item.addEventListener('mouseenter', () => {
        const name = bookmarks[slideIndex];
        if (!name) return;
        const rect = item.getBoundingClientRect();
        bookmarkTooltip.textContent = name;
        bookmarkTooltip.style.display = 'block';
        bookmarkTooltip.style.top = `${rect.top + rect.height / 2}px`;
        bookmarkTooltip.style.left = `${rect.right + 8}px`;
    });
    item.addEventListener('mouseleave', () => {
        bookmarkTooltip.style.display = 'none';
    });
}

function openBookmarkInput(item, slideIndex) {
    const label = item.querySelector('span');
    const currentName = bookmarks[slideIndex] || '';
    label.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'bookmark-input';
    input.maxLength = 20;
    input.placeholder = 'Name…';
    input.value = currentName;
    item.appendChild(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = (save) => {
        if (committed) return;
        committed = true;
        if (save) {
            const name = input.value.trim();
            if (name === '') {
                delete bookmarks[slideIndex];
            } else {
                bookmarks[slideIndex] = name;
            }
            item.classList.toggle('bookmarked', !!bookmarks[slideIndex]);
            populateBookmarkPins();

            if (splitViewEnabled) {
                populateSlideNavigatorRight();
            }
        }
        input.remove();
        label.style.display = '';
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit(true);
        if (e.key === 'Escape') commit(false);
        e.stopPropagation();
    });
    input.addEventListener('blur', () => commit(true));
}

function populateBookmarkPins() {
    const pins = document.getElementById('bookmark-pins');
    pins.innerHTML = '';

    const indices = Object.keys(bookmarks)
        .map(Number)
        .filter(index => index >= 0 && index < slideStructure.length)
        .sort((a, b) => a - b);

    // Clean up stale bookmarks that point to removed slides
    Object.keys(bookmarks).forEach((key) => {
        const index = Number(key);
        if (index < 0 || index >= slideStructure.length) {
            delete bookmarks[index];
        }
    });

    const visibleIndices = indices.filter((slideIndex) => {
        const slide = slideStructure[slideIndex];

        if (slide?.type !== 'blank') {
            return true;
        }

        const parentIsBookmarked = indices.some((index) => {
            const candidate = slideStructure[index];
            return candidate?.type === 'pdf' && candidate.pdfIndex === slide.parent;
        });

        return !parentIsBookmarked || !isParentCollapsed(slide.parent);
    });

    if (visibleIndices.length === 0) {
        pins.style.display = 'none';
        return;
    }

    pins.style.display = 'flex';

    visibleIndices.forEach((slideIndex) => {
        const slide = slideStructure[slideIndex];

        const pin = document.createElement('div');
        pin.className = 'slide-nav-item bookmarked';

        if (slide?.type === 'pdf') {
            pin.classList.add('slide-nav-parent');
            pin.style.position = 'relative';
        }

        if (slide?.type === 'blank') {
            pin.classList.add('slide-nav-child');
        }

        const label = document.createElement('span');
        label.textContent = getLogicalSlideLabel(slide, slideIndex);
        pin.appendChild(label);

        if (slide?.type === 'pdf') {
            const hasBookmarkedBlankChildren = indices.some((index) => {
                const candidate = slideStructure[index];
                return candidate?.type === 'blank' && candidate.parent === slide.pdfIndex;
            });

            if (hasBookmarkedBlankChildren) {
                const toggleBtn = document.createElement('span');
                toggleBtn.textContent = getCollapseIndicator(slide.pdfIndex);
                toggleBtn.style.position = 'absolute';
                toggleBtn.style.right = '8px';
                toggleBtn.style.top = '50%';
                toggleBtn.style.transform = 'translateY(-50%)';
                toggleBtn.style.cursor = 'pointer';
                toggleBtn.style.fontSize = '12px';
                toggleBtn.style.lineHeight = '1';

                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    toggleParentCollapsed(slide.pdfIndex);
                };

                pin.appendChild(toggleBtn);
            }
        }

        pin.onclick = () => goToSlide(slideIndex);
        attachTooltip(pin, slideIndex);
        pins.appendChild(pin);
    });
}

function createNavItem(slideIndex) {
    const item = document.createElement('div');
    item.className = 'slide-nav-item';
    if (bookmarks[slideIndex]) item.classList.add('bookmarked');
    item.dataset.slideIndex = slideIndex;

    const slide = slideStructure[slideIndex];

    const label = document.createElement('span');
    label.textContent = getLogicalSlideLabel(slide, slideIndex);
    item.appendChild(label);

    let holdFired = false;
    addHoldListener(item, () => {
        holdFired = true;
        openBookmarkInput(item, slideIndex);
    }, 500);

    item.addEventListener('click', () => {
        if (holdFired) {
            holdFired = false;
            return;
        }
        goToSlide(slideIndex);
    });

    attachTooltip(item, slideIndex);
    return item;
}

function getLogicalSlideLabel(slide, logicalIndex) {
    if (!slide) return String(logicalIndex + 1);

    if (slide.type === 'pdf') {
        return String(slide.pdfIndex + 1);
    }

    if (slide.type === 'blank') {
        const letter = String.fromCharCode(96 + slide.subIndex);
        return `${slide.parent + 1}.${letter}`;
    }

    return String(logicalIndex + 1);
}

function getBlankChildren(parentPdfIndex) {
    return slideStructure.filter(
        s => s.type === 'blank' && s.parent === parentPdfIndex
    );
}

function isParentCollapsed(parentPdfIndex) {
    return collapsedParents.has(parentPdfIndex);
}

function getCollapseIndicator(parentPdfIndex) {
    const collapsed = isParentCollapsed(parentPdfIndex);

    if (splitViewEnabled) {
        return collapsed ? '▾' : '▸';
    }

    return collapsed ? '▸' : '▾';
}

function toggleParentCollapsed(parentPdfIndex) {
    if (collapsedParents.has(parentPdfIndex)) {
        collapsedParents.delete(parentPdfIndex);
    } else {
        collapsedParents.add(parentPdfIndex);
    }

    populateSlideNavigator();

    if (splitViewEnabled) {
        populateSlideNavigatorRight();
    }
}

function populateSlideNavigator() {
    const navigator = document.getElementById('slide-navigator');
    const pins = document.getElementById('bookmark-pins');

    navigator.innerHTML = '';
    navigator.appendChild(pins);

    for (let i = 0; i < slideStructure.length; i++) {
        const slide = slideStructure[i];

        // PDF slide
        if (slide.type === 'pdf') {
            const item = createNavItem(i);
            item.dataset.slideIndex = i;
            item.classList.add('slide-nav-parent');
            item.style.position = 'relative';

            const blankChildren = getBlankChildren(slide.pdfIndex);

            if (blankChildren.length > 0) {
                const toggleBtn = document.createElement('span');
                toggleBtn.textContent = getCollapseIndicator(slide.pdfIndex);
                toggleBtn.style.position = 'absolute';
                toggleBtn.style.right = '8px';
                toggleBtn.style.top = '50%';
                toggleBtn.style.transform = 'translateY(-50%)';
                toggleBtn.style.cursor = 'pointer';
                toggleBtn.style.fontSize = '12px';
                toggleBtn.style.lineHeight = '1';

                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    toggleParentCollapsed(slide.pdfIndex);
                };

                item.appendChild(toggleBtn);
            }

            navigator.appendChild(item);
            continue;
        }

        // Blank child slide
        if (slide.type === 'blank') {
            if (isParentCollapsed(slide.parent)) {
                continue;
            }

            const item = createNavItem(i);
            item.classList.add('slide-nav-child');

            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.justifyContent = 'center';
            item.style.boxSizing = 'border-box';
            item.style.paddingLeft = '0';
            item.style.fontSize = '0.95em';

            navigator.appendChild(item);
        }
    }

    updateSlideNavigator();
    populateBookmarkPins();

    if (splitViewEnabled) {
        populateSlideNavigatorRight();
    }
}

function updateSlideNavigator() {
    const items = document.querySelectorAll('#slide-navigator .slide-nav-item');

    items.forEach((item) => {
        const slideIndex = Number(item.dataset.slideIndex);

        if (slideIndex === currentSlide) {
            item.classList.add('active');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}

function populateSlideNavigatorRight() {
    const navigator = document.getElementById('slide-navigator-right');
    navigator.innerHTML = '';

    for (let i = 0; i < slideStructure.length; i++) {
        const slide = slideStructure[i];

        if (slide.type === 'pdf') {
            const item = document.createElement('div');
            item.className = 'slide-nav-item slide-nav-parent';
            if (bookmarks[i]) item.classList.add('bookmarked');
            item.dataset.slideIndex = i;
            item.style.position = 'relative';

            const label = document.createElement('span');
            label.textContent = getLogicalSlideLabel(slide, i);
            item.appendChild(label);

            attachTooltip(item, i);

            const blankChildren = getBlankChildren(slide.pdfIndex);

            if (blankChildren.length > 0) {
                const toggleBtn = document.createElement('span');
                toggleBtn.textContent = getCollapseIndicator(slide.pdfIndex);
                toggleBtn.style.position = 'absolute';
                toggleBtn.style.right = '8px';
                toggleBtn.style.top = '50%';
                toggleBtn.style.transform = 'translateY(-50%)';
                toggleBtn.style.cursor = 'pointer';
                toggleBtn.style.fontSize = '12px';
                toggleBtn.style.lineHeight = '1';

                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    toggleParentCollapsed(slide.pdfIndex);
                };

                item.appendChild(toggleBtn);
            }

            item.onclick = async () => {
                if (i === currentSlide) return;
                rightSlideIndex = i;
                await renderLogicalSlideRight(i);
                updateSlideNavigatorRight();
            };

            navigator.appendChild(item);
            continue;
        }

        if (slide.type === 'blank') {
            if (isParentCollapsed(slide.parent)) {
                continue;
            }

            const item = document.createElement('div');
            item.className = 'slide-nav-item slide-nav-child';
            if (bookmarks[i]) item.classList.add('bookmarked');
            item.dataset.slideIndex = i;

            const label = document.createElement('span');
            label.textContent = getLogicalSlideLabel(slide, i);
            item.appendChild(label);

            attachTooltip(item, i);

            item.onclick = async () => {
                if (i === currentSlide) return;
                rightSlideIndex = i;
                await renderLogicalSlideRight(i);
                updateSlideNavigatorRight();
            };

            navigator.appendChild(item);
        }
    }

    updateSlideNavigatorRight();
}

function updateSlideNavigatorRight() {
    const items = document.querySelectorAll('#slide-navigator-right .slide-nav-item');

    items.forEach((item) => {
        const slideIndex = Number(item.dataset.slideIndex);

        item.classList.toggle('active', slideIndex === rightSlideIndex);
        item.classList.toggle('disabled', slideIndex === currentSlide);

        if (slideIndex === rightSlideIndex) {
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

function autoAdvanceRight() {
    const candidates = [];
    if (currentSlide + 1 < slideStructure.length) candidates.push(currentSlide + 1);
    if (currentSlide - 1 >= 0) candidates.push(currentSlide - 1);
    if (candidates.length === 0) return;
    rightSlideIndex = candidates[0];
    renderLogicalSlideRight(rightSlideIndex);
    updateSlideNavigatorRight();
}

let bookmarks = {};

let zipFile = null;
let slideConfigs = {};
let mediaCache = {};
let annotations = {};
let annotationsRight = {};
let currentSlide = 0;
let totalSlides = 0;
let slideStructure = [];
let collapsedParents = new Set();

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
annCvs.canvas.addEventListener('mouseup', () => syncAnnotations());
annCvs.canvas.addEventListener('touchend', () => syncAnnotations());

function syncAnnotations() {
    clearTimeout(annotationSyncTimeout);

    const slideIndexAtDrawTime = currentSlide;

    annotationSyncTimeout = setTimeout(() => {
        const annData = annCvs.canvas.toDataURL("image/png");
        // Save annotations locally per-slide and emit to server
        annotations[slideIndexAtDrawTime] = annData;
        socket.emit('annotation_update', {
            annotations: annData,
            slideIndex: slideIndexAtDrawTime
        });
    }, 100);
}

// Helper function to update all media element positions after resize
function updateMediaPositions() {
    // Get the container's actual size on screen
    const rect = slide_canvas_container.getBoundingClientRect();
    
    // Update videos using stored fractional positions
    const videos = slide_canvas_container.querySelectorAll('video');
    videos.forEach(video => {
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
    const models = slide_canvas_container.querySelectorAll('model-viewer');
    models.forEach(mv => {
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

function saveCurrentAnnotations() {
    const annData = annCvs.canvas.toDataURL("image/png");
    annotations[currentSlide] = annData;
    socket.emit('annotation_update', {
        annotations: annData,
        slideIndex: currentSlide
    });
}

prevBtn.onClick(() => goToSlide(currentSlide - 1));
nextBtn.onClick(() => goToSlide(currentSlide + 1));

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') goToSlide(currentSlide - 1);
    if (e.key === 'ArrowRight') goToSlide(currentSlide + 1);
});

async function goToSlide(slideIndex) {
    if (slideIndex < 0 || slideIndex >= slideStructure.length) return;

    // Save current slide before leaving it
    saveCurrentAnnotations();
    clearTimeout(annotationSyncTimeout);

    currentSlide = slideIndex;

    const currentObj = slideStructure[currentSlide];
    if (currentObj?.type === 'blank') {
        collapsedParents.delete(currentObj.parent);
    }

    await renderLogicalSlide(currentSlide);
    updateSlideNavigator();
    updateBlankSlideButtons();

    if (splitViewEnabled) {
        if (rightSlideIndex === currentSlide) {
            autoAdvanceRight();
        } else {
            updateSlideNavigatorRight();
        }
    }

    const annData = annCvs.canvas.toDataURL("image/png");
    socket.emit('slide_change', {
        slideIndex: currentSlide,
        annotations: annData
    });
}

async function renderLogicalSlide(logicalIndex) {
    const slideObj = slideStructure[logicalIndex];
    if (!slideObj) return;

    if (slideObj.type === 'pdf') {
        slide_canvas_container.style.display = 'flex';
        if (pdfCvs?.canvas) pdfCvs.canvas.style.visibility = 'visible';
        ann_canvas_container.style.background = '';

        await renderSlide(slideObj.pdfIndex);
        return;
    }

    if (slideObj.type === 'blank') {
        slide_canvas_container.style.display = 'flex';
        if (pdfCvs?.canvas) pdfCvs.canvas.style.visibility = 'hidden';
        annCvs.clear();

        try {
            if (annotations[logicalIndex]) {
                await annCvs.loadAnnotations(annotations[logicalIndex]);
            } else {
                annCvs.resetHistory();
            }
        } catch (e) {
            console.warn('Error loading annotations for blank slide', logicalIndex, e);
        }

        ann_canvas_container.style.background = 'white';
        updateHistoryButtons();
    }
}

async function renderSlide(slideIndex) {
    console.log('renderSlide called:', slideIndex);
    
    if (!zipFile) {
        console.log('No ZIP file loaded');
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

    if (pdfCvs?.canvas) pdfCvs.canvas.style.visibility = 'visible';
    await pdfCvs.renderPDFPage(page);

    // Load per-slide annotations (clear then draw saved image if present)
    try {
        annCvs.clear();
        if (annotations[currentSlide]) {
            await annCvs.loadAnnotations(annotations[currentSlide]);
        } else {
            annCvs.resetHistory();
        }
    } catch (e) {
        console.warn('Error loading annotations for slide', slideIndex, e);
    }
    
    const existingMedia = slide_canvas_container.querySelectorAll('video, audio, model-viewer');
    existingMedia.forEach(el => el.remove());
    
    cleanupWidgets(slide_canvas_container);
    
    const slideConfig = await loadSlideConfig(slideIndex);
    
    if (!slideConfig) {
        console.log('No config for this slide');
        return;
    }
    
    console.log('Videos to render:', slideConfig.videos?.length || 0);
    console.log('Models to render:', slideConfig.models?.length || 0);
    console.log('Widgets to render:', slideConfig.widgets?.length || 0);
    
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

            video.addEventListener('play', () => {
                socket.emit('video_action', {
                    videoId: v.id,
                    slideIndex: currentSlide,
                    action: 'play',
                    currentTime: video.currentTime
                });
            });

            video.addEventListener('pause', () => {
                socket.emit('video_action', {
                    videoId: v.id,
                    slideIndex: currentSlide,
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
                    slideIndex: currentSlide,
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
        renderWidgets(slideConfig, slide_canvas_container, zipFile);
    }
}

function insertBlankAfterCurrent() {
    const currentObj = slideStructure[currentSlide];
    if (!currentObj) return;

    const parentPdfIndex =
        currentObj.type === 'pdf' ? currentObj.pdfIndex : currentObj.parent;

    const blankSlide = {
        type: 'blank',
        parent: parentPdfIndex,
        subIndex: 1
    };

    let insertIndex;

    if (currentObj.type === 'blank') {
        // Add directly after the current blank page
        insertIndex = currentSlide + 1;
    } else {
        // Add after all existing blank children of this PDF page
        insertIndex = currentSlide + 1;
        while (
            insertIndex < slideStructure.length &&
            slideStructure[insertIndex].type === 'blank' &&
            slideStructure[insertIndex].parent === parentPdfIndex
        ) {
            insertIndex++;
        }
    }

    slideStructure.splice(insertIndex, 0, blankSlide);

    let counter = 1;
    slideStructure.forEach((s) => {
        if (s.type === 'blank' && s.parent === parentPdfIndex) {
            s.subIndex = counter++;
        }
    });

    collapsedParents.delete(parentPdfIndex);
    populateSlideNavigator();

    goToSlide(insertIndex);
}

function shiftAnnotationsAfterDelete(deletedIndex) {
    const newAnnotations = {};

    Object.keys(annotations).forEach((key) => {
        const index = Number(key);

        if (index < deletedIndex) {
            newAnnotations[index] = annotations[index];
        } else if (index > deletedIndex) {
            newAnnotations[index - 1] = annotations[index];
        }
        // skip deletedIndex
    });

    annotations = newAnnotations;
}

async function deleteCurrentBlank() {
    const slideObj = slideStructure[currentSlide];

    if (!slideObj || slideObj.type !== 'blank') {
        return;
    }

    const deletedIndex = currentSlide;
    const parentIndex = slideObj.parent;

    clearTimeout(annotationSyncTimeout);

    shiftAnnotationsAfterDelete(deletedIndex);

    slideStructure.splice(deletedIndex, 1);

    let counter = 1;
    slideStructure.forEach(s => {
        if (s.type === 'blank' && s.parent === parentIndex) {
            s.subIndex = counter++;
        }
    });

    let nextSlideIndex;

    // Stay at the same position if another blank now occupies it
    if (
        deletedIndex < slideStructure.length &&
        slideStructure[deletedIndex].type === 'blank' &&
        slideStructure[deletedIndex].parent === parentIndex
    ) {
        nextSlideIndex = deletedIndex;
    }

    // Otherwise move to the previous blank sibling if it exists
    else if (
        deletedIndex - 1 >= 0 &&
        slideStructure[deletedIndex - 1].type === 'blank' &&
        slideStructure[deletedIndex - 1].parent === parentIndex
    ) {
        nextSlideIndex = deletedIndex - 1;
    }

    // Finally, fall back to the parent PDF slide
    else {
        nextSlideIndex = slideStructure.findIndex(
            s => s.type === 'pdf' && s.pdfIndex === parentIndex
        );
    }

    currentSlide = nextSlideIndex;
    populateSlideNavigator();
    await renderLogicalSlide(currentSlide);
    updateSlideNavigator();
    updateBlankSlideButtons();

    const annData = annCvs.canvas.toDataURL("image/png");
    socket.emit('slide_change', {
        slideIndex: currentSlide,
        annotations: annData
    });
}

async function renderLogicalSlideRight(logicalIndex) {
    const slideObj = slideStructure[logicalIndex];
    if (!slideObj || !splitViewEnabled || !pdfCvs2 || !annCvs2) return;

    if (slideObj.type === 'pdf') {
        slide_canvas_container2.style.display = 'flex';
        if (pdfCvs2?.canvas) pdfCvs2.canvas.style.visibility = 'visible';
        ann_canvas_container2.style.background = '';
        await renderSlideRight(slideObj.pdfIndex, logicalIndex);
        return;
    }

    if (slideObj.type === 'blank') {
        slide_canvas_container2.style.display = 'flex';
        if (pdfCvs2?.canvas) pdfCvs2.canvas.style.visibility = 'hidden';
        annCvs2.clear();

        try {
            if (annotations[logicalIndex]) {
                await annCvs2.loadAnnotations(annotations[logicalIndex]);
            } else {
                annCvs2.resetHistory();
            }
        } catch (e) {
            console.warn('Error loading right annotations for blank slide', logicalIndex, e);
        }

        ann_canvas_container2.style.background = 'white';
    }
}

// Render a slide on the right (split view) canvas - full featured with widgets and annotations
async function renderSlideRight(slideIndex, logicalIndex = null) {
    if (!zipFile || !splitViewEnabled || !pdfCvs2 || !annCvs2) return;

    const pdfFile = zipFile.file("slides.pdf");
    if (!pdfFile) return;

    const pdfData = await pdfFile.async("arraybuffer");
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const page = await pdfDoc.getPage(slideIndex + 1);

    await pdfCvs2.renderPDFPage(page);

    const effectiveLogicalIndex =
        logicalIndex !== null
            ? logicalIndex
            : slideStructure.findIndex(s => s.type === 'pdf' && s.pdfIndex === slideIndex);

    // Load annotations for the corresponding logical slide
    try {
        annCvs2.clear();
        if (effectiveLogicalIndex !== -1 && annotations[effectiveLogicalIndex]) {
            await annCvs2.loadAnnotations(annotations[effectiveLogicalIndex]);
        } else {
            annCvs2.resetHistory();
        }
    } catch (e) {
        console.warn('Error loading right annotations for slide', slideIndex, e);
    }

    // Remove existing media from right container
    const existingMedia = slide_canvas_container2.querySelectorAll('video, audio, model-viewer');
    existingMedia.forEach(el => el.remove());

    cleanupWidgets(slide_canvas_container2);

    const slideConfig = await loadSlideConfig(slideIndex);

    if (!slideConfig) {
        return;
    }

    // Get container's actual size for positioning all media elements
    const containerRect = slide_canvas_container2.getBoundingClientRect();

    if (slideConfig.videos) {
        for (const v of slideConfig.videos) {
            const videoURL = await loadMediaFromPath(v.path);
            if (!videoURL) continue;

            const video = document.createElement("video");
            video.src = videoURL;
            video.volume = v.volume || 1.0;
            video.dataset.videoId = v.id + '-right';

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

            video.addEventListener('click', (ev) => {
                try {
                    if (video.paused) video.play();
                    else video.pause();
                } catch (e) {
                    console.error('Error toggling video playback:', e);
                }
                ev.stopPropagation();
            });

            slide_canvas_container2.appendChild(video);
        }
    }

    if (slideConfig.models) {
        for (const m of slideConfig.models) {
            const modelURL = await loadMediaFromPath(m.path);
            if (!modelURL) continue;

            const mv = document.createElement("model-viewer");
            mv.src = modelURL;
            mv.alt = m.alt || "3D model";
            mv.dataset.modelId = m.id + '-right';

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

            slide_canvas_container2.appendChild(mv);
        }
    }

    if (slideConfig.widgets) {
        renderWidgets(slideConfig, slide_canvas_container2, zipFile);
    }
}

// Save right annotations when switching slides
function saveRightAnnotations() {
    if (splitViewEnabled && annCvs2 && annCvs2.canvas) {
        annotationsRight[rightSlideIndex] = annCvs2.canvas.toDataURL('image/png');
    }
}

folderInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;
    console.log('Folder selected with', files.length, 'files');

    const uploadModal = Modal.loading('Uploading Presentation', 'Please wait while your presentation is uploaded...');

    // Create a ZIP file from the selected folder
    const zip = new JSZip();
    
    // Add all files to the ZIP, preserving folder structure
    for (const file of files) {
        // Get the relative path from the file's webkitRelativePath
        const relativePath = file.webkitRelativePath;
        // Remove the first folder name to get the path relative to the selected folder
        const pathParts = relativePath.split('/');
        const zipPath = pathParts.slice(1).join('/');
        
        if (zipPath) {
            const fileData = await file.arrayBuffer();
            zip.file(zipPath, fileData);
        }
    }
    
    console.log('Creating ZIP from folder...');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    const formData = new FormData();
    formData.append('file', zipBlob, 'presentation.zip');

    try {
        const response = await fetch('/api/presentation/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        console.log('Upload response:', data);

        if (data.success) {
            await loadAvailableModels();

            console.log(`Presentation uploaded with ${data.models_found} Summarizer Script`);
            if (data.models && data.models.length > 0) {
                console.log('Available AI models:', data.models);
            }
        }
    } catch (error) {
        console.error('Error uploading presentation:', error);
        uploadModal.close();
        Modal.error('Upload Failed', 'Failed to upload presentation. Please try again.');
        return;
    }
    
    // Load the ZIP we just created into memory for frontend use
    zipFile = zip;
    console.log('ZIP loaded into memory');
    
    const pdfFile = zipFile.file("slides.pdf");
    if (!pdfFile) {
        console.error("The uploaded package is not a valid Beamer+ presentation (no slides.pdf found).");
        uploadModal.close();
        Modal.error('Invalid Presentation', 'The uploaded package is not a valid Beamer+ presentation.');
        return;
    }
    
    const pdfData = await pdfFile.async("arraybuffer");
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    totalSlides = pdfDoc.numPages;
    
    console.log(`Total slides: ${totalSlides}`);

    slideStructure = [];
    for (let i = 0; i < totalSlides; i++) {
        slideStructure.push({
            type: 'pdf',
            pdfIndex: i
        });
    }

    currentSlide = 0;
    slideConfigs = {};
    mediaCache = {};
    annotations = {};

    await renderLogicalSlide(0);

    // Populate slide navigator
    populateSlideNavigator();
    updateBlankSlideButtons();

    // Locate the slide that contains the survey_result widget (if any)
    await locateSurveyWidgetSlide();

    socket.emit('presentation_loaded', {
        totalSlides: totalSlides
    });
    // Enable controls now that a presentation is loaded
    uploadModal.close();
    setControlsEnabledAfterUpload(true, __beamer_controls);
    updateBlankSlideButtons();
    
    // Enable screen share button
    screenShareBtn.el.disabled = false;
    screenShareBtn.el.style.opacity = '1';
    screenShareBtn.el.style.cursor = 'pointer';
    
    // Enable record button
    recordBtn.el.disabled = false;
    recordBtn.el.style.opacity = '1';
    recordBtn.el.style.cursor = 'pointer';
    
    updateHistoryButtons();
});

zipInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    console.log('ZIP file selected:', file.name);

    const uploadModal = Modal.loading('Uploading Presentation', 'Please wait while your presentation is uploaded...');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/presentation/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        console.log('Upload response:', data);

        if (data.success) {
            await loadAvailableModels();

            console.log(`Presentation uploaded with ${data.models_found} Summarizer Script`);
            if (data.models && data.models.length > 0) {
                console.log('Available AI models:', data.models);
            }
        }
    } catch (error) {
        console.error('Error uploading presentation:', error);
        uploadModal.close();
        Modal.error('Upload Failed', 'Failed to upload presentation. Please try again.');
        return;
    }
    
    // Load the ZIP into memory for frontend use
    const reader = new FileReader();
    reader.onload = async (event) => {
        zipFile = await JSZip.loadAsync(event.target.result);
        console.log('ZIP loaded into memory');
        
        const pdfFile = zipFile.file("slides.pdf");
        if (!pdfFile) {
            console.error("The uploaded package is not a valid Beamer+ presentation (no slides.pdf found).");
            uploadModal.close();
            Modal.error('Invalid Presentation', 'The uploaded package is not a valid Beamer+ presentation.');
            return;
        }
        
        const pdfData = await pdfFile.async("arraybuffer");
        const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
        totalSlides = pdfDoc.numPages;
        
        console.log(`Total slides: ${totalSlides}`);

        slideStructure = [];
        for (let i = 0; i < totalSlides; i++) {
            slideStructure.push({
                type: 'pdf',
                pdfIndex: i
            });
        }

        currentSlide = 0;
        slideConfigs = {};
        mediaCache = {};
        annotations = {};

        await renderLogicalSlide(0);

        // Populate slide navigator
        populateSlideNavigator();
        updateBlankSlideButtons();

        // Locate the slide that contains the survey_result widget (if any)
        await locateSurveyWidgetSlide();

        socket.emit('presentation_loaded', {
            totalSlides: totalSlides
        });
        // Enable controls now that a presentation is loaded
        uploadModal.close();
        setControlsEnabledAfterUpload(true, __beamer_controls);
        updateBlankSlideButtons();
        
        // Enable screen share button
        screenShareBtn.el.disabled = false;
        screenShareBtn.el.style.opacity = '1';
        screenShareBtn.el.style.cursor = 'pointer';
        
        // Enable record button
        recordBtn.el.disabled = false;
        recordBtn.el.style.opacity = '1';
        recordBtn.el.style.cursor = 'pointer';
        
        updateHistoryButtons();
    };
    reader.readAsArrayBuffer(file);
});

pdfInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pdfInput.value = '';

    const uploadModal = Modal.loading('Loading Presentation', 'Please wait while your presentation is loaded...');

    try {
        const pdfArrayBuffer = await file.arrayBuffer();

        const zip = new JSZip();
        zip.file('slides.pdf', pdfArrayBuffer);

        const pdfDoc = await pdfjsLib.getDocument({ data: pdfArrayBuffer }).promise;
        totalSlides = pdfDoc.numPages;

        zipFile = zip;

        slideStructure = [];
        for (let i = 0; i < totalSlides; i++) {
            slideStructure.push({
                type: 'pdf',
                pdfIndex: i
            });
        }

        currentSlide = 0;
        slideConfigs = {};
        mediaCache = {};
        annotations = {};
        annotationsRight = {};
        bookmarks = {};
        collapsedParents = new Set();

        await renderLogicalSlide(0);
        populateSlideNavigator();
        updateBlankSlideButtons();
        await locateSurveyWidgetSlide();

        socket.emit('presentation_loaded', { totalSlides });
        uploadModal.close();
        setControlsEnabledAfterUpload(true, __beamer_controls);
        updateBlankSlideButtons();

        screenShareBtn.el.disabled = false;
        screenShareBtn.el.style.opacity = '1';
        screenShareBtn.el.style.cursor = 'pointer';

        recordBtn.el.disabled = false;
        recordBtn.el.style.opacity = '1';
        recordBtn.el.style.cursor = 'pointer';

        updateHistoryButtons();
    } catch (err) {
        console.error('Error loading PDF:', err);
        uploadModal.close();
        Modal.error('Invalid File', 'Could not load the PDF. Please try again.');
    }
});

async function loadAvailableModels() {
    try {
        const response = await fetch('/api/models');
        const data = await response.json();
        availableModels = data.models || [];
        console.log('Available AI models:', availableModels);
    } catch (error) {
        console.error('Error loading models:', error);
        availableModels = [];
    }
}

let currentSurveyResults = null; // { summaries, model, num_responses }
let currentSurveyData = null;    // { survey_id, url, question, model, num_summaries, ... }
let currentSurveyResponseCount = 0;

// listeners used by the widget to live-update the response count
const __surveyCountSubscribers = new Set();

// caches the first slide index that contains the survey_result widget (if any)
let surveyWidgetSlideIndex = null;

// Find the first slide that contains a survey_result widget.
async function locateSurveyWidgetSlide() {
    surveyWidgetSlideIndex = null;
    if (!zipFile || !totalSlides) return;

    for (let i = 0; i < totalSlides; i++) {
        const cfg = await loadSlideConfig(i);
        const widgets = cfg?.widgets || [];
        if (widgets.some(w => w.type === 'survey_result')) {
            surveyWidgetSlideIndex = i;
            break;
        }
    }
}

function __notifySurveyCountSubscribers() {
    for (const cb of __surveyCountSubscribers) {
        try { cb(currentSurveyResponseCount); } catch (e) { /* ignore */ }
    }
}

// Expose a parent API for the survey_result widget (iframe) to call.
window.beamerSurvey = {
    getAvailableModels: () => Array.isArray(availableModels) ? [...availableModels] : [],

    getState: () => ({
        survey: currentSurveyData,
        responseCount: currentSurveyResponseCount,
        results: currentSurveyResults
    }),

    subscribeResponseCount: (cb) => {
        if (typeof cb !== 'function') return () => {};
        __surveyCountSubscribers.add(cb);
        // immediate sync
        cb(currentSurveyResponseCount);
        return () => __surveyCountSubscribers.delete(cb);
    },

    // Create survey and start collecting responses (does NOT block slide navigation).
    createSurvey: async ({ question, model, num_summaries }) => {
        if (!zipFile) throw new Error('Please upload a presentation first.');
        if (!model) throw new Error('No model selected.');

        const resp = await fetch('/api/survey/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, model, num_summaries })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to create survey');

        currentSurveyData = { ...data, question, model, num_summaries };
        currentSurveyResults = null;
        currentSurveyResponseCount = 0;
        __notifySurveyCountSubscribers();

        socket.emit('survey_show', data);

        return {
            ...data,
            full_url: `${window.location.origin}${data.url}`
        };
    },

    // Close survey + generate summaries.
    generateSummaries: async () => {
        if (!currentSurveyData) throw new Error('No survey exists. Create one first.');

        // close the survey server-side
        try {
            await fetch(`/api/survey/${currentSurveyData.survey_id}/close`, { method: 'POST' });
            socket.emit('survey_close', { survey_id: currentSurveyData.survey_id });
        } catch (e) {
            // non-fatal; continue
        }

        // ensure there is at least one response (widget disables button until then)
        const resResp = await fetch(`/api/survey/${currentSurveyData.survey_id}/responses`);
        const resData = await resResp.json();
        if (!resResp.ok) throw new Error(resData.error || 'Failed to load responses');
        if (!Array.isArray(resData.responses) || resData.responses.length === 0) {
            throw new Error('No responses yet.');
        }

        const analyzeResponse = await fetch(`/api/survey/${currentSurveyData.survey_id}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const analysisData = await analyzeResponse.json();
        if (!analyzeResponse.ok) throw new Error(analysisData.error || 'Analysis failed');

        currentSurveyResults = {
            summaries: analysisData.summaries,
            model: analysisData.model,
            num_responses: analysisData.num_responses
        };

        return currentSurveyResults;
    },

    // Optional reset helper (not currently used by the widget UI)
    reset: async () => {
        if (currentSurveyData?.survey_id) {
            try { await fetch(`/api/survey/${currentSurveyData.survey_id}/close`, { method: 'POST' }); } catch (e) {}
        }
        currentSurveyData = null;
        currentSurveyResults = null;
        currentSurveyResponseCount = 0;
        __notifySurveyCountSubscribers();
    }
};

window.beamerWordCloud = {
    goToNextPdfSlide: async () => {
        const currentPdfIndex = slideStructure[currentSlide]?.pdfIndex;
        if (currentPdfIndex == null) return;

        const nextPdfIndex = currentPdfIndex + 1;
        const nextLogicalIndex = slideStructure.findIndex(
            s => s.type === 'pdf' && s.pdfIndex === nextPdfIndex
        );

        if (nextLogicalIndex !== -1) {
            await goToSlide(nextLogicalIndex);
        }
    },

    goToPdfSlide: async (pdfIndex) => {
        const logicalIndex = slideStructure.findIndex(
            s => s.type === 'pdf' && s.pdfIndex === pdfIndex
        );

        if (logicalIndex !== -1) {
            await goToSlide(logicalIndex);
        }
    },

    getCurrentPdfIndex: () => slideStructure[currentSlide]?.pdfIndex ?? null
};

// Update response counts globally (for the widget), without creating any overlays.
socket.on('survey_response', (data) => {
    if (!currentSurveyData) return;
    if (data.survey_id !== currentSurveyData.survey_id) return;

    // server sends a running total
    if (typeof data.total === 'number') {
        currentSurveyResponseCount = data.total;
        __notifySurveyCountSubscribers();
    }
});
// Add resize listener
window.addEventListener('resize', () => {
    // Resize annotation canvas to maintain proper mouse coordinate mapping
    if (annCvs) {
        annCvs.resize();
    }
    if (splitViewEnabled && annCvs2) {
        annCvs2.resize();
    }

    // Update positions of all media elements (videos, models, widgets)
    if (zipFile && slideConfigs[currentSlide]) {
        updateMediaPositions();
    }
});

// Add fullscreen change listener to handle fullscreen transitions
document.addEventListener('fullscreenchange', () => {
    // Need a small delay for the browser to finish the fullscreen transition
    setTimeout(() => {
        if (annCvs) {
            annCvs.resize();
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
        Modal.error('Recording Error', 'Please start screen sharing before recording.');
        return;
    }
    
    try {
        // Get the canvas that's being used for screen sharing
        const pdfContainer = document.getElementById('pdf-canvas');
        
        // Create a new canvas for recording
        recordingCanvas = document.createElement('canvas');
        recordingCanvas.width = pdfContainer.getBoundingClientRect().width;
        recordingCanvas.height = pdfContainer.getBoundingClientRect().height;
        
        // Create a stream from the canvas at 30 FPS
        recordingStream = recordingCanvas.captureStream(30);
        
        // Request microphone audio
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStream.getAudioTracks().forEach(track => recordingStream.addTrack(track));
        } catch (error) {
            console.warn('Microphone not captured:', error);
        }
        
        // Request system audio (will prompt user)
        try {
            audioStream = await navigator.mediaDevices.getDisplayMedia({
                video: false,
                audio: true
            });
            audioStream.getAudioTracks().forEach(track => recordingStream.addTrack(track));
        } catch (audioError) {
            console.warn('System audio not captured:', audioError);
        }
        
        // Create MediaRecorder to record in real-time
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(recordingStream, {
            mimeType: 'video/webm;codecs=vp9',
            videoBitsPerSecond: 2500000
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
        recordBtn.el.style.backgroundColor = '#e74c3c';

        console.log('Recording started');
    } catch (error) {
        console.error('Error starting recording:', error);
        Modal.error('Recording Error', 'Could not start recording: ' + error.message);
    }
}

async function stopRecording() {
    if (!isRecording || !mediaRecorder) return;

    isRecording = false;

    // Reset button appearance
    recordBtn.el.innerHTML = '<i class="fa-solid fa-circle"></i>';
    recordBtn.el.style.backgroundColor = '';

    console.log('Recording stopped. Processing video...');
    
    // Show processing modal with loading animation
    const processingModal = Modal.loading('Processing Video', 'Please wait while your recording is being processed and downloaded...');
    
    return new Promise((resolve, reject) => {
        mediaRecorder.onstop = () => {
            try {
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                
                // Download the video
                const a = document.createElement('a');
                a.href = url;
                a.download = `beamer-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                // Clean up
                recordedChunks = [];
                if (micStream) {
                    micStream.getTracks().forEach(track => track.stop());
                    micStream = null;
                }
                if (audioStream) {
                    audioStream.getTracks().forEach(track => track.stop());
                    audioStream = null;
                }
                if (recordingStream) {
                    recordingStream.getTracks().forEach(track => track.stop());
                    recordingStream = null;
                }
                recordingCanvas = null;
                
                processingModal.close();
                Modal.success('Recording Complete', 'Your video has been downloaded successfully!');
                resolve();
            } catch (error) {
                console.error('Error processing video:', error);
                processingModal.close();
                Modal.error('Recording Error', 'Failed to process video: ' + error.message);
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
                cursor: 'always', // always show cursor (other options: 'moving', 'never')
                displaySurface: 'browser' // this determines which displaySurface
                //  (tab/window/monitor) the picker defaults to. 'browser' means 'tab'.
            },
            audio: false,
            selfBrowserSurface: 'include',
            surfaceSwitching: 'exclude',
            systemAudio: 'exclude'
        });
        
        // Check if the user selected the correct surface type
        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        
        // check by regex if the user is on Safari:
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent); 
        console.log(`isSafari: ${isSafari}`);

        if (!isSafari) {
            // Verify that a browser tab was selected (not window or monitor)
            if (settings.displaySurface && settings.displaySurface !== 'browser') {
                // Stop the stream immediately
                stream.getTracks().forEach(track => track.stop());
                
                Modal.error(
                    'Wrong Source Selected', 
                    'Please select the Beamer+ browser tab (not a window or entire screen). Click the screen share button again and choose "This Tab" or the Beamer+ tab from the list.'
                );
                isScreenSharing = false;
                return;
            }
        }
        // We don't do the above check for Safari, because 'browser' screensharing
        // (i.e. tab screensharing) is not possible on Safari.

        screenStream = stream;
        isScreenSharing = true;
        
        // Update button appearance
        screenShareBtn.el.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
        
        // Create a hidden video element to capture the stream
        const video = document.createElement('video');
        video.style.display = 'none';
        video.srcObject = stream;
        video.play();
        
        document.body.appendChild(video);
        
        // Create canvas for cropping
        const cropCanvas = document.createElement('canvas');
        const cropCtx = cropCanvas.getContext('2d');
        
        // Get the canvas container dimensions
        const pdfContainer = document.getElementById('pdf-canvas');
        
        let lastFrameTime = 0;
        const frameInterval = 100; // Reduced to 10 FPS to prevent flashing
        
        // Start capturing and cropping frames
        const captureFrame = (currentTime) => {
            if (!isScreenSharing) return;
            
            // Throttle frame rate
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
                sourceX, sourceY, sourceWidth, sourceHeight,
                0, 0, cropCanvas.width, cropCanvas.height
            );
            
            // If recording, draw to recording canvas in real-time
            if (isRecording && recordingCanvas) {
                const recordingCtx = recordingCanvas.getContext('2d');
                // Update canvas size if needed
                if (recordingCanvas.width !== cropCanvas.width || recordingCanvas.height !== cropCanvas.height) {
                    recordingCanvas.width = cropCanvas.width;
                    recordingCanvas.height = cropCanvas.height;
                }
                // Draw the current frame to the recording canvas
                recordingCtx.drawImage(cropCanvas, 0, 0);
            }
            
            // Convert canvas to blob and emit to server
            cropCanvas.toBlob((blob) => {
                if (blob && isScreenSharing) {
                    // Convert blob to base64
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64data = reader.result;
                        socket.emit('screen_frame', {
                            frame: base64data,
                            width: cropCanvas.width,
                            height: cropCanvas.height
                        });
                    };
                    reader.readAsDataURL(blob);
                }
            }, 'image/jpeg', 0.75); // Reduced quality to 75% for less bandwidth
            
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
        socket.emit('screen_share_start');
        
        // Show a helper message
        console.log('Screen sharing started. Sharing Beamer+ tab.');
        
    } catch (error) {
        console.error('Error starting screen share:', error);
        
        let errorMessage = 'Could not start screen sharing.';
        if (error.name === 'NotAllowedError') {
            errorMessage = 'Screen sharing permission was denied. Please allow screen sharing and select the Beamer+ tab (choose "This Tab" option).';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'No screen sharing source was selected. Please click the button again and select the Beamer+ tab.';
        } else if (error.name === 'NotSupportedError') {
            errorMessage = 'Screen sharing is not supported in this browser. Please use Chrome, Firefox, or Edge.';
        }
        
        Modal.error('Screen Share Error', errorMessage);
        isScreenSharing = false;
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    isScreenSharing = false;
    
    // If recording is active, stop it
    if (isRecording) {
        stopRecording();
    }
    
    // Reset button appearance
    screenShareBtn.el.innerHTML = '<i class="fa-solid fa-desktop"></i>';
    screenShareBtn.el.style.backgroundColor = '';
    
    // Remove the hidden video element
    const videos = document.querySelectorAll('video[style*="display: none"]');
    videos.forEach(v => v.remove());
    
    // Notify viewers that screen sharing has stopped
    socket.emit('screen_share_stop');
}

});
