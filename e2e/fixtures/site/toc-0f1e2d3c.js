// Populate the sidebar (invented; the shape is that of a modern mdBook)
class LanternSidebar extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        this.innerHTML = '<ol class="chapter"><li class="chapter-item expanded "><span class="chapter-link-wrapper"><a href="index.html">Welcome to the Handbook</a></span></li><li class="part-title">Part One: Light</li><li class="chapter-item expanded "><span class="chapter-link-wrapper"><a href="ch01-intro.html"><strong aria-hidden="true">1.</strong> Introduction &amp; Aims</a></span><ol class="section"><li class="chapter-item expanded "><span class="chapter-link-wrapper"><a href="ch01-01-wicks.html"><strong aria-hidden="true">1.1.</strong> Wicks</a></span></li><li class="chapter-item expanded "><span class="chapter-link-wrapper"><a href="ch01-01-wicks.html#trimming"><strong aria-hidden="true">1.2.</strong> Trimming (same page)</a></span></li></ol><li class="chapter-item expanded "><span class="chapter-link-wrapper"><a href="ch02-quiz.html"><strong aria-hidden="true">2.</strong> A Quiz</a></span></li><li class="part-title">Part Two: Dark</li><li class="chapter-item expanded "><span class="chapter-link-wrapper"><span><strong aria-hidden="true">3.</strong> A draft chapter</span></span></li><li class="chapter-item expanded "><span class="chapter-link-wrapper"><a href="https://example.org/outside"><strong aria-hidden="true">4.</strong> Elsewhere</a></span></li><li class="spacer"></li><li class="chapter-item expanded affix "><span class="chapter-link-wrapper"><a href="ch05-afterword.html">Afterword</a></span></li><li class="chapter-item expanded affix "><span class="chapter-link-wrapper"><a href="print.html">Print</a></span></li></ol>';
        this.dataset.ready = 'true';
    }
}
window.customElements.define("lantern-sidebar", LanternSidebar);
