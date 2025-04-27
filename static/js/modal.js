class Modal {
    /**
     * @param {object} opts
     * @param {string} opts.title   — the modal header text
     * @param {string} opts.message — the modal body text
     */
    constructor({ title = 'Notice', message = '' } = {}) {
      // 1) Build the DOM
      this.backdrop = document.createElement('div');
      this.backdrop.className = 'modal';
  
      const box = document.createElement('div');
      box.className = 'modal-box';
  
      const closeBtn = document.createElement('span');
      closeBtn.className = 'modal-close';
      closeBtn.innerHTML = '&times;';
  
      const h2 = document.createElement('h2');
      h2.textContent = title;
  
      const p = document.createElement('p');
      p.textContent = message;
  
      box.append(closeBtn, h2, p);
      this.backdrop.append(box);
      document.body.append(this.backdrop);
  
      // 2) Wire up events
      closeBtn.addEventListener('click', () => this.hide());
      this.backdrop.addEventListener('click', e => {
        if (e.target === this.backdrop) this.hide();
      });
    }
  
    show() {
      this.backdrop.classList.add('show');
    }
  
    hide() {
      this.backdrop.classList.remove('show');
    }
  
    /** fully remove from DOM */
    destroy() {
      this.backdrop.remove();
    }
  }
  