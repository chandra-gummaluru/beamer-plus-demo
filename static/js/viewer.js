import { Button } from "./button.js";

window.addEventListener("DOMContentLoaded", () => {

const switchContainer = document.getElementById("switch-container");

const switchBtn = new Button(switchContainer, {
    label: '<i class="fa-solid fa-display"></i>',
    className: 'btn'
});

});