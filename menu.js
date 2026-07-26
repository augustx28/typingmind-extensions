(function() {
  const style = document.createElement('style');
  style.innerHTML = `
    /* =========================================
       1. Folder Icon Color Change
       ========================================= */
    svg.text-slate-400 {
      color: #DA9010 !important; 
    }

    /* =========================================
       2. Workspace & Background Overrides
       ========================================= */
    /* Overflow hidden area background */
    .md\\:pl-\\[--workspace-width\\] .flex-shrink-0 .bg-\\[--workspace-color\\] .justify-center > .overflow-hidden {
      background-color: #38383c !important;
    }

    /* Sidebar/Nav handler height adjustments */
    #nav-handler .md\\:w-\\[--sidebar-width\\] .h-\\[var\\(--workspace-height\\)\\] {
      background-color: #191919 !important;
    }

    /* Workspace color generic */
    .md\\:w-auto .flex-col .bg-\\[--workspace-color\\] {
      background-color: #191919 !important;
    }

    /* Transition opacity container (Background) */
    .md\\:w-auto .flex-col .flex-col .md\\:pl-\\[--workspace-width\\] > .transition-opacity {
      background-color: #191919 !important;
    }

    /* Navigation container */
    .md\\:w-auto .flex-col .md\\:pl-\\[--workspace-width\\] {
      background-color: #191919 !important;
    }

    /* Nav handler specific height vars */
    #nav-handler .h-\\[--workspace-height\\] .h-\\[var\\(--workspace-height\\)\\] {
      background-color: #191919 !important;
    }

    /* =========================================
       3. Navigation & Header Adjustments
       ========================================= */
    /* Svg positioning */
    #nav-handler .md\\:flex .w-5 {
      position: relative;
      top: 3px;
    }

    /* Division background color */
    #nav-handler .md\\:w-\\[--workspace-width\\] .md\\:flex {
      background-color: #191919;
    }

    /* Hide Span Tag (visibility hidden) */
    #nav-handler .md\\:flex .md\\:leading-none {
      visibility: hidden;
    }

    /* Transition opacity (Opacity Level) */
    .md\\:w-auto .flex-shrink-0 .transition-opacity {
      opacity: 0.3;
    }

    /* NEW: Hide Font Bold Elements (1st & 2nd child) */
    .md\\:pl-\\[--current-sidebar-width\\] .sm\\:block .font-bold:nth-child(1) {
      visibility: hidden;
    }

    .md\\:pl-\\[--current-sidebar-width\\] .sm\\:block .font-bold:nth-child(2) {
      visibility: hidden;
    }

   

    /* =========================================
       4. Mobile Media Queries
       ========================================= */
    /* NOTE: every rule removed from this section targeted a workspace tab by
       its child index (:nth-child(8), (10), (11)) and nudged it with
       position/left/width. Those indices only hold for one exact number of
       tabs -- installing or removing an extension that adds a tab shifts every
       later index by one, so the offsets land on the wrong tab and it overlaps
       its neighbour. Anything index-independent is kept below. If a tab needs
       nudging again, target it by [data-element-id="workspace-tab-..."], which
       does not move when the tab count changes. */

    /* Max-width: 585.991px */
    @media (max-width: 585.991px) {
      /* Span Tag positioning */
      .overflow-x-auto .justify-center .md\\:leading-none {
        position: relative;
        top: 2px;
      }
    }

    /* Max-width: 499.995px */
    @media (max-width: 499.995px) {
      /* Text white margins */
      .overflow-x-auto .justify-start .text-white {
        margin-left: 2px;
        margin-right: 2px;
      }
    }

    /* Max-width: 498.991px */
    @media (max-width: 498.991px) {
      /* Force reset transform on deep nested justify-start */
      #__next .custom-theme #nav-handler .md\\:pl-\\[--current-sidebar-width\\] .overflow-y-auto .resize-container .flex-col .custom-scrollbar .dynamic-chat-content-container .antialiased .justify-start .justify-start:nth-child(1) .justify-start {
        transform: translatex(0px) translatey(0px) !important;
      }
    }
  `;
  document.head.appendChild(style);
})();

// Remove Homepage Logo Only (Using your exact CSS)
const style = document.createElement('style');
style.innerHTML = `
  .antialiased > .justify-start > .justify-start img {
    visibility: hidden !important;
  }
`;
document.head.appendChild(style);
